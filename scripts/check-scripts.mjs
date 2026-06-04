#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const scriptDir = "scripts";
const scripts = readdirSync(scriptDir)
  .filter((name) => name.endsWith(".mjs"))
  .map((name) => join(scriptDir, name))
  .sort();
const helpScripts = [
  "scripts/completion-audit.mjs",
  "scripts/completion-evidence-note.mjs",
  "scripts/collect-release-evidence.mjs",
  "scripts/deploy-command-plan.mjs",
  "scripts/deploy-next-actions.mjs",
  "scripts/deploy-preflight.mjs",
  "scripts/operator-prereq-note.mjs",
  "scripts/production-candidate-audit.mjs",
  "scripts/smoke-deploy.mjs",
  "scripts/staging-e2e.mjs",
  "scripts/supabase-e2e.mjs",
  "scripts/stripe-webhook-e2e.mjs",
];

const issues = [];
const forbiddenHelpSnippets = [
  "AUTH_TOKEN=",
  "UNPAID_AUTH_TOKEN=",
  "SUPABASE_SERVICE_ROLE_KEY=",
  "STRIPE_WEBHOOK_SECRET=",
];

for (const script of scripts) {
  const result = spawnSync(process.execPath, ["--check", script], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    issues.push(`${script}: ${result.stderr.trim() || result.stdout.trim() || "node --check failed"}`);
  }
}

for (const script of helpScripts) {
  const result = spawnSync(process.execPath, [script, "--help"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    issues.push(`${script}: --help exited with ${result.status}`);
    continue;
  }
  if (!result.stdout.includes("Usage:")) {
    issues.push(`${script}: --help output must include Usage:`);
  }
  for (const snippet of forbiddenHelpSnippets) {
    if (result.stdout.includes(snippet)) {
      issues.push(`${script}: --help output must not include secret assignment form ${snippet}`);
    }
  }
  if (script === "scripts/staging-e2e.mjs" && !result.stdout.includes("approval metadata")) {
    issues.push(`${script}: --help output must say Google write evidence checks approval metadata`);
  }
}

if (issues.length) {
  console.error("Script check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`Script check passed (${scripts.length} files, ${helpScripts.length} help contracts).`);
