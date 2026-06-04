#!/usr/bin/env node

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const issues = [];

await runContract("passes when all operator tools and auth checks pass", {
  tools: passingTools(),
  extraEnv: expectedTargetEnv(),
  expectStatus: 0,
  mustIncludeStdout: [
    "Deploy preflight passed.",
    "pass: Docker daemon",
    "pass: Expected Google Cloud project",
    "pass: Expected Cloudflare account",
    "pass: Expected Supabase project ref",
    "pass: Expected Stripe account",
    "pass: Google Cloud CLI auth",
    "pass: Cloudflare Wrangler auth",
    "pass: Supabase CLI auth",
    "pass: Stripe CLI auth",
    "pass: GitHub CLI auth",
  ],
});

await runContract("fails with remediation when required CLIs are missing", {
  tools: {
    gh: tool("echo 'github.com'"),
  },
  extraEnv: expectedTargetEnv(),
  expectStatus: 1,
  mustIncludeStdout: ["Deploy preflight summary:", "pass: GitHub CLI auth"],
  mustIncludeStderr: [
    "Docker CLI: docker not found",
    "Google Cloud CLI: gcloud not found",
    "Cloudflare Wrangler CLI: wrangler not found",
    "Supabase CLI: supabase not found",
    "Stripe CLI: stripe not found",
    "Install the Google Cloud CLI.",
    "Install Wrangler for the deployment operator environment.",
    "Install the Supabase CLI.",
    "Install the Stripe CLI.",
  ],
});

await runContract("fails with remediation when auth or daemon checks fail", {
  tools: {
    ...passingTools(),
    docker: tool(`
if [ "$1" = "--version" ]; then echo "Docker version 29.5.2"; exit 0; fi
if [ "$1" = "info" ]; then echo "docker daemon unavailable" >&2; exit 1; fi
exit 1
`),
    gcloud: tool(`
if [ "$1" = "--version" ]; then echo "Google Cloud SDK 999.0.0"; exit 0; fi
if [ "$1" = "auth" ]; then echo "[]"; exit 0; fi
if [ "$1" = "config" ]; then echo "(unset)"; exit 0; fi
exit 1
`),
    wrangler: tool(`
if [ "$1" = "--version" ]; then echo "wrangler 4.0.0"; exit 0; fi
if [ "$1" = "whoami" ]; then echo "not logged in" >&2; exit 1; fi
exit 1
`),
    supabase: tool(`
if [ "$1" = "--version" ]; then echo "supabase 2.0.0"; exit 0; fi
if [ "$1" = "projects" ]; then echo "not logged in" >&2; exit 1; fi
exit 1
`),
    stripe: tool(`
if [ "$1" = "--version" ]; then echo "stripe version 1.0.0"; exit 0; fi
if [ "$1" = "whoami" ]; then echo "not logged in" >&2; exit 1; fi
exit 1
`),
  },
  extraEnv: expectedTargetEnv(),
  expectStatus: 1,
  mustIncludeStderr: [
    "Docker daemon: docker daemon unavailable",
    "Google Cloud CLI auth: no active gcloud account",
    "Google Cloud project: gcloud project does not match expected project adops-production",
    "Cloudflare Wrangler auth: not logged in",
    "Supabase CLI auth: not logged in",
    "Stripe CLI auth: not logged in",
    "Start Docker Desktop",
    "Run `gcloud auth login`",
    "Run `wrangler login`",
    "Run `supabase login`",
    "Run `stripe login`",
  ],
});

await runContract("fails when expected deployment targets are not configured", {
  tools: passingTools(),
  expectStatus: 1,
  mustIncludeStderr: [
    "Expected Google Cloud project: Set GCP_PROJECT or EXPECTED_GCP_PROJECT to the intended deployment project.",
    "Expected Cloudflare account: Set EXPECTED_CLOUDFLARE_ACCOUNT to the account that owns the Pages project.",
    "Expected Supabase project ref: Set SUPABASE_PROJECT_REF or EXPECTED_SUPABASE_PROJECT_REF to the target Supabase project ref.",
    "Expected Stripe account: Set EXPECTED_STRIPE_ACCOUNT to the Stripe account used for billing.",
    "Set `GCP_PROJECT=<gcp-project-id>` or `EXPECTED_GCP_PROJECT=<gcp-project-id>`",
    "Set `EXPECTED_CLOUDFLARE_ACCOUNT=<account-marker>`",
    "Set `SUPABASE_PROJECT_REF=<project-ref>` or `EXPECTED_SUPABASE_PROJECT_REF=<project-ref>`",
    "Set `EXPECTED_STRIPE_ACCOUNT=<account-marker>`",
  ],
});

await runContract("fails when active gcloud project does not match GCP_PROJECT", {
  tools: passingTools(),
  extraEnv: {
    GCP_PROJECT: "expected-production-project",
    EXPECTED_CLOUDFLARE_ACCOUNT: "cloudflare-user",
    EXPECTED_SUPABASE_PROJECT_REF: "linked-project",
    EXPECTED_STRIPE_ACCOUNT: "stripe-user",
  },
  expectStatus: 1,
  mustIncludeStderr: [
    "Google Cloud project: gcloud project does not match expected project expected-production-project",
    "Set GCP_PROJECT or EXPECTED_GCP_PROJECT and confirm it matches the active gcloud project exactly.",
  ],
});

