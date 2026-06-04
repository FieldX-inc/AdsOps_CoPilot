#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const audit = loadCompletionAudit();

console.log("# Completion Evidence Note");
console.log("");
console.log("This note is generated from `npm run audit:completion -- --json`. It contains no secrets. Do not paste secrets, provider tokens, webhook secrets, service role keys, OAuth codes, or raw customer data into the final release note.");
console.log("");
console.log(`- Overall status: ${audit.overallStatus ?? "unknown"}`);
console.log(`- Captured at: ${new Date().toISOString()}`);
console.log("");
console.log("## Requirement Status");
console.log("");
for (const requirement of audit.requirements ?? []) {
  console.log(`### ${requirement.id ?? "unknown"}`);
  console.log("");
  console.log(`- Status: ${requirement.status ?? "unknown"}`);
  console.log(`- Requirement: ${requirement.requirement ?? "missing"}`);
  console.log(`- Evidence: ${(requirement.evidence ?? []).join(", ") || "missing"}`);
  if (requirement.missing?.length) console.log(`- Missing: ${requirement.missing.join(", ")}`);
  if (requirement.nextActions?.length) {
    console.log("- Next actions:");
    for (const action of requirement.nextActions) console.log(`  - ${action}`);
  }
  console.log("");
}
console.log("## Attachments To Paste Below");
console.log("");
console.log("- `npm run deploy:preflight -- --json` output after it passes.");
console.log("- `npm run deploy:prereq-note` output if operator prerequisites were blocked earlier.");
console.log("- `npm run deploy:next` output after preflight passes.");
console.log("- `npm run deploy:commands -- --target=staging` output before staging deployment.");
console.log("- `API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging` output after staging provider evidence passes; requires AUTH_TOKEN in the operator env.");
console.log("- `CHECK_GOOGLE_WRITE=true CONFIRM_GOOGLE_WRITE=true GOOGLE_CUSTOMER_ID=<customer-id> GOOGLE_CAMPAIGN_ID=<campaign-id> GOOGLE_WRITE_KIND=status GOOGLE_WRITE_STATUS=PAUSED GOOGLE_RESTORE_STATUS=ENABLED GOOGLE_WRITE_ROLLBACK=\"restore campaign status to ENABLED after audit observation\" API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging` output for reversible Google Ads write evidence; requires AUTH_TOKEN in the operator env.");
console.log("- Screenshot or note confirming the web Data Connection audit review panel showed the Google write and restore rows with approval metadata.");
console.log("- `CONFIRM_STRIPE_WEBHOOK_TEST=true npm run e2e:stripe-webhook` output after staging Stripe webhook evidence passes.");
console.log("- `CONFIRM_STRIPE_FULL_E2E=true STRIPE_FULL_E2E_CONFIRMATION=\"checkout existing customer reuse webhook billing gate customer/workspace mismatch rejection confirmed\" API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging` output only after hosted Stripe evidence is recorded; requires AUTH_TOKEN and UNPAID_AUTH_TOKEN in the operator env.");
console.log("- `EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com npm run smoke:deploy` output after production URLs exist.");
console.log("- `EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com RELEASE_SHA=<git-sha> EVIDENCE_OWNER=<operator-name> npm run collect:release-evidence` output after production URLs exist.");
console.log("- Filled `deploy/release-evidence.template.md` fields.");
console.log("- `RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>` pointing to the filled operator-owned release evidence note before the final completion audit.");
console.log("");
console.log("Run `npm run audit:completion -- --with-verify --json` again after the missing items are resolved.");

process.exit(audit.overallStatus === "complete" ? 0 : 1);

function loadCompletionAudit() {
  if (process.env.COMPLETION_AUDIT_JSON) return JSON.parse(process.env.COMPLETION_AUDIT_JSON);
  const auditArgs = ["scripts/completion-audit.mjs", "--json"];
  if (args.has("--with-verify")) auditArgs.push("--with-verify");
  const result = spawnSync(process.execPath, auditArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      COMPLETION_AUDIT_VERIFY_STATUS: process.env.COMPLETION_AUDIT_VERIFY_STATUS,
      DEPLOY_PREFLIGHT_JSON: process.env.DEPLOY_PREFLIGHT_JSON,
    },
  });
  try {
    return JSON.parse(result.stdout || "{}");
  } catch (error) {
    throw new Error(`Could not parse completion audit JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function printHelp() {
  console.log(`Usage:
  npm run audit:completion-note
  npm run audit:completion-note -- --with-verify

Prints a non-secret Markdown note generated from npm run audit:completion -- --json.
Pass --with-verify to run the full local verify gate before the note is generated.
For contract tests only, COMPLETION_AUDIT_JSON may provide a mocked completion audit payload.`);
}
