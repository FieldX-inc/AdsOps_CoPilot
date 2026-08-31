# Deployment and production Go runbook

Updated: 2026-07-15

External changes are approval-gated. Reading status and generating local plans is allowed; remote migrations, provider configuration, write E2E, deploy, push and PR require the approvals listed in `REQUIREMENTS.md`.

## 1. Local quality gate

```bash
npm run verify
docker build -f apps/api/Dockerfile .
docker build -f services/adk-agent/Dockerfile .
```

The API image contains both `dist/index.js` and `dist/report-job.js`. Run the latter as the Cloud Run Job command. Build the web app with production browser-safe variables and verify `dist/_redirects` exists.

The contract audit must test routes, server-side plan boundaries, fail-closed behavior, no-secret surfaces, RLS/migration contract and preview disabling. It must not rely on prose copied from old documentation.

## 2. Staging recovery gate

1. Inspect staging Supabase project pause/deletion/DNS status.
2. Rotate the DB credential exposed during audit before reuse.
3. If recovery is impossible, obtain approval before creating a replacement project.
4. Re-authenticate gcloud, Wrangler, Supabase and Stripe as the operator.
5. Apply additive migrations after explicit remote-migration approval.

## 3. Staging deploy

- Deploy private Agent with authenticated ingress.
- Deploy public API using the API image.
- Grant only the API/Job service account `roles/run.invoker` on private Agent.
- Configure `AGENT_SERVICE_AUTH_MODE=google_id_token` and the exact Agent audience.
- Build/upload Cloudflare Pages by Direct Upload; verify SPA fallback.
- Create Cloud Run Job from the API image with `node apps/api/dist/report-job.js`.
- Configure hourly Cloud Scheduler invocation with a least-privilege service account.

Record commit SHA, image digest, Cloud Run revisions, Pages deployment ID and migration IDs.

## 4. Staging provider E2E

### Supabase

- Email signup/login and Google login
- pending-payment 402 gate and active transition
- owner/admin/member/nonmember/cross-workspace RLS matrix
- member and ad-account limits

### Google Ads

- OAuth, MCC child discovery, MCC sync rejection, client connect and 30-day sync
- re-check the deploy-time latest Google Ads API release; `v24.2` is the current candidate and maps to the REST path `v24`
- on a dedicated campaign, run `ENABLED ↔ PAUSED` and restore immediately
- test budget with provider mock/contract only; do not mutate a real budget
- confirm preview, stale-value 409, success/failure/conflict audit and rollback-audit relation

### Agent/report/email

- private Agent health and API→Agent OIDC
- structured answer and usage on setup/chat/report
- manually execute report Job; verify idempotency, retry, auth-expiry fallback and separate report credits
- after the user supplies a dedicated domain, configure Cloudflare DNS, SPF, DKIM and DMARC
- send HTML/plain summaries to the administrator; verify unsubscribe, queue/delivery/bounce and reconnect notice

### Stripe test mode

After pricing approval and external-change approval, create three recurring monthly test Prices and three one-time setup-fee test Prices, then configure Portal/Webhook. Test the three-plan display, mixed-cart Checkout, initial-invoice-only setup fee, existing Customer reuse, Portal, plan change, cancel, unpaid, unknown Price and downgrade-over-limit behavior.

## 5. Cost measurement and pricing approval

Use real data or approved fixtures:

- at least 10 reports across small, standard and multi-account cases
- at least 30 representative chat turns
- p50/p95 tokens and estimated cost by source/model

The three setup fees and three monthly prices were approved on 2026-07-24. Prepare Standard/Premium limit candidates, customer consultation estimates and gross-margin scenarios separately. Stop for explicit external-change approval before creating the corresponding recurring and one-time Price IDs in Stripe or writing them to production env.

## 6. Production deployment

1. Apply the same tested migrations after approval.
2. Configure the approved three monthly and three setup-fee live Prices and Portal/Webhook after approval.
3. Configure production Supabase Auth, Google OAuth/Ads and Email domain.
4. Deploy private Agent, public API, report Job/Scheduler and Cloudflare Pages.
5. Use the provided application URLs; only email requires the dedicated domain.
6. Align callback, CORS and Supabase Site URL.
7. Release with `GOOGLE_ADS_WRITE_ENABLED=false`.

## 7. Production smoke

Verify:

- Email/Google login
- pending-payment gate
- three monthly plan choices with setup fees, Checkout and Portal
- Google Ads read, account filter, Dashboard and BI
- AI setup/chat usage and plan locks
- three-day report Job and email delivery
- private Agent health and API→Agent
- dynamic `/readiness`

After a separate approval, enable production write and perform a dedicated campaign status round trip with immediate restore. Never test a real production budget mutation.

## 8. Rollback

- Cloudflare Pages: previous deployment
- Cloud Run API/Agent: previous revision
- Report system: pause Scheduler/Job
- Database: keep additive schema; deploy compatible previous code and follow migration-specific operational rollback
- Google Ads: use returned rollback payload, expected-current conflict check and original audit relation
- Stripe: restore approved catalog/Portal configuration; do not delete subscription data ad hoc

## 9. Release evidence and Go

Record SHA, image digest, revisions, deployment IDs, migrations, Price catalog version, E2E timestamps, status round-trip audit IDs, Scheduler/Job execution, report/email evidence and rollback checks in `deploy/release-evidence.template.md` or generated evidence output.

Go requires all acceptance conditions in `REQUIREMENTS.md`, dynamic `/readiness`, completion audit and user approval gates. A local green build alone is not production Go.
