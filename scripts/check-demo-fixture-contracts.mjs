#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildDemoFixture,
  collectFixtureContractIssues,
  collectFixtureSafetyIssues,
  serializeDemoFixture,
} from "./reset-demo-fixture.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_ROOT = join(REPOSITORY_ROOT, "fixtures/demo");
const OUTPUT_PATH = join(REPOSITORY_ROOT, "harness/evidence/demo/current.json");
const RESET_SCRIPT = join(REPOSITORY_ROOT, "scripts/reset-demo-fixture.mjs");

const first = buildDemoFixture();
const second = buildDemoFixture();
assert.deepEqual(collectFixtureContractIssues(first), []);
assert.deepEqual(collectFixtureSafetyIssues(first), []);
assert.equal(serializeDemoFixture(first), serializeDemoFixture(second), "two builds must be byte-identical");
assert.equal(readFileSync(OUTPUT_PATH, "utf8"), serializeDemoFixture(first), "current.json must match the fixed seed");

const jsonFiles = listJsonFiles(FIXTURE_ROOT);
assert.equal(jsonFiles.length, 8, "manifest plus seven state files must be the complete JSON fixture source");
for (const path of jsonFiles) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(
    collectFixtureSafetyIssues(parsed, relative(REPOSITORY_ROOT, path)),
    [],
    `${relative(REPOSITORY_ROOT, path)} must contain synthetic safe data only`,
  );
}

assertSafetyRejection(
  { accessCredential: "demo-value" },
  "credential-like key",
  "credential-like keys are forbidden",
);
assertSafetyRejection(
  { note: "Bearer abcdefghijklmnopqrstuvwxyz" },
  "credential-like value",
  "credential-like values are forbidden",
);
assertSafetyRejection(
  { companyName: "Real Customer株式会社" },
  "unmarked organization name",
  "identity labels must contain DEMO, 架空, or synthetic",
);
assertSafetyRejection(
  { customerId: "1234567890" },
  "numeric provider customer id",
  "10-digit provider customer IDs are forbidden",
);

const packageJson = JSON.parse(readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8"));
assert.equal(packageJson.scripts?.["demo:reset"], "node scripts/reset-demo-fixture.mjs");
assert.equal(packageJson.scripts?.["check:demo-fixture"], "node scripts/check-demo-fixture-contracts.mjs");
assert.match(packageJson.scripts?.verify || "", /npm run check:demo-fixture/);

const runbook = readFileSync(join(REPOSITORY_ROOT, "docs/demo-account.md"), "utf8");
for (const required of [
  "専用workspace",
  "専用campaign",
  "明示承認",
  "Reset",
  "Cleanup",
  "provider/DB適用は未実行",
  "campaign作成は対象外",
]) {
  assert.ok(runbook.includes(required), `docs/demo-account.md must include ${required}`);
}

const check = spawnSync(process.execPath, [RESET_SCRIPT, "--check"], {
  cwd: REPOSITORY_ROOT,
  encoding: "utf8",
});
assert.equal(check.status, 0, check.stderr || check.stdout);
assert.match(check.stdout, /determinism check passed/);
assert.match(check.stdout, /Provider\/DB application not run/);

const externalApply = spawnSync(process.execPath, [RESET_SCRIPT, "--apply"], {
  cwd: REPOSITORY_ROOT,
  encoding: "utf8",
});
assert.equal(externalApply.status, 1, "the local fixture harness must reject external apply flags");
assert.match(externalApply.stderr, /Provider\/DB application is not supported/);

console.log("Demo fixture contract checks passed (7 deterministic states, static safety rejection, local-only reset). ");

function listJsonFiles(directory) {
  const results = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...listJsonFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".json")) results.push(path);
  }
  return results.sort();
}

function assertSafetyRejection(value, label, expectedMessage) {
  const issues = collectFixtureSafetyIssues(value, label);
  assert.ok(issues.some((issue) => issue.includes(expectedMessage)), `${label} should be rejected: ${issues.join(", ")}`);
}
