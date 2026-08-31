#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const HARNESS_ROOT = join(REPOSITORY_ROOT, "harness");

function readJson(path, errors) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${relative(REPOSITORY_ROOT, path)}: ${error.message}`);
    return null;
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}

function pathPatternIsSafe(value) {
  return nonEmptyString(value) && !value.startsWith("/") && !value.split("/").includes("..");
}

function loadHarness() {
  const errors = [];
  const program = readJson(join(HARNESS_ROOT, "program.json"), errors);
  const e2ePlan = readJson(join(HARNESS_ROOT, "e2e-plan.json"), errors);
  const evidenceSchema = readJson(join(HARNESS_ROOT, "schemas/evidence.schema.json"), errors);
  const issueSchema = readJson(join(HARNESS_ROOT, "schemas/issue.schema.json"), errors);
  const agentRoleSchema = readJson(join(HARNESS_ROOT, "schemas/agent-role.schema.json"), errors);

  const issueDirectory = join(HARNESS_ROOT, "issues");
  const issueFiles = readdirSync(issueDirectory)
    .filter((name) => /^\d{3}\.json$/.test(name))
    .sort();
  const issues = issueFiles
    .map((name) => ({ file: name, manifest: readJson(join(issueDirectory, name), errors) }))
    .filter(({ manifest }) => manifest);

  const agentDirectory = join(HARNESS_ROOT, "agents");
  const agentFiles = readdirSync(agentDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const agents = agentFiles
    .map((name) => ({ file: name, contract: readJson(join(agentDirectory, name), errors) }))
    .filter(({ contract }) => contract);

  return { program, e2ePlan, evidenceSchema, issueSchema, agentRoleSchema, issues, agents, errors };
}

function validateHarness(harness) {
  const { program, e2ePlan, evidenceSchema, issueSchema, agentRoleSchema, issues, agents } = harness;
  const errors = [...harness.errors];
  const warnings = [];

  if (!program || !e2ePlan || !evidenceSchema || !issueSchema || !agentRoleSchema) {
    return { valid: false, errors, warnings, issueCount: issues.length, agentCount: agents.length, scenarioCount: 0 };
  }

  if (program.schemaVersion !== 1) errors.push("harness/program.json: schemaVersion must be 1");
  if (!nonEmptyString(program.programId)) errors.push("harness/program.json: programId is required");
  if (!Array.isArray(program.issueNumbers) || !program.issueNumbers.every(Number.isInteger)) {
    errors.push("harness/program.json: issueNumbers must be an integer array");
  }
  if (!nonEmptyStringArray(program.states)) errors.push("harness/program.json: states must be a non-empty string array");
  if (!nonEmptyStringArray(program.riskLevels)) errors.push("harness/program.json: riskLevels must be a non-empty string array");
  if (!nonEmptyStringArray(program.gateStatuses)) errors.push("harness/program.json: gateStatuses must be a non-empty string array");
  if (!nonEmptyStringArray(program.gateTypes)) errors.push("harness/program.json: gateTypes must be a non-empty string array");
  if (!Array.isArray(program.waves) || program.waves.length === 0) errors.push("harness/program.json: waves are required");

  const expectedNumbers = [...(program.issueNumbers || [])].sort((a, b) => a - b);
  const actualNumbers = issues.map(({ manifest }) => manifest.issue?.number).filter(Number.isInteger).sort((a, b) => a - b);
  if (JSON.stringify(actualNumbers) !== JSON.stringify(expectedNumbers)) {
    errors.push(`harness/issues: expected issue inventory [${expectedNumbers.join(", ")}], found [${actualNumbers.join(", ")}]`);
  }
  if (new Set(actualNumbers).size !== actualNumbers.length) errors.push("harness/issues: issue numbers must be unique");

  const agentIds = new Set(agents.map(({ contract }) => contract.roleId));
  const requiredAgents = [program.executionPolicy?.orchestrator, ...(program.executionPolicy?.subagents || [])];
  for (const roleId of requiredAgents) {
    if (!agentIds.has(roleId)) errors.push(`harness/program.json: missing agent contract ${roleId}`);
  }
  if (program.executionPolicy?.maxConcurrentImplementationLanes !== 3) {
    errors.push("harness/program.json: maxConcurrentImplementationLanes must be 3");
  }
  if (program.executionPolicy?.agentToolsMayMutateAdPlatforms !== false) {
    errors.push("harness/program.json: agentToolsMayMutateAdPlatforms must be false");
  }

  for (const { file, contract } of agents) {
    const prefix = `harness/agents/${file}`;
    if (contract.schemaVersion !== 1) errors.push(`${prefix}: schemaVersion must be 1`);
    if (!nonEmptyString(contract.roleId)) errors.push(`${prefix}: roleId is required`);
    if (`${contract.roleId}.json` !== file) errors.push(`${prefix}: filename must match roleId`);
    if (!["orchestrator", "subagent"].includes(contract.kind)) errors.push(`${prefix}: invalid kind ${contract.kind}`);
    if (!nonEmptyString(contract.mission)) errors.push(`${prefix}: mission is required`);
    if (contract.kind === "subagent" && !agentIds.has(contract.reportsTo)) errors.push(`${prefix}: reportsTo must reference an agent`);
    for (const field of ["owns", "mustNot", "inputs", "deliverables", "requiredChecks", "handoff"]) {
      if (!nonEmptyStringArray(contract[field])) errors.push(`${prefix}: ${field} must be a non-empty string array`);
    }
  }

  const waveById = new Map((program.waves || []).map((wave, index) => [wave.id, { ...wave, index }]));
  const waveOccurrences = new Map();
  for (const wave of program.waves || []) {
    if (!nonEmptyString(wave.id) || !nonEmptyString(wave.name)) errors.push("harness/program.json: every wave needs id and name");
    if (!Array.isArray(wave.issues)) errors.push(`harness/program.json: ${wave.id || "wave"}.issues must be an array`);
    for (const issueNumber of wave.issues || []) {
      waveOccurrences.set(issueNumber, (waveOccurrences.get(issueNumber) || 0) + 1);
    }
    if (!nonEmptyStringArray(wave.exitCriteria)) errors.push(`harness/program.json: ${wave.id}.exitCriteria must be non-empty`);
  }
  for (const issueNumber of expectedNumbers) {
    if (waveOccurrences.get(issueNumber) !== 1) errors.push(`harness/program.json: issue #${issueNumber} must appear in exactly one wave`);
  }

  const layerIds = new Set((e2ePlan.layers || []).map((layer) => layer.id));
  const scenarioById = new Map();
  if (!Array.isArray(e2ePlan.layers) || e2ePlan.layers.length === 0) errors.push("harness/e2e-plan.json: layers are required");
  if (!Array.isArray(e2ePlan.scenarios) || e2ePlan.scenarios.length === 0) errors.push("harness/e2e-plan.json: scenarios are required");
  for (const scenario of e2ePlan.scenarios || []) {
    if (!nonEmptyString(scenario.id)) errors.push("harness/e2e-plan.json: every scenario needs an id");
    if (scenarioById.has(scenario.id)) errors.push(`harness/e2e-plan.json: duplicate scenario ${scenario.id}`);
    scenarioById.set(scenario.id, scenario);
    if (!layerIds.has(scenario.layer)) errors.push(`harness/e2e-plan.json: scenario ${scenario.id} has unknown layer ${scenario.layer}`);
    if (!Array.isArray(scenario.issues) || !scenario.issues.every((number) => expectedNumbers.includes(number))) {
      errors.push(`harness/e2e-plan.json: scenario ${scenario.id} has an invalid issue reference`);
    }
    if (!nonEmptyStringArray(scenario.assertions)) errors.push(`harness/e2e-plan.json: scenario ${scenario.id} needs assertions`);
  }

  const artifactKinds = new Set(evidenceSchema.$defs?.artifact?.properties?.kind?.enum || []);
  if (artifactKinds.size === 0) errors.push("harness/schemas/evidence.schema.json: artifact kind enum is required");
  if (evidenceSchema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    errors.push("harness/schemas/evidence.schema.json: expected JSON Schema draft 2020-12");
  }

  const issueByNumber = new Map(issues.map(({ manifest }) => [manifest.issue?.number, manifest]));
  const seenSlugs = new Set();
  for (const { file, manifest } of issues) {
    const prefix = `harness/issues/${file}`;
    const number = manifest.issue?.number;
    if (manifest.schemaVersion !== 1) errors.push(`${prefix}: schemaVersion must be 1`);
    if (!Number.isInteger(manifest.manifestVersion) || manifest.manifestVersion < 1) errors.push(`${prefix}: manifestVersion must be a positive integer`);
    if (!Number.isInteger(number)) errors.push(`${prefix}: issue.number is required`);
    if (`${String(number).padStart(3, "0")}.json` !== file) errors.push(`${prefix}: filename must match issue number`);
    if (!nonEmptyString(manifest.issue?.title)) errors.push(`${prefix}: issue.title is required`);
    if (!nonEmptyString(manifest.issue?.slug) || !/^[a-z0-9-]+$/.test(manifest.issue?.slug || "")) errors.push(`${prefix}: issue.slug must be kebab-case`);
    if (seenSlugs.has(manifest.issue?.slug)) errors.push(`${prefix}: duplicate issue slug ${manifest.issue?.slug}`);
    seenSlugs.add(manifest.issue?.slug);
    if (manifest.issue?.url !== `https://github.com/FieldX-inc/AdsOps_CoPilot/issues/${number}`) errors.push(`${prefix}: issue.url does not match issue number`);
    if (!program.states.includes(manifest.state)) errors.push(`${prefix}: unknown state ${manifest.state}`);
    if (!waveById.has(manifest.wave)) errors.push(`${prefix}: unknown wave ${manifest.wave}`);
    if (waveById.has(manifest.wave) && !waveById.get(manifest.wave).issues.includes(number)) errors.push(`${prefix}: wave does not list issue #${number}`);
    if (!nonEmptyString(manifest.summary)) errors.push(`${prefix}: summary is required`);
    if (!nonEmptyStringArray(manifest.decisions)) errors.push(`${prefix}: decisions must be non-empty`);
    if (!nonEmptyStringArray(manifest.scope?.in) || !Array.isArray(manifest.scope?.out)) errors.push(`${prefix}: scope.in and scope.out are required`);
    if (!nonEmptyStringArray(manifest.requirementRefs)) errors.push(`${prefix}: requirementRefs must be non-empty`);
    if (!Array.isArray(manifest.dependencies) || !manifest.dependencies.every(Number.isInteger)) errors.push(`${prefix}: dependencies must be an integer array`);
    if (manifest.dependencies?.includes(number)) errors.push(`${prefix}: issue cannot depend on itself`);
    for (const dependency of manifest.dependencies || []) {
      if (!expectedNumbers.includes(dependency)) errors.push(`${prefix}: unknown dependency #${dependency}`);
      const dependencyManifest = issueByNumber.get(dependency);
      if (dependencyManifest && waveById.get(dependencyManifest.wave)?.index > waveById.get(manifest.wave)?.index) {
        errors.push(`${prefix}: dependency #${dependency} is in a later wave`);
      }
    }
    if (!Array.isArray(manifest.blockers)) errors.push(`${prefix}: blockers must be an array`);
    if (manifest.state === "blocked" && !nonEmptyStringArray(manifest.blockers)) errors.push(`${prefix}: blocked issues need blockers`);
    if (manifest.state !== "blocked" && manifest.blockers?.length > 0) errors.push(`${prefix}: only blocked issues may have blockers`);
    if (!Array.isArray(manifest.risks) || manifest.risks.length === 0) errors.push(`${prefix}: risks must be non-empty`);
    for (const risk of manifest.risks || []) {
      if (!nonEmptyString(risk.id) || !program.riskLevels.includes(risk.level) || !nonEmptyString(risk.description) || !nonEmptyString(risk.mitigation)) {
        errors.push(`${prefix}: every risk needs id, valid level, description, and mitigation`);
      }
    }
    if (!Array.isArray(manifest.gates)) errors.push(`${prefix}: gates must be an array`);
    for (const gate of manifest.gates || []) {
      if (!nonEmptyString(gate.id) || !program.gateTypes.includes(gate.type) || !nonEmptyString(gate.requiredAt) || !program.gateStatuses.includes(gate.status) || !nonEmptyString(gate.owner) || !nonEmptyString(gate.description)) {
        errors.push(`${prefix}: every gate needs id, valid type/status, requiredAt, owner, and description`);
      }
    }
    if (!agentIds.has(manifest.ownership?.primaryAgent)) errors.push(`${prefix}: primaryAgent must reference an agent contract`);
    if (!Array.isArray(manifest.ownership?.reviewAgents) || !manifest.ownership.reviewAgents.every((id) => agentIds.has(id))) errors.push(`${prefix}: reviewAgents must reference agent contracts`);
    for (const field of ["allowedPaths", "forbiddenPaths"]) {
      if (!nonEmptyStringArray(manifest.ownership?.[field])) errors.push(`${prefix}: ownership.${field} must be non-empty`);
      for (const pattern of manifest.ownership?.[field] || []) {
        if (!pathPatternIsSafe(pattern)) errors.push(`${prefix}: unsafe ${field} entry ${pattern}`);
      }
    }
    if (!nonEmptyStringArray(manifest.acceptanceCriteria)) errors.push(`${prefix}: acceptanceCriteria must be non-empty`);
    if (!nonEmptyStringArray(manifest.verification?.commands)) errors.push(`${prefix}: verification.commands must be non-empty`);
    if (!Array.isArray(manifest.verification?.scenarioIds)) errors.push(`${prefix}: verification.scenarioIds must be an array`);
    for (const scenarioId of manifest.verification?.scenarioIds || []) {
      const scenario = scenarioById.get(scenarioId);
      if (!scenario) errors.push(`${prefix}: unknown scenario ${scenarioId}`);
      else if (!scenario.issues.includes(number)) errors.push(`${prefix}: scenario ${scenarioId} does not list issue #${number}`);
    }
    if (!nonEmptyStringArray(manifest.evidence?.requiredArtifacts)) errors.push(`${prefix}: evidence.requiredArtifacts must be non-empty`);
    for (const artifact of manifest.evidence?.requiredArtifacts || []) {
      if (!artifactKinds.has(artifact)) errors.push(`${prefix}: unknown evidence artifact ${artifact}`);
    }
    if (!nonEmptyString(manifest.evidence?.retention)) errors.push(`${prefix}: evidence.retention is required`);
    if (!nonEmptyString(manifest.rollback?.strategy) || !nonEmptyString(manifest.rollback?.verification)) errors.push(`${prefix}: rollback strategy and verification are required`);
  }

  const visitState = new Map();
  const stack = [];
  function visit(number) {
    const state = visitState.get(number);
    if (state === "done") return;
    if (state === "visiting") {
      const cycleStart = stack.indexOf(number);
      errors.push(`harness/issues: dependency cycle ${[...stack.slice(cycleStart), number].map((item) => `#${item}`).join(" -> ")}`);
      return;
    }
    visitState.set(number, "visiting");
    stack.push(number);
    for (const dependency of issueByNumber.get(number)?.dependencies || []) visit(dependency);
    stack.pop();
    visitState.set(number, "done");
  }
  for (const number of expectedNumbers) visit(number);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    issueCount: issues.length,
    agentCount: agents.length,
    scenarioCount: e2ePlan.scenarios?.length || 0,
  };
}

