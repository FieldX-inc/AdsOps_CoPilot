#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const preflight = loadPreflight();
const failures = preflight.failures ?? [];

console.log("# Operator Prerequisite Note");
console.log("");
console.log("This note is generated from `npm run deploy:preflight -- --json`. It is non-secret and only describes local operator tooling, auth, and verification commands.");
console.log("");
console.log(`- Overall status: ${preflight.overallStatus ?? "unknown"}`);
console.log(`- Captured at: ${new Date().toISOString()}`);
console.log("");

if (!failures.length) {
  console.log("All required operator prerequisites are passing.");
  console.log("");
  console.log("Next commands:");
  printList([
    "npm run deploy:next",
    "npm run deploy:commands -- --target=staging",
    "npm run audit:completion-note -- --with-verify",
  ]);
  process.exit(0);
}

console.log("## Required Fixes");
console.log("");
for (const failure of failures) {
  console.log(`### ${failure.label}`);
  console.log("");
  console.log(`- Current result: ${failure.detail || "required check failed"}`);
  const remediation = preflight.remediation?.[failure.label] ?? [];
  if (remediation.length) {
    console.log("- Remediation:");
    printList(remediation);
  }
  console.log(`- Verification command: ${verificationCommand(failure.label)}`);
  console.log("");
}

console.log("## Re-run After Fixes");
console.log("");
printList([
  "npm run deploy:preflight",
  "npm run deploy:preflight -- --json",
  "npm run deploy:next",
  "npm run audit:completion -- --with-verify --json",
]);

process.exit(1);

function loadPreflight() {
  if (process.env.DEPLOY_PREFLIGHT_JSON) return JSON.parse(process.env.DEPLOY_PREFLIGHT_JSON);
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

function verificationCommand(label) {
  switch (label) {
    case "Docker CLI":
      return "docker --version";
    case "Docker daemon":
      return "docker info";
    case "Google Cloud CLI":
      return "gcloud --version";
    case "Google Cloud CLI auth":
      return "gcloud auth list --format=json";
    case "Google Cloud project":
      return "gcloud config get-value project";
    case "Cloudflare Wrangler CLI":
      return "wrangler --version";
    case "Cloudflare Wrangler auth":
      return "wrangler whoami";
    case "Supabase CLI":
      return "supabase --version";
    case "Supabase CLI auth":
      return "supabase projects list";
    case "Stripe CLI":
      return "stripe --version";
    case "Stripe CLI auth":
      return "stripe whoami";
    default:
      return "npm run deploy:preflight";
  }
}

function printList(items) {
  for (const item of items) console.log(`  - ${item}`);
}

function printHelp() {
  console.log(`Usage:
  npm run deploy:prereq-note

Prints a non-secret Markdown note from npm run deploy:preflight -- --json, including required fixes, verification commands, and the next deploy commands.
For contract tests only, DEPLOY_PREFLIGHT_JSON may provide a mocked preflight JSON payload.`);
}
