# Operator Handoff

This file is the deployment operator checklist for moving the current release from verified code to a staging deploy, production readiness evidence, and final smoke. It is intentionally focused on external tooling and provider evidence because those are not proven by `npm run verify`.

Do not treat the release as production-ready until this handoff, `npm run deploy:preflight`, staging E2E evidence, production env checks, and the final `EXPECT_PRODUCTION_READY=true` smoke all pass.

Copy `deploy/release-evidence.template.md` into an operator-owned evidence note for each release candidate, fill it with non-secret URLs, timestamps, command results, and rollback ownership, and keep real secrets out of the note.

## 1. Local Operator Tools

Run this first:

```sh
npm run deploy:preflight
npm run deploy:preflight -- --json
npm run deploy:prereq-note
npm run audit:production-candidate
npm run deploy:next
```

If it fails, satisfy every required prerequisite below and rerun it until it passes. Use the plain output for interactive remediation and the `--json` output as non-secret release evidence once every required check passes; the JSON evidence must show `overallStatus=pass` and no required failures.
`npm run deploy:prereq-note` turns the blocked preflight result into a non-secret Markdown checklist with remediation and verification commands for each missing operator prerequisite.
`npm run deploy:next` refuses to print the staging/production sequence until preflight passes, then prints the next non-secret operator commands in order.
`npm run audit:production-candidate` gives the short status report: repository goal contract status, full verify status, deploy preflight status, remaining operator prerequisites, and the next command. Use `npm run audit:production-candidate -- --with-verify` when the report itself should execute the full local verify gate before claiming staging-E2E readiness.

- Docker CLI: install Docker Desktop or the Docker CLI, then confirm `docker --version`.
- Docker daemon: start Docker Desktop, then confirm `docker info` returns server details.
- Google Cloud CLI: install `gcloud`, run `gcloud auth login`, then set the target project with `gcloud config set project <gcp-project-id>`.
- Google Cloud project: set `GCP_PROJECT` or `EXPECTED_GCP_PROJECT`, then confirm `gcloud config get-value project` returns that intended staging or production project. `npm run deploy:preflight` requires it to match exactly.
- Cloudflare Wrangler CLI: install Wrangler, set `EXPECTED_CLOUDFLARE_ACCOUNT`, run `wrangler login`, then confirm `wrangler whoami` returns the account that owns the Pages project. `npm run deploy:preflight` requires the expected marker to appear in `wrangler whoami`.
- Supabase CLI: install Supabase CLI, set `SUPABASE_PROJECT_REF` or `EXPECTED_SUPABASE_PROJECT_REF`, run `supabase login`, then confirm `supabase projects list` can read the staging and production projects. `npm run deploy:preflight` requires the expected project ref to appear in `supabase projects list`.
- Stripe CLI: install Stripe CLI, set `EXPECTED_STRIPE_ACCOUNT`, run `stripe login`, then confirm `stripe whoami` returns the account used for staging and production billing. `npm run deploy:preflight` requires the expected marker to appear in `stripe whoami`.
- GitHub CLI: run `gh auth status`; this is optional in preflight but required if the operator is also publishing a branch, release, or deployment issue.

macOS/Homebrew setup examples for a fresh operator machine:

```sh
brew install --cask docker
brew install --cask google-cloud-sdk
npm install -g wrangler
brew install supabase/tap/supabase
brew install stripe/stripe-cli/stripe
```

These commands are examples only. Run them in the operator environment after confirming package manager policy and account ownership, then rerun `npm run deploy:preflight -- --json`.

## 2. Code And Env Contracts

Before any provider deploy, run:

```sh
npm run verify
npm run audit:production-candidate
npm run deploy:preflight
npm run deploy:preflight -- --json
npm run deploy:next
node scripts/check-env.mjs .env.staging.api .env.staging.agent .env.staging.web
```

For production env files created from the templates, run:

```sh
node scripts/check-env.mjs .env.production.api .env.production.agent .env.production.web
```

`npm run deploy:commands -- --target=staging|production` uses `--env-vars-file="$API_ENV_FILE"` and `--env-vars-file="$AGENT_ENV_FILE"` for Cloud Run API / Agent runtime env. Keep those files operator-owned and out of git. For the web build, it loads the browser-safe `WEB_ENV_FILE` before `wrangler pages deploy`; the web file must contain only `VITE_*` values.

