create schema if not exists app;

create or replace function app.current_user_is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

create or replace function app.current_user_has_workspace_role(
  target_workspace_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role = any(allowed_roles)
  );
$$;

create or replace function app.workspace_has_members(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
  );
$$;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app.enforce_workspace_user_membership()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id is not null and not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = new.user_id
  ) then
    raise exception 'user_id % is not a member of workspace_id %', new.user_id, new.workspace_id
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function app.set_token_encrypted_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    tg_op = 'INSERT'
    and (new.access_token_encrypted is not null or new.refresh_token_encrypted is not null)
  ) then
    new.token_encrypted_at = coalesce(new.token_encrypted_at, now());
  elsif (
    tg_op = 'UPDATE'
    and (
      new.access_token_encrypted is distinct from old.access_token_encrypted
      or new.refresh_token_encrypted is distinct from old.refresh_token_encrypted
      or new.token_key_id is distinct from old.token_key_id
    )
  ) then
    new.token_encrypted_at = now();
  end if;

  return new;
end;
$$;

create or replace function app.prevent_workspace_without_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and old.role = 'owner' then
    if not exists (
      select 1
      from public.workspaces w
      where w.id = old.workspace_id
    ) then
      return old;
    end if;

    if not exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = old.workspace_id
        and wm.role = 'owner'
        and wm.user_id <> old.user_id
    ) then
      raise exception 'workspace_id % must keep at least one owner', old.workspace_id
        using errcode = '23514';
    end if;

    return old;
  end if;

  if tg_op = 'UPDATE'
    and old.role = 'owner'
    and (
      new.role <> 'owner'
      or new.workspace_id is distinct from old.workspace_id
      or new.user_id is distinct from old.user_id
    )
  then
    if not exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = old.workspace_id
        and wm.role = 'owner'
        and wm.user_id <> old.user_id
    ) then
      raise exception 'workspace_id % must keep at least one owner', old.workspace_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on schema app from public;
grant usage on schema app to authenticated;
revoke all on function app.current_user_is_workspace_member(uuid) from public, anon;
revoke all on function app.current_user_has_workspace_role(uuid, text[]) from public, anon;
revoke all on function app.workspace_has_members(uuid) from public, anon;
grant execute on function app.current_user_is_workspace_member(uuid) to authenticated;
grant execute on function app.current_user_has_workspace_role(uuid, text[]) to authenticated;
grant execute on function app.workspace_has_members(uuid) to authenticated;

alter table ad_platform_connections
  add column if not exists token_key_id text not null default 'v1',
  add column if not exists token_encrypted_at timestamptz;

alter table human_tasks
  add column if not exists updated_at timestamptz not null default now();

comment on column ad_platform_connections.access_token_encrypted is
  'Application-encrypted OAuth access token. Never expose to client, logs, prompts, or memory.';
comment on column ad_platform_connections.refresh_token_encrypted is
  'Application-encrypted OAuth refresh token. Never expose to client, logs, prompts, or memory.';
comment on column ad_platform_connections.token_key_id is
  'Application encryption key id used for OAuth token envelope encryption.';

drop trigger if exists trg_workspace_members_keep_owner on workspace_members;
create trigger trg_workspace_members_keep_owner
before update of workspace_id, user_id, role or delete on workspace_members
for each row execute function app.prevent_workspace_without_owner();

drop trigger if exists trg_workspaces_set_updated_at on workspaces;
create trigger trg_workspaces_set_updated_at
before update on workspaces
for each row execute function app.set_updated_at();

drop trigger if exists trg_workspace_profiles_set_updated_at on workspace_profiles;
create trigger trg_workspace_profiles_set_updated_at
before update on workspace_profiles
for each row execute function app.set_updated_at();

drop trigger if exists trg_ad_platform_connections_set_updated_at on ad_platform_connections;
create trigger trg_ad_platform_connections_set_updated_at
before update on ad_platform_connections
for each row execute function app.set_updated_at();