function parseArguments(argv) {
  const options = { json: false, filters: {}, positionals: [] };
  for (const argument of argv) {
    if (argument === "--json") options.json = true;
    else if (argument.startsWith("--state=")) options.filters.state = argument.slice("--state=".length);
    else if (argument.startsWith("--wave=")) options.filters.wave = argument.slice("--wave=".length);
    else if (argument.startsWith("--agent=")) options.filters.agent = argument.slice("--agent=".length);
    else options.positionals.push(argument);
  }
  return options;
}

function help() {
  console.log(`Usage:
  node scripts/implementation-harness.mjs validate [--json]
  node scripts/implementation-harness.mjs list [--state=<state>] [--wave=<wave>] [--agent=<role>] [--json]
  node scripts/implementation-harness.mjs plan <issue-number> [--json]

Commands are read-only. They never update issue state, contact providers, or run implementation checks.`);
}

function printValidation(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.valid) {
    console.log(`Implementation harness valid: ${result.issueCount} issues, ${result.agentCount} agent roles, ${result.scenarioCount} E2E scenarios.`);
    return;
  }
  console.error("Implementation harness validation failed:");
  for (const error of result.errors) console.error(`- ${error}`);
}

function listIssues(harness, filters, asJson) {
  const validation = validateHarness(harness);
  if (!validation.valid) {
    printValidation(validation, asJson);
    process.exitCode = 1;
    return;
  }
  let rows = harness.issues.map(({ manifest }) => manifest);
  if (filters.state) rows = rows.filter((manifest) => manifest.state === filters.state);
  if (filters.wave) rows = rows.filter((manifest) => manifest.wave === filters.wave);
  if (filters.agent) rows = rows.filter((manifest) => manifest.ownership.primaryAgent === filters.agent || manifest.ownership.reviewAgents.includes(filters.agent));
  rows.sort((a, b) => a.issue.number - b.issue.number);
  if (asJson) {
    console.log(JSON.stringify(rows.map((manifest) => ({
      number: manifest.issue.number,
      title: manifest.issue.title,
      state: manifest.state,
      wave: manifest.wave,
      primaryAgent: manifest.ownership.primaryAgent,
      dependencies: manifest.dependencies,
      blockerCount: manifest.blockers.length,
      pendingGateCount: manifest.gates.filter((gate) => gate.status === "pending").length,
    })), null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log("No issues match the selected filters.");
    return;
  }
  const header = ["ISSUE", "STATE", "WAVE", "PRIMARY AGENT", "TITLE"];
  const values = rows.map((manifest) => [
    `#${manifest.issue.number}`,
    manifest.state,
    manifest.wave,
    manifest.ownership.primaryAgent,
    manifest.issue.title,
  ]);
  const widths = header.map((value, index) => Math.max(value.length, ...values.map((row) => row[index].length)));
  console.log(header.map((value, index) => value.padEnd(widths[index])).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of values) console.log(row.map((value, index) => value.padEnd(widths[index])).join("  "));
}

function issuePlan(harness, issueNumber, asJson) {
  const validation = validateHarness(harness);
  if (!validation.valid) {
    printValidation(validation, asJson);
    process.exitCode = 1;
    return;
  }
  const issueByNumber = new Map(harness.issues.map(({ manifest }) => [manifest.issue.number, manifest]));
  const target = issueByNumber.get(issueNumber);
  if (!target) {
    const message = `Unknown issue #${issueNumber}. Run the list command to see registered issues.`;
    if (asJson) console.log(JSON.stringify({ error: message }, null, 2));
    else console.error(message);
    process.exitCode = 2;
    return;
  }
  const ordered = [];
  const visited = new Set();
  function add(number) {
    if (visited.has(number)) return;
    const manifest = issueByNumber.get(number);
    for (const dependency of manifest.dependencies) add(dependency);
    visited.add(number);
    ordered.push(manifest);
  }
  add(issueNumber);
  const steps = ordered.map((manifest, index) => {
    const pendingDependencies = manifest.dependencies.filter((number) => issueByNumber.get(number).state !== "done");
    return {
      order: index + 1,
      number: manifest.issue.number,
      title: manifest.issue.title,
      state: manifest.state,
      wave: manifest.wave,
      primaryAgent: manifest.ownership.primaryAgent,
      pendingDependencies,
      blockers: manifest.blockers,
      pendingGates: manifest.gates.filter((gate) => gate.status === "pending"),
      allowedPaths: manifest.ownership.allowedPaths,
      commands: manifest.verification.commands,
      scenarioIds: manifest.verification.scenarioIds,
      requiredArtifacts: manifest.evidence.requiredArtifacts,
    };
  });
  const payload = {
    target: { number: target.issue.number, title: target.issue.title, state: target.state },
    runnableNow: target.state === "ready" && target.blockers.length === 0 && target.dependencies.every((number) => issueByNumber.get(number).state === "done") && target.gates.filter((gate) => gate.requiredAt === "before_implementation").every((gate) => ["satisfied", "waived", "not_applicable"].includes(gate.status)),
    steps,
    acceptanceCriteria: target.acceptanceCriteria,
    rollback: target.rollback,
  };
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(`Plan for #${payload.target.number}: ${payload.target.title}`);
  console.log(`Current state: ${payload.target.state}; runnable now: ${payload.runnableNow ? "yes" : "no"}`);
  console.log("Dependency order:");
  for (const step of steps) {
    console.log(`${step.order}. #${step.number} [${step.state}] ${step.title} (${step.primaryAgent})`);
    if (step.blockers.length) console.log(`   blockers: ${step.blockers.join(" | ")}`);
    if (step.pendingDependencies.length) console.log(`   pending dependencies: ${step.pendingDependencies.map((number) => `#${number}`).join(", ")}`);
    if (step.pendingGates.length) console.log(`   pending gates: ${step.pendingGates.map((gate) => `${gate.id}@${gate.requiredAt}`).join(", ")}`);
  }
  console.log("Allowed paths:");
  for (const path of target.ownership.allowedPaths) console.log(`- ${path}`);
  console.log("Verification:");
  for (const command of target.verification.commands) console.log(`- ${command}`);
  console.log("Required evidence:");
  for (const artifact of target.evidence.requiredArtifacts) console.log(`- ${artifact}`);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const [command, issueArgument] = options.positionals;
  if (!command || command === "--help" || command === "help") {
    help();
    return;
  }
  const harness = loadHarness();
  if (command === "validate") {
    const result = validateHarness(harness);
    printValidation(result, options.json);
    if (!result.valid) process.exitCode = 1;
    return;
  }
  if (command === "list") {
    listIssues(harness, options.filters, options.json);
    return;
  }
  if (command === "plan") {
    const issueNumber = Number(issueArgument);
    if (!Number.isInteger(issueNumber) || issueNumber < 1) {
      const message = "plan requires a positive integer issue number";
      if (options.json) console.log(JSON.stringify({ error: message }, null, 2));
      else console.error(message);
      process.exitCode = 2;
      return;
    }
    issuePlan(harness, issueNumber, options.json);
    return;
  }
  console.error(`Unknown command: ${command}`);
  help();
  process.exitCode = 2;
}

if (resolve(process.argv[1] || "") === resolve(SCRIPT_PATH)) main();

export { loadHarness, validateHarness };
