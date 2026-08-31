#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const issues = [];

runContract("prints staging command template", {
  args: ["--target=staging"],
  expectStatus: 0,
  mustIncludeStdout: [
    "# Staging Deploy Command Plan",
    "npm run verify",
    "npm run deploy:preflight -- --json",
    "node scripts/check-env.mjs .env.staging.api .env.staging.agent .env.staging.web",
    "export API_ENV_FILE=.env.staging.api",
    "export AGENT_ENV_FILE=.env.staging.agent",
    "export WEB_ENV_FILE=.env.staging.web",
    "export DEPLOY_ENV_TMP_DIR=$(mktemp -d)",
    'install -m 600 "$API_ENV_FILE" "$DEPLOY_ENV_TMP_DIR/api.env"',
    'install -m 600 "$AGENT_ENV_FILE" "$DEPLOY_ENV_TMP_DIR/agent.env"',
    'export API_GCLOUD_ENV_FILE="$DEPLOY_ENV_TMP_DIR/api.env"',
    'export AGENT_GCLOUD_ENV_FILE="$DEPLOY_ENV_TMP_DIR/agent.env"',
    "export SUPABASE_PROJECT_REF=<staging-supabase-project-ref>",
    "export SUPABASE_URL=https://your-staging-project.supabase.co",
    "gcloud artifacts repositories create",
    "docker build -f apps/api/Dockerfile",
    "docker build -f services/adk-agent/Dockerfile",
    "gcloud run deploy adops-api-staging",
    '--env-vars-file="$API_GCLOUD_ENV_FILE"',
    "gcloud run deploy adops-agent-staging",
    '--env-vars-file="$AGENT_GCLOUD_ENV_FILE"',
    "roles/run.invoker",
    "gcloud run jobs deploy adops-report-staging",
    "apps/api/dist/report-job.js",
    "gcloud scheduler jobs create http adops-report-hourly-staging",
    "https://run.googleapis.com/v2/projects/$GCP_PROJECT/locations/$GCP_REGION/jobs/adops-report-staging:run",
    "0 * * * *",
    "gcloud run jobs execute adops-report-staging",
    "REPORT_EMAIL_STAGING_E2E_PASSED_AT",
    'set -a; . "$WEB_ENV_FILE"; set +a; npm --workspace @adops/web run build',
    "wrangler pages deploy apps/web/dist --project-name=<cloudflare-pages-staging-project>",
    "## 7. Supabase Migrations",
    'supabase link --project-ref "$SUPABASE_PROJECT_REF"',
    "supabase db push",
    "npm run e2e:supabase",
    "npm run e2e:staging",
    "CHECK_GOOGLE_WRITE=true",
    "CONFIRM_GOOGLE_WRITE=true",
    "GOOGLE_WRITE_ROLLBACK",
    "reversible Google Ads write evidence",
    "audit review panel shows the Google write and restore rows with approval metadata",
    "requires AUTH_TOKEN in operator env",
    "npm run e2e:stripe-webhook",
    "requires STRIPE_WEBHOOK_SECRET and AUTH_TOKEN in operator env",
    "CONFIRM_STRIPE_FULL_E2E=true",
    "STRIPE_FULL_E2E_CONFIRMATION",
    "requires AUTH_TOKEN and UNPAID_AUTH_TOKEN in operator env",
    "npm run audit:completion-note -- --with-verify",
  ],
  mustNotIncludeStdout: [
    "SUPABASE_SERVICE_ROLE_KEY=",
    "OPENAI_API_KEY=",
    "STRIPE_SECRET_KEY=",
    "GOOGLE_ADS_DEVELOPER_TOKEN=",
    "AUTH_TOKEN=",
    "STRIPE_WEBHOOK_SECRET=",
  ],
});

runContract("prints production command template", {
  args: ["--target=production"],
  expectStatus: 0,
  mustIncludeStdout: [
    "# Production Deploy Command Plan",
    "node scripts/check-env.mjs .env.production.api .env.production.agent .env.production.web",
    "export API_ENV_FILE=.env.production.api",
    "export AGENT_ENV_FILE=.env.production.agent",
    "export WEB_ENV_FILE=.env.production.web",
    "export DEPLOY_ENV_TMP_DIR=$(mktemp -d)",
    'export API_GCLOUD_ENV_FILE="$DEPLOY_ENV_TMP_DIR/api.env"',
    'export AGENT_GCLOUD_ENV_FILE="$DEPLOY_ENV_TMP_DIR/agent.env"',
    "export SUPABASE_PROJECT_REF=<production-supabase-project-ref>",
    "export SUPABASE_URL=https://your-production-project.supabase.co",
    "gcloud run deploy adops-api-prod",
    '--env-vars-file="$API_GCLOUD_ENV_FILE"',
    "gcloud run deploy adops-agent-prod",
    '--env-vars-file="$AGENT_GCLOUD_ENV_FILE"',
    "gcloud run jobs deploy adops-report-prod",
    "gcloud scheduler jobs create http adops-report-hourly-prod",
    "https://run.googleapis.com/v2/projects/$GCP_PROJECT/locations/$GCP_REGION/jobs/adops-report-prod:run",
    'set -a; . "$WEB_ENV_FILE"; set +a; npm --workspace @adops/web run build',
    "wrangler pages deploy apps/web/dist --project-name=<cloudflare-pages-production-project>",
    "## 7. Supabase Migrations",
    'supabase link --project-ref "$SUPABASE_PROJECT_REF"',
    "supabase db push",
    "npm run e2e:supabase",
    "EXPECT_PRODUCTION_READY=true",
    "npm run smoke:deploy",
    "npm run collect:release-evidence",
    "Record the smoke and collector output in the filled release evidence note",
    "Copy export PRODUCTION_SMOKE_PASSED_AT=... and export RELEASE_EVIDENCE_COLLECTED_AT=... from the successful collector output",
    "export RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>",
    "npm run audit:completion -- --with-verify --json",
  ],
  mustNotIncludeStdout: [
    "PRODUCTION_SMOKE_PASSED_AT=<iso-timestamp>",
    "RELEASE_EVIDENCE_COLLECTED_AT=<iso-timestamp>",
    "RELEASE_EVIDENCE_NOTE_PATH=/",
  ],
});

runContract("rejects unknown target", {
  args: ["--target=preview"],
  expectStatus: 1,
  mustIncludeStderr: ["--target must be staging or production"],
});

if (issues.length) {
  console.error("Deploy command plan contract check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Deploy command plan contract check passed.");

function runContract(name, contract) {
  const result = spawnSync(process.execPath, ["scripts/deploy-command-plan.mjs", ...(contract.args ?? [])], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
    },
  });
  if (result.status !== contract.expectStatus) {
    issues.push(`${name}: expected exit ${contract.expectStatus}, got ${result.status}. stdout=${result.stdout} stderr=${result.stderr}`);
  }
  for (const snippet of contract.mustIncludeStdout ?? []) {
    if (!result.stdout.includes(snippet)) issues.push(`${name}: stdout missing "${snippet}"`);
  }
  for (const snippet of contract.mustIncludeStderr ?? []) {
    if (!result.stderr.includes(snippet)) issues.push(`${name}: stderr missing "${snippet}"`);
  }
  for (const snippet of contract.mustNotIncludeStdout ?? []) {
    if (result.stdout.includes(snippet)) issues.push(`${name}: stdout must not include "${snippet}"`);
  }
}
