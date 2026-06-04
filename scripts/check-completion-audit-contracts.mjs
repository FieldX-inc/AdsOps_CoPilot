#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const issues = [];
const now = new Date();
const completeProductionSmokeAt = hoursAgo(2);
const completeReleaseEvidenceAt = hoursAgo(1);
const completeReleaseEvidenceNotePath = releaseEvidenceNotePath({
  productionSmokeAt: completeProductionSmokeAt,
  releaseEvidenceAt: completeReleaseEvidenceAt,
});

runContract("reports incomplete when preflight and staging evidence are missing", {
  args: ["--json"],
  preflight: {
    overallStatus: "fail",
    failures: [{ label: "Stripe CLI", detail: "stripe not found" }],
    remediation: {
      "Stripe CLI": ["Install the Stripe CLI.", "Run `stripe login` before webhook forwarding or webhook E2E checks."],
    },
  },
  expectStatus: 1,
  mustIncludeStdout: [
    '"overallStatus": "incomplete"',
    '"id": "openai_agents_sdk_runtime"',
    '"status": "proven"',
    '"id": "google_ads_read_write"',
    '"id": "stripe_billing"',
    '"id": "local_repository_verification"',
    '"status": "missing"',
    '"id": "operator_deploy_prerequisites"',
    '"Stripe CLI"',
    '"id": "staging_provider_evidence"',
    '"id": "final_production_smoke"',
    '"OPENAI_AGENT_STAGING_E2E_PASSED_AT"',
    '"DEPLOYMENT_RUNBOOK_ACK=true"',
    '"PRODUCTION_SMOKE_PASSED_AT"',
    '"RELEASE_EVIDENCE_COLLECTED_AT"',
    '"RELEASE_EVIDENCE_NOTE_PATH"',
    '"nextActions": [',
    '"Install the Stripe CLI."',
    '"npm run deploy:preflight -- --json"',
    '"npm run deploy:next"',
    '"supabase link --project-ref <staging-supabase-project-ref>"',
    '"supabase db push"',
    '"npm run deploy:commands -- --target=staging"',
    '"API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging # requires AUTH_TOKEN in operator env"',
    '"CHECK_GOOGLE_WRITE=true CONFIRM_GOOGLE_WRITE=true GOOGLE_CUSTOMER_ID=<customer-id> GOOGLE_CAMPAIGN_ID=<campaign-id> GOOGLE_WRITE_KIND=status GOOGLE_WRITE_STATUS=PAUSED GOOGLE_RESTORE_STATUS=ENABLED GOOGLE_WRITE_ROLLBACK=\\"restore campaign status to ENABLED after audit observation\\" API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging # reversible Google Ads write evidence; requires AUTH_TOKEN in operator env"',
    '"Confirm the web Data Connection audit review panel shows the Google write and restore rows with approval metadata before setting GOOGLE_ADS_STAGING_E2E_PASSED_AT"',
    '"CONFIRM_STRIPE_WEBHOOK_TEST=true npm run e2e:stripe-webhook # requires STRIPE_WEBHOOK_SECRET and AUTH_TOKEN in operator env"',
    '"CONFIRM_STRIPE_FULL_E2E=true STRIPE_FULL_E2E_CONFIRMATION=\\"checkout existing customer reuse webhook billing gate customer/workspace mismatch rejection confirmed\\" API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging # set only after hosted Stripe evidence is recorded; requires AUTH_TOKEN and UNPAID_AUTH_TOKEN in operator env"',
    '"Copy export PRODUCTION_SMOKE_PASSED_AT and export RELEASE_EVIDENCE_COLLECTED_AT from the successful collector output after recording the release evidence note"',
    '"Set RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>"',
    '"node scripts/check-env.mjs .env.production.api .env.production.agent .env.production.web"',
    '"npm run deploy:commands -- --target=production"',
    '"EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com npm run smoke:deploy"',
    '"EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com RELEASE_SHA=<git-sha> EVIDENCE_OWNER=<operator-name> npm run collect:release-evidence"',
  ],
});

