-- PostgREST resolves /rest/v1/rpc/* against the exposed public schema.
-- Keep the stateful implementation private in app and expose only service-role
-- wrappers so Stripe webhook claims remain idempotent without granting clients
-- access to the webhook ledger.

create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_stripe_created_at timestamptz default null
)
returns boolean
language sql
security definer
set search_path = public, app
as $$
  select app.claim_stripe_webhook_event(p_event_id, p_event_type, p_stripe_created_at);
$$;

create or replace function public.finish_stripe_webhook_event(
  p_event_id text,
  p_succeeded boolean,
  p_error_code text default null
)
returns void
language sql
security definer
set search_path = public, app
as $$
  select app.finish_stripe_webhook_event(p_event_id, p_succeeded, p_error_code);
$$;

revoke all on function public.claim_stripe_webhook_event(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_stripe_webhook_event(text, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(text, text, timestamptz) to service_role;
grant execute on function public.finish_stripe_webhook_event(text, boolean, text) to service_role;

comment on function public.claim_stripe_webhook_event(text, text, timestamptz)
  is 'Service-role PostgREST wrapper for the private Stripe webhook claim function.';
comment on function public.finish_stripe_webhook_event(text, boolean, text)
  is 'Service-role PostgREST wrapper for the private Stripe webhook completion function.';

-- Rollback:
-- drop function public.finish_stripe_webhook_event(text, boolean, text);
-- drop function public.claim_stripe_webhook_event(text, text, timestamptz);
