# Release Evidence Template

Copy this template for each release candidate into an operator-owned evidence note. Do not commit real secrets, access tokens, refresh tokens, webhook secrets, service role keys, or OAuth codes.

Production is not ready until every field below is filled with non-secret evidence and the final `EXPECT_PRODUCTION_READY=true` smoke passes.

After deployed URLs exist, generate a non-secret health/readiness summary with:

```sh
EXPECT_PRODUCTION_READY=true \
API_ORIGIN=https://api.example.com \
AGENT_SERVICE_URL=https://agent.example.com \
WEB_ORIGIN=https://app.example.com \
RELEASE_SHA=<git-sha> \
EVIDENCE_OWNER=<operator-name> \
npm run collect:release-evidence
```

## Release Identity

- Release branch or commit SHA:
- Evidence owner:
- Evidence captured at:
- Staging API origin:
- Staging Agent Service origin:
- Staging Web origin:
- Production API origin:
- Production Agent Service origin:
- Production Web origin:

## Operator Preflight

- `npm run verify` passed:
- `npm run deploy:preflight` passed:
- `npm run deploy:preflight -- --json` produced `overallStatus=pass` with no required failures:
- Docker daemon confirmed with `docker info`:
- Google Cloud CLI auth confirmed with `gcloud auth list --format=json`:
- Google Cloud project confirmed with `gcloud config get-value project`:
- Cloudflare account confirmed with `wrangler whoami`:
- Supabase access confirmed with `supabase projects list`:
- Stripe account confirmed with `stripe whoami`:
- GitHub auth confirmed with `gh auth status`:

## Env And Secret Boundary

- API env checked with `node scripts/check-env.mjs .env.production.api`:
- Agent env checked with `node scripts/check-env.mjs .env.production.agent`:
- Web env checked with `node scripts/check-env.mjs .env.production.web`:
- Cloudflare Pages contains only `VITE_*` browser-safe env:
- API service owns Supabase service role, token encryption, Google Ads, Stripe, and Agent Service routing secrets:
- Agent service owns `OPENAI_API_KEY` and OpenAI Agents logging safety env:
- Private Agent Service IAM applied with `gcloud run services add-iam-policy-binding` and `roles/run.invoker`:
- API service env has `AGENT_SERVICE_AUTH_MODE=google_id_token`:
- API service env has `AGENT_SERVICE_AUDIENCE=<agent-service-url>` matching `AGENT_SERVICE_URL` after trailing-slash normalization:
- API, Agent, and final smoke env do not set legacy ADK aliases (`ADK_AGENT_URL`, `USE_ADK_AGENT`, `ADK_AGENT_TIMEOUT_MS`):
- No secret values were pasted into this evidence note:

## Supabase Evidence

- `supabase db push` applied through `supabase/migrations/20260604_openai_google_write_stripe.sql`:
- `npm run e2e:supabase` passed:
- Billing tables and RLS confirmed:
- Google Ads connection and OAuth state tables confirmed:
- Audit log surface confirmed:

## OpenAI Agent Evidence

- Agent `/health` returned OpenAI mode:
- Agent `/health` returned `selectedRuntime=openai` or `selectedRuntime=openai_agents`:
- Agent `/health` returned `runtimeConfigured=true`:
- Agent `/health` returned non-secret `runtimeDiagnostics` with `openaiApiKeyConfigured=true`, `openaiAgentsSdkImportable=true`, `openaiAgentsSdkAvailable=true`, and no missing OpenAI Agents SDK symbols:
- Agent `/health` returned `dataSafetyConfigured=true`:
- API chat through Agent Service passed in staging:
- `OPENAI_AGENT_STAGING_E2E_PASSED_AT`:

## Google Ads Evidence