runContract("stays incomplete when staging evidence is proven but final smoke evidence is missing", {
  args: ["--with-verify", "--json"],
  preflight: {
    overallStatus: "pass",
    failures: [],
  },
  extraEnv: {
    COMPLETION_AUDIT_VERIFY_STATUS: "pass",
    OPENAI_AGENT_STAGING_E2E_PASSED_AT: hoursAgo(6),
    GOOGLE_ADS_STAGING_E2E_PASSED_AT: hoursAgo(5),
    STRIPE_STAGING_E2E_PASSED_AT: hoursAgo(4),
    DEPLOYMENT_RUNBOOK_ACK: "true",
  },
  expectStatus: 1,
  mustIncludeStdout: [
    '"overallStatus": "incomplete"',
    '"id": "staging_provider_evidence"',
    '"status": "proven"',
    '"id": "final_production_smoke"',
    '"status": "missing"',
    '"PRODUCTION_SMOKE_PASSED_AT"',
    '"RELEASE_EVIDENCE_COLLECTED_AT"',
    '"npm run deploy:commands -- --target=production"',
    '"EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com RELEASE_SHA=<git-sha> EVIDENCE_OWNER=<operator-name> npm run collect:release-evidence"',
  ],
});

runContract("reports complete only when verify, preflight, staging evidence, and final smoke evidence are proven", {
  args: ["--with-verify", "--json"],
  preflight: {
    overallStatus: "pass",
    failures: [],
  },
  extraEnv: {
    COMPLETION_AUDIT_VERIFY_STATUS: "pass",
    OPENAI_AGENT_STAGING_E2E_PASSED_AT: hoursAgo(6),
    GOOGLE_ADS_STAGING_E2E_PASSED_AT: hoursAgo(5),
    STRIPE_STAGING_E2E_PASSED_AT: hoursAgo(4),
    DEPLOYMENT_RUNBOOK_ACK: "true",
    PRODUCTION_SMOKE_PASSED_AT: completeProductionSmokeAt,
    RELEASE_EVIDENCE_COLLECTED_AT: completeReleaseEvidenceAt,
    RELEASE_EVIDENCE_NOTE_PATH: completeReleaseEvidenceNotePath,
  },
  expectStatus: 0,
  mustIncludeStdout: [
    '"overallStatus": "complete"',
    '"id": "openai_agents_sdk_runtime"',
    '"id": "google_ads_read_write"',
    '"id": "stripe_billing"',
    '"id": "operator_deploy_prerequisites"',
    '"id": "staging_provider_evidence"',
    '"id": "final_production_smoke"',
    '"status": "proven"',
  ],
});

runContract("keeps final smoke evidence missing when the release evidence note is not provided", {
  args: ["--with-verify"],
  preflight: {
    overallStatus: "pass",
    failures: [],
  },
  extraEnv: {
    COMPLETION_AUDIT_VERIFY_STATUS: "pass",
    OPENAI_AGENT_STAGING_E2E_PASSED_AT: hoursAgo(6),
    GOOGLE_ADS_STAGING_E2E_PASSED_AT: hoursAgo(5),
    STRIPE_STAGING_E2E_PASSED_AT: hoursAgo(4),
    DEPLOYMENT_RUNBOOK_ACK: "true",
    PRODUCTION_SMOKE_PASSED_AT: hoursAgo(2),
    RELEASE_EVIDENCE_COLLECTED_AT: hoursAgo(1),
  },
  expectStatus: 1,
  mustIncludeStdout: [
    "# Completion Audit",
    "Overall status: incomplete",
    "missing: RELEASE_EVIDENCE_NOTE_PATH",
    "Set RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>",
  ],
});