Keep server secrets out of Cloudflare Pages. Pages should only receive browser-safe `VITE_*` values. API secrets, Supabase service role keys, OAuth client secrets, Google Ads developer tokens, Stripe secrets, and OpenAI keys belong to Cloud Run services or their secret manager.

For a private Cloud Run Agent Service, grant the API Cloud Run service account invoke permission before staging E2E:

```sh
gcloud run services add-iam-policy-binding <agent-service-name> \
  --project=<gcp-project-id> \
  --region=<gcp-region> \
  --member="serviceAccount:<api-cloud-run-service-account-email>" \
  --role="roles/run.invoker"
```

The API service env must then set `AGENT_SERVICE_AUTH_MODE=google_id_token`, `AGENT_SERVICE_AUDIENCE=<agent-service-url>`, and `AGENT_SERVICE_URL=<agent-service-url>`. `AGENT_SERVICE_AUDIENCE` must match `AGENT_SERVICE_URL` exactly after trailing-slash normalization.

For production env, do not use the legacy ADK aliases `ADK_AGENT_URL`, `USE_ADK_AGENT`, or `ADK_AGENT_TIMEOUT_MS`. Use `AGENT_SERVICE_URL`, `USE_AGENT_SERVICE`, and `AGENT_SERVICE_TIMEOUT_MS`. Do not set Gemini fallback keys such as `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or `GEMINI_RUNTIME` on the production OpenAI Agent Service. The final `EXPECT_PRODUCTION_READY=true npm run smoke:deploy` gate requires `AGENT_SERVICE_URL` and rejects legacy ADK aliases in the operator env.

Agent `/health` must report `runtimeConfigured=true` only after the Agent image has `OPENAI_API_KEY` and the OpenAI Agents SDK import succeeds. A missing SDK package is a production No-Go even if the key is present. Use the non-secret `runtimeDiagnostics` object to distinguish `openaiApiKeyConfigured`, `openaiAgentsSdkImportable`, `openaiAgentsSdkAvailable`, and `missingOpenaiAgentsSymbols` during staging and final smoke.

## 3. Supabase Evidence

Link the intended staging Supabase project, apply migrations, then run schema evidence:

```sh
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db push

