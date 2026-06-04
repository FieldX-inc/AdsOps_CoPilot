# Deployment Runbook

この手順は staging / production に AdOps Advisor を出すための実行メモです。

## 1. Build Targets

Before building images, run the local verification suite:

```sh
npm run verify
npm run audit:production-candidate
npm run audit:completion
npm run audit:completion-note
npm run deploy:preflight
npm run deploy:preflight -- --json
npm run deploy:prereq-note
npm run deploy:next
npm run deploy:commands -- --target=staging
npm run deploy:commands -- --target=production
```

This runs env/secret placement checks, Supabase migration contract checks, Dockerfile/package-data checks, deploy config checks, script syntax checks, login-time billing gate web contract checks, web/api typecheck, production build, API route tests, and the OpenAI Agent Service pytest suite.

`npm run verify` also runs `npm run check:goal`, a static production-goal audit that fails if the OpenAI Agents SDK runtime, beginner/experienced routing, Google Ads read/write approval boundary, Stripe billing gate, staging evidence timestamps, or deploy/smoke scripts disappear from the repository contract.

`npm run verify` also runs `npm run check:smoke`, which starts local throwaway HTTP servers and proves `npm run smoke:deploy` passes only when API health, Agent health, API readiness, and deployed web HTML all satisfy the production gate.

`npm run verify` also runs `npm run check:staging-e2e`, which proves staging evidence scripts fail before any provider call when Google Ads write rollback/restore values or Stripe full-E2E confirmation notes are incomplete.

`npm run deploy:preflight` is a separate operator-machine check for Docker daemon, Google Cloud CLI auth/project, Wrangler CLI/auth, Supabase CLI/auth, Stripe CLI/auth, and GitHub CLI auth. It is intentionally not part of `npm run verify` because it depends on local cloud credentials. Use `npm run deploy:preflight -- --json` to capture a non-secret machine-readable release evidence snapshot after the plain preflight passes.

`npm run deploy:prereq-note` turns the current preflight JSON into a non-secret Markdown note with each missing operator prerequisite, remediation, verification command, and the commands to rerun after fixes.

`npm run deploy:next` runs the JSON preflight first. If preflight is still blocked it prints the remaining operator prerequisites and exits non-zero; once preflight passes it prints the next non-secret staging env check, Supabase, provider E2E, production env, final smoke, and release evidence commands.

`npm run deploy:commands -- --target=staging|production` prints copyable non-secret command templates for Artifact Registry, Cloud Run API, private Cloud Run Agent, Cloudflare Pages, Supabase migrations, provider evidence, final smoke, release evidence, and completion audit. It passes operator-owned API / Agent env files to Cloud Run with `--env-vars-file`, loads the browser-safe web env file before the Vite build, and includes `supabase link`, `supabase db push`, and `npm run e2e:supabase` before provider E2E or production smoke. It is a command plan only; secrets must still live in operator-owned env files, the hosting provider, or secret manager, and real secret values must not be pasted into shell history.

`npm run audit:production-candidate` summarizes the repository production goal contract status, full verify status, deploy preflight status, remaining operator prerequisites, the next command, and the non-secret evidence commands still needed for release proof. By default it does not run the full local `npm run verify`; use `npm run audit:production-candidate -- --with-verify` when the report itself should execute the full verify gate before claiming staging-E2E readiness.
Use `npm run audit:production-candidate -- --json` for a machine-readable status object; it includes `completionStillRequires`, `operatorPrerequisiteDetails`, and `evidenceCommands` so release notes can clearly separate code readiness from operator prerequisites and staging/provider evidence still owed.

`npm run audit:completion` is the final goal audit. It breaks the original request into OpenAI Agents SDK runtime, Google Ads read-write, Stripe billing, local verification, operator deploy prerequisites, staging/provider evidence, and final production smoke evidence. Missing requirements include `nextActions` with the non-secret command or operator remediation to run next. It intentionally exits non-zero until each requirement has current direct evidence, including `PRODUCTION_SMOKE_PASSED_AT`, `RELEASE_EVIDENCE_COLLECTED_AT`, and `RELEASE_EVIDENCE_NOTE_PATH` pointing to the filled operator-owned release evidence note after the final smoke and release evidence collector pass.

`npm run audit:completion-note` converts the completion audit JSON into a non-secret Markdown note that can be pasted at the top of the operator-owned release evidence note before filling `deploy/release-evidence.template.md`. Use `npm run audit:completion-note -- --with-verify` when the note itself should rerun local verify first.

