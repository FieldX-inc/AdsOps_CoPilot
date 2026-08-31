#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const FIXTURE_ROOT = join(REPOSITORY_ROOT, "fixtures/demo");
const MANIFEST_PATH = join(FIXTURE_ROOT, "manifest.json");
const OUTPUT_PATH = join(REPOSITORY_ROOT, "harness/evidence/demo/current.json");
const EXPECTED_STATE_IDS = [
  "onboarding",
  "active-dashboard",
  "partial-error",
  "setup",
  "conversation",
  "scheduled-report",
  "write-review",
];

const FORBIDDEN_KEY_PATTERN = /token|secret|credential|password|authorization|api.?key|private.?key/i;
const FORBIDDEN_VALUE_PATTERNS = [
  /\bbearer\s+[A-Za-z0-9._-]{12,}\b/i,
  /\b(?:sk|pk|rk)[_-](?:live|test|proj)[_-]?[A-Za-z0-9_-]{8,}\b/i,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  /\bgh[opurs]_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/i,
  /\bwhsec_[A-Za-z0-9_-]{8,}\b/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const NUMERIC_PROVIDER_ID_PATTERN = /(?<!\d)\d{10}(?!\d)/;
const ORGANIZATION_SUFFIX_PATTERN = /(?:株式会社|有限会社|合同会社|\b(?:Inc|Corp|LLC)\.?\b)/i;
const IDENTITY_KEY_PATTERN = /(?:customer|company|workspace|account|campaign|user).*(?:name|label)|displayName/i;
const SYNTHETIC_MARKER_PATTERN = /(?:DEMO|架空|synthetic)/i;

export function buildDemoFixture() {
  const manifest = readJson(MANIFEST_PATH);
  assertManifestContract(manifest);

  const states = {};
  for (const entry of manifest.scenarioFiles) {
    const sourcePath = resolveFixturePath(entry.path);
    const scenario = readJson(sourcePath);
    if (scenario.id !== entry.id) {
      throw new Error(`${entry.path}: scenario id must be ${entry.id}`);
    }
    if (scenario.workspaceId !== manifest.workspace.workspaceId) {
      throw new Error(`${entry.path}: workspaceId must match manifest workspaceId`);
    }
    states[entry.id] = scenario;
  }

  const fixture = {
    schemaVersion: 1,
    fixtureId: manifest.fixtureId,
    seedVersion: manifest.seedVersion,
    frozenAt: manifest.frozenAt,
    mode: "local-artifact-only",
    synthetic: true,
    safeguards: {
      networkAccess: false,
      databaseAccess: false,
      providerAccess: false,
      externalApplication: "not_performed",
    },
    workspace: manifest.workspace,
    stateOrder: manifest.scenarioFiles.map(({ id }) => id),
    states,
    expectedCounts: {
      states: manifest.scenarioFiles.length,
      campaigns: states["active-dashboard"].state.campaigns.length,
      conversationMessages: states.conversation.state.messages.length,
      scheduledReports: 1,
      pendingWriteReviews: 1,
    },
    sourceFiles: [
      "fixtures/demo/manifest.json",
      ...manifest.scenarioFiles.map(({ path }) => `fixtures/demo/${path}`),
    ],
  };

  const contractIssues = collectFixtureContractIssues(fixture);
  const safetyIssues = collectFixtureSafetyIssues(fixture, "composed fixture");
  const issues = [...contractIssues, ...safetyIssues];
  if (issues.length) {
    throw new Error(`Demo fixture validation failed:\n- ${issues.join("\n- ")}`);
  }
  return fixture;
}

export function serializeDemoFixture(fixture) {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

export function collectFixtureContractIssues(fixture) {
  const issues = [];
  if (fixture.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (fixture.synthetic !== true) issues.push("fixture must be explicitly synthetic");
  if (fixture.mode !== "local-artifact-only") issues.push("mode must be local-artifact-only");
  if (JSON.stringify(fixture.stateOrder) !== JSON.stringify(EXPECTED_STATE_IDS)) {
    issues.push(`stateOrder must be ${EXPECTED_STATE_IDS.join(", ")}`);
  }
  if (JSON.stringify(Object.keys(fixture.states || {})) !== JSON.stringify(EXPECTED_STATE_IDS)) {
    issues.push("states must contain exactly the seven required deterministic states in order");
  }
  if (fixture.expectedCounts?.states !== EXPECTED_STATE_IDS.length) {
    issues.push(`expectedCounts.states must be ${EXPECTED_STATE_IDS.length}`);
  }
  for (const access of ["networkAccess", "databaseAccess", "providerAccess"]) {
    if (fixture.safeguards?.[access] !== false) issues.push(`safeguards.${access} must be false`);
  }
  if (fixture.states?.setup?.state?.campaignDraft?.execution !== "not_requested") {
    issues.push("setup campaign draft must remain not_requested");
  }
  if (fixture.states?.["scheduled-report"]?.state?.delivery?.channel !== "local_artifact") {
    issues.push("scheduled report delivery must target a local artifact");
  }
  const writeState = fixture.states?.["write-review"]?.state;
  if (writeState?.approval?.confirmed !== false || writeState?.execution?.status !== "not_requested") {
    issues.push("write review must remain unconfirmed and not_requested");
  }
  if (writeState?.execution?.providerAccess !== false || writeState?.execution?.databaseAccess !== false) {
    issues.push("write review must disable provider and database access");
  }
  return issues;
}

export function collectFixtureSafetyIssues(value, label = "fixture") {
  const issues = [];

  function visit(current, path) {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (current && typeof current === "object") {
      for (const [key, item] of Object.entries(current)) {
        const itemPath = `${path}.${key}`;
        if (FORBIDDEN_KEY_PATTERN.test(key)) {
          issues.push(`${itemPath}: credential-like keys are forbidden`);
        }
        if (typeof item === "string" && IDENTITY_KEY_PATTERN.test(key) && !SYNTHETIC_MARKER_PATTERN.test(item)) {
          issues.push(`${itemPath}: identity labels must contain DEMO, 架空, or synthetic`);
        }
        visit(item, itemPath);
      }
      return;
    }
    if (typeof current !== "string") return;

    for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.test(current)) {
        issues.push(`${path}: credential-like values are forbidden`);
        break;
      }
    }
    for (const match of current.matchAll(EMAIL_PATTERN)) {
      if (!match[0].toLowerCase().endsWith(".invalid")) {
        issues.push(`${path}: personal or routable email addresses are forbidden`);
      }
    }
    EMAIL_PATTERN.lastIndex = 0;
    if (NUMERIC_PROVIDER_ID_PATTERN.test(current)) {
      issues.push(`${path}: 10-digit provider customer IDs are forbidden`);
    }
    if (ORGANIZATION_SUFFIX_PATTERN.test(current) && !SYNTHETIC_MARKER_PATTERN.test(current)) {
      issues.push(`${path}: organization names must be explicitly synthetic`);
    }
  }

  visit(value, label);
  return issues;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${relative(REPOSITORY_ROOT, path)}: ${error.message}`);
  }
}

function assertManifestContract(manifest) {
  if (manifest.schemaVersion !== 1) throw new Error("fixtures/demo/manifest.json: schemaVersion must be 1");
  if (manifest.synthetic !== true) throw new Error("fixtures/demo/manifest.json: synthetic must be true");
  if (manifest.mode !== "local-artifact-only") {
    throw new Error("fixtures/demo/manifest.json: mode must be local-artifact-only");
  }
  const ids = (manifest.scenarioFiles || []).map(({ id }) => id);
  if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_STATE_IDS)) {
    throw new Error(`fixtures/demo/manifest.json: scenario ids must be ${EXPECTED_STATE_IDS.join(", ")}`);
  }
  if (!manifest.workspace?.workspaceId?.startsWith("demo-") || !manifest.workspace?.userId?.startsWith("demo-")) {
    throw new Error("fixtures/demo/manifest.json: workspace and user ids must use the demo- prefix");
  }
}

function resolveFixturePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.endsWith(".json") || isAbsolute(relativePath)) {
    throw new Error(`Unsafe demo fixture path: ${String(relativePath)}`);
  }
  const resolved = resolve(FIXTURE_ROOT, relativePath);
  if (resolved !== FIXTURE_ROOT && !resolved.startsWith(`${FIXTURE_ROOT}${sep}`)) {
    throw new Error(`Demo fixture path escapes fixtures/demo: ${relativePath}`);
  }
  return resolved;
}

function printHelp() {
  console.log(`Usage:
  node scripts/reset-demo-fixture.mjs
  node scripts/reset-demo-fixture.mjs --check

The default command atomically rewrites harness/evidence/demo/current.json from
fixed synthetic JSON sources. --check proves two builds are byte-identical and
that the checked-in current artifact matches. Neither mode accesses a database,
network, or provider. External application is a separate, unexecuted process.`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const unexpected = args.filter((arg) => arg !== "--check");
  if (unexpected.length) {
    throw new Error(`Unknown argument(s): ${unexpected.join(", ")}. Provider/DB application is not supported.`);
  }

  const first = serializeDemoFixture(buildDemoFixture());
  if (args.includes("--check")) {
    const second = serializeDemoFixture(buildDemoFixture());
    if (first !== second) throw new Error("Demo fixture composition is not deterministic");
    if (!existsSync(OUTPUT_PATH)) throw new Error("Missing harness/evidence/demo/current.json; run npm run demo:reset");
    const current = readFileSync(OUTPUT_PATH, "utf8");
    if (current !== first) throw new Error("current.json differs from the fixed seed; run npm run demo:reset");
    console.log("Demo fixture determinism check passed (7 states, local artifact only). Provider/DB application not run.");
    return;
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const temporaryPath = `${OUTPUT_PATH}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, first, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, OUTPUT_PATH);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  console.log(`Reset deterministic local demo fixture: ${relative(REPOSITORY_ROOT, OUTPUT_PATH)}`);
  console.log("No database, network, or provider operation was performed.");
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    main();
  } catch (error) {
    console.error(`Demo fixture reset failed: ${error.message}`);
    process.exitCode = 1;
  }
}
