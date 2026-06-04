#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const issues = [];

runContract("prints required fixes when preflight is blocked", {
  preflight: {
    overallStatus: "fail",
    failures: [
      { label: "Docker daemon", detail: "docker daemon unavailable" },
      { label: "Stripe CLI", detail: "stripe not found" },
    ],
    remediation: {
      "Docker daemon": [
        "Start Docker Desktop, then rerun `docker info` until it returns server details.",
        "macOS/Homebrew example if Docker Desktop is missing: `brew install --cask docker`, then `open -a Docker`.",
      ],
      "Stripe CLI": [
        "Install the Stripe CLI.",
        "macOS/Homebrew example: `brew install stripe/stripe-cli/stripe`.",
        "Run `stripe login` before webhook forwarding or webhook E2E checks.",
      ],
    },
  },
  expectStatus: 1,
  mustIncludeStdout: [
    "# Operator Prerequisite Note",
    "Overall status: fail",
    "### Docker daemon",
    "docker daemon unavailable",
    "Start Docker Desktop",
    "brew install --cask docker",
    "Verification command: docker info",
    "### Stripe CLI",
    "stripe not found",
    "Install the Stripe CLI.",
    "brew install stripe/stripe-cli/stripe",
    "Verification command: stripe --version",
    "npm run deploy:preflight -- --json",
    "npm run audit:completion -- --with-verify --json",
  ],
  mustNotIncludeStdout: ["sk_", "whsec_", "SUPABASE_SERVICE_ROLE_KEY=", "AUTH_TOKEN="],
});

runContract("prints next deploy commands when preflight passes", {
  preflight: {
    overallStatus: "pass",
    failures: [],
    remediation: {},
  },
  expectStatus: 0,
  mustIncludeStdout: [
    "All required operator prerequisites are passing.",
    "npm run deploy:next",
    "npm run deploy:commands -- --target=staging",
    "npm run audit:completion-note -- --with-verify",
  ],
});

if (issues.length) {
  console.error("Operator prerequisite note contract check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Operator prerequisite note contract check passed.");

function runContract(name, contract) {
  const result = spawnSync(process.execPath, ["scripts/operator-prereq-note.mjs"], {
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
  for (const snippet of contract.mustNotIncludeStdout ?? []) {
    if (result.stdout.includes(snippet)) issues.push(`${name}: stdout must not include "${snippet}"`);
  }
}