drop trigger if exists trg_ad_platform_connections_set_token_encrypted_at on ad_platform_connections;
create trigger trg_ad_platform_connections_set_token_encrypted_at
before insert or update of access_token_encrypted, refresh_token_encrypted, token_key_id on ad_platform_connections
for each row execute function app.set_token_encrypted_at();

drop trigger if exists trg_ad_accounts_set_updated_at on ad_accounts;
create trigger trg_ad_accounts_set_updated_at
before update on ad_accounts
for each row execute function app.set_updated_at();

drop trigger if exists trg_agent_threads_set_updated_at on agent_threads;
create trigger trg_agent_threads_set_updated_at
before update on agent_threads
for each row execute function app.set_updated_at();

drop trigger if exists trg_user_memories_set_updated_at on user_memories;
create trigger trg_user_memories_set_updated_at
before update on user_memories
for each row execute function app.set_updated_at();

drop trigger if exists trg_recommendations_set_updated_at on recommendations;
create trigger trg_recommendations_set_updated_at
before update on recommendations
for each row execute function app.set_updated_at();

drop trigger if exists trg_human_tasks_set_updated_at on human_tasks;
create trigger trg_human_tasks_set_updated_at
before update on human_tasks
for each row execute function app.set_updated_at();

drop trigger if exists trg_ad_platform_connections_membership on ad_platform_connections;
create trigger trg_ad_platform_connections_membership
before insert or update of workspace_id, user_id on ad_platform_connections
for each row execute function app.enforce_workspace_user_membership();

drop trigger if exists trg_agent_threads_membership on agent_threads;
create trigger trg_agent_threads_membership
before insert or update of workspace_id, user_id on agent_threads
for each row execute function app.enforce_workspace_user_membership();

drop trigger if exists trg_agent_messages_membership on agent_messages;
create trigger trg_agent_messages_membership
before insert or update of workspace_id, user_id on agent_messages
for each row execute function app.enforce_workspace_user_membership();

drop trigger if exists trg_user_memories_membership on user_memories;
create trigger trg_user_memories_membership
before insert or update of workspace_id, user_id on user_memories
for each row execute function app.enforce_workspace_user_membership();

drop trigger if exists trg_recommendations_membership on recommendations;
create trigger trg_recommendations_membership
before insert or update of workspace_id, user_id on recommendations
for each row execute function app.enforce_workspace_user_membership();

drop trigger if exists trg_human_tasks_membership on human_tasks;
create trigger trg_human_tasks_membership
before insert or update of workspace_id, user_id on human_tasks
for each row execute function app.enforce_workspace_user_membership();

drop trigger if exists trg_operator_feedback_membership on operator_feedback;
create trigger trg_operator_feedback_membership
before insert or update of workspace_id, user_id on operator_feedback
for each row execute function app.enforce_workspace_user_membership();

drop trigger if exists trg_agent_tool_calls_membership on agent_tool_calls;
create trigger trg_agent_tool_calls_membership
before insert or update of workspace_id, user_id on agent_tool_calls
for each row execute function app.enforce_workspace_user_membership();

drop trigger if exists trg_audit_logs_membership on audit_logs;
create trigger trg_audit_logs_membership
before insert or update of workspace_id, user_id on audit_logs
for each row execute function app.enforce_workspace_user_membership();

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table workspace_profiles enable row level security;
alter table ad_platform_connections enable row level security;
alter table ad_accounts enable row level security;
alter table campaign_snapshots enable row level security;
alter table ad_group_snapshots enable row level security;
alter table ad_daily_metrics enable row level security;
alter table agent_threads enable row level security;
alter table agent_messages enable row level security;
alter table user_memories enable row level security;
alter table recommendations enable row level security;
alter table human_tasks enable row level security;
alter table operator_feedback enable row level security;
alter table agent_tool_calls enable row level security;
alter table audit_logs enable row level security;

drop policy if exists "workspace members can read workspaces" on workspaces;
create policy "workspace members can read workspaces"
on workspaces for select
to authenticated
using (app.current_user_is_workspace_member(id));