When preflight fails, resolve the listed operator prerequisite before deployment. In practice this means Docker Desktop must be running, `gcloud auth login` and `gcloud config set project <gcp-project-id>` must be complete, `wrangler whoami` must return the Cloudflare account that owns the Pages project, `supabase projects list` must read the staging/production projects, and `stripe whoami` must return the Stripe account used for billing. Preflight now requires non-secret target markers so account mix-ups fail closed: set `GCP_PROJECT` or `EXPECTED_GCP_PROJECT`, `EXPECTED_CLOUDFLARE_ACCOUNT`, `SUPABASE_PROJECT_REF` or `EXPECTED_SUPABASE_PROJECT_REF`, and `EXPECTED_STRIPE_ACCOUNT`. The active CLI outputs must match those expected markers before `npm run deploy:preflight` can pass.

The same gate is wired in `.github/workflows/verify.yml` for push / pull request / manual runs. The workflow also builds both Docker images (`apps/api/Dockerfile` and `services/adk-agent/Dockerfile`) so container build failures are caught before staging deploy. A release candidate should have the workflow green before staging deploy.

Use `deploy/README.md` and the env templates in `deploy/` when creating hosting config:

- Cloudflare Pages: `deploy/cloudflare-pages.env.example`
- Cloud Run API: `deploy/cloud-run-api.env.example`
- Cloud Run Agent: `deploy/cloud-run-agent.env.example`
- Production Cloudflare Pages: `deploy/production-cloudflare-pages.env.example`
- Production Cloud Run API: `deploy/production-cloud-run-api.env.example`
- Production Cloud Run Agent: `deploy/production-cloud-run-agent.env.example`

Use `deploy/operator-handoff.md` for the operator's external tooling and staging evidence sequence, then use `deploy/production-readiness-checklist.md` as the final pre-production handoff sheet before setting `DEPLOYMENT_RUNBOOK_ACK=true`.

For staging / production env files, run the env check against the target file before uploading secrets:

```sh
node scripts/check-env.mjs .env.staging
node scripts/check-env.mjs .env.production
```

Production templates intentionally contain placeholders such as `replace-with-...` and evidence timestamp placeholders. They are deployment contracts, not directly uploadable env files. Copy them into real operator-only env files, replace every placeholder, then run `node scripts/check-env.mjs .env.production.api .env.production.agent .env.production.web` before uploading to Cloud Run or Cloudflare. For `APP_ENV=production`, `scripts/check-env.mjs` rejects unreplaced placeholder values. Cloud Run accepts `.env` or YAML files via `gcloud run deploy --env-vars-file=<env-file>`; the deploy command plan uses this for API and Agent service runtime env.

Set `DEPLOY_SURFACE=api` or `DEPLOY_SURFACE=agent` for Cloud Run service-specific env files. Cloudflare Pages env is inferred from `deploy/cloudflare-pages.env.example` and must remain `VITE_*` only. The deploy command plan loads the web env with `set -a; . "$WEB_ENV_FILE"; set +a; npm --workspace @adops/web run build` before `wrangler pages deploy`. Omit `DEPLOY_SURFACE` or use `DEPLOY_SURFACE=combined` only for a combined production contract file. The check intentionally fails if production env points the API at a localhost Agent Service, omits required service-specific secrets, mismatches `GOOGLE_ADS_REDIRECT_URI` from `<API_PUBLIC_ORIGIN>/oauth/google/callback`, or places server-only secrets in `VITE_*` browser variables.

After staging is deployed and a Supabase user has logged in, run the provider E2E check with that user's access token:

```sh
API_ORIGIN=https://api.staging.example.com \
AGENT_SERVICE_URL=https://agent.staging.example.com \
WORKSPACE_ID=<workspace-id> \
npm run e2e:staging
```

`npm run e2e:staging` requires `AUTH_TOKEN` and can use `UNPAID_AUTH_TOKEN` from the operator env to verify authenticated `402 billing_required`. `UNPAID_AUTH_TOKEN` is required when `CONFIRM_STRIPE_FULL_E2E=true`. Do not paste either token into command history or release evidence notes.

`npm run e2e:staging` and `npm run e2e:stripe-webhook` refuse API origins that do not look like staging/local/test before making provider calls. If a preview URL does not include an obvious staging marker, set `CONFIRM_STAGING_TARGET=true` and `STAGING_TARGET_CONFIRMATION="staging non-production environment confirmed"`.

