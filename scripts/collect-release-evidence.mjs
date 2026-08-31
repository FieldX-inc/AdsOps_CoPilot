#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const apiOrigin = cleanOrigin(process.env.API_ORIGIN || process.env.VITE_API_BASE_URL || "");
const agentServiceUrl = cleanOrigin(process.env.AGENT_SERVICE_URL || "");
const webOrigin = cleanOrigin(process.env.WEB_ORIGIN || process.env.VITE_WEB_ORIGIN || "");
const releaseSha = process.env.RELEASE_SHA || process.env.GITHUB_SHA || "";
const evidenceOwner = process.env.EVIDENCE_OWNER || "";
const expectProductionReady = process.env.EXPECT_PRODUCTION_READY === "true";
const expectGoogleAdsWriteActivation = process.env.EXPECT_GOOGLE_ADS_WRITE_ACTIVATION === "true";
const productionGate = expectGoogleAdsWriteActivation ? "google-ads-write-activation" : expectProductionReady ? "initial-production-go" : "none";
const requireProductionGate = productionGate !== "none";
const allowIncomplete = process.env.ALLOW_INCOMPLETE_EVIDENCE === "true";
const issues = [];
const evidenceCapturedAt = new Date().toISOString();

if (!apiOrigin) issues.push("Set API_ORIGIN or VITE_API_BASE_URL to the deployed API origin.");
if (!agentServiceUrl) issues.push("Set AGENT_SERVICE_URL to the deployed OpenAI Agent Service origin.");
if (expectProductionReady && expectGoogleAdsWriteActivation) {
  issues.push("Choose exactly one production gate: EXPECT_PRODUCTION_READY=true for initial Go or EXPECT_GOOGLE_ADS_WRITE_ACTIVATION=true for later write activation.");
}
if (requireProductionGate && !webOrigin) {
  issues.push("Set WEB_ORIGIN to the deployed Cloudflare Pages web origin before collecting production gate evidence.");
}
const legacyAgentAliases = [];
if (process.env.ADK_AGENT_URL) legacyAgentAliases.push("ADK_AGENT_URL");
if (process.env.USE_ADK_AGENT === "true") legacyAgentAliases.push("USE_ADK_AGENT");
if (process.env.ADK_AGENT_TIMEOUT_MS) legacyAgentAliases.push("ADK_AGENT_TIMEOUT_MS");
if (requireProductionGate && legacyAgentAliases.length) {
  issues.push(`Remove legacy ADK agent aliases before collecting production release evidence: ${legacyAgentAliases.join(", ")}.`);
}

const [apiHealth, readiness, agentHealth] = issues.length
  ? [null, null, null]
  : await Promise.all([
      getJson(`${apiOrigin}/health`, "API health"),
      getJson(`${apiOrigin}/readiness`, "API readiness"),
      getJson(`${agentServiceUrl}/health`, "Agent health"),
    ]);

const normalSmoke = apiOrigin && agentServiceUrl ? runSmokeDeploy("none") : null;
const productionSmoke = apiOrigin && agentServiceUrl && requireProductionGate ? runSmokeDeploy(productionGate) : null;

if (requireProductionGate) {
  validateProductionEvidence(apiHealth, readiness, agentHealth, productionGate);
}
if (normalSmoke && normalSmoke.status !== 0) issues.push("npm run smoke:deploy did not pass.");
if (requireProductionGate && productionSmoke && productionSmoke.status !== 0) {
  issues.push(`${productionGateCommand()} npm run smoke:deploy did not pass.`);
}
if (requireProductionGate && !productionSmoke) {
  issues.push(`${productionGateCommand()} was set, but the production gate smoke did not run.`);
}

printEvidence();