drop policy if exists "authenticated users can create workspaces" on workspaces;
create policy "authenticated users can create workspaces"
on workspaces for insert
to authenticated
with check (auth.uid() is not null);

drop policy if exists "workspace admins can update workspaces" on workspaces;
create policy "workspace admins can update workspaces"
on workspaces for update
to authenticated
using (app.current_user_has_workspace_role(id, array['owner', 'admin']))
with check (app.current_user_has_workspace_role(id, array['owner', 'admin']));

drop policy if exists "workspace members can read memberships" on workspace_members;
create policy "workspace members can read memberships"
on workspace_members for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "first owner or admins can add memberships" on workspace_members;
create policy "first owner or admins can add memberships"
on workspace_members for insert
to authenticated
with check (
  (
    user_id = auth.uid()
    and role = 'owner'
    and not app.workspace_has_members(workspace_id)
  )
  or app.current_user_has_workspace_role(workspace_id, array['owner', 'admin'])
);

drop policy if exists "workspace admins can update memberships" on workspace_members;
create policy "workspace admins can update memberships"
on workspace_members for update
to authenticated
using (app.current_user_has_workspace_role(workspace_id, array['owner', 'admin']))
with check (app.current_user_has_workspace_role(workspace_id, array['owner', 'admin']));

drop policy if exists "workspace owners can delete memberships" on workspace_members;
create policy "workspace owners can delete memberships"
on workspace_members for delete
to authenticated
using (app.current_user_has_workspace_role(workspace_id, array['owner']));

drop policy if exists "workspace members can read profiles" on workspace_profiles;
create policy "workspace members can read profiles"
on workspace_profiles for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "workspace admins can write profiles" on workspace_profiles;
drop policy if exists "workspace admins can create profiles" on workspace_profiles;
create policy "workspace admins can create profiles"
on workspace_profiles for insert
to authenticated
with check (app.current_user_has_workspace_role(workspace_id, array['owner', 'admin']));

drop policy if exists "workspace admins can update profiles" on workspace_profiles;
create policy "workspace admins can update profiles"
on workspace_profiles for update
to authenticated
using (app.current_user_has_workspace_role(workspace_id, array['owner', 'admin']))
with check (app.current_user_has_workspace_role(workspace_id, array['owner', 'admin']));

drop policy if exists "workspace members can read ad platform connection status" on ad_platform_connections;
create policy "workspace members can read ad platform connection status"
on ad_platform_connections for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "workspace members can read ad accounts" on ad_accounts;
create policy "workspace members can read ad accounts"
on ad_accounts for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "workspace members can read campaign snapshots" on campaign_snapshots;
create policy "workspace members can read campaign snapshots"
on campaign_snapshots for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "workspace members can read ad group snapshots" on ad_group_snapshots;
create policy "workspace members can read ad group snapshots"
on ad_group_snapshots for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "workspace members can read ad daily metrics" on ad_daily_metrics;
create policy "workspace members can read ad daily metrics"
on ad_daily_metrics for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "workspace members can read agent threads" on agent_threads;
create policy "workspace members can read agent threads"
on agent_threads for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "workspace members can create own agent threads" on agent_threads;
create policy "workspace members can create own agent threads"
on agent_threads for insert
to authenticated
with check (
  user_id = auth.uid()
  and app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
);

drop policy if exists "workspace members can update own agent threads" on agent_threads;
create policy "workspace members can update own agent threads"
on agent_threads for update
to authenticated
using (
  user_id = auth.uid()
  and app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
)
with check (
  user_id = auth.uid()
  and app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
);

drop policy if exists "workspace members can read agent messages" on agent_messages;
create policy "workspace members can read agent messages"
on agent_messages for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "workspace members can create own user messages" on agent_messages;
create policy "workspace members can create own user messages"
on agent_messages for insert
to authenticated
with check (
  user_id = auth.uid()
  and role = 'user'
  and app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
);

