#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const preflight = loadPreflight();

if (preflight.overallStatus !== "pass") {
  console.error("Deploy next actions are blocked because deploy preflight is not passing.");
  for (const failure of preflight.failures ?? []) {
    console.error(`- ${failure.label}: ${failure.detail || "required check failed"}`);
    const remediation = preflight.remediation?.[failure.label] ?? [];
    for (const step of remediation) console.error(`  next: ${step}`);
  }
  console.error("\nRun `npm run deploy:preflight -- --json` again after resolving the blockers.");
  process.exit(1);
}

console.log("# Deploy Next Actions");
console.log("");
console.log("Deploy preflight is passing. Continue with this non-secret operator sequence:");
console.log("");
printStep("1. Re-run local code gate", ["npm run verify"]);
printStep("2. Validate staging env files before uploading secrets", [
  "node scripts/check-env.mjs .env.staging.api .env.staging.agent .env.staging.web",
]);
printStep("3. Apply Supabase migrations and verify schema evidence", [
  "supabase link --project-ref <staging-supabase-project-ref>",
  "supabase db push",
  "SUPABASE_URL=https://your-staging-project.supabase.co npm run e2e:supabase # requires SUPABASE service role in operator env",
]);
printStep("4. Deploy staging API, Agent, and Web surfaces", [
  "npm run deploy:commands -- --target=staging",
  "Use docs/deployment.md for Artifact Registry, Cloud Run, and Cloudflare Pages commands.",
  "Grant the API Cloud Run service account roles/run.invoker on the private Agent Service.",
]);
printStep("5. Collect staging provider evidence", [
  "API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging # requires AUTH_TOKEN in operator env",
  "CHECK_GOOGLE_WRITE=true CONFIRM_GOOGLE_WRITE=true GOOGLE_CUSTOMER_ID=<customer-id> GOOGLE_CAMPAIGN_ID=<campaign-id> GOOGLE_WRITE_KIND=status GOOGLE_WRITE_STATUS=PAUSED GOOGLE_RESTORE_STATUS=ENABLED GOOGLE_WRITE_ROLLBACK=\"restore campaign status to ENABLED after audit observation\" API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging # reversible Google Ads write evidence; requires AUTH_TOKEN in operator env",
  "Confirm the web Data Connection audit review panel shows the Google write and restore rows with approval metadata before setting GOOGLE_ADS_STAGING_E2E_PASSED_AT.",
  "Run Stripe webhook evidence with CONFIRM_STRIPE_WEBHOOK_TEST=true npm run e2e:stripe-webhook; requires STRIPE_WEBHOOK_SECRET and AUTH_TOKEN in operator env.",
  "Set CONFIRM_STRIPE_FULL_E2E=true only after STRIPE_FULL_E2E_CONFIRMATION mentions checkout, existing customer reuse, webhook, billing gate, and customer/workspace mismatch rejection; requires UNPAID_AUTH_TOKEN in operator env for authenticated 402 billing_required.",
  "Copy only the export *_STAGING_E2E_PASSED_AT lines backed by the current run and recorded operator evidence.",
]);
printStep("6. Prepare production env and final evidence", [
  "node scripts/check-env.mjs .env.production.api .env.production.agent .env.production.web",
  "npm run deploy:commands -- --target=production",
  "EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com npm run smoke:deploy",
  "EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com RELEASE_SHA=<git-sha> EVIDENCE_OWNER=<operator-name> npm run collect:release-evidence",
  "Record the final smoke and collector output in the filled release evidence note, then set RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>.",
  "npm run audit:completion -- --with-verify --json",
]);
console.log("Keep real secrets out of command history, release notes, and Cloudflare Pages env.");

function loadPreflight() {
  if (process.env.DEPLOY_PREFLIGHT_JSON) {
    return JSON.parse(process.env.DEPLOY_PREFLIGHT_JSON);
  }
  const result = spawnSync(process.execPath, ["scripts/deploy-preflight.mjs", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  try {
    return JSON.parse(result.stdout || "{}");
  } catch (error) {
    throw new Error(`Could not parse deploy preflight JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function printStep(label, commands) {
  console.log(`## ${label}`);
  for (const command of commands) console.log(`- ${command}`);
  console.log("");
}

function printHelp() {
  console.log(`Usage:
  npm run deploy:next

Runs deploy preflight in JSON mode. If preflight is blocked, prints the missing operator prerequisites and remediation.
If preflight passes, prints the next non-secret staging, evidence, and production smoke actions.

For contract tests only, DEPLOY_PREFLIGHT_JSON may provide a mocked preflight JSON payload.`);
}