await runContract("fails when expected provider accounts are not visible to CLIs", {
  tools: passingTools(),
  extraEnv: {
    GCP_PROJECT: "adops-production",
    EXPECTED_CLOUDFLARE_ACCOUNT: "expected-cloudflare-account",
    EXPECTED_SUPABASE_PROJECT_REF: "expected-supabase-project",
    EXPECTED_STRIPE_ACCOUNT: "expected-stripe-account",
  },
  expectStatus: 1,
  mustIncludeStderr: [
    "Cloudflare Wrangler auth: Cloudflare account does not include expected account expected-cloudflare-account",
    "Supabase CLI auth: Supabase projects list does not include expected project expected-supabase-project",
    "Stripe CLI auth: Stripe account does not include expected account expected-stripe-account",
    "Set EXPECTED_CLOUDFLARE_ACCOUNT and confirm it appears",
    "Set SUPABASE_PROJECT_REF or EXPECTED_SUPABASE_PROJECT_REF and confirm it appears",
    "Set EXPECTED_STRIPE_ACCOUNT and confirm it appears",
  ],
});

await runContract("prints non-secret JSON evidence for release notes", {
  args: ["--json"],
  tools: passingTools(),
  extraEnv: expectedTargetEnv(),
  expectStatus: 0,
  mustIncludeStdout: [
    '"overallStatus": "pass"',
    '"label": "Docker daemon"',
    '"label": "Google Cloud CLI auth"',
    '"label": "Stripe CLI auth"',
  ],
});

await runContract("prints JSON remediation when operator prerequisites fail", {
  args: ["--json"],
  tools: {
    gh: tool("echo 'github.com'"),
  },
  extraEnv: expectedTargetEnv(),
  expectStatus: 1,
  mustIncludeStdout: [
    '"overallStatus": "fail"',
    '"label": "Docker CLI"',
    '"detail": "docker not found"',
    '"Google Cloud CLI"',
    "Install the Google Cloud CLI.",
    '"Stripe CLI"',
    "Install the Stripe CLI.",
  ],
});

if (issues.length) {
  console.error("Deploy preflight contract check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Deploy preflight contract check passed.");

async function runContract(name, contract) {
  const tempDir = mkdtempSync(join(tmpdir(), "adops-preflight-contract-"));
  try {
    for (const [command, body] of Object.entries(contract.tools)) {
      const path = join(tempDir, command);
      writeFileSync(path, `#!/bin/sh\n${body}\n`, "utf8");
      chmodSync(path, 0o755);
    }

    const result = spawnSync(process.execPath, ["scripts/deploy-preflight.mjs", ...(contract.args ?? [])], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        PATH: tempDir,
        ...(contract.extraEnv ?? {}),
      },
    });

    if (result.status !== contract.expectStatus) {
      issues.push(`${name}: expected exit ${contract.expectStatus}, got ${result.status}. stdout=${result.stdout} stderr=${result.stderr}`);
    }
    for (const snippet of contract.mustIncludeStdout ?? []) {
      if (!result.stdout.includes(snippet)) {
        issues.push(`${name}: stdout missing "${snippet}"`);
      }
    }
    for (const snippet of contract.mustIncludeStderr ?? []) {
      if (!result.stderr.includes(snippet)) {
        issues.push(`${name}: stderr missing "${snippet}"`);
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function passingTools() {
  return {
    docker: tool(`
if [ "$1" = "--version" ]; then echo "Docker version 29.5.2"; exit 0; fi
if [ "$1" = "info" ]; then echo '"29.5.2"'; exit 0; fi
exit 1
`),
    gcloud: tool(`
if [ "$1" = "--version" ]; then echo "Google Cloud SDK 999.0.0"; exit 0; fi
if [ "$1" = "auth" ]; then echo '[{"status":"ACTIVE"}]'; exit 0; fi
if [ "$1" = "config" ]; then echo "adops-production"; exit 0; fi
exit 1
`),
    wrangler: tool(`
if [ "$1" = "--version" ]; then echo "wrangler 4.0.0"; exit 0; fi
if [ "$1" = "whoami" ]; then echo "cloudflare-user"; exit 0; fi
exit 1
`),
    supabase: tool(`
if [ "$1" = "--version" ]; then echo "supabase 2.0.0"; exit 0; fi
if [ "$1" = "projects" ]; then echo "linked-project"; exit 0; fi
exit 1
`),
    stripe: tool(`
if [ "$1" = "--version" ]; then echo "stripe version 1.0.0"; exit 0; fi
if [ "$1" = "whoami" ]; then echo "stripe-user"; exit 0; fi
exit 1
`),
    gh: tool(`
if [ "$1" = "auth" ]; then echo "github.com"; exit 0; fi
exit 1
`),
  };
}

function tool(script) {
  return script.trim();
}

function expectedTargetEnv() {
  return {
    GCP_PROJECT: "adops-production",
    EXPECTED_CLOUDFLARE_ACCOUNT: "cloudflare-user",
    SUPABASE_PROJECT_REF: "linked-project",
    EXPECTED_STRIPE_ACCOUNT: "stripe-user",
  };
}
