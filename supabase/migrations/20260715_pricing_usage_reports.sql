alter table workspaces
  add column if not exists billing_state text not null default 'pending_payment'
    check (billing_state in ('pending_payment', 'active', 'past_due', 'cancelled'));

alter table billing_subscriptions
  add column if not exists plan_id text
    check (plan_id is null or plan_id in ('minimum', 'standard', 'premium')),
  add column if not exists billing_interval text
    check (billing_interval is null or billing_interval in ('month', 'year'));

alter table workspace_members
  add column if not exists is_primary boolean not null default false;

alter table ad_accounts
  add column if not exists manager_customer_id text;

with ranked_memberships as (
  select workspace_id, user_id,
    row_number() over (partition by user_id order by created_at asc, workspace_id asc) as row_number
  from workspace_members
)
update workspace_members wm
set is_primary = ranked_memberships.row_number = 1
from ranked_memberships
where wm.workspace_id = ranked_memberships.workspace_id
  and wm.user_id = ranked_memberships.user_id;

create unique index if not exists idx_workspace_members_one_primary
  on workspace_members(user_id)
  where is_primary = true;

create table if not exists workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  token_hash text not null unique,
  invited_by_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_workspace_invitations_pending_email
  on workspace_invitations(workspace_id, lower(email))
  where accepted_at is null and revoked_at is null;

create table if not exists stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  stripe_created_at timestamptz,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  claimed_at timestamptz not null default now(),
  processed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function app.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_stripe_created_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
begin
  insert into stripe_webhook_events (
    event_id, event_type, stripe_created_at, status, claimed_at, processed_at, error_code
  ) values (
    p_event_id, p_event_type, p_stripe_created_at, 'processing', now(), null, null
  )
  on conflict (event_id) do update
  set status = 'processing',
      claimed_at = now(),
      processed_at = null,
      error_code = null,
      updated_at = now()
  where stripe_webhook_events.status = 'failed'
     or (stripe_webhook_events.status = 'processing' and stripe_webhook_events.claimed_at < now() - interval '10 minutes');
  get diagnostics affected_count = row_count;
  return affected_count > 0;
end;
$$;