The command checks API health/readiness, Agent `/health`, OpenAI runtime mode and `selectedRuntime`, beginner and experienced API chat through the Agent Service, API-layer write guard, Stripe billing status, Stripe Checkout session creation, unauthenticated `401 authentication_required`, unpaid-user `402 billing_required` when `UNPAID_AUTH_TOKEN` is present, Google OAuth start URL, and Google customer list. It prints `export *_STAGING_E2E_PASSED_AT=...` candidates only for sections that passed; copy only the lines backed by the current run and recorded operator evidence. `STRIPE_STAGING_E2E_PASSED_AT` is printed only when `CONFIRM_STRIPE_FULL_E2E=true`; at that point `CHECK_BILLING_GATE=true` and `UNPAID_AUTH_TOKEN` are required, and the operator must have confirmed hosted Checkout, existing customer reuse, webhook row updates, billing gate behavior, and customer/workspace mismatch rejection.

OpenAI credentials belong to the Agent Service, not the API service. API `/readiness` verifies API-to-Agent routing and staging E2E evidence; `npm run smoke:deploy` verifies the deployed Agent `/health` reports OpenAI runtime mode, `selectedRuntime=openai` or `selectedRuntime=openai_agents`, and safe OpenAI Agents logging flags before production Go. Agent `/health` reports `runtimeConfigured=true` only when `OPENAI_API_KEY` is present and the OpenAI Agents SDK package can be imported with `Agent`, `RunConfig`, and `Runner`. In `APP_ENV=production`, Agent `/health` reports `ok=false` unless OpenAI runtime and data-safety env are both configured. The API also sanitizes workspace profile, memory, feedback, recommendation, and task context before sending it to the Agent Service; secret-like keys or values must be redacted before prompt routing.

### Staging Deploy Command Template

Run this only after `npm run verify`, `npm run deploy:preflight`, target env upload, and Supabase migrations have passed. Keep real secrets in Cloud Run service env or Secret Manager; do not pass secrets directly in shell history.

```sh
export GCP_PROJECT=<gcp-project-id>
export GCP_REGION=asia-northeast1
export ARTIFACT_REPOSITORY=adops-advisor
export RELEASE_TAG=$(git rev-parse --short HEAD)
export API_SERVICE_ACCOUNT=<api-cloud-run-service-account-email>

gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" \
  --repository-format=docker \
  --location="$GCP_REGION" \
  --description="AdOps Advisor containers" || true

gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev"

docker build -f apps/api/Dockerfile \
  -t "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$ARTIFACT_REPOSITORY/adops-api:$RELEASE_TAG" .
docker push "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$ARTIFACT_REPOSITORY/adops-api:$RELEASE_TAG"

docker build -f services/adk-agent/Dockerfile \
  -t "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$ARTIFACT_REPOSITORY/adops-agent:$RELEASE_TAG" .
docker push "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$ARTIFACT_REPOSITORY/adops-agent:$RELEASE_TAG"

gcloud run deploy adops-api-staging \
  --project="$GCP_PROJECT" \
  --region="$GCP_REGION" \
  --image="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$ARTIFACT_REPOSITORY/adops-api:$RELEASE_TAG" \
  --allow-unauthenticated \
  --port=8787

gcloud run deploy adops-agent-staging \
  --project="$GCP_PROJECT" \
  --region="$GCP_REGION" \
  --image="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$ARTIFACT_REPOSITORY/adops-agent:$RELEASE_TAG" \
  --no-allow-unauthenticated \
  --port=8000

gcloud run services add-iam-policy-binding adops-agent-staging \
  --project="$GCP_PROJECT" \
  --region="$GCP_REGION" \
  --member="serviceAccount:$API_SERVICE_ACCOUNT" \
  --role="roles/run.invoker"

npm --workspace @adops/web run build
wrangler pages deploy apps/web/dist --project-name=<cloudflare-pages-project>
```

