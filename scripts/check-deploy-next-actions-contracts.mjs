#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const issues = [];

runContract("blocks next actions when preflight is failing", {
  preflight: {
    overallStatus: "fail",
    failures: [
      {
        label: "Docker daemon",
        detail: "docker daemon unavailable",
      },
      {
        label: "Stripe CLI",
        detail: "stripe not found",
      },
    ],
    remediation: {
      "Docker daemon": ["Start Docker Desktop, then rerun `docker info` until it returns server details."],
      "Stripe CLI": ["Install the Stripe CLI.", "Run `stripe login` before webhook forwarding or webhook E2E checks."],
    },
  },
  expectStatus: 1,
  mustIncludeStderr: [
    "Deploy next actions are blocked because deploy preflight is not passing.",
    "Docker daemon: docker daemon unavailable",
    "Start Docker Desktop",
    "Stripe CLI: stripe not found",
    "Run `stripe login`",
    "npm run deploy:preflight -- --json",
  ],
});

runContract("prints ordered operator sequence after preflight passes", {
  preflight: {
    overallStatus: "pass",
    failures: [],
    remediation: {},
  },
  expectStatus: 0,
  mustIncludeStdout: [
    "# Deploy Next Actions",
    "npm run verify",
    "node scripts/check-env.mjs .env.staging.api .env.staging.agent .env.staging.web",
    "supabase link --project-ref <staging-supabase-project-ref>",
    "supabase db push",
    "requires SUPABASE service role in operator env",
    "npm run deploy:commands -- --target=staging",
    "roles/run.invoker",
    "npm run e2e:staging",
    "requires AUTH_TOKEN in operator env",
    "CHECK_GOOGLE_WRITE=true",
    "CONFIRM_GOOGLE_WRITE=true",
    "GOOGLE_RESTORE_STATUS=ENABLED",
    "GOOGLE_WRITE_ROLLBACK",
    "audit review panel shows the Google write and restore rows with approval metadata",
    "npm run e2e:stripe-webhook",
    "requires STRIPE_WEBHOOK_SECRET and AUTH_TOKEN in operator env",
    "STRIPE_FULL_E2E_CONFIRMATION mentions checkout, existing customer reuse, webhook, billing gate, and customer/workspace mismatch rejection",
    "requires UNPAID_AUTH_TOKEN in operator env",
    "Copy only the export *_STAGING_E2E_PASSED_AT lines backed by the current run",
    "node scripts/check-env.mjs .env.production.api .env.production.agent .env.production.web",
    "npm run deploy:commands -- --target=production",
    "EXPECT_PRODUCTION_READY=true",
    "WEB_ORIGIN=https://app.example.com",
    "RELEASE_SHA=<git-sha>",
    "EVIDENCE_OWNER=<operator-name>",
    "npm run collect:release-evidence",
    "RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>",
    "npm run audit:completion -- --with-verify --json",
    "Keep real secrets out",
  ],
  mustNotIncludeStdout: ["AUTH_TOKEN=", "STRIPE_WEBHOOK_SECRET=", "SUPABASE_SERVICE_ROLE_KEY="],
});

if (issues.length) {
  console.error("Deploy next actions contract check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Deploy next actions contract check passed.");

function runContract(name, contract) {
  const result = spawnSync(process.execPath, ["scripts/deploy-next-actions.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      DEPLOY_PREFLIGHT_JSON: JSON.stringify(contract.preflight),
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