- Google Ads OAuth start URL returned:
- OAuth callback completed for staging user:
- `/google/customers` returned expected customer:
- Customer connect passed:
- `/sync/google` passed:
- Approved reversible write used `confirmed=true`:
- Approved reversible write used `CONFIRM_GOOGLE_WRITE=true`:
- `approvalNote` recorded reason, restore value, and observation window:
- `approvalNote` audit payload redacted dummy secret-like QA values as `[REDACTED]` and did not store raw values, `Authorization: Bearer`, or `client_secret=`:
- Audit payload recorded `confirmed=true`, `approvalType=explicit_user_confirmation`, `approvedByUserId`, and `approvedAt`:
- Restore value differed from write value:
- `/audit-logs/recent?eventTypePrefix=google_ads.` showed write and restore rows:
- Final campaign status or budget matched the original restore value:
- `GOOGLE_ADS_STAGING_E2E_PASSED_AT`:

## Stripe Evidence

- Stripe Price exists and matches `STRIPE_PRICE_ID`:
- Stripe webhook endpoint is `<API_PUBLIC_ORIGIN>/billing/webhook`:
- Hosted Checkout completed in staging test mode:
- Existing Stripe customer reuse sent `customer=<existing customer>` without `customer_email`:
- Webhook delivery updated billing rows:
- Stripe customer/workspace mismatch returned `400` without mutating billing rows:
- Login-time billing gate blocked unpaid access:
- `npm run e2e:staging` ran with `CHECK_BILLING_GATE=true` and `UNPAID_AUTH_TOKEN` before `STRIPE_STAGING_E2E_PASSED_AT` was set:
- Login-time billing gate opened after active subscription:
- API returned `401 authentication_required` before login:
- API returned `402 billing_required` before active subscription:
- `npm run e2e:stripe-webhook` passed, if used:
- `STRIPE_FULL_E2E_CONFIRMATION` mentioned checkout, existing customer reuse, webhook, billing gate, and customer/workspace mismatch rejection:
- `STRIPE_STAGING_E2E_PASSED_AT`:

## Evidence Window

- `OPENAI_AGENT_STAGING_E2E_PASSED_AT`, `GOOGLE_ADS_STAGING_E2E_PASSED_AT`, and `STRIPE_STAGING_E2E_PASSED_AT` are valid ISO timestamps:
- The three evidence timestamps are no more than 7 days apart:
- The three evidence timestamps are newer than 90 days:
- API `/readiness` included `staging-e2e-evidence-window=pass`:
- API `/readiness` included `agent-service-modern-env=pass`:

## Final Smoke

- `npm run smoke:deploy` passed against production URLs:
- `EXPECT_PRODUCTION_READY=true npm run smoke:deploy` passed against production URLs:
- Final smoke used `AGENT_SERVICE_URL`, checked `WEB_ORIGIN` HTML/root plus JS/CSS asset references, and rejected legacy ADK aliases:
- `npm run collect:release-evidence` produced non-secret health/readiness evidence:
- `npm run collect:release-evidence` failed closed unless API health, Agent health, readiness `Go`, required readiness checks, and final smoke were complete:
- Collector printed `export PRODUCTION_SMOKE_PASSED_AT=...` and `export RELEASE_EVIDENCE_COLLECTED_AT=...` only after final production evidence passed:
- `PRODUCTION_SMOKE_PASSED_AT`:
- `RELEASE_EVIDENCE_COLLECTED_AT`:
- `RELEASE_EVIDENCE_NOTE_PATH` pointed to this filled operator-owned release evidence note for the final audit:
- `npm run audit:completion -- --with-verify` returned `overallStatus=complete`:
- API `/health` reported `mode=agent-proxy`:
- API `/health` reported `mediaWriteEnabled=true`:
- API `/health` reported `billingConfigured=true`:
- API `/health` reported `supabaseConfigured=true`:
- API `/health` reported `authConfigured=true`:
- Agent `/health` reported OpenAI runtime mode:
- Agent `/health` reported `selectedRuntime=openai` or `selectedRuntime=openai_agents`:
- Agent `/health` reported `runtimeConfigured=true`:
- Agent `/health` reported OpenAI runtime diagnostics with SDK import and required symbols available:
- Agent `/health` reported `dataSafetyConfigured=true`:
- API `/readiness` production decision was `Go`:

## Go Decision

- `DEPLOYMENT_RUNBOOK_ACK=true` set:
- No production secret exists in committed files:
- Rollout owner approved production traffic:
- Rollback owner and rollback action:
