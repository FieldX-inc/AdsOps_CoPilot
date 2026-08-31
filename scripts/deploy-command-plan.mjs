#!/usr/bin/env node

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const target = valueArg("--target") || "staging";
if (!["staging", "production"].includes(target)) {
  console.error("deploy command plan failed:");
  console.error("- --target must be staging or production");
  process.exit(1);
}

const suffix = target === "production" ? "prod" : "staging";
const apiService = `adops-api-${suffix}`;
const agentService = `adops-agent-${suffix}`;
const reportJob = `adops-report-${suffix}`;
const reportScheduler = `adops-report-hourly-${suffix}`;
const webProject = target === "production" ? "<cloudflare-pages-production-project>" : "<cloudflare-pages-staging-project>";
const apiEnvFile = target === "production" ? ".env.production.api" : ".env.staging.api";
const agentEnvFile = target === "production" ? ".env.production.agent" : ".env.staging.agent";
const webEnvFile = target === "production" ? ".env.production.web" : ".env.staging.web";

console.log(`# ${title(target)} Deploy Command Plan`);
console.log("");
console.log("This is a non-secret command template. Replace placeholders and upload secrets through the hosting provider or secret manager. Do not paste service role keys, OAuth secrets, Stripe secrets, OpenAI keys, or Google Ads developer tokens into shell history.");
console.log("");
console.log("## 1. Operator Gates");
printCommands([
  "npm run verify",
  "npm run deploy:preflight",
  "npm run deploy:preflight -- --json",
  `node scripts/check-env.mjs ${apiEnvFile} ${agentEnvFile} ${webEnvFile}`,
]);
console.log("## 2. Shared Variables");
printCommands([
  "export GCP_PROJECT=<gcp-project-id>",
  "export GCP_REGION=asia-northeast1",
  "export ARTIFACT_REPOSITORY=adops-advisor",
  "export RELEASE_TAG=$(git rev-parse --short HEAD)",
  "export API_SERVICE_ACCOUNT=<api-cloud-run-service-account-email>",
  "export SCHEDULER_SERVICE_ACCOUNT=<scheduler-service-account-email>",
  `export SUPABASE_PROJECT_REF=<${target}-supabase-project-ref>`,
  `export SUPABASE_URL=https://your-${target}-project.supabase.co`,
  `export API_ENV_FILE=${apiEnvFile}`,
  `export AGENT_ENV_FILE=${agentEnvFile}`,
  `export WEB_ENV_FILE=${webEnvFile}`,
  'export DEPLOY_ENV_TMP_DIR=$(mktemp -d)',
  'trap \'rm -rf "$DEPLOY_ENV_TMP_DIR"\' EXIT',
  'install -m 600 "$API_ENV_FILE" "$DEPLOY_ENV_TMP_DIR/api.env"',
  'install -m 600 "$AGENT_ENV_FILE" "$DEPLOY_ENV_TMP_DIR/agent.env"',
  'export API_GCLOUD_ENV_FILE="$DEPLOY_ENV_TMP_DIR/api.env"',
  'export AGENT_GCLOUD_ENV_FILE="$DEPLOY_ENV_TMP_DIR/agent.env"',
]);
console.log("## 3. Artifact Registry");
printCommands([
  'gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" --repository-format=docker --location="$GCP_REGION" --description="AdOps Advisor containers" || true',
  'gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev"',
]);
console.log("## 4. Build And Push Images");
printCommands([
  'docker build -f apps/api/Dockerfile -t "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$ARTIFACT_REPOSITORY/adops-api:$RELEASE_TAG" .',
  'docker push "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$ARTIFACT_REPOSITORY/adops-api:$RELEASE_TAG"',
  'docker build -f services/adk-agent/Dockerfile -t "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$ARTIFACT_REPOSITORY/adops-agent:$RELEASE_TAG" .',
  'docker push "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$ARTIFACT_REPOSITORY/adops-agent:$RELEASE_TAG"',
]);
console.log("## 5. Deploy Cloud Run");
printCommands([
  `gcloud run deploy ${apiService} --project="$GCP_PROJECT" --region="$GCP_REGION" --image="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$ARTIFACT_REPOSITORY/adops-api:$RELEASE_TAG" --allow-unauthenticated --port=8787 --env-vars-file="$API_GCLOUD_ENV_FILE"`,
  `gcloud run deploy ${agentService} --project="$GCP_PROJECT" --region="$GCP_REGION" --image="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$ARTIFACT_REPOSITORY/adops-agent:$RELEASE_TAG" --no-allow-unauthenticated --port=8000 --env-vars-file="$AGENT_GCLOUD_ENV_FILE"`,
  `gcloud run services add-iam-policy-binding ${agentService} --project="$GCP_PROJECT" --region="$GCP_REGION" --member="serviceAccount:$API_SERVICE_ACCOUNT" --role="roles/run.invoker"`,
  `gcloud run jobs deploy ${reportJob} --project="$GCP_PROJECT" --region="$GCP_REGION" --image="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/$ARTIFACT_REPOSITORY/adops-api:$RELEASE_TAG" --service-account="$API_SERVICE_ACCOUNT" --command=node --args=apps/api/dist/report-job.js --env-vars-file="$API_GCLOUD_ENV_FILE" --tasks=1 --max-retries=0`,
  `gcloud run jobs add-iam-policy-binding ${reportJob} --project="$GCP_PROJECT" --region="$GCP_REGION" --member="serviceAccount:$SCHEDULER_SERVICE_ACCOUNT" --role="roles/run.invoker"`,
  `gcloud scheduler jobs create http ${reportScheduler} --project="$GCP_PROJECT" --location="$GCP_REGION" --schedule="0 * * * *" --uri="https://run.googleapis.com/v2/projects/$GCP_PROJECT/locations/$GCP_REGION/jobs/${reportJob}:run" --http-method=POST --oauth-service-account-email="$SCHEDULER_SERVICE_ACCOUNT" || gcloud scheduler jobs update http ${reportScheduler} --project="$GCP_PROJECT" --location="$GCP_REGION" --schedule="0 * * * *" --uri="https://run.googleapis.com/v2/projects/$GCP_PROJECT/locations/$GCP_REGION/jobs/${reportJob}:run" --http-method=POST --oauth-service-account-email="$SCHEDULER_SERVICE_ACCOUNT"`,
]);
console.log("## 6. Deploy Web");
printCommands([
  'set -a; . "$WEB_ENV_FILE"; set +a; npm --workspace @adops/web run build',
  `wrangler pages deploy apps/web/dist --project-name=${webProject}`,
]);
console.log("## 7. Supabase Migrations");
printCommands([
  'supabase link --project-ref "$SUPABASE_PROJECT_REF"',
  "supabase db push",
  'SUPABASE_URL="$SUPABASE_URL" npm run e2e:supabase # requires SUPABASE service role in operator env',
]);
console.log("## 8. Post Deploy Evidence");
if (target === "staging") {
  printCommands([
    "API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging # requires AUTH_TOKEN in operator env",
    "CHECK_GOOGLE_WRITE=true CONFIRM_GOOGLE_WRITE=true GOOGLE_CUSTOMER_ID=<customer-id> GOOGLE_CAMPAIGN_ID=<campaign-id> GOOGLE_WRITE_KIND=status GOOGLE_WRITE_STATUS=PAUSED GOOGLE_RESTORE_STATUS=ENABLED GOOGLE_WRITE_ROLLBACK=\"restore campaign status to ENABLED after audit observation\" API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging # reversible Google Ads write evidence; requires AUTH_TOKEN in operator env",
    "CONFIRM_STRIPE_WEBHOOK_TEST=true API_ORIGIN=https://api.staging.example.com WORKSPACE_ID=<workspace-id> USER_ID=<user-id> npm run e2e:stripe-webhook # requires STRIPE_WEBHOOK_SECRET and AUTH_TOKEN in operator env",
    "CONFIRM_STRIPE_FULL_E2E=true STRIPE_FULL_E2E_CONFIRMATION=\"checkout existing customer reuse webhook billing gate customer/workspace mismatch rejection confirmed\" API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging # set only after hosted Stripe evidence is recorded; requires AUTH_TOKEN and UNPAID_AUTH_TOKEN in operator env",
    `gcloud run jobs execute ${reportJob} --project="$GCP_PROJECT" --region="$GCP_REGION" --wait # verify report claim, structured output, separate usage, and Cloudflare Email delivery before setting REPORT_EMAIL_STAGING_E2E_PASSED_AT`,
    "# Confirm the web Data Connection audit review panel shows the Google write and restore rows with approval metadata before setting GOOGLE_ADS_STAGING_E2E_PASSED_AT.",
  ]);
} else {
  printCommands([
    "EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com npm run smoke:deploy",
    "EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com RELEASE_SHA=$RELEASE_TAG EVIDENCE_OWNER=<operator-name> npm run collect:release-evidence",
    "# Record the smoke and collector output in the filled release evidence note.",
    "# Copy export PRODUCTION_SMOKE_PASSED_AT=... and export RELEASE_EVIDENCE_COLLECTED_AT=... from the successful collector output before running:",
    "export RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>",
    "npm run audit:completion -- --with-verify --json",
  ]);
}
console.log("## 9. Evidence Note");
printCommands(["npm run audit:completion-note -- --with-verify"]);

function printCommands(commands) {
  console.log("```sh");
  for (const command of commands) console.log(command);
  console.log("```");
  console.log("");
}

function valueArg(name) {
  const prefix = `${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return "";
}

function title(value) {
  return value[0].toUpperCase() + value.slice(1);
}

function printHelp() {
  console.log(`Usage:
  npm run deploy:commands
  npm run deploy:commands -- --target=staging
  npm run deploy:commands -- --target=production

Prints non-secret Cloud Run, Cloudflare Pages, provider evidence, final smoke, and completion-audit command templates.`);
  console.log("");
  console.log("Examples include Cloud Run services such as adops-api-staging and adops-agent-prod.");
}
