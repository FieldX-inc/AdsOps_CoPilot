# Production Handoff Tasks

このタスク表は、旧Pre-SaaS read-only / ADK MVP計画を置き換えるものです。現在の到達目標は、OpenAI Agents SDK、Google Ads read/write、Stripe課金を組み込んだ production candidate を作り、外部環境の準備後に staging E2E と最終 smoke を通せる状態にすることです。

詳細なデプロイ手順は `docs/deployment.md`、最終チェックリストは `deploy/production-readiness-checklist.md` を正本にします。

## 0. Target State

Production candidate の完了条件:

- OpenAI Agents SDK が正規agent runtimeである
- 素人モード / 玄人モードを routePlan と API context で切り替えられる
- OpenAI agent prompts / tools / QA gate が secret除外、根拠不足、write境界を守る
- Supabase Auth と workspace scope が product API の入口で効く
- Google Ads OAuth、customer list、metrics sync が実媒体APIへ接続できる
- Google Ads write は campaign status / budget に限定し、人間の明示承認と audit log を必須にする
- Stripe Checkout / Billing Portal / Webhook が login後課金導線として動く
- production API は未ログインで `401`、未課金で `402`、Stripe未設定で `503 billing_not_configured` として fail closed する
- Cloudflare Pages、Cloud Run API、Cloud Run Agent、Supabase、Stripe、Google Ads の env境界が分離されている
- `npm run verify`、staging E2E、production smoke が揃う

対象外:

- Meta Ads / Yahoo Ads の write
- AI agent tool による広告媒体mutation
- 完全自律運用
- 代理店向けマルチクライアント管理

## 1. Milestone Map

| ID | Milestone | Status | Completion Evidence |
| --- | --- | --- | --- |
| M0 | Repo Contract / Goal Audit | Done | `npm run check:goal` |
| M1 | OpenAI Agent Runtime | Done | Agent pytest + OpenAI runtime contract tests |
| M2 | Beginner / Experienced Routing | Done | conversation router tests + staging E2E chat |
| M3 | Supabase Auth / Workspace / Billing Gate | Code Done, external E2E pending | API tests + Supabase staging E2E |
| M4 | Google Ads Read/Write | Code Done, external E2E pending | API tests + reversible staging write E2E |
| M5 | Stripe Billing | Code Done, external E2E pending | API tests + Stripe webhook/hosted Checkout staging E2E |
| M6 | Deployment Surfaces | Code Done, operator tooling pending | Dockerfile checks + Docker builds + deploy preflight |
| M7 | Production Smoke | Pending external env | `EXPECT_PRODUCTION_READY=true npm run smoke:deploy` |

## 2. M0 Repo Contract / Goal Audit

Tasks:

- [x] Add `scripts/check-production-goal.mjs`.
- [x] Add `npm run check:goal`.
- [x] Include `check:goal` in `npm run verify`.
- [x] Wire production goal audit into GitHub Actions.
- [x] Confirm docs mention `check:goal`.

Verify:

```sh
npm run check:goal
npm run verify
```

## 3. M1 OpenAI Agent Runtime

Tasks:

- [x] Make OpenAI Agents SDK the default runtime via `ADOPS_AGENT_RUNTIME=openai`.
- [x] Require OpenAI Agents SDK import availability before Agent `/health` reports `runtimeConfigured=true`.
- [x] Keep Gemini/ADK only as a compatibility fallback.
- [x] Add OpenAI orchestrator with specialist agents as tools.
- [x] Package prompt markdown and eval JSON in the Agent Docker image.
- [x] Expose Agent `/health` with `service=openai-agent`, runtime mode, runtime configuration, and data-safety flags.
- [x] Sanitize production Agent context at the API boundary before sending it to the Agent Service.
- [x] Add deterministic QA gate for no-secret, no-unapproved-write, required sections, and overconfident claims.

Verify:

```sh
python3.11 -m pytest services/adk-agent/tests
npm run check:goal
```

## 4. M2 Beginner / Experienced Routing

Tasks:

