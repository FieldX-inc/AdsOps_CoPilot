#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const issues = [];

runContract("reports not-ready when operator preflight is blocked", {
  preflight: {
    overallStatus: "fail",
    failures: [
      { label: "Docker daemon", detail: "docker daemon unavailable" },
      { label: "Google Cloud CLI", detail: "gcloud not found" },
    ],
  },
  args: [],
  expectStatus: 1,
  mustIncludeStdout: [
    "# Production Candidate Audit",
    "Repository goal contract status: pass",
    "Full verify status: not-run",
    "Deploy preflight status: blocked",
    "Overall status: not-ready",
    "Docker daemon: docker daemon unavailable",
    "Google Cloud CLI: gcloud not found",
    "npm run deploy:preflight -- --json",
    "audit:production-candidate -- --with-verify",
    "Completion still requires:",
    "staging Supabase migration and schema/RLS evidence",
    "Google Ads OAuth, read/sync, reversible write, restore, and audit evidence",
    "Stripe hosted Checkout, webhook delivery, subscription rows, and billing gate evidence",
    "production env checks and EXPECT_PRODUCTION_READY=true smoke evidence",
    "Evidence commands to run after operator prerequisites pass:",
    "node scripts/check-env.mjs .env.staging.api .env.staging.agent .env.staging.web",
    "SUPABASE_URL=https://your-staging-project.supabase.co npm run e2e:supabase # requires SUPABASE service role in operator env",
    "requires AUTH_TOKEN in operator env",
    "requires STRIPE_WEBHOOK_SECRET and AUTH_TOKEN in operator env",
    "EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com RELEASE_SHA=<git-sha> EVIDENCE_OWNER=<operator-name> npm run collect:release-evidence",
  ],
  mustNotIncludeStdout: ["AUTH_TOKEN=", "SUPABASE_SERVICE_ROLE_KEY=", "STRIPE_WEBHOOK_SECRET="],
});

runContract("prints json status when requested", {
  preflight: {
    overallStatus: "fail",
    failures: [{ label: "Stripe CLI", detail: "stripe not found" }],
  },
  args: ["--json"],
  expectStatus: 1,
  mustIncludeStdout: [
    '"overallStatus": "not-ready"',
    '"repositoryGoalContractStatus": "pass"',
    '"fullVerifyStatus": "not-run"',
    '"deployPreflightStatus": "blocked"',
    '"remainingOperatorPrerequisites": [',
    '"Stripe CLI"',
    '"operatorPrerequisiteDetails": [',
    '"detail": "stripe not found"',
    '"remediation": []',
    '"nextCommand": "npm run deploy:preflight -- --json"',
    '"completionStillRequires": [',
    '"Google Ads OAuth, read/sync, reversible write, restore, and audit evidence"',
    '"evidenceCommands": [',
    '"npm run verify"',
    '"CONFIRM_STRIPE_WEBHOOK_TEST=true npm run e2e:stripe-webhook # requires STRIPE_WEBHOOK_SECRET and AUTH_TOKEN in operator env"',
  ],
  mustNotIncludeStdout: ["AUTH_TOKEN=", "SUPABASE_SERVICE_ROLE_KEY=", "STRIPE_WEBHOOK_SECRET="],
});

runContract("prints json ready status when verify is explicitly confirmed", {
  preflight: {
    overallStatus: "pass",
    failures: [],
  },
  args: ["--with-verify", "--json"],
  expectStatus: 0,
  extraEnv: {
    PRODUCTION_CANDIDATE_VERIFY_STATUS: "pass",
  },
  mustIncludeStdout: [
    '"overallStatus": "ready-for-staging-e2e"',
    '"repositoryGoalContractStatus": "pass"',
    '"fullVerifyStatus": "pass"',
    '"deployPreflightStatus": "pass"',
    '"remainingOperatorPrerequisites": []',
    '"operatorPrerequisiteDetails": []',
    '"nextCommand": "npm run deploy:next"',
    '"completionStillRequires": [',
    '"evidenceCommands": [',
  ],
});

runContract("reports preflight-ready but verify-not-run when contracts and preflight pass", {
  preflight: {
    overallStatus: "pass",
    failures: [],
  },
  args: [],
  expectStatus: 1,
  mustIncludeStdout: [
    "Repository goal contract status: pass",
    "Full verify status: not-run",
    "Deploy preflight status: pass",
    "Overall status: preflight-ready-verify-not-run",
    "npm run verify && npm run deploy:next",
  ],
});

runContract("reports ready for staging e2e when verify is explicitly confirmed", {
  preflight: {
    overallStatus: "pass",
    failures: [],
  },
  args: ["--with-verify"],
  expectStatus: 0,
  extraEnv: {
    PRODUCTION_CANDIDATE_VERIFY_STATUS: "pass",
  },
  mustIncludeStdout: [
    "Repository goal contract status: pass",
    "Full verify status: pass",
    "Deploy preflight status: pass",
    "Overall status: ready-for-staging-e2e",
    "npm run deploy:next",
  ],
});

if (issues.length) {
  console.error("Production candidate audit contract check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Production candidate audit contract check passed.");

function runContract(name, contract) {
  const result = spawnSync(process.execPath, ["scripts/production-candidate-audit.mjs", ...contract.args], {
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
  for (const snippet of contract.mustNotIncludeStdout ?? []) {
    if (result.stdout.includes(snippet)) issues.push(`${name}: stdout must not include "${snippet}"`);
  }
}
