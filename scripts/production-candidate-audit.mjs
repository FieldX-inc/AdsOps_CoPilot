#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const goal = runCommand(["scripts/check-production-goal.mjs"]);
const preflight = loadPreflight();
const verify = args.has("--with-verify") ? loadVerify() : null;

const repositoryGoalContractStatus = goal.status === 0 ? "pass" : "fail";
const fullVerifyStatus = verify ? (verify.status === 0 ? "pass" : "fail") : "not-run";
const preflightStatus = preflight.overallStatus === "pass" ? "pass" : "blocked";
const overallStatus = determineOverallStatus(repositoryGoalContractStatus, fullVerifyStatus, preflightStatus);
const nextCommand = determineNextCommand(fullVerifyStatus, preflightStatus);
const completionStillRequires = [
  "staging Supabase migration and schema/RLS evidence",
  "Google Ads OAuth, read/sync, reversible write, restore, and audit evidence",
  "Stripe hosted Checkout, webhook delivery, subscription rows, and billing gate evidence",
  "production env checks and EXPECT_PRODUCTION_READY=true smoke evidence",
];
const evidenceCommands = [
  "npm run deploy:preflight -- --json",
  "npm run verify",
  "node scripts/check-env.mjs .env.staging.api .env.staging.agent .env.staging.web",
  "SUPABASE_URL=https://your-staging-project.supabase.co npm run e2e:supabase # requires SUPABASE service role in operator env",
  "API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging # requires AUTH_TOKEN in operator env",
  "CONFIRM_STRIPE_WEBHOOK_TEST=true npm run e2e:stripe-webhook # requires STRIPE_WEBHOOK_SECRET and AUTH_TOKEN in operator env",
  "node scripts/check-env.mjs .env.production.api .env.production.agent .env.production.web",
  "EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com npm run smoke:deploy",
  "EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com RELEASE_SHA=<git-sha> EVIDENCE_OWNER=<operator-name> npm run collect:release-evidence",
];

if (args.has("--json")) {
  console.log(
    JSON.stringify(
      {
        overallStatus,
        repositoryGoalContractStatus,
        fullVerifyStatus,
        deployPreflightStatus: preflightStatus,
        remainingOperatorPrerequisites: (preflight.failures ?? []).map((failure) => failure.label),
        operatorPrerequisiteDetails: (preflight.failures ?? []).map((failure) => ({
          label: failure.label,
          detail: failure.detail || "required check failed",
          remediation: preflight.remediation?.[failure.label] ?? [],
        })),
        nextCommand,
        completionStillRequires,
        evidenceCommands,
      },
      null,
      2,
    ),
  );
  process.exit(overallStatus === "ready-for-staging-e2e" ? 0 : 1);
}

console.log("# Production Candidate Audit");
console.log("");
console.log(`- Repository goal contract status: ${repositoryGoalContractStatus}`);
console.log(`- Full verify status: ${fullVerifyStatus}`);
console.log(`- Deploy preflight status: ${preflightStatus}`);
console.log(`- Overall status: ${overallStatus}`);
console.log("");

if (goal.status !== 0) {
  console.log("## Code Contract Issues");
  console.log("");
  for (const line of (goal.stderr || goal.stdout).split(/\r?\n/).filter(Boolean)) console.log(`- ${line}`);
  console.log("");
}

if (preflightStatus !== "pass") {
  console.log("## Remaining Operator Prerequisites");
  console.log("");
  for (const failure of preflight.failures ?? []) {
    console.log(`- ${failure.label}: ${failure.detail || "required check failed"}`);
  }
  console.log("");
  console.log("Next command after fixing these prerequisites:");
  console.log("");
  console.log("- npm run deploy:preflight -- --json");
} else {
  console.log("## Next Command");
  console.log("");
  console.log(`- ${nextCommand}`);
}

console.log("");
if (fullVerifyStatus === "not-run") {
  console.log("Run with `npm run audit:production-candidate -- --with-verify` when you want this audit to execute the full local verify gate before reporting readiness.");
  console.log("");
}
console.log("Completion still requires:");
for (const requirement of completionStillRequires) console.log(`- ${requirement}`);
console.log("");
console.log("Evidence commands to run after operator prerequisites pass:");
for (const command of evidenceCommands) console.log(`- ${command}`);

process.exit(overallStatus === "ready-for-staging-e2e" ? 0 : 1);

function runCommand(commandArgs) {
  return spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function runNpm(commandArgs) {
  return spawnSync("npm", commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function loadVerify() {
  if (process.env.PRODUCTION_CANDIDATE_VERIFY_STATUS) {
    return { status: process.env.PRODUCTION_CANDIDATE_VERIFY_STATUS === "pass" ? 0 : 1 };
  }
  return runNpm(["run", "verify"]);
}

function determineOverallStatus(repositoryGoalContractStatus, fullVerifyStatus, preflightStatus) {
  if (repositoryGoalContractStatus !== "pass" || preflightStatus !== "pass") return "not-ready";
  if (fullVerifyStatus === "fail") return "not-ready";
  if (fullVerifyStatus === "not-run") return "preflight-ready-verify-not-run";
  return "ready-for-staging-e2e";
}

function determineNextCommand(fullVerifyStatus, preflightStatus) {
  if (preflightStatus !== "pass") return "npm run deploy:preflight -- --json";
  if (fullVerifyStatus === "not-run") return "npm run verify && npm run deploy:next";
  if (fullVerifyStatus === "fail") return "npm run verify";
  return "npm run deploy:next";
}

function loadPreflight() {
  if (process.env.DEPLOY_PREFLIGHT_JSON) {
    return JSON.parse(process.env.DEPLOY_PREFLIGHT_JSON);
  }
  const result = runCommand(["scripts/deploy-preflight.mjs", "--json"]);
  try {
    return JSON.parse(result.stdout || "{}");
  } catch (error) {
    throw new Error(`Could not parse deploy preflight JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function printHelp() {
  console.log(`Usage:
  npm run audit:production-candidate
  npm run audit:production-candidate -- --json
  npm run audit:production-candidate -- --with-verify

Summarizes whether repository production goal contracts pass, whether full verify was run, and whether deploy preflight is ready.
This command does not deploy, install tools, call remote providers, or print secrets.`);
}
