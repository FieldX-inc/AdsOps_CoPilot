create table if not exists ad_setup_intakes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'ready', 'archived')),
  score integer not null default 0 check (score >= 0 and score <= 100),
  dimension_scores jsonb not null default '{}'::jsonb,
  facts jsonb not null default '{}'::jsonb,
  missing_fields text[] not null default '{}',
  generated_steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, status)
);

create table if not exists ad_setup_intake_messages (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references ad_setup_intakes(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ad_setup_intakes_workspace_user on ad_setup_intakes(workspace_id, user_id, status);
create index if not exists idx_ad_setup_intake_messages_intake on ad_setup_intake_messages(intake_id, created_at);

drop trigger if exists trg_ad_setup_intakes_updated_at on ad_setup_intakes;
create trigger trg_ad_setup_intakes_updated_at
before update on ad_setup_intakes
for each row execute function app.set_updated_at();

drop trigger if exists trg_ad_setup_intakes_membership on ad_setup_intakes;
create trigger trg_ad_setup_intakes_membership
before insert or update of workspace_id, user_id on ad_setup_intakes
for each row execute function app.enforce_workspace_user_membership();

drop trigger if exists trg_ad_setup_intake_messages_membership on ad_setup_intake_messages;
create trigger trg_ad_setup_intake_messages_membership
before insert or update of workspace_id, user_id on ad_setup_intake_messages
for each row execute function app.enforce_workspace_user_membership();

alter table ad_setup_intakes enable row level security;
alter table ad_setup_intake_messages enable row level security;

drop policy if exists "workspace members can read setup intakes" on ad_setup_intakes;
create policy "workspace members can read setup intakes"
on ad_setup_intakes for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "workspace members can create own setup intakes" on ad_setup_intakes;
create policy "workspace members can create own setup intakes"
on ad_setup_intakes for insert
to authenticated
with check (
  user_id = auth.uid()
  and app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
);

drop policy if exists "workspace members can update own setup intakes" on ad_setup_intakes;
create policy "workspace members can update own setup intakes"
on ad_setup_intakes for update
to authenticated
using (
  user_id = auth.uid()
  and app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
)
with check (
  user_id = auth.uid()
  and app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
);

drop policy if exists "workspace members can read setup intake messages" on ad_setup_intake_messages;
create policy "workspace members can read setup intake messages"
on ad_setup_intake_messages for select
to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists "workspace members can create own setup intake user messages" on ad_setup_intake_messages;
create policy "workspace members can create own setup intake user messages"
on ad_setup_intake_messages for insert
to authenticated
with check (
  user_id = auth.uid()
  and role = 'user'
  and app.current_user_has_workspace_role(workspace_id, array['owner', 'admin', 'member'])
);

grant select, insert, update on ad_setup_intakes to authenticated;
grant select, insert on ad_setup_intake_messages to authenticated;

comment on table ad_setup_intakes is
  'Workspace-scoped ad setup depth intake. Stores structured facts, readiness score, and editable human-executed setup steps; never stores platform tokens or secrets.';

comment on table ad_setup_intake_messages is
  'Conversation log for the setup_intake_agent. Workspace/user scoped and intended for human-in-the-loop ad preparation only.';
