create table if not exists oauth_states (
  state text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('google', 'meta', 'yahoo')),
  code_verifier text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_oauth_states_expiry on oauth_states(expires_at);
create index if not exists idx_oauth_states_workspace_user on oauth_states(workspace_id, user_id);

drop trigger if exists trg_oauth_states_membership on oauth_states;
create trigger trg_oauth_states_membership
before insert or update of workspace_id, user_id on oauth_states
for each row execute function app.enforce_workspace_user_membership();

alter table oauth_states enable row level security;

drop policy if exists "oauth states are server-side only" on oauth_states;
create policy "oauth states are server-side only"
on oauth_states for all
to authenticated
using (false)
with check (false);

comment on table oauth_states is
  'Short-lived OAuth state and PKCE verifier storage. Server-side service role only; never expose code_verifier to browser or LLM.';
