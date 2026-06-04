# Production Readiness Checklist

Use this as the single pre-production handoff sheet. Production is not ready until every section below has evidence and `/readiness` returns production `Go`.

## 1. Code Gate

- [ ] `npm run verify` passed on the release branch.
- [ ] `npm run deploy:preflight` passed on the deployment operator machine.
- [ ] `.github/workflows/verify.yml` is green for the release branch or PR.
- [ ] API Docker image builds from `apps/api/Dockerfile`.
- [ ] Agent Docker image builds from `services/adk-agent/Dockerfile`.
- [ ] Web build output is `apps/web/dist`.

## 2. Hosting Config

- [ ] Cloudflare Pages uses only `deploy/cloudflare-pages.env.example` browser-safe keys.
- [ ] Cloud Run API uses `deploy/cloud-run-api.env.example` with real staging/production secret values.
- [ ] Cloud Run Agent uses `deploy/cloud-run-agent.env.example` with real OpenAI Agent Service values.
- [ ] Cloud Run API / Agent deployment used `--env-vars-file="$API_ENV_FILE"` and `--env-vars-file="$AGENT_ENV_FILE"` with operator-owned env files.
- [ ] Cloudflare Pages build loaded browser-safe `WEB_ENV_FILE` before `wrangler pages deploy`.
- [ ] API service env uses `AGENT_SERVICE_AUTH_MODE=google_id_token` when Agent Cloud Run is private.
- [ ] API Cloud Run service account has permission to invoke the Agent Cloud Run service.
- [ ] `gcloud run services add-iam-policy-binding <agent-service-name> --member="serviceAccount:<api-cloud-run-service-account-email>" --role="roles/run.invoker"` was applied for the private Agent Service.
- [ ] API service env has `AGENT_SERVICE_AUDIENCE=<agent-service-url>` matching `AGENT_SERVICE_URL` after trailing-slash normalization.
- [ ] API, Agent, staging E2E, and final smoke env do not set legacy ADK aliases: `ADK_AGENT_URL`, `USE_ADK_AGENT`, or `ADK_AGENT_TIMEOUT_MS`.
- [ ] `node scripts/check-env.mjs <target env files>` passed before uploading secrets.
- [ ] `WEB_ORIGIN`, `API_PUBLIC_ORIGIN`, and `AGENT_SERVICE_URL` are public staging/production URLs, not localhost.

## 3. Supabase

- [ ] `supabase link --project-ref "$SUPABASE_PROJECT_REF"` points to the intended staging/production Supabase project.
- [ ] `supabase db push` applied migrations through `supabase/migrations/20260604_openai_google_write_stripe.sql`.
- [ ] Supabase Auth Site URL equals `WEB_ORIGIN`.
- [ ] Supabase Auth Redirect URLs include `<WEB_ORIGIN>/auth/callback`.
- [ ] Supabase Google login provider is enabled with an app-login OAuth client.
- [ ] `billing_customers`, `billing_subscriptions`, `oauth_states`, `ad_platform_connections`, and `audit_logs` exist with RLS enabled.
- [ ] `billing_subscriptions.stripe_subscription_id` has a partial unique index when non-null.
- [ ] Read-only schema E2E passed after migration:

```sh
SUPABASE_URL=https://your-staging-project.supabase.co \
npm run e2e:supabase
```

- [ ] `npm run e2e:supabase` used the Supabase service role from the operator env, not from the pasted command line.

## 4. OpenAI Agent Service

- [ ] Agent env has `ADOPS_AGENT_RUNTIME=openai`.
- [ ] Agent env has server-side `OPENAI_API_KEY`.
- [ ] Agent image includes the OpenAI Agents SDK package and Agent `/health` proves it can be imported.
- [ ] Agent `/health` `runtimeDiagnostics` shows `openaiApiKeyConfigured=true`, `openaiAgentsSdkImportable=true`, `openaiAgentsSdkAvailable=true`, and no missing OpenAI Agents SDK symbols.
- [ ] OpenAI tracing/model/tool data safety env is set:
  - `OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA=0`
  - `OPENAI_AGENTS_DONT_LOG_MODEL_DATA=1`
  - `OPENAI_AGENTS_DONT_LOG_TOOL_DATA=1`