drop policy if exists "users can read own memories" on user_memories;
create policy "users can read own memories"
on user_memories for select
to authenticated
using (
  user_id = auth.uid()
  and app.current_user_is_workspace_member(workspace_id)
);

drop policy if exists "users can write own memories" on user_memories;
drop policy if exists "users can create own memories" on user_memories;
create policy "users can create own memories"
on user_memories for insert
to authenticated
with check (
  user_id = auth.uid()
  and app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
);

drop policy if exists "users can update own memories" on user_memories;
create policy "users can update own memories"
on user_memories for update
to authenticated
using (
  user_id = auth.uid()
  and app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
)
with check (
  user_id = auth.uid()
  and app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
);

drop policy if exists "workspace members can read recommendations" on recommendations;
create policy "workspace members can read recommendations"
on recommendations for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "workspace members can write recommendations" on recommendations;
drop policy if exists "workspace members can create recommendations" on recommendations;
create policy "workspace members can create recommendations"
on recommendations for insert
to authenticated
with check (app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member']));

drop policy if exists "workspace members can update recommendations" on recommendations;
create policy "workspace members can update recommendations"
on recommendations for update
to authenticated
using (app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member']))
with check (app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member']));

drop policy if exists "workspace members can read human tasks" on human_tasks;
create policy "workspace members can read human tasks"
on human_tasks for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "workspace members can write human tasks" on human_tasks;
drop policy if exists "workspace members can create human tasks" on human_tasks;
create policy "workspace members can create human tasks"
on human_tasks for insert
to authenticated
with check (app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member']));

drop policy if exists "workspace members can update human tasks" on human_tasks;
create policy "workspace members can update human tasks"
on human_tasks for update
to authenticated
using (app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member']))
with check (app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member']));

drop policy if exists "workspace members can read operator feedback" on operator_feedback;
create policy "workspace members can read operator feedback"
on operator_feedback for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "workspace members can create own operator feedback" on operator_feedback;
create policy "workspace members can create own operator feedback"
on operator_feedback for insert
to authenticated
with check (
  user_id = auth.uid()
  and app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
);

drop policy if exists "workspace admins can read agent tool calls" on agent_tool_calls;
create policy "workspace admins can read agent tool calls"
on agent_tool_calls for select
to authenticated
using (app.current_user_has_workspace_role(workspace_id, array['owner', 'admin']));

drop policy if exists "workspace admins can read audit logs" on audit_logs;
create policy "workspace admins can read audit logs"
on audit_logs for select
to authenticated
using (
  workspace_id is not null
  and app.current_user_has_workspace_role(workspace_id, array['owner', 'admin'])
);

grant select, insert, update on workspaces to authenticated;
grant select, insert, update, delete on workspace_members to authenticated;
grant select, insert, update on workspace_profiles to authenticated;
grant select on ad_accounts to authenticated;
grant select on campaign_snapshots to authenticated;
grant select on ad_group_snapshots to authenticated;
grant select on ad_daily_metrics to authenticated;
grant select, insert, update on agent_threads to authenticated;
grant select, insert on agent_messages to authenticated;
grant select, insert, update on user_memories to authenticated;
grant select, insert, update on recommendations to authenticated;
grant select, insert, update on human_tasks to authenticated;
grant select, insert on operator_feedback to authenticated;
grant select on agent_tool_calls to authenticated;
grant select on audit_logs to authenticated;

revoke all on ad_platform_connections from anon, authenticated;
grant select (
  id,
  workspace_id,
  user_id,
  platform,
  provider_account_id,
  scopes,
  status,
  expires_at,
  last_error,
  created_at,
  updated_at,
  token_key_id,
  token_encrypted_at
) on ad_platform_connections to authenticated;

create or replace view ad_platform_connection_statuses
with (security_invoker = true)
as
select
  id,
  workspace_id,
  user_id,
  platform,
  provider_account_id,
  scopes,
  status,
  expires_at,
  last_error,
  created_at,
  updated_at
from ad_platform_connections;

grant select on ad_platform_connection_statuses to authenticated;