runContract("keeps final smoke evidence missing when the release evidence note omits timestamp values", {
  args: ["--with-verify"],
  preflight: {
    overallStatus: "pass",
    failures: [],
  },
  extraEnv: {
    COMPLETION_AUDIT_VERIFY_STATUS: "pass",
    OPENAI_AGENT_STAGING_E2E_PASSED_AT: hoursAgo(6),
    GOOGLE_ADS_STAGING_E2E_PASSED_AT: hoursAgo(5),
    STRIPE_STAGING_E2E_PASSED_AT: hoursAgo(4),
    DEPLOYMENT_RUNBOOK_ACK: "true",
    PRODUCTION_SMOKE_PASSED_AT: hoursAgo(2),
    RELEASE_EVIDENCE_COLLECTED_AT: hoursAgo(1),
    RELEASE_EVIDENCE_NOTE_PATH: releaseEvidenceNotePath({
      productionSmokeAt: "2026-01-01T00:00:00.000Z",
      releaseEvidenceAt: "2026-01-01T01:00:00.000Z",
    }),
  },
  expectStatus: 1,
  mustIncludeStdout: [
    "release evidence note must include PRODUCTION_SMOKE_PASSED_AT value",
    "release evidence note must include RELEASE_EVIDENCE_COLLECTED_AT value",
  ],
});

runContract("keeps staging evidence missing when timestamps are stale or spread too far apart", {
  args: ["--with-verify"],
  preflight: {
    overallStatus: "pass",
    failures: [],
  },
  extraEnv: {
    COMPLETION_AUDIT_VERIFY_STATUS: "pass",
    OPENAI_AGENT_STAGING_E2E_PASSED_AT: daysAgo(10),
    GOOGLE_ADS_STAGING_E2E_PASSED_AT: hoursAgo(2),
    STRIPE_STAGING_E2E_PASSED_AT: hoursAgo(1),
    DEPLOYMENT_RUNBOOK_ACK: "true",
  },
  expectStatus: 1,
  mustIncludeStdout: [
    "# Completion Audit",
    "Overall status: incomplete",
    "missing: staging evidence timestamps within 7 days",
    "next: npm run deploy:next",
    "npm run audit:completion -- --with-verify",
  ],
});

runContract("keeps final smoke evidence missing when timestamps are spread too far apart", {
  args: ["--with-verify"],
  preflight: {
    overallStatus: "pass",
    failures: [],
  },
  extraEnv: {
    COMPLETION_AUDIT_VERIFY_STATUS: "pass",
    OPENAI_AGENT_STAGING_E2E_PASSED_AT: hoursAgo(6),
    GOOGLE_ADS_STAGING_E2E_PASSED_AT: hoursAgo(5),
    STRIPE_STAGING_E2E_PASSED_AT: hoursAgo(4),
    DEPLOYMENT_RUNBOOK_ACK: "true",
    PRODUCTION_SMOKE_PASSED_AT: daysAgo(2),
    RELEASE_EVIDENCE_COLLECTED_AT: hoursAgo(1),
    RELEASE_EVIDENCE_NOTE_PATH: releaseEvidenceNotePath({
      productionSmokeAt: daysAgo(2),
      releaseEvidenceAt: hoursAgo(1),
    }),
  },
  expectStatus: 1,
  mustIncludeStdout: [
    "# Completion Audit",
    "Overall status: incomplete",
    "missing: production smoke and release evidence timestamps within 24 hours",
    "Copy export PRODUCTION_SMOKE_PASSED_AT and export RELEASE_EVIDENCE_COLLECTED_AT from the successful collector output after recording the release evidence note",
  ],
});

runContract("keeps staging evidence missing when timestamps are stale even if the spread is valid", {
  args: ["--with-verify"],
  preflight: {
    overallStatus: "pass",
    failures: [],
  },
  extraEnv: {
    COMPLETION_AUDIT_VERIFY_STATUS: "pass",
    OPENAI_AGENT_STAGING_E2E_PASSED_AT: daysAgo(100),
    GOOGLE_ADS_STAGING_E2E_PASSED_AT: daysAgo(100),
    STRIPE_STAGING_E2E_PASSED_AT: daysAgo(100),
    DEPLOYMENT_RUNBOOK_ACK: "true",
  },
  expectStatus: 1,
  mustIncludeStdout: [
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT must be refreshed before completion audit",
    "GOOGLE_ADS_STAGING_E2E_PASSED_AT must be refreshed before completion audit",
    "STRIPE_STAGING_E2E_PASSED_AT must be refreshed before completion audit",
  ],
});