create or replace function app.finish_stripe_webhook_event(
  p_event_id text,
  p_succeeded boolean,
  p_error_code text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update stripe_webhook_events
  set status = case when p_succeeded then 'processed' else 'failed' end,
      processed_at = case when p_succeeded then now() else null end,
      error_code = case when p_succeeded then null else left(coalesce(p_error_code, 'processing_failed'), 80) end,
      updated_at = now()
  where event_id = p_event_id;
$$;

revoke all on function app.claim_stripe_webhook_event(text, text, timestamptz) from public, anon, authenticated;
revoke all on function app.finish_stripe_webhook_event(text, boolean, text) from public, anon, authenticated;
grant execute on function app.claim_stripe_webhook_event(text, text, timestamptz) to service_role;
grant execute on function app.finish_stripe_webhook_event(text, boolean, text) to service_role;

alter table user_memories
  add column if not exists source_type text,
  add column if not exists source_ref text,
  add column if not exists dedupe_key text;

create unique index if not exists idx_user_memories_dedupe
  on user_memories(workspace_id, user_id, memory_type, dedupe_key)
  where dedupe_key is not null;

create table if not exists ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  source_type text not null check (source_type in ('setup', 'chat', 'scheduled_report')),
  source_id text not null,
  model text not null,
  requests integer not null default 0 check (requests >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  reasoning_tokens bigint not null default 0 check (reasoning_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  estimated_cost_microunits bigint not null default 0 check (estimated_cost_microunits >= 0),
  credit_units bigint not null default 0 check (credit_units >= 0),
  rate_version text not null,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create table if not exists report_schedules (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  interval_days integer not null default 3 check (interval_days = 3),
  timezone text not null default 'Asia/Tokyo',
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists report_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  due_at timestamptz not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'needs_reconnect', 'failed')),
  content jsonb not null default '{}'::jsonb,
  usage_event_id uuid references ai_usage_events(id) on delete set null,
  email_status text not null default 'pending'
    check (email_status in ('pending', 'delivered', 'queued', 'bounced', 'failed', 'skipped')),
  email_result jsonb not null default '{}'::jsonb,
  retry_count integer not null default 0 check (retry_count >= 0),
  error_code text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  check (period_start <= period_end)
);

create table if not exists notification_preferences (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_email_enabled boolean not null default true,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists idx_ai_usage_events_monthly
  on ai_usage_events(workspace_id, source_type, occurred_at);
create index if not exists idx_report_schedules_due
  on report_schedules(enabled, next_run_at);
create index if not exists idx_report_runs_workspace_created
  on report_runs(workspace_id, created_at desc);

drop trigger if exists set_report_schedules_updated_at on report_schedules;
create trigger set_report_schedules_updated_at
before update on report_schedules
for each row execute function app.set_updated_at();

drop trigger if exists set_report_runs_updated_at on report_runs;
create trigger set_report_runs_updated_at
before update on report_runs
for each row execute function app.set_updated_at();

drop trigger if exists set_notification_preferences_updated_at on notification_preferences;
create trigger set_notification_preferences_updated_at
before update on notification_preferences
for each row execute function app.set_updated_at();

create or replace function app.workspace_plan_id(target_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select bs.plan_id
    from billing_subscriptions bs
    where bs.workspace_id = target_workspace_id
      and bs.status in ('active', 'checkout_completed')
    order by bs.updated_at desc
    limit 1
  ), 'minimum');
$$;

create or replace function app.enforce_workspace_member_plan_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  member_limit integer;
  member_count integer;
begin
  member_limit := case app.workspace_plan_id(new.workspace_id)
    when 'premium' then 5
    else 2
  end;
  if tg_op = 'INSERT' then
    select count(*) into member_count
    from workspace_members wm
    where wm.workspace_id = new.workspace_id;
  else
    select count(*) into member_count
    from workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id <> old.user_id;
  end if;
  if member_count >= member_limit then
    raise exception 'workspace member limit reached for plan'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.enforce_ad_account_plan_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  account_limit integer;
  account_count integer;
begin
  if coalesce(new.status, '') in ('removed', 'revoked') then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and new.workspace_id = old.workspace_id
    and coalesce(old.status, '') not in ('removed', 'revoked') then
    return new;
  end if;
  account_limit := case app.workspace_plan_id(new.workspace_id)
    when 'premium' then 10
    when 'standard' then 3
    else 1
  end;
  if tg_op = 'INSERT' then
    select count(*) into account_count
    from ad_accounts aa
    where aa.workspace_id = new.workspace_id
      and coalesce(aa.status, '') not in ('removed', 'revoked');
  else
    select count(*) into account_count
    from ad_accounts aa
    where aa.workspace_id = new.workspace_id
      and aa.id <> old.id
      and coalesce(aa.status, '') not in ('removed', 'revoked');
  end if;
  if account_count >= account_limit then
    raise exception 'ad account limit reached for plan'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function app.prevent_last_workspace_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  owner_count integer;
begin
  if old.role <> 'owner' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;
  select count(*) into owner_count
  from workspace_members wm
  where wm.workspace_id = old.workspace_id
    and wm.role = 'owner';
  if owner_count <= 1 then
    raise exception 'cannot remove or demote the last workspace owner'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_workspace_members_plan_limit on workspace_members;
create trigger trg_workspace_members_plan_limit
before insert or update of workspace_id, user_id on workspace_members
for each row execute function app.enforce_workspace_member_plan_limit();

drop trigger if exists trg_ad_accounts_plan_limit on ad_accounts;
create trigger trg_ad_accounts_plan_limit
before insert or update of workspace_id, status on ad_accounts
for each row execute function app.enforce_ad_account_plan_limit();

drop trigger if exists trg_workspace_members_last_owner on workspace_members;
create trigger trg_workspace_members_last_owner
before delete or update of role on workspace_members
for each row execute function app.prevent_last_workspace_owner();

alter table ai_usage_events enable row level security;
alter table report_schedules enable row level security;
alter table report_runs enable row level security;
alter table notification_preferences enable row level security;
alter table workspace_invitations enable row level security;
alter table stripe_webhook_events enable row level security;

drop policy if exists report_schedules_member_select on report_schedules;
create policy report_schedules_member_select on report_schedules
for select to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists report_runs_member_select on report_runs;
create policy report_runs_member_select on report_runs
for select to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists notification_preferences_own_select on notification_preferences;
create policy notification_preferences_own_select on notification_preferences
for select to authenticated
using (user_id = auth.uid() and app.current_user_is_workspace_member(workspace_id));

drop policy if exists notification_preferences_own_update on notification_preferences;
create policy notification_preferences_own_update on notification_preferences
for update to authenticated
using (user_id = auth.uid() and app.current_user_is_workspace_member(workspace_id))
with check (user_id = auth.uid() and app.current_user_is_workspace_member(workspace_id));

revoke all on ai_usage_events from anon, authenticated;
revoke all on report_schedules from anon;
revoke all on report_runs from anon;
revoke all on notification_preferences from anon;
revoke all on workspace_invitations from anon, authenticated;
revoke all on stripe_webhook_events from anon, authenticated;
grant select on report_schedules to authenticated;
grant select on report_runs to authenticated;
grant select, update on notification_preferences to authenticated;

comment on table ai_usage_events is 'Server-only raw model usage and estimated cost ledger. Never expose raw token counts through customer APIs.';
comment on table report_runs is 'Idempotent three-day AI improvement report executions and delivery outcomes.';
comment on column user_memories.dedupe_key is 'Hash used to prevent duplicate stable memories within a workspace/user/type scope.';
comment on table workspace_invitations is 'Server-only email invitation records. Raw invitation tokens are never persisted.';
comment on table stripe_webhook_events is 'Server-only Stripe webhook claim ledger for idempotent processing.';

-- Rollback: stop report/webhook workers, revoke access to the additive feature tables, and drop the three membership/account safety triggers first.
-- Keep additive columns in place until usage/report data has been exported; do not drop production data automatically.
