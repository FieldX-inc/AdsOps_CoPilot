create extension if not exists pgcrypto;

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists data_sources (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  sheets_url text not null,
  last_refresh_status text,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists raw_import_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  platform text not null,
  row_hash text not null,
  row_json jsonb not null,
  imported_at timestamptz not null default now(),
  unique (workspace_id, row_hash)
);

create table if not exists normalized_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  date date not null,
  platform text not null,
  campaign text not null,
  adgroup text not null,
  cost numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions numeric not null default 0,
  revenue numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (workspace_id, date, platform, campaign, adgroup)
);

create table if not exists anomalies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  date date not null,
  platform text not null,
  campaign text not null,
  type text not null,
  severity text not null,
  metric_value numeric not null,
  baseline_value numeric not null,
  detail text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists help_articles (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  tags text[] not null,
  difficulty text not null,
  title text not null,
  body text not null,
  updated_at timestamptz not null default now()
);

create table if not exists app_logs (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  level text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ai_chat_sessions (
  id text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references ai_chat_sessions(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now()
);
