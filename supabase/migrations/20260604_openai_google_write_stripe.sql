create table if not exists billing_customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id),
  unique (stripe_customer_id)
);

create table if not exists billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  stripe_price_id text,
  status text not null default 'incomplete',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, stripe_customer_id)
);

create index if not exists idx_billing_customers_workspace on billing_customers(workspace_id);
create index if not exists idx_billing_subscriptions_workspace on billing_subscriptions(workspace_id);
create index if not exists idx_billing_subscriptions_stripe_subscription on billing_subscriptions(stripe_subscription_id);
create unique index if not exists idx_billing_subscriptions_stripe_subscription_unique
on billing_subscriptions(stripe_subscription_id)
where stripe_subscription_id is not null;

drop trigger if exists set_billing_customers_updated_at on billing_customers;
create trigger set_billing_customers_updated_at
before update on billing_customers
for each row execute function app.set_updated_at();

drop trigger if exists set_billing_subscriptions_updated_at on billing_subscriptions;
create trigger set_billing_subscriptions_updated_at
before update on billing_subscriptions
for each row execute function app.set_updated_at();

drop trigger if exists trg_billing_customers_membership on billing_customers;
create trigger trg_billing_customers_membership
before insert or update of workspace_id, user_id on billing_customers
for each row execute function app.enforce_workspace_user_membership();

alter table billing_customers enable row level security;
alter table billing_subscriptions enable row level security;

drop policy if exists billing_customers_member_select on billing_customers;
create policy billing_customers_member_select on billing_customers
for select to authenticated
using (app.current_user_is_workspace_member(workspace_id));

drop policy if exists billing_subscriptions_member_select on billing_subscriptions;
create policy billing_subscriptions_member_select on billing_subscriptions
for select to authenticated
using (app.current_user_is_workspace_member(workspace_id));

revoke all on billing_customers from anon;
revoke all on billing_subscriptions from anon;
grant select on billing_customers to authenticated;
grant select on billing_subscriptions to authenticated;

comment on table billing_customers is 'Stripe customer mapping. Written server-side only; clients may read workspace billing state.';
comment on table billing_subscriptions is 'Stripe subscription state mirrored from Checkout and webhook events.';
comment on table audit_logs is 'Includes google_ads.* write events. Payloads must not include OAuth tokens, API keys, or Stripe secrets.';
