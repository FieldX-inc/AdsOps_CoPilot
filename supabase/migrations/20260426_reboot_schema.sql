create extension if not exists pgcrypto;

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists workspace_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  company_description text,
  product_description text,
  target_audience text,
  conversion_definition text,
  monthly_budget numeric,
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)
);

create table if not exists ad_platform_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('google', 'meta', 'yahoo')),
  provider_account_id text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  scopes text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'connected', 'expired', 'revoked', 'error')),
  expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ad_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connection_id uuid references ad_platform_connections(id) on delete set null,
  platform text not null check (platform in ('google', 'meta', 'yahoo')),
  external_account_id text not null,
  name text not null,
  currency text,
  timezone text,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, platform, external_account_id)
);

create table if not exists campaign_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  platform text not null check (platform in ('google', 'meta', 'yahoo')),
  external_campaign_id text not null,
  name text not null,
  status text,
  objective text,
  raw jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  unique (workspace_id, platform, external_campaign_id)
);

create table if not exists ad_group_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  campaign_snapshot_id uuid references campaign_snapshots(id) on delete set null,
  platform text not null check (platform in ('google', 'meta', 'yahoo')),
  external_ad_group_id text not null,
  name text not null,
  status text,
  raw jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  unique (workspace_id, platform, external_ad_group_id)
);

create table if not exists ad_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ad_account_id uuid not null references ad_accounts(id) on delete cascade,
  platform text not null check (platform in ('google', 'meta', 'yahoo')),
  date date not null,
  external_campaign_id text,
  campaign_name text,
  external_ad_group_id text,
  ad_group_name text,
  external_ad_id text,
  ad_name text,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost numeric not null default 0,
  conversions numeric not null default 0,
  revenue numeric not null default 0,
  raw jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  unique (
    workspace_id,
    ad_account_id,
    platform,
    date,
    external_campaign_id,
    external_ad_group_id,
    external_ad_id
  )
);

create table if not exists agent_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  thread_id uuid not null references agent_threads(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists user_memories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_type text not null,
  content text not null,
  source_thread_id uuid references agent_threads(id) on delete set null,
  confidence numeric not null default 0.5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  ad_account_id uuid references ad_accounts(id) on delete set null,
  thread_id uuid references agent_threads(id) on delete set null,
  title text not null,
  conclusion text not null,
  evidence jsonb not null default '{}'::jsonb,
  diagnosis text,
  recommended_actions jsonb not null default '[]'::jsonb,
  operator_steps jsonb not null default '[]'::jsonb,
  risks text,
  observation_plan text,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  status text not null default 'suggested' check (status in ('draft', 'suggested', 'accepted', 'rejected', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists human_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  ad_account_id uuid references ad_accounts(id) on delete set null,
  recommendation_id uuid references recommendations(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  status text not null default 'suggested' check (status in ('draft', 'suggested', 'accepted', 'doing', 'done', 'rejected', 'ignored')),
  due_date date,
  created_by_agent boolean not null default true,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists operator_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  recommendation_id uuid references recommendations(id) on delete set null,
  human_task_id uuid references human_tasks(id) on delete set null,
  outcome text not null check (outcome in ('accepted', 'rejected', 'implemented', 'worked', 'did_not_work', 'unclear')),
  comment text,
  observed_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  thread_id uuid references agent_threads(id) on delete set null,
  tool_name text not null,
  input_summary jsonb not null default '{}'::jsonb,
  output_summary jsonb not null default '{}'::jsonb,
  status text not null check (status in ('started', 'succeeded', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ad_accounts_workspace on ad_accounts(workspace_id);
create index if not exists idx_ad_daily_metrics_lookup on ad_daily_metrics(workspace_id, ad_account_id, date);
create index if not exists idx_agent_threads_workspace_user on agent_threads(workspace_id, user_id);
create index if not exists idx_user_memories_workspace_user on user_memories(workspace_id, user_id);
create index if not exists idx_human_tasks_workspace_status on human_tasks(workspace_id, status);
create index if not exists idx_agent_tool_calls_thread on agent_tool_calls(thread_id);
