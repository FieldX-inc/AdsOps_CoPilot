# Deployment Targets

This directory maps the deploy surfaces and the env each surface owns. Replace placeholders in the hosting provider or secret manager; do not commit real secrets.

Use `deploy/operator-handoff.md` for the deployment operator's external tooling and evidence sequence, copy `deploy/release-evidence.template.md` into an operator-owned release evidence note, then use `deploy/production-readiness-checklist.md` as the final pre-production handoff sheet. Staging templates use the existing `cloud-*` names; production templates use the `production-*` names and must be copied into the hosting providers only after replacing placeholders.

## Cloudflare Pages

Target: Web UI

- Root directory: repository root
- Build command: `npm --workspace @adops/web run build`
- Output directory: `apps/web/dist`
- Env template: `deploy/cloudflare-pages.env.example`
- Production env template: `deploy/production-cloudflare-pages.env.example`

Cloudflare Pages must receive only `VITE_*` browser-safe values. Server secrets, OAuth client secrets, Google Ads developer tokens, Stripe secrets, OpenAI keys, service role keys, and DB URLs stay out of Pages. The deploy command plan loads the operator-owned web env file as `WEB_ENV_FILE` before the Vite build, then runs `wrangler pages deploy`.

## Cloud Run API

Target: Hono API, OAuth callback, Stripe webhook, Google Ads read/approved-write routes, and the report Job image

Build:

```sh
docker build -f apps/api/Dockerfile -t adops-api .
```

Runtime env template: `deploy/cloud-run-api.env.example`
Production env template: `deploy/production-cloud-run-api.env.example`

The API owns Supabase service role access, token encryption, Google Ads OAuth/API credentials, restricted Stripe API access, Cloudflare Email Sending access, `AGENT_SERVICE_URL`, and production readiness evidence env. Because `gcloud --env-vars-file` chooses its parser from the filename extension, the deploy command plan copies the operator-owned API file into a mode-600 temporary file ending in `.env`, passes that path to Cloud Run, and removes the temporary directory on shell exit.

The same image is deployed as a Cloud Run Job with `node apps/api/dist/report-job.js`. An hourly Cloud Scheduler trigger starts it; the Job itself selects each workspace's 3-day local-9:00 due schedule.

When the Agent Service is private Cloud Run, the API service account must have `roles/run.invoker` on the Agent service, and the API env must use `AGENT_SERVICE_AUTH_MODE=google_id_token` with `AGENT_SERVICE_AUDIENCE=<agent-service-url>`.

## Cloud Run Agent

Target: OpenAI Agent Service

Build:

```sh
docker build -f services/adk-agent/Dockerfile -t adops-agent .
```

Runtime env template: `deploy/cloud-run-agent.env.example`
Production env template: `deploy/production-cloud-run-agent.env.example`

The Agent owns `OPENAI_API_KEY`, OpenAI Agents SDK model/runtime settings, sensitive tracing/logging controls, and optional `ADOPS_DATABASE_URL`. The deploy command plan uses the same mode-600 temporary `.env` copy for the Agent deploy, so filenames such as `.env.staging.agent` are never misread as YAML.

## Release Gate

Before staging:

```sh
npm run verify
npm run check:goal
npm run audit:production-candidate
npm run deploy:preflight
npm run deploy:preflight -- --json
npm run deploy:next
node scripts/check-env.mjs deploy/cloud-run-api.env.example deploy/cloud-run-agent.env.example deploy/cloudflare-pages.env.example
```

For real production env files created from the production templates, run:

```sh
node scripts/check-env.mjs .env.production.api .env.production.agent .env.production.web
```

Operator-machine deploy tooling:

```sh
npm run deploy:preflight
npm run deploy:preflight -- --json
npm run audit:production-candidate
npm run deploy:next
npm run deploy:commands -- --target=staging
npm run deploy:commands -- --target=production
```