runContract("keeps final smoke evidence missing when timestamps are stale even if the spread is valid", {
  args: ["--with-verify"],
  preflight: {
    overallStatus: "pass",
    failures: [],
  },
  extraEnv: {
    COMPLETION_AUDIT_VERIFY_STATUS: "pass",
    OPENAI_AGENT_STAGING_E2E_PASSED_AT: hoursAgo(6),
    GOOGLE_ADS_STAGING_E2E_PASSED_AT: hoursAgo(5),
    STRIPE_STAGING_E2E_PASSED_AT: hoursAgo(4),
    DEPLOYMENT_RUNBOOK_ACK: "true",
    PRODUCTION_SMOKE_PASSED_AT: daysAgo(10),
    RELEASE_EVIDENCE_COLLECTED_AT: daysAgo(10),
    RELEASE_EVIDENCE_NOTE_PATH: releaseEvidenceNotePath({
      productionSmokeAt: daysAgo(10),
      releaseEvidenceAt: daysAgo(10),
    }),
  },
  expectStatus: 1,
  mustIncludeStdout: [
    "PRODUCTION_SMOKE_PASSED_AT must be refreshed before completion audit",
    "RELEASE_EVIDENCE_COLLECTED_AT must be refreshed before completion audit",
  ],
});

runContract("keeps completion incomplete when evidence timestamps are too far in the future", {
  args: ["--with-verify"],
  preflight: {
    overallStatus: "pass",
    failures: [],
  },
  extraEnv: {
    COMPLETION_AUDIT_VERIFY_STATUS: "pass",
    OPENAI_AGENT_STAGING_E2E_PASSED_AT: hoursFromNow(30),
    GOOGLE_ADS_STAGING_E2E_PASSED_AT: hoursAgo(5),
    STRIPE_STAGING_E2E_PASSED_AT: hoursAgo(4),
    DEPLOYMENT_RUNBOOK_ACK: "true",
    PRODUCTION_SMOKE_PASSED_AT: hoursAgo(2),
    RELEASE_EVIDENCE_COLLECTED_AT: hoursFromNow(30),
    RELEASE_EVIDENCE_NOTE_PATH: releaseEvidenceNotePath({
      productionSmokeAt: hoursAgo(2),
      releaseEvidenceAt: hoursFromNow(30),
    }),
  },
  expectStatus: 1,
  mustIncludeStdout: [
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT must not be more than 24 hours in the future",
    "RELEASE_EVIDENCE_COLLECTED_AT must not be more than 24 hours in the future",
  ],
});

if (issues.length) {
  console.error("Completion audit contract check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Completion audit contract check passed.");

function runContract(name, contract) {
  const result = spawnSync(process.execPath, ["scripts/completion-audit.mjs", ...contract.args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      DEPLOY_PREFLIGHT_JSON: JSON.stringify(contract.preflight),
      ...(contract.extraEnv ?? {}),
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
  const forbiddenStdout = contract.mustNotIncludeStdout ?? ["AUTH_TOKEN=", "SUPABASE_SERVICE_ROLE_KEY=", "STRIPE_WEBHOOK_SECRET="];
  for (const snippet of forbiddenStdout) {
    if (result.stdout.includes(snippet)) issues.push(`${name}: stdout must not include "${snippet}"`);
  }
}

function hoursAgo(hours) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function daysAgo(days) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function hoursFromNow(hours) {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function releaseEvidenceNotePath({ productionSmokeAt, releaseEvidenceAt }) {
  const dir = mkdtempSync(join(tmpdir(), "adops-completion-audit-"));
  const filePath = join(dir, "release-evidence.md");
  writeFileSync(filePath, `# Release Evidence

EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com npm run smoke:deploy
EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com RELEASE_SHA=abc123 EVIDENCE_OWNER=operator npm run collect:release-evidence

- Final smoke used WEB_ORIGIN.
- API \`/readiness\` production decision was \`Go\`:
- PRODUCTION_SMOKE_PASSED_AT: ${productionSmokeAt}
- RELEASE_EVIDENCE_COLLECTED_AT: ${releaseEvidenceAt}
`);
  return filePath;
}
