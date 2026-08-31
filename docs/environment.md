# Environment contract

Updated: 2026-07-15

Real secrets belong in Secret Manager, Cloud Run secret bindings, Supabase provider settings, Stripe or Cloudflare. Never commit them or copy them into Agent env.

## Web / Cloudflare Pages

Browser-safe only:

- `VITE_APP_ENV=production`
- `VITE_API_BASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_AUTH_REDIRECT_PATH=/auth/callback`

Production mode disables setup preview, auth/billing demo bypass and mock dashboard toggle. `SUPABASE_SERVICE_ROLE_KEY`, Stripe, Google OAuth secrets, OpenAI keys and Email tokens are forbidden on this surface.

## Public API and report Job

### App/auth

- `APP_ENV`, `DEPLOY_SURFACE=api`
- `WEB_ORIGIN`, `API_PUBLIC_ORIGIN`, `APP_PUBLIC_URL`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `TOKEN_ENCRYPTION_KEY` (32-byte base64), `TOKEN_ENCRYPTION_KEY_ID`
- `NOTIFICATION_SIGNING_SECRET`

### Private Agent invocation

- `AGENT_SERVICE_URL`
- `AGENT_SERVICE_AUTH_MODE=google_id_token`
- `AGENT_SERVICE_AUDIENCE`
- `USE_AGENT_SERVICE=true`
- `AGENT_SERVICE_TIMEOUT_MS`

### Google Ads

- `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_REDIRECT_URI`, optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
- `GOOGLE_OAUTH_STATE_STORE=db`
- `GOOGLE_ADS_API_VERSION` (release candidate `v24.2`; re-check at deploy time). Minor releases are tracked here for audit, while REST requests normalize that value to the major path (`v24`) required by Google Ads REST.
- `GOOGLE_ADS_MAX_BUDGET_AMOUNT`
- `GOOGLE_ADS_WRITE_ENABLED=false` at initial production release

### Stripe

- `STRIPE_API_KEY`: restricted key in production
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_API_VERSION=2026-05-27.dahlia`
- `BILLING_PLANS_JSON`: approved three monthly recurring Prices, three one-time setup-fee Prices, exact JPY amounts, and plan limits
- `PREMIUM_ONBOARDING_BOOKING_URL`: optional external booking link. Unset/invalid values fall back to `https://example.com`.

### Usage/report/email

- `MODEL_COST_CATALOG_JSON`: versioned model rates. The checked-in example records the official GPT-5.2 standard rates verified on 2026-07-15; re-verify the OpenAI model pricing page before each production release.
- `AI_CREDIT_TOKENS`
- `REPORT_JOB_MAX_RETRIES`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_EMAIL_API_TOKEN`: Email Sending permission only
- `REPORT_EMAIL_DOMAIN`, `REPORT_EMAIL_FROM_LOCAL_PART`, `REPORT_EMAIL_FROM_NAME`

The API service and report Job use the same image/env contract. The Job does not need a public listening port.

## Private Agent Service

- `APP_ENV`, `DEPLOY_SURFACE=agent`
- `ADOPS_AGENT_RUNTIME=openai`
- `OPENAI_API_KEY`, `OPENAI_AGENTS_MODEL`, `OPENAI_AGENTS_TIMEOUT_SECONDS`
- `OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA=0`
- `OPENAI_AGENTS_DONT_LOG_MODEL_DATA=1`
- `OPENAI_AGENTS_DONT_LOG_TOOL_DATA=1`

Forbidden: Supabase service role, Google Ads token/secret, Stripe key, Email API token, customer list. The service receives only sanitized scoped context from the API.

## Supabase Auth provider settings

Enable Email and Google providers. The Google login OAuth client is separate from Google Ads OAuth. Set Site URL and redirect allowlist to the deployed Cloudflare Pages URL and `/auth/callback`. API callback/CORS/Site URL must use the same approved deployment origins.

## Evidence flags

Timestamp variables such as `GOOGLE_ADS_STAGING_E2E_PASSED_AT`, `STRIPE_STAGING_E2E_PASSED_AT`, `OPENAI_AGENT_STAGING_E2E_PASSED_AT`, `PRODUCTION_SMOKE_PASSED_AT` and `RELEASE_EVIDENCE_COLLECTED_AT` are evidence pointers, not bypasses. Set them only after the corresponding run succeeded for the same commit/release window.

## Rotation requirement

Any staging DB credential exposed in terminal output during the 2026-07-15 audit must be rotated before staging is reused. Update operator-owned env and Secret Manager; do not put replacement values in Git, logs or prompts.