- [x] Add conversation router and routePlan contract.
- [x] Route beginner mode to explanatory, step-oriented responses.
- [x] Route experienced mode to KPI decomposition, hypotheses, priorities, approval-gated write candidates, and rollback conditions.
- [x] Pass advisor mode from web/API context to Agent Service.
- [x] Add UI selector for advisor mode.

Verify:

```sh
python3.11 -m pytest services/adk-agent/tests/test_conversation_router.py
npm run e2e:staging
```

## 5. M3 Supabase Auth / Workspace / Billing Gate

Tasks:

- [x] Require authenticated Supabase session for product APIs in configured staging / production.
- [x] Scope data access by workspace membership.
- [x] Bootstrap workspace for logged-in users.
- [x] Gate app shell after login on `/billing/status`.
- [x] Block agent chat and Google Ads write before billing access.
- [x] Add fail-closed production behavior when Stripe is not configured.
- [ ] Apply migrations to staging Supabase.
- [ ] Run Supabase schema/RLS E2E against staging.

Verify:

```sh
SUPABASE_URL=https://your-staging-project.supabase.co \
npm run e2e:supabase
```

Requires `SUPABASE_SERVICE_ROLE_KEY` in the operator environment. Do not paste service role keys into shell history.

## 6. M4 Google Ads Read/Write

Tasks:

- [x] Add Google OAuth start-url and callback.
- [x] Store OAuth state server-side with workspace/user binding.
- [x] Encrypt token storage server-side.
- [x] Refresh expired Google Ads access tokens before read/sync/write provider calls.
- [x] Add Google Ads accessible customer list endpoint.
- [x] Add customer connect and metrics sync.
- [x] Use canonical `/google/customers` web endpoint.
- [x] Add approval-gated campaign status write route.
- [x] Restrict campaign status write to reversible `ENABLED` / `PAUSED` changes.
- [x] Add approval-gated campaign budget write route.
- [x] Require authenticated user, workspace scope, billing access, `confirmed=true`, `approvalNote`, and `GOOGLE_ADS_WRITE_ENABLED=true`.
- [x] Add `GOOGLE_ADS_MAX_BUDGET_AMOUNT` cap for campaign budget writes.
- [x] Audit Google Ads write events with approval note, target IDs, old/new intent, and no secrets.
- [x] Add staging E2E script path for reversible write and restore.
- [ ] Configure Google Ads OAuth app and developer token in staging.
- [ ] Connect a low-risk staging/test Google Ads account.
- [ ] Run read customer list and metrics sync E2E.
- [ ] Run reversible campaign status or budget write E2E and restore value.

Verify:

```sh
API_ORIGIN=https://api.staging.example.com \
AGENT_SERVICE_URL=https://agent.staging.example.com \
WORKSPACE_ID=<workspace-id> \
CHECK_GOOGLE_WRITE=true \
CONFIRM_GOOGLE_WRITE=true \
GOOGLE_CUSTOMER_ID=<customer-id> \
GOOGLE_CAMPAIGN_ID=<campaign-id> \
GOOGLE_WRITE_ROLLBACK="Reason and rollback condition for the reversible staging write." \
npm run e2e:staging
```

Requires `AUTH_TOKEN` in the operator environment. Do not paste user access tokens into shell history.

Set `GOOGLE_ADS_STAGING_E2E_PASSED_AT=<ISO timestamp>` only after the script verifies both the write audit log and restore audit log include the expected target payload and approval metadata.

## 7. M5 Stripe Billing

Tasks:

- [x] Add `billing_customers` and `billing_subscriptions` schema.
- [x] Add Checkout session route.
- [x] Add Billing Portal route.
- [x] Add signed webhook route.
- [x] Mirror subscription status into Supabase.
- [x] Gate login-time app shell on billing access.
- [x] Add API fail-closed behavior for production Stripe misconfiguration.
- [x] Add webhook E2E script for signed test events.
- [x] Require handled Stripe webhook events to include workspace metadata and return `handled=true` evidence.
- [ ] Create staging Stripe product and subscription price.
- [ ] Configure webhook endpoint to `<API_PUBLIC_ORIGIN>/billing/webhook`.
- [ ] Complete hosted Checkout in staging.
- [ ] Confirm webhook row updates and login-time billing gate.