SUPABASE_URL=https://your-staging-project.supabase.co \
npm run e2e:supabase
```

`npm run e2e:supabase` requires the Supabase service role key in the operator environment. Do not paste it into release notes, command transcripts, or committed env files. Confirm the billing tables, Google Ads connection tables, OAuth state handling, audit log surface, and connection status columns are present before continuing.

## 4. Staging Provider Evidence

Run the staging app E2E after the API, Agent Service, web app, Supabase Auth, Google Ads OAuth, and Stripe test-mode config are available:

```sh
API_ORIGIN=https://api.staging.example.com \
AGENT_SERVICE_URL=https://agent.staging.example.com \
WORKSPACE_ID=<workspace-id> \
npm run e2e:staging
```

`npm run e2e:staging` requires `AUTH_TOKEN` and can use `UNPAID_AUTH_TOKEN` from the operator environment. `UNPAID_AUTH_TOKEN` is required when `CONFIRM_STRIPE_FULL_E2E=true` so the script verifies authenticated `402 billing_required` before printing Stripe full evidence.

The staging scripts refuse production-looking API origins before provider calls. If a preview URL does not include an obvious local, test, or staging marker, the operator must set:

```sh
CONFIRM_STAGING_TARGET=true \
STAGING_TARGET_CONFIRMATION="staging non-production environment confirmed"
```

Record these evidence env values only after the corresponding checks pass:

- `OPENAI_AGENT_STAGING_E2E_PASSED_AT`: Agent `/health`, API-to-Agent routing, and OpenAI chat E2E passed.
- `GOOGLE_ADS_STAGING_E2E_PASSED_AT`: Google Ads OAuth, customer list/connect/sync, approved reversible write, restore, and audit payload checks passed.
- `STRIPE_STAGING_E2E_PASSED_AT`: hosted Checkout, existing customer reuse, webhook delivery, billing row update, authenticated unpaid-user `402 billing_required`, active-user gate open, and customer/workspace mismatch rejection passed.

All three `*_STAGING_E2E_PASSED_AT` values must be generated in the same release validation window. `scripts/check-env.mjs` rejects production env files when the three evidence timestamps are more than 7 days apart.

For Google Ads write evidence, use only a reversible staging or test campaign. Campaign status write is limited to `ENABLED` and `PAUSED`; do not use `REMOVED` for MVP write E2E or production. The write must include `confirmed=true`, `CONFIRM_GOOGLE_WRITE=true`, a human approval note, a rollback condition, a restore value different from the write value, audit payload approval metadata (`approvalType=explicit_user_confirmation`, `approvedByUserId`, `approvedAt`), and a `GOOGLE_ADS_MAX_BUDGET_AMOUNT` cap that is no higher than the release owner approved. After the write and restore run, open the web Data Connection screen and confirm the audit review panel shows both rows with the expected customer, campaign, and approval metadata before setting `GOOGLE_ADS_STAGING_E2E_PASSED_AT`.

Google Ads access tokens expire. Before production Go, confirm that a near-expiry or expired access token is refreshed with the stored refresh token before `/google/customers`, `/sync/google`, or approved write routes call Google Ads.

For Stripe webhook-path evidence, run the signed webhook script in staging:

```sh
API_ORIGIN=https://api.staging.example.com \
WORKSPACE_ID=<workspace-id> \
USER_ID=<user-id> \
CONFIRM_STRIPE_WEBHOOK_TEST=true \
npm run e2e:stripe-webhook
```

`npm run e2e:stripe-webhook` requires `STRIPE_WEBHOOK_SECRET` and `AUTH_TOKEN` from the operator environment.

Set `CONFIRM_STRIPE_FULL_E2E=true` for the app E2E only after the hosted Checkout flow, existing Stripe customer reuse, webhook, and billing gate have all been observed. Existing customer reuse means a workspace with `billing_customers.stripe_customer_id` creates a new Checkout session that sends `customer=<existing customer>` without `customer_email`. The signed webhook script must show `handled=true` and the expected `eventType` for handled Stripe events, and handled events must include `metadata.workspace_id`. The app E2E must run with `CHECK_BILLING_GATE=true` and `UNPAID_AUTH_TOKEN` so authenticated `402 billing_required` is verified before `STRIPE_STAGING_E2E_PASSED_AT` can print. The operator must also confirm a Stripe customer/workspace mismatch is rejected with `400` and does not mutate `billing_customers` or `billing_subscriptions`; webhook metadata must not be able to move an existing `stripe_customer_id` to another workspace. `STRIPE_FULL_E2E_CONFIRMATION` must mention checkout, existing customer reuse, webhook, billing gate, and customer/workspace mismatch rejection.

## 5. Production Smoke

After production env is uploaded, migrations are confirmed, and the evidence env values above are set with current ISO timestamps, run:

```sh
API_ORIGIN=https://api.example.com \
AGENT_SERVICE_URL=https://agent.example.com \
npm run smoke:deploy

EXPECT_PRODUCTION_READY=true \
API_ORIGIN=https://api.example.com \
AGENT_SERVICE_URL=https://agent.example.com \
WEB_ORIGIN=https://app.example.com \
npm run smoke:deploy

EXPECT_PRODUCTION_READY=true \
API_ORIGIN=https://api.example.com \
AGENT_SERVICE_URL=https://agent.example.com \
WEB_ORIGIN=https://app.example.com \
RELEASE_SHA=<git-sha> \
EVIDENCE_OWNER=<operator-name> \
npm run collect:release-evidence
```

The final smoke must prove API `/readiness` returns production decision `Go`, the `agent-service-modern-env` and `staging-e2e-evidence-window` checks are present and passing, all production checks pass, API `/health` reports `mode=agent-proxy`, `mediaWriteEnabled=true`, `billingConfigured=true`, `supabaseConfigured=true`, and `authConfigured=true`, and Agent `/health` reports OpenAI mode with `selectedRuntime=openai` or `selectedRuntime=openai_agents`, `runtimeConfigured=true`, and `dataSafetyConfigured=true`.

The collector must produce a non-secret health/readiness/smoke summary for the release evidence note. With `EXPECT_PRODUCTION_READY=true`, it must independently fail if API health, Agent health, readiness `Go`, required readiness checks, or the final smoke are incomplete. If `EXPECT_PRODUCTION_READY=true npm run smoke:deploy` fails, `npm run collect:release-evidence` must fail too unless the operator explicitly sets `ALLOW_INCOMPLETE_EVIDENCE=true` for a partial diagnostic note.

Only after this point should deployment ownership move from code readiness to traffic rollout.