if (issues.length && !allowIncomplete) {
  console.error("Release evidence collection failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

if (issues.length) {
  console.error("Release evidence collection completed with incomplete evidence:");
  for (const issue of issues) console.error(`- ${issue}`);
}

function cleanOrigin(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

async function getJson(url, label) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });
    const body = await response.text();
    if (!response.ok) {
      issues.push(`${label}: HTTP ${response.status}`);
      return null;
    }
    try {
      return JSON.parse(body);
    } catch {
      issues.push(`${label}: response was not valid JSON`);
      return null;
    }
  } catch (error) {
    issues.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function runSmokeDeploy(gate) {
  const result = spawnSync(process.execPath, ["scripts/smoke-deploy.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...safeChildEnv(),
      API_ORIGIN: apiOrigin,
      AGENT_SERVICE_URL: agentServiceUrl,
      WEB_ORIGIN: webOrigin,
      EXPECT_PRODUCTION_READY: gate === "initial-production-go" ? "true" : "false",
      EXPECT_GOOGLE_ADS_WRITE_ACTIVATION: gate === "google-ads-write-activation" ? "true" : "false",
    },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function validateProductionEvidence(apiHealthPayload, readinessPayload, agentHealthPayload, gate) {
  if (!apiHealthPayload) {
    issues.push("Production evidence: API health is missing.");
  } else {
    const expectedApiFlags = {
      ok: true,
      service: "adops-api",
      mode: "agent-proxy",
      mediaWriteEnabled: gate === "google-ads-write-activation",
      billingConfigured: true,
      supabaseConfigured: true,
      authConfigured: true,
    };
    for (const [key, expected] of Object.entries(expectedApiFlags)) {
      if (apiHealthPayload[key] !== expected) {
        issues.push(`Production evidence: API health ${key} expected ${String(expected)}, got ${String(apiHealthPayload[key] ?? "missing")}.`);
      }
    }
  }

  if (!agentHealthPayload) {
    issues.push("Production evidence: Agent health is missing.");
  } else {
    if (agentHealthPayload.ok !== true) {
      issues.push("Production evidence: Agent health ok expected true.");
    }
    if (agentHealthPayload.service !== "openai-agent") {
      issues.push(`Production evidence: Agent health service expected openai-agent, got ${String(agentHealthPayload.service ?? "missing")}.`);
    }
    if (!["openai", "openai_agents"].includes(String(agentHealthPayload.mode ?? ""))) {
      issues.push(`Production evidence: Agent health mode expected OpenAI runtime, got ${String(agentHealthPayload.mode ?? "missing")}.`);
    }
    if (!["openai", "openai_agents"].includes(String(agentHealthPayload.selectedRuntime ?? ""))) {
      issues.push(`Production evidence: Agent health selectedRuntime expected OpenAI runtime, got ${String(agentHealthPayload.selectedRuntime ?? "missing")}.`);
    }
    if (agentHealthPayload.runtimeConfigured !== true) {
      issues.push("Production evidence: Agent health runtimeConfigured expected true.");
      const diagnostics = runtimeDiagnosticSummary(agentHealthPayload.runtimeDiagnostics);
      if (diagnostics) issues.push(`Production evidence: Agent runtime diagnostics: ${diagnostics}`);
    }
    if (agentHealthPayload.dataSafetyConfigured !== true) {
      issues.push("Production evidence: Agent health dataSafetyConfigured expected true.");
    }
  }

  const production = readinessPayload?.scopes?.production;
  if (!production) {
    issues.push("Production evidence: readiness scopes.production is missing.");
    return;
  }
  if (production.decision !== "Go") {
    issues.push(`Production evidence: readiness production decision expected Go, got ${String(production.decision ?? "missing")}.`);
  }
  const checks = Array.isArray(production.checks) ? production.checks : [];
  const presentIds = new Set(checks.map((check) => check.id));
  const requiredIds = [
    "supabase-auth-env",
    "agent-service-enabled",
    "agent-service-modern-env",
    "openai-agent-service-health",
    "openai-agent-staging-e2e",
    "real-media-apis",
    "stripe-billing",
    "staging-e2e-evidence-window",
    "deployment",
  ];
  for (const id of requiredIds) {
    if (!presentIds.has(id)) {
      issues.push(`Production evidence: readiness production check ${id} is missing.`);
    }
  }
  for (const check of checks) {
    if (check.status !== "pass") {
      issues.push(`Production evidence: readiness production check ${check.id ?? "unknown"} is ${check.status ?? "unknown"}.`);
    }
  }
}

function safeChildEnv() {
  const kept = {};
  for (const key of ["PATH", "HOME", "SHELL", "TMPDIR", "USER", "LOGNAME"]) {
    if (process.env[key] !== undefined) kept[key] = process.env[key];
  }
  return kept;
}

function productionGateCommand() {
  return productionGate === "google-ads-write-activation"
    ? "EXPECT_GOOGLE_ADS_WRITE_ACTIVATION=true"
    : "EXPECT_PRODUCTION_READY=true";
}

function printEvidence() {
  const production = readiness?.scopes?.production;
  const productionChecks = Array.isArray(production?.checks) ? production.checks : [];
  const evidenceWindow = productionChecks.find((check) => check.id === "staging-e2e-evidence-window");

  console.log("# Collected Release Evidence");
  console.log("");
  console.log("This output contains only public health/readiness summaries and smoke output. Do not paste secrets into this evidence note.");
  console.log("");
  console.log("## Release Identity");
  console.log("");
  console.log(`- Release branch or commit SHA: ${releaseSha || "fill manually"}`);
  console.log(`- Evidence owner: ${evidenceOwner || "fill manually"}`);
  console.log(`- Evidence captured at: ${evidenceCapturedAt}`);
  console.log(`- Production gate: ${productionGate}`);
  console.log(`- API origin: ${apiOrigin ? redactUrl(apiOrigin) : "missing"}`);
  console.log(`- Agent Service origin: ${agentServiceUrl ? redactUrl(agentServiceUrl) : "missing"}`);
  console.log(`- Web origin: ${webOrigin ? redactUrl(webOrigin) : "fill manually"}`);
  console.log("");
  console.log("## API Health");
  console.log("");
  printHealth("API", apiHealth, ["ok", "service", "mode", "mediaWriteEnabled", "billingConfigured", "supabaseConfigured", "authConfigured"]);
  console.log("");
  console.log("## Agent Health");
  console.log("");
  printHealth("Agent", agentHealth, ["ok", "service", "mode", "selectedRuntime", "runtimeConfigured", "dataSafetyConfigured"]);
  const diagnostics = runtimeDiagnosticSummary(agentHealth?.runtimeDiagnostics);
  if (diagnostics) console.log(`- runtimeDiagnostics: ${diagnostics}`);
  console.log("");
  console.log("## API Readiness");
  console.log("");
  console.log(`- Production decision: ${production?.decision ?? "missing"}`);
  for (const check of productionChecks) {
    console.log(`- ${check.id ?? "unknown"}: ${check.status ?? "unknown"}`);
  }
  console.log(`- staging-e2e-evidence-window: ${evidenceWindow?.status ?? "missing"}`);
  console.log("");
  console.log("## Smoke");
  console.log("");
  printSmoke("npm run smoke:deploy", normalSmoke);
  printSmoke(`${productionGateCommand()} npm run smoke:deploy`, productionSmoke);
  console.log("");
  console.log("## Manual Evidence Still Required");
  console.log("");
  console.log("- `npm run deploy:preflight` pass output from the operator machine.");
  console.log("- `node scripts/check-env.mjs .env.production.api .env.production.agent .env.production.web` pass output.");
  console.log("- `npm run e2e:supabase` pass output after migrations.");
  console.log("- Google Ads OAuth, dedicated campaign ENABLED/PAUSED write and restore, final live preview re-read, and audit log evidence; budget stays provider-fake only.");
  console.log("- Stripe hosted Checkout, existing customer reuse, webhook delivery, DB row update, billing gate, and customer/workspace mismatch rejection evidence.");
  console.log("- Rollout owner, rollback owner, and rollback action.");
  if (expectProductionReady && !issues.length) {
    console.log("");
    console.log("## Completion Audit Env Candidates");
    console.log("");
    console.log("Copy these only after this collector output and the final production smoke are recorded in the release evidence note:");
    console.log(`export PRODUCTION_SMOKE_PASSED_AT=${evidenceCapturedAt}`);
    console.log(`export RELEASE_EVIDENCE_COLLECTED_AT=${evidenceCapturedAt}`);
    console.log("export RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>");
  }
  if (expectGoogleAdsWriteActivation && !issues.length) {
    console.log("");
    console.log("## Google Ads Write Activation Evidence Candidate");
    console.log("");
    console.log("Record this only after separate approval, production mediaWriteEnabled=true, and the activation smoke are captured:");
    console.log(`export GOOGLE_ADS_WRITE_ACTIVATION_PASSED_AT=${evidenceCapturedAt}`);
  }
}

function runtimeDiagnosticSummary(runtimeDiagnostics) {
  if (!runtimeDiagnostics || typeof runtimeDiagnostics !== "object") return "";
  const missingSymbols = Array.isArray(runtimeDiagnostics.missingOpenaiAgentsSymbols)
    ? runtimeDiagnostics.missingOpenaiAgentsSymbols.join(",")
    : "";
  return [
    `openaiApiKeyConfigured=${String(runtimeDiagnostics.openaiApiKeyConfigured ?? "missing")}`,
    `openaiAgentsSdkImportable=${String(runtimeDiagnostics.openaiAgentsSdkImportable ?? "missing")}`,
    `openaiAgentsSdkAvailable=${String(runtimeDiagnostics.openaiAgentsSdkAvailable ?? "missing")}`,
    `missingOpenaiAgentsSymbols=${missingSymbols || "none"}`,
  ].join(", ");
}

function printHealth(label, payload, keys) {
  if (!payload) {
    console.log(`- ${label} health: missing`);
    return;
  }
  for (const key of keys) {
    console.log(`- ${key}: ${String(payload[key] ?? "missing")}`);
  }
}

function printSmoke(label, result) {
  console.log(`- ${label}: ${result ? `exit ${result.status}` : "not run"}`);
  if (!result) return;
  for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
    console.log(`  ${line}`);
  }
  for (const line of result.stderr.split(/\r?\n/).filter(Boolean)) {
    console.log(`  stderr: ${line}`);
  }
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    if (url.username) url.username = "REDACTED";
    if (url.password) url.password = "REDACTED";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "[invalid-url]";
  }
}

function printHelp() {
  console.log(`Usage:
  API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com npm run collect:release-evidence

Optional:
  WEB_ORIGIN=https://app.example.com
  RELEASE_SHA=<git-sha>
  EVIDENCE_OWNER=<operator-name>
  EXPECT_PRODUCTION_READY=true               Run the initial production Go gate; requires mediaWriteEnabled=false.
  EXPECT_GOOGLE_ADS_WRITE_ACTIVATION=true    Run the separate post-Go write activation gate; requires mediaWriteEnabled=true.
  ALLOW_INCOMPLETE_EVIDENCE=true    Print partial evidence even when checks fail.

The command fetches:
  <API_ORIGIN>/health
  <API_ORIGIN>/readiness
  <AGENT_SERVICE_URL>/health

It also runs npm run smoke:deploy. Choose at most one production gate: initial Go or later Google Ads write activation.
It prints Markdown evidence to stdout and intentionally excludes secrets, tokens, OAuth codes, and webhook secrets.`);
}