Verify:

```sh
API_ORIGIN=https://api.staging.example.com \
WORKSPACE_ID=<workspace-id> \
npm run e2e:stripe-webhook
```

Requires `AUTH_TOKEN` and `STRIPE_WEBHOOK_SECRET` in the operator environment. Do not paste access tokens or webhook secrets into shell history.

Set `STRIPE_STAGING_E2E_PASSED_AT=<ISO timestamp>` only after hosted Checkout, existing customer reuse, webhook delivery, database rows, and billing gate are confirmed.

## 8. M6 Deployment Surfaces

Tasks:

- [x] Add API Dockerfile.
- [x] Add Agent Dockerfile.
- [x] Add Cloudflare Pages env template.
- [x] Add Cloud Run API env template.
- [x] Add Cloud Run Agent env template.
- [x] Add deploy preflight script.
- [x] Add production candidate audit script.
- [x] Add deploy smoke script.
- [x] Add GitHub Actions verify workflow with Docker builds.
- [ ] Start Docker daemon on operator machine.
- [ ] Install/authenticate Google Cloud CLI.
- [ ] Set active Google Cloud project.
- [ ] Install/authenticate Wrangler.
- [ ] Install/authenticate Supabase CLI.
- [ ] Install/authenticate Stripe CLI.

Verify:

```sh
npm run verify
npm run audit:production-candidate
npm run deploy:preflight
```

Current known blocker: `npm run deploy:preflight` fails until Docker daemon and `gcloud` / `wrangler` / `supabase` / `stripe` CLIs are available on the operator machine.

## 9. M7 Production Smoke

Tasks:

- [ ] Deploy Cloud Run Agent with server-side `OPENAI_API_KEY`.
- [ ] Deploy Cloud Run API with Supabase, Google Ads, Stripe, and Agent Service env.
- [ ] Deploy Cloudflare Pages web build with only `VITE_*` browser-safe values.
- [ ] Grant API service account permission to invoke private Agent service.
- [ ] Set `OPENAI_AGENT_STAGING_E2E_PASSED_AT`.
- [ ] Set `GOOGLE_ADS_STAGING_E2E_PASSED_AT`.
- [ ] Set `STRIPE_STAGING_E2E_PASSED_AT`.
- [ ] Set `DEPLOYMENT_RUNBOOK_ACK=true` after checklist review.
- [ ] Run final deployed smoke with production readiness required.

Verify:

```sh
EXPECT_PRODUCTION_READY=true \
API_ORIGIN=https://api.example.com \
AGENT_SERVICE_URL=https://agent.example.com \
WEB_ORIGIN=https://app.example.com \
npm run smoke:deploy
```

Goal completion requires this smoke to pass against deployed API, Agent, and Web services. Until then, the repo can be code-ready but the user goal remains active.

## 10. Production Evidence Rules

Evidence env values must be valid ISO timestamps:

- `OPENAI_AGENT_STAGING_E2E_PASSED_AT`
- `GOOGLE_ADS_STAGING_E2E_PASSED_AT`
- `STRIPE_STAGING_E2E_PASSED_AT`

`/readiness` treats malformed or missing evidence as production `No-Go`. `scripts/check-env.mjs` also rejects stale or malformed production evidence. Do not set these values from intent alone; set them only after the corresponding staging E2E actually passed.

## 11. Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Operator machine lacks deploy tools | Staging/prod deploy cannot start | `npm run deploy:preflight` prints concrete remediation |
| Google Ads write target is not safely reversible | Real campaign damage | Use staging/test account, explicit `approvalNote`, restore value, audit verification |
| Stripe evidence set before hosted Checkout | False production Go | Only set `STRIPE_STAGING_E2E_PASSED_AT` after Checkout, webhook delivery, DB rows, and billing gate |
| Secret leaks to prompt/browser/log | Credential exposure | env checks, prompt evals, QA gate, no `VITE_*` server secrets |
| Agent claims write was executed | User trust and operational risk | QA gate and no-write policy convert to approval-gated candidate language |
