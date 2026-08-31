#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = "scripts/implementation-harness.mjs";

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

const validate = run("validate", "--json");
assert.equal(validate.status, 0, validate.stderr || validate.stdout);
const validation = JSON.parse(validate.stdout);
assert.equal(validation.valid, true);
assert.equal(validation.issueCount, 18);
assert.equal(validation.agentCount, 6);
assert.ok(validation.scenarioCount >= 10);

const list = run("list", "--json");
assert.equal(list.status, 0, list.stderr || list.stdout);
const issues = JSON.parse(list.stdout);
assert.equal(issues.length, 18);
assert.deepEqual(issues.map((issue) => issue.number), [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);

const blocked = run("list", "--state=blocked", "--json");
assert.equal(blocked.status, 0, blocked.stderr || blocked.stdout);
assert.deepEqual(JSON.parse(blocked.stdout).map((issue) => issue.number), [5]);

const plan = run("plan", "1", "--json");
assert.equal(plan.status, 0, plan.stderr || plan.stdout);
const writePlan = JSON.parse(plan.stdout);
assert.equal(writePlan.target.number, 1);
assert.equal(writePlan.steps.at(-1).number, 1);
assert.ok(writePlan.steps.some((step) => step.number === 3));
assert.ok(writePlan.steps.some((step) => step.number === 6));
assert.ok(writePlan.steps.at(-1).requiredArtifacts.includes("rollback-proof"));
assert.equal(writePlan.runnableNow, false);

const leafPlan = run("plan", "12", "--json");
assert.equal(leafPlan.status, 0, leafPlan.stderr || leafPlan.stdout);
assert.equal(JSON.parse(leafPlan.stdout).target.state, "browser_verified");
assert.equal(JSON.parse(leafPlan.stdout).runnableNow, false);

const missing = run("plan", "999", "--json");
assert.equal(missing.status, 2);
assert.match(JSON.parse(missing.stdout).error, /Unknown issue/);

const help = run("--help");
assert.equal(help.status, 0, help.stderr || help.stdout);
assert.match(help.stdout, /Usage:/);
assert.doesNotMatch(help.stdout, /AUTH_TOKEN=/);

console.log("Implementation harness contract checks passed (18 issues, 6 agent roles). ");