If this fails, fix the reported operator prerequisite before moving on. Typical fixes are starting Docker Desktop, installing and authenticating the Google Cloud CLI, confirming `wrangler whoami`, confirming `supabase projects list`, and confirming `stripe whoami`. Use the JSON form after the plain command passes to copy a non-secret `overallStatus=pass` snapshot into release evidence. `npm run audit:production-candidate` gives the short repository-contract/full-verify/preflight/next-command status, `npm run deploy:next` prints the next staging, provider evidence, production env, final smoke, and release evidence commands in order, and `npm run deploy:commands` prints copyable Cloud Run / Cloudflare / Supabase migration / evidence command templates.

The full operator sequence, including staging evidence env values and the final production smoke, is in `deploy/operator-handoff.md`. The release evidence fields to fill after the external checks pass are in `deploy/release-evidence.template.md`. `npm run verify` runs `npm run check:handoff` and `npm run check:release-evidence` so the handoff and evidence template cannot silently drop a required provider prerequisite or evidence command.

After deployed URLs exist, run `npm run collect:release-evidence` with `API_ORIGIN`, `AGENT_SERVICE_URL`, and `EXPECT_PRODUCTION_READY=true` to print a non-secret health/readiness/smoke summary for the release evidence note. `npm run verify` runs `npm run check:release-evidence-collector` so this collector must fail when final smoke fails and must avoid echoing secret-like operator env values.

Staging command templates for Artifact Registry, Cloud Run, and Cloudflare Pages live in `docs/deployment.md`. Upload real runtime env and secrets through operator-owned env files, the hosting providers, or Secret Manager before running the deploy commands; the `.env.example` files in this directory are contracts, not deployable secret files. Keep `DEPLOY_SURFACE=api` or `DEPLOY_SURFACE=agent` on Cloud Run env files so `scripts/check-env.mjs` validates the right secret boundary. Cloudflare Pages env must stay `VITE_*` only.

The deploy command plan includes Supabase migration commands:

```sh
supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db push
```

After applying Supabase migrations:

```sh
SUPABASE_URL=https://your-staging-project.supabase.co \
npm run e2e:supabase
```

`npm run e2e:supabase` requires the Supabase service role in the operator env. Do not paste it into command history or release evidence notes.

After staging deploy and login:

```sh
API_ORIGIN=https://api.staging.example.com \
AGENT_SERVICE_URL=https://agent.staging.example.com \
WORKSPACE_ID=<workspace-id> \
npm run e2e:staging
```

`npm run e2e:staging` requires `AUTH_TOKEN` and can use optional `UNPAID_AUTH_TOKEN` from the operator env.

Before production traffic:

```sh
EXPECT_PRODUCTION_READY=true \
API_ORIGIN=https://api.example.com \
AGENT_SERVICE_URL=https://agent.example.com \
WEB_ORIGIN=https://app.example.com \
npm run smoke:deploy
```

The initial production Go deployment keeps `GOOGLE_ADS_WRITE_ENABLED=false`. Its `EXPECT_PRODUCTION_READY=true` smoke requires API `/health` to report `mode=agent-proxy`, `mediaWriteEnabled=false`, `billingConfigured=true`, `usageCostConfigured=true`, `reportEmailConfigured=true`, `supabaseConfigured=true`, and `authConfigured=true`, plus Agent `/health` OpenAI runtime/data-safety readiness, API `/readiness` production `Go`, and Web app HTML/root plus reachable JS/CSS asset references from `WEB_ORIGIN`.
When `EXPECT_PRODUCTION_READY=true npm run collect:release-evidence` passes, copy the printed `export PRODUCTION_SMOKE_PASSED_AT=...` and `export RELEASE_EVIDENCE_COLLECTED_AT=...` candidates only after the collector output is recorded in the release evidence note, then set `RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>` before rerunning the final completion audit.

Google Ads write activation is a separate post-Go gate. Only after explicit approval, validate the API env with `EXPECT_GOOGLE_ADS_WRITE_ACTIVATION=true node scripts/check-env.mjs .env.production.api`, deploy `GOOGLE_ADS_WRITE_ENABLED=true`, and run `EXPECT_GOOGLE_ADS_WRITE_ACTIVATION=true npm run smoke:deploy`; this later gate requires `mediaWriteEnabled=true`. Staging real-provider evidence is limited to a dedicated campaign `ENABLED`/`PAUSED` status round trip with a final provider live-preview re-read; budget remains provider-fake/contract-test only.