- [ ] Agent `/health` returns `mode=openai` or `mode=openai_agents`, `runtimeConfigured=true`, and `dataSafetyConfigured=true`.
- [ ] Staging E2E passed:

```sh
API_ORIGIN=https://api.staging.example.com \
AGENT_SERVICE_URL=https://agent.staging.example.com \
WORKSPACE_ID=<workspace-id> \
npm run e2e:staging
```

- [ ] `npm run e2e:staging` used `AUTH_TOKEN` and optional `UNPAID_AUTH_TOKEN` from the operator env, not from the pasted command line.
- [ ] `OPENAI_AGENT_STAGING_E2E_PASSED_AT=<timestamp>` is set only after Agent health, OpenAI runtime mode, `selectedRuntime=openai` or `selectedRuntime=openai_agents`, beginner/experienced chat, and API-layer write guard passed.

## 5. Google Ads

- [ ] Google Ads OAuth client redirect URI equals `<API_PUBLIC_ORIGIN>/oauth/google/callback`.
- [ ] `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, and `GOOGLE_ADS_REDIRECT_URI` are set on the API service.
- [ ] `GOOGLE_OAUTH_STATE_STORE=db` is set on the API service for staging and production.
- [ ] OAuth completes for the staging user.
- [ ] Expired Google Ads access token refresh is verified, or `/google/customers` and write E2E run after forcing a near-expiry token in staging.
- [ ] Customer list returns the expected Google Ads customer.
- [ ] Customer connect and `/sync/google` succeed.
- [ ] Staging write test uses a reversible campaign/budget target.
- [ ] Campaign status write uses only `ENABLED` or `PAUSED`; `REMOVED` is not used for MVP write E2E or production.
- [ ] `GOOGLE_ADS_MAX_BUDGET_AMOUNT` is set to the approved maximum single budget write amount for this release.
- [ ] Approved write request includes `approvalNote` with reason, rollback condition, and observation window.
- [ ] Approved write request does not include real secrets in `approvalNote`; if a dummy secret-like value is included for QA, the audit row stores `[REDACTED]` and does not store the raw value, `Authorization: Bearer`, or `client_secret=`.
- [ ] `GOOGLE_WRITE_ROLLBACK` includes reason, restore value, and observation window, and write value differs from restore value.
- [ ] `GOOGLE_WRITE_ROLLBACK` records the exact restore action.
- [ ] Status write E2E sets `GOOGLE_RESTORE_STATUS` to the original campaign status, or budget write E2E sets `GOOGLE_RESTORE_AMOUNT` to the original campaign budget.
- [ ] Approved write E2E passes with `CHECK_GOOGLE_WRITE=true` and `CONFIRM_GOOGLE_WRITE=true`.
- [ ] `/audit-logs/recent?eventTypePrefix=google_ads.` shows both write and restore audit rows with the expected payload values, including `confirmed=true`, `approvalType=explicit_user_confirmation`, `approvedByUserId`, and `approvedAt`.
- [ ] Web Data Connection audit review panel shows the write and restore audit rows with the expected customer, campaign, and approval metadata.
- [ ] The final campaign status or budget matches the original restore value in Google Ads.
- [ ] `GOOGLE_ADS_STAGING_E2E_PASSED_AT=<timestamp>` is set only after OAuth, sync, approved write, automated restore, final state confirmation, and audit review are complete.

## 6. Stripe

- [ ] Stripe subscription Price exists and `STRIPE_PRICE_ID` is set.
- [ ] Stripe webhook endpoint is `<API_PUBLIC_ORIGIN>/billing/webhook`.
- [ ] Stripe webhook events include:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- [ ] `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set on the API service.
- [ ] Hosted Checkout completes in staging test mode.
- [ ] Handled Stripe webhook events include `metadata.workspace_id`.
- [ ] Stripe webhook E2E confirms `received=true`, `handled=true`, and the expected `eventType`.
- [ ] Stripe customer/workspace mismatch returns `400` and does not mutate `billing_customers` or `billing_subscriptions`.
- [ ] Stripe webhook delivery updates `billing_customers` and `billing_subscriptions`.
- [ ] Login-time billing gate blocks unpaid access and opens after active subscription.
- [ ] Cloudflare Pages production env has `VITE_APP_ENV=production`, so the local/staging demo billing bypass is hidden.
- [ ] API product routes fail closed with `503 billing_not_configured` if production Stripe secrets are missing.
- [ ] API product routes return `401 authentication_required` before login and `402 billing_required` before active subscription.
- [ ] `npm run e2e:staging` passed with `CHECK_BILLING_GATE=true` and `UNPAID_AUTH_TOKEN` for the authenticated 402 path before Stripe full evidence was accepted.
- [ ] Optional direct webhook path check passed:

```sh
API_ORIGIN=https://api.staging.example.com \
WORKSPACE_ID=<workspace-id> \
USER_ID=<user-id> \
CONFIRM_STRIPE_WEBHOOK_TEST=true \
npm run e2e:stripe-webhook
```

- [ ] `npm run e2e:stripe-webhook` used `STRIPE_WEBHOOK_SECRET` and `AUTH_TOKEN` from the operator env, not from the pasted command line.
- [ ] `STRIPE_STAGING_E2E_PASSED_AT=<timestamp>` is set only after hosted Checkout, existing customer reuse, real webhook delivery, DB row updates, and login-time billing gate are confirmed.
- [ ] `STRIPE_FULL_E2E_CONFIRMATION` records checkout, existing customer reuse, webhook, billing gate, and customer/workspace mismatch rejection before Stripe staging evidence is accepted.

## 7. Final Smoke

- [ ] Deployment runbook is acknowledged with `DEPLOYMENT_RUNBOOK_ACK=true`.
- [ ] API `/health` returns `service=adops-api`, `mode=agent-proxy`, `mediaWriteEnabled=true`, `billingConfigured=true`, `supabaseConfigured=true`, and `authConfigured=true`.
- [ ] Agent `/health` returns `service=openai-agent`, OpenAI runtime mode, `selectedRuntime=openai` or `selectedRuntime=openai_agents`, `runtimeConfigured=true`, and `dataSafetyConfigured=true`.
- [ ] Agent `/health` runtime diagnostics confirm the OpenAI Agents SDK import and required SDK symbols are available.
- [ ] API `/readiness` production decision is `Go`.
- [ ] API `/readiness` includes `agent-service-modern-env=pass`.
- [ ] API `/readiness` includes `staging-e2e-evidence-window=pass`.
- [ ] Final smoke passes:

```sh
EXPECT_PRODUCTION_READY=true \
API_ORIGIN=https://api.example.com \
AGENT_SERVICE_URL=https://agent.example.com \
WEB_ORIGIN=https://app.example.com \
npm run smoke:deploy
```

- [ ] Final smoke used `AGENT_SERVICE_URL`, checked `WEB_ORIGIN` HTML/root plus JS/CSS asset references, and rejected legacy ADK aliases (`ADK_AGENT_URL`, `USE_ADK_AGENT`, `ADK_AGENT_TIMEOUT_MS`).
- [ ] `EXPECT_PRODUCTION_READY=true npm run collect:release-evidence` printed `export PRODUCTION_SMOKE_PASSED_AT=...` and `export RELEASE_EVIDENCE_COLLECTED_AT=...` after final production evidence passed.
- [ ] `PRODUCTION_SMOKE_PASSED_AT` and `RELEASE_EVIDENCE_COLLECTED_AT` were copied from the successful collector output only after the release evidence note was recorded.
- [ ] `RELEASE_EVIDENCE_NOTE_PATH` points to the filled operator-owned release evidence note and the note contains the final smoke and release evidence timestamps.

## 8. Production Go Decision

- [ ] `OPENAI_AGENT_STAGING_E2E_PASSED_AT` is set.
- [ ] `GOOGLE_ADS_STAGING_E2E_PASSED_AT` is set.
- [ ] `STRIPE_STAGING_E2E_PASSED_AT` is set.
- [ ] All `*_STAGING_E2E_PASSED_AT` values are valid ISO timestamps from this release validation window and are no more than 7 days apart.
- [ ] `DEPLOYMENT_RUNBOOK_ACK=true` is set.
- [ ] `EXPECT_PRODUCTION_READY=true npm run smoke:deploy` passed with `WEB_ORIGIN`.
- [ ] `RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>` is set for the final audit.
- [ ] `npm run audit:completion -- --with-verify` returned `overallStatus=complete`.
- [ ] No production secret is present in any `VITE_*` env or committed file.

Only after all items above are checked should the release be treated as "あとは本番trafficへ向けるだけ".