After the first deploy, set `AGENT_SERVICE_URL` on the API service to the Agent Service URL selected for the environment, then redeploy or update the API revision. The command template deploys the Agent with `--no-allow-unauthenticated`; for that private Cloud Run setup, set `AGENT_SERVICE_AUTH_MODE=google_id_token` and `AGENT_SERVICE_AUDIENCE=<agent-service-url>` on the API service. `AGENT_SERVICE_AUDIENCE` must match `AGENT_SERVICE_URL` exactly after trailing-slash normalization. Grant the API Cloud Run service account permission to invoke the Agent service with `roles/run.invoker` before enabling production traffic, then verify API-to-Agent routing with `npm run e2e:staging` and `npm run smoke:deploy`.

Production env must not rely on legacy ADK aliases. Do not set `ADK_AGENT_URL`, `USE_ADK_AGENT`, or `ADK_AGENT_TIMEOUT_MS`; use `AGENT_SERVICE_URL`, `USE_AGENT_SERVICE`, and `AGENT_SERVICE_TIMEOUT_MS` instead. Do not set Gemini fallback keys such as `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or `GEMINI_RUNTIME` on the production OpenAI Agent Service. The final `EXPECT_PRODUCTION_READY=true npm run smoke:deploy` gate requires `AGENT_SERVICE_URL` and rejects legacy ADK aliases in the operator env.

If the API cannot fetch the Cloud Run metadata identity token, `/agent/chat` returns `502 agent_service_auth_failed` and does not call the private Agent Service without an Authorization header. Treat that as an operator IAM/runtime setup failure: re-check the API service account, `roles/run.invoker`, `AGENT_SERVICE_AUTH_MODE=google_id_token`, and `AGENT_SERVICE_AUDIENCE`.

### API

```sh
docker build -f apps/api/Dockerfile -t adops-api .
docker run --rm -p 8787:8787 --env-file .env adops-api
curl http://localhost:8787/health
```

The API image uses a multi-stage build: the build stage compiles TypeScript, and the runtime stage installs production dependencies with `--omit=dev` before starting `apps/api/dist/index.js` with Node. Local `npm --workspace @adops/api run start` expects `npm --workspace @adops/api run build` to have run first.

The image includes a Docker `HEALTHCHECK` against `/health`.

### OpenAI Agent Service

```sh
docker build -f services/adk-agent/Dockerfile -t adops-agent .
docker run --rm -p 8000:8000 --env-file .env adops-agent
curl http://localhost:8000/health
```

The Agent image installs the Python package with `pip install .`; `services/adk-agent/pyproject.toml` must include `prompts/*.md` and `evals/*.json` as package data so the OpenAI orchestrator has its prompt contracts inside the container.

The image includes a Docker `HEALTHCHECK` against `/health`.

## 2. Required Production Secrets

API service:

- `APP_ENV=production`
- `WEB_ORIGIN`
- `API_PUBLIC_ORIGIN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_AUTH_SITE_URL`
- `SUPABASE_AUTH_REDIRECT_URLS`
- `SUPABASE_AUTH_GOOGLE_CLIENT_ID`
- `SUPABASE_AUTH_GOOGLE_CLIENT_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `TOKEN_ENCRYPTION_KEY_ID`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_REDIRECT_URI`
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` if manager account access is needed
- `GOOGLE_ADS_WRITE_ENABLED=true` only after staging write E2E passes
- `GOOGLE_ADS_MAX_BUDGET_AMOUNT` set to the maximum single budget write amount approved for the release
- `GOOGLE_ADS_STAGING_E2E_PASSED_AT` only after Google Ads OAuth / sync / approved write E2E passes
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_STAGING_E2E_PASSED_AT` only after Checkout / Portal / Webhook / billing gate E2E passes
- `AGENT_SERVICE_URL`
- `AGENT_SERVICE_AUTH_MODE=google_id_token` for private Cloud Run Agent, or `none` only for an intentionally public test Agent
- `AGENT_SERVICE_AUDIENCE=<agent-service-url>` when using `AGENT_SERVICE_AUTH_MODE=google_id_token`
- `USE_AGENT_SERVICE=true`
- `OPENAI_AGENT_STAGING_E2E_PASSED_AT` only after Agent `/health` and API chat E2E passes
- `DEPLOYMENT_RUNBOOK_ACK=true` only after public URLs, secret ownership, logs, and smoke command are confirmed

Agent service:

- `ADOPS_AGENT_RUNTIME=openai`
- `OPENAI_API_KEY`
- `OPENAI_AGENTS_MODEL`
- `OPENAI_AGENTS_TIMEOUT_SECONDS`
- `OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA=0`
- `OPENAI_AGENTS_DONT_LOG_MODEL_DATA=1`
- `OPENAI_AGENTS_DONT_LOG_TOOL_DATA=1`
- `ADOPS_DATABASE_URL` if DB-backed agent repository is used

Do not put service role keys, OAuth secrets, Google Ads developer tokens, Stripe secrets, or OpenAI keys in `VITE_*` variables. The Supabase Auth Google OAuth client for app login must be separate from the Google Ads OAuth client.

## 3. Supabase

Apply migrations in order:

```sh
supabase db push
```

The current production-critical migration is:

- `supabase/migrations/20260604_openai_google_write_stripe.sql`

After applying migrations, verify:

- `billing_customers` exists
- `billing_subscriptions` exists
- RLS is enabled on both billing tables
- authenticated users can select billing state for their workspace
- only server-side service role writes billing rows
- `billing_customers` enforces workspace/user membership on insert/update
- `audit_logs` accepts `google_ads.*` write events without storing OAuth tokens or secrets

Run the read-only PostgREST schema check against the deployed Supabase project:

```sh
SUPABASE_URL=https://your-staging-project.supabase.co \
npm run e2e:supabase
```

`npm run e2e:supabase` requires the Supabase service role in the operator env. Do not paste it into command history or release evidence notes.

This verifies the production-critical billing, OAuth, connection, audit, and connection-status surfaces are reachable with the expected columns after `supabase db push`. It does not prove RLS policy behavior, so keep the RLS/policy review above as a separate dashboard or SQL-console check.

## 4. Google Ads

1. Create a Google Ads OAuth client for the API service.
2. Set authorized redirect URI to `<API_ORIGIN>/oauth/google/callback`.
3. Set `GOOGLE_ADS_REDIRECT_URI` to the same value and `GOOGLE_OAUTH_STATE_STORE=db` for staging/production. `memory` is only for one-process local smoke checks.
4. Confirm `/oauth/google/start-url` returns a consent URL.
5. Complete OAuth and verify `/google/customers`. Confirm `audit_logs` has `google_ads.oauth_connected` with only non-secret metadata, and no OAuth token, refresh token, authorization code, client secret, or developer token. Google Ads access tokens expire; read/sync/write routes must refresh expired access tokens with the stored refresh token before provider calls.
6. Connect a customer and run `/sync/google`. Google Ads write routes require the target `customerId` to exist as a connected `ad_accounts` row in the same workspace before any OAuth token read or provider mutate.
7. In staging only, set `GOOGLE_ADS_WRITE_ENABLED=true`.
8. Set `GOOGLE_ADS_MAX_BUDGET_AMOUNT` high enough for the planned reversible budget write but no higher than the release owner approved.
9. Test campaign status or budget write with a reversible low-risk target, `confirmed=true`, an `approvalNote` containing the reason and rollback condition, and an explicit restore value. Campaign status write allows only `ENABLED` and `PAUSED`; do not use `REMOVED` in MVP E2E or production.
10. Confirm `audit_logs` rows are written for both the write and restore events. The audit payload must include the expected `platform=google`, `customerId`, `campaignId`, changed value, `confirmed=true`, `approvalType=explicit_user_confirmation`, `approvedByUserId`, and parseable `approvedAt`. It should preserve the non-secret reason and rollback condition, but secret-like values, `Authorization: Bearer ...`, `client_secret=...`, and token assignments in `approvalNote` must appear only as `[REDACTED]`.

Command form after OAuth is complete:

```sh
API_ORIGIN=https://api.staging.example.com \
WORKSPACE_ID=<workspace-id> \
GOOGLE_CUSTOMER_ID=1234567890 \
npm run e2e:staging
```

This command requires `AUTH_TOKEN` in the operator env.

Write E2E is intentionally opt-in. Use it only on a reversible staging/test campaign after deciding the rollback condition:

```sh
API_ORIGIN=https://api.staging.example.com \
WORKSPACE_ID=<workspace-id> \
GOOGLE_CUSTOMER_ID=1234567890 \
GOOGLE_CAMPAIGN_ID=987654321 \
CHECK_STRIPE=false \
CHECK_GOOGLE_WRITE=true \
CONFIRM_GOOGLE_WRITE=true \
GOOGLE_WRITE_ROLLBACK="restore campaign status to ENABLED after confirming audit log" \
GOOGLE_WRITE_KIND=status \
GOOGLE_WRITE_STATUS=PAUSED \
GOOGLE_RESTORE_STATUS=ENABLED \
npm run e2e:staging
```

For budget write E2E, replace the status fields with `GOOGLE_WRITE_KIND=budget`, `GOOGLE_WRITE_AMOUNT=<temporary-budget>`, and `GOOGLE_RESTORE_AMOUNT=<original-budget>`. Status write E2E accepts only `GOOGLE_WRITE_STATUS=ENABLED|PAUSED` and `GOOGLE_RESTORE_STATUS=ENABLED|PAUSED`. The API rejects budget writes above `GOOGLE_ADS_MAX_BUDGET_AMOUNT`; keep that cap explicit in staging and production evidence.

For write E2E, `GOOGLE_WRITE_ROLLBACK` and the matching `GOOGLE_RESTORE_*` value are required. `GOOGLE_WRITE_ROLLBACK` must include the reason, restore value, and observation window, and the write value must differ from the restore value so the reversible write proves both mutation and restore. The script executes the approved write, checks `/audit-logs/recent` for the write payload plus approval metadata, executes the restore value, and checks the restore audit payload plus approval metadata before printing `GOOGLE_ADS_STAGING_E2E_PASSED_AT`. Still confirm the final campaign state in Google Ads UI or API before treating the evidence as production-ready.

## 5. Stripe

1. Create a subscription Price in Stripe.
2. Set `STRIPE_PRICE_ID`.
3. Set webhook endpoint to `<API_ORIGIN>/billing/webhook`.
4. Subscribe to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Set `STRIPE_WEBHOOK_SECRET`.
6. Create a Checkout session via `/billing/checkout-session`.
7. For a workspace that already has `billing_customers.stripe_customer_id`, create another Checkout session and verify Stripe receives `customer=<existing customer>` without `customer_email`.
8. Create a Billing Portal session via `/billing/portal-session` for an existing Stripe customer and confirm `audit_logs` has `stripe.portal_session_created` without Stripe secret values or the portal URL.
9. Log in to the web app and confirm the billing gate appears before the app shell.
10. Complete checkout in test mode.
11. Verify Stripe sends UUID-formatted `metadata.workspace_id` on handled events, Checkout `metadata.workspace_id` matches `client_reference_id`, and the webhook response includes `received=true`, `handled=true`, and the expected `eventType`.
12. Verify `billing_customers` and `billing_subscriptions` are updated.
13. Reload the web app and confirm the app shell opens after `/billing/status` returns `access=active`.
14. Confirm a webhook event whose `customer` is already linked to another workspace is rejected with `400` and does not mutate billing rows.

`npm run e2e:staging` creates a Checkout session and verifies billing status shape, but it cannot complete a browser Checkout flow or simulate Stripe's hosted webhook delivery by itself. Set `CONFIRM_STRIPE_FULL_E2E=true` only after the browser checkout, existing customer reuse, webhook row updates, and login-time billing gate are manually confirmed in staging. The script also requires `CHECK_BILLING_GATE=true`, `UNPAID_AUTH_TOKEN`, and `STRIPE_FULL_E2E_CONFIRMATION` containing a short note mentioning checkout, existing customer reuse, webhook, billing gate, and customer/workspace mismatch rejection before it prints `STRIPE_STAGING_E2E_PASSED_AT`.

The billing gate is enforced in two places: the web app does not render the app shell until `/billing/status` returns `access=active`, and the API returns `401 authentication_required` for production product APIs without login and `402 billing_required` for authenticated product APIs without an active/trialing/checkout-completed subscription. Run the staging E2E with an unpaid user token in `UNPAID_AUTH_TOKEN` before setting `STRIPE_STAGING_E2E_PASSED_AT`.

In production, set `VITE_APP_ENV=production` on Cloudflare Pages. The local/staging-only "continue with demo" billing bypass is hidden when `VITE_APP_ENV=production`, and strict production API routes fail closed with `503 billing_not_configured` if Stripe secrets are missing. `/billing/checkout-session` and `/billing/portal-session` also return `503 billing_not_configured` before any Stripe API call when `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, or `STRIPE_WEBHOOK_SECRET` is unset.

To test the webhook signature and DB update path directly in staging, send a signed local test event:

```sh
API_ORIGIN=https://api.staging.example.com \
WORKSPACE_ID=<workspace-id> \
USER_ID=<user-id> \
CONFIRM_STRIPE_WEBHOOK_TEST=true \
npm run e2e:stripe-webhook
```

`npm run e2e:stripe-webhook` requires `STRIPE_WEBHOOK_SECRET` and `AUTH_TOKEN` from the operator env.

This sends signed `checkout.session.completed` and `customer.subscription.updated` test events, verifies the webhook response reports `handled=true` for each event, writes staging billing rows with synthetic Stripe IDs, and then verifies `/billing/status` returns an `active` subscription when `AUTH_TOKEN` is provided. Do not run it against production. The script prints `export STRIPE_WEBHOOK_STAGING_E2E_PASSED_AT=...` for the webhook segment only; still set `STRIPE_STAGING_E2E_PASSED_AT` only after hosted Checkout, existing customer reuse, webhook delivery, row updates, the login-time billing gate, and customer/workspace mismatch rejection are all confirmed.

Invalid, missing, expired, or mismatched Stripe webhook signatures must return `400` and must not mutate `billing_customers` or `billing_subscriptions`.
Invalid Stripe webhook `metadata.workspace_id` or `metadata.user_id` values must return `400` before billing row mutation. Checkout webhook `metadata.workspace_id` / `client_reference_id` mismatches and Stripe customer/workspace mismatches must also return `400`; do not let webhook metadata move an existing `stripe_customer_id` to another workspace.

## 6. Readiness Gate

Before production traffic:

```sh
curl <API_ORIGIN>/health
curl <API_ORIGIN>/readiness
curl <AGENT_SERVICE_URL>/health
```

Or run the deploy smoke check:

```sh
API_ORIGIN=https://api.example.com \
AGENT_SERVICE_URL=https://agent.example.com \
npm run smoke:deploy

EXPECT_PRODUCTION_READY=true \
API_ORIGIN=https://api.example.com \
AGENT_SERVICE_URL=https://agent.example.com \
WEB_ORIGIN=https://app.example.com \
npm run smoke:deploy
```

Use `EXPECT_PRODUCTION_READY=true` only for the final production gate. It requires `/readiness` production decision to be `Go`, every production check to pass, the `agent-service-modern-env` and `staging-e2e-evidence-window` checks to be present, API `/health` to report `mode=agent-proxy`, `mediaWriteEnabled=true`, `billingConfigured=true`, `supabaseConfigured=true`, and `authConfigured=true`, Agent `/health` to report OpenAI runtime with `selectedRuntime=openai` or `selectedRuntime=openai_agents` plus runtime/data-safety configuration enabled, and `WEB_ORIGIN` to return the deployed app HTML with the root element and reachable JS/CSS asset references.

Production evidence env values such as `OPENAI_AGENT_STAGING_E2E_PASSED_AT`, `GOOGLE_ADS_STAGING_E2E_PASSED_AT`, and `STRIPE_STAGING_E2E_PASSED_AT` must be ISO timestamps from the current release validation window. `scripts/check-env.mjs` rejects malformed values, future values beyond 24 hours, evidence older than 90 days, and evidence timestamps that are spread more than 7 days apart from each other.

When `EXPECT_PRODUCTION_READY=true npm run collect:release-evidence` passes, it prints `export PRODUCTION_SMOKE_PASSED_AT=...` and `export RELEASE_EVIDENCE_COLLECTED_AT=...` candidates for the final completion audit. Copy those only after the collector output and final smoke are recorded in the release evidence note, then set `RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>` before rerunning `npm run audit:completion -- --with-verify`.

Production readiness should show:

- Supabase Auth configured
- OpenAI Agent Service enabled with a non-local `AGENT_SERVICE_URL`
- Agent `/health` reports OpenAI runtime mode, `selectedRuntime=openai` or `selectedRuntime=openai_agents`, `runtimeConfigured=true`, and `dataSafetyConfigured=true`
- OpenAI Agents SDK runtime configured with server-side `OPENAI_API_KEY` on the Agent Service
- OpenAI Agents tracing/model/tool data safety env set on the Agent Service
- OpenAI Agent staging E2E evidence recorded
- Google OAuth configured
- Google Ads read/write route configured and staging E2E evidence recorded
- Stripe billing configured and staging E2E evidence recorded
- Deployment URL and secret ownership documented with runbook acknowledgement

`/readiness` may remain `No-Go` until external provider credentials, OpenAI Agent Service env, and deployment URLs are set. That is intentional; code readiness is not the same as provider readiness.
