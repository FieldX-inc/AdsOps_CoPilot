#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const issues = [];

runContract("prints non-secret markdown for incomplete audit", {
  audit: {
    overallStatus: "incomplete",
    requirements: [
      {
        id: "openai_agents_sdk_runtime",
        requirement: "Agent framework is switched to OpenAI Agents SDK and production uses OpenAI APIs.",
        status: "proven",
        evidence: ["scripts/check-production-goal.mjs"],
        nextActions: [],
      },
      {
        id: "operator_deploy_prerequisites",
        requirement: "Deployment operator machine has Docker daemon and provider CLIs ready.",
        status: "missing",
        evidence: ["npm run deploy:preflight -- --json"],
        missing: ["Docker daemon", "Stripe CLI"],
        nextActions: ["Start Docker Desktop.", "Install the Stripe CLI.", "npm run deploy:preflight -- --json"],
      },
    ],
  },
  expectStatus: 1,
  mustIncludeStdout: [
    "# Completion Evidence Note",
    "Overall status: incomplete",
    "## Requirement Status",
    "### openai_agents_sdk_runtime",
    "- Status: proven",
    "### operator_deploy_prerequisites",
    "- Status: missing",
    "- Missing: Docker daemon, Stripe CLI",
    "- Next actions:",
    "Install the Stripe CLI.",
    "## Attachments To Paste Below",
    "npm run deploy:prereq-note",
    "npm run deploy:next",
    "npm run deploy:commands -- --target=staging",
    "API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging",
    "requires AUTH_TOKEN in the operator env",
    "CHECK_GOOGLE_WRITE=true CONFIRM_GOOGLE_WRITE=true",
    "reversible Google Ads write evidence",
    "web Data Connection audit review panel showed the Google write and restore rows with approval metadata",
    "CONFIRM_STRIPE_WEBHOOK_TEST=true npm run e2e:stripe-webhook",
    "CONFIRM_STRIPE_FULL_E2E=true STRIPE_FULL_E2E_CONFIRMATION",
    "hosted Stripe evidence is recorded",
    "requires AUTH_TOKEN and UNPAID_AUTH_TOKEN in the operator env",
    "EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com npm run smoke:deploy",
    "EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com RELEASE_SHA=<git-sha> EVIDENCE_OWNER=<operator-name> npm run collect:release-evidence",
    "deploy/release-evidence.template.md",
    "RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>",
    "npm run audit:completion -- --with-verify --json",
  ],
  mustNotIncludeStdout: ["sk_", "whsec_", "SUPABASE_SERVICE_ROLE_KEY=", "AUTH_TOKEN="],
});

runContract("help documents with-verify passthrough", {
  args: ["--help"],
  audit: { overallStatus: "incomplete", requirements: [] },
  expectStatus: 0,
  mustIncludeStdout: [
    "npm run audit:completion-note -- --with-verify",
    "Pass --with-verify to run the full local verify gate",
  ],
});

runContract("exits zero only when completion audit is complete", {
  audit: {
    overallStatus: "complete",
    requirements: [
      {
        id: "final_production_smoke",
        requirement: "Final production smoke and release evidence collection passed.",
        status: "proven",
        evidence: ["PRODUCTION_SMOKE_PASSED_AT", "RELEASE_EVIDENCE_COLLECTED_AT", "RELEASE_EVIDENCE_NOTE_PATH"],
        nextActions: [],
      },
    ],
  },
  expectStatus: 0,
  mustIncludeStdout: [
    "Overall status: complete",
    "### final_production_smoke",
    "PRODUCTION_SMOKE_PASSED_AT",
    "RELEASE_EVIDENCE_COLLECTED_AT",
    "RELEASE_EVIDENCE_NOTE_PATH",
  ],
});

if (issues.length) {
  console.error("Completion evidence note contract check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Completion evidence note contract check passed.");

function runContract(name, contract) {
  const result = spawnSync(process.execPath, ["scripts/completion-evidence-note.mjs", ...(contract.args ?? [])], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      COMPLETION_AUDIT_JSON: JSON.stringify(contract.audit),
    },
  });
  if (result.status !== contract.expectStatus) {
    issues.push(`${name}: expected exit ${contract.expectStatus}, got ${result.status}. stdout=${result.stdout} stderr=${result.stderr}`);
  }
  for (const snippet of contract.mustIncludeStdout ?? []) {
    if (!result.stdout.includes(snippet)) issues.push(`${name}: stdout missing "${snippet}"`);
  }
  for (const snippet of contract.mustNotIncludeStdout ?? []) {
    if (result.stdout.includes(snippet)) issues.push(`${name}: stdout must not include "${snippet}"`);
  }
}
