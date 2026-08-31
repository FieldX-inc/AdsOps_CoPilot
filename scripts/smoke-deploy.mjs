#!/usr/bin/env node

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const apiOrigin = cleanOrigin(process.env.API_ORIGIN || process.env.VITE_API_BASE_URL || "");
const agentServiceUrl = cleanOrigin(process.env.AGENT_SERVICE_URL || "");
const webOrigin = cleanOrigin(process.env.WEB_ORIGIN || process.env.VITE_WEB_ORIGIN || "");
const expectProductionReady = process.env.EXPECT_PRODUCTION_READY === "true";
const expectGoogleAdsWriteActivation = process.env.EXPECT_GOOGLE_ADS_WRITE_ACTIVATION === "true";
const productionGate = expectGoogleAdsWriteActivation ? "google-ads-write-activation" : expectProductionReady ? "initial-production-go" : "none";
const requireProductionGate = productionGate !== "none";
const issues = [];

if (!apiOrigin) {
  issues.push("Set API_ORIGIN or VITE_API_BASE_URL to the deployed API origin.");
}
if (!agentServiceUrl) {
  issues.push("Set AGENT_SERVICE_URL to the deployed OpenAI Agent Service origin.");
}
if (expectProductionReady && expectGoogleAdsWriteActivation) {
  issues.push("Choose exactly one production gate: EXPECT_PRODUCTION_READY=true for initial Go or EXPECT_GOOGLE_ADS_WRITE_ACTIVATION=true for later write activation.");
}
if (requireProductionGate) {
  if (!webOrigin) {
    issues.push("Set WEB_ORIGIN to the deployed Cloudflare Pages web origin for the production gate.");
  }
  validateModernAgentServiceEnv();
}

if (issues.length) {
  reportAndExit(issues);
}

const [apiHealth, readiness, agentHealth, webHtml] = await Promise.all([
  getJson(`${apiOrigin}/health`, "API health"),
  getJson(`${apiOrigin}/readiness`, "API readiness"),
  getJson(`${agentServiceUrl}/health`, "Agent health"),
  webOrigin ? getText(webOrigin, "Web app") : Promise.resolve(null),
]);
const webAssetSummary = webOrigin && requireProductionGate && webHtml ? await validateWebAssets(webHtml, webOrigin) : null;

validateHealth(apiHealth, "API health", "adops-api");
validateHealth(agentHealth, "Agent health", "openai-agent");
validateApiHealth(apiHealth, productionGate);
validateAgentHealth(agentHealth, requireProductionGate);
validateReadiness(readiness, requireProductionGate);
validateWebApp(webHtml, requireProductionGate);

printSummary({
  apiOrigin,
  agentServiceUrl,
  webOrigin,
  apiHealth,
  readiness,
  agentHealth,
  webHtml,
  webAssetSummary,
  expectProductionReady,
  expectGoogleAdsWriteActivation,
  productionGate,
});

if (issues.length) {
  reportAndExit(issues);
}

console.log("Deploy smoke check passed.");

function cleanOrigin(value) {
  return value.trim().replace(/\/+$/, "");
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

async function getText(url, label) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html",
      },
    });
    const body = await response.text();
    if (!response.ok) {
      issues.push(`${label}: HTTP ${response.status}`);
      return null;
    }
    return body;
  } catch (error) {
    issues.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function validateHealth(payload, label, expectedService) {
  if (!payload) return;
  if (payload.ok !== true) {
    issues.push(`${label}: expected ok=true`);
  }
  if (payload.service !== expectedService) {
    issues.push(`${label}: expected service=${expectedService}`);
  }
}

function validateAgentHealth(payload, requireProductionReady) {
  if (!payload) return;
  if (!["openai", "openai_agents"].includes(String(payload.mode ?? ""))) {
    issues.push(`Agent health: expected OpenAI runtime mode, got ${payload.mode ?? "unknown"}`);
  }
  if (!["openai", "openai_agents"].includes(String(payload.selectedRuntime ?? ""))) {
    issues.push(`Agent health: expected selectedRuntime=openai/openai_agents, got ${payload.selectedRuntime ?? "unknown"}`);
  }
  if (!requireProductionReady) return;
  if (payload.runtimeConfigured !== true) {
    issues.push("Agent health: expected runtimeConfigured=true for production gate");
    const diagnostics = runtimeDiagnosticSummary(payload.runtimeDiagnostics);
    if (diagnostics) issues.push(`Agent health runtime diagnostics: ${diagnostics}`);
  }
  if (payload.dataSafetyConfigured !== true) {
    issues.push("Agent health: expected dataSafetyConfigured=true for production gate");
  }
}

function validateApiHealth(payload, gate) {
  if (!payload || gate === "none") return;
  if (payload.mode !== "agent-proxy") {
    issues.push(`API health: expected mode=agent-proxy for production gate, got ${payload.mode ?? "unknown"}`);
  }
  const expectedMediaWriteEnabled = gate === "google-ads-write-activation";
  if (payload.mediaWriteEnabled !== expectedMediaWriteEnabled) {
    issues.push(
      `API health: expected mediaWriteEnabled=${String(expectedMediaWriteEnabled)} for ${gate === "initial-production-go" ? "initial production Go" : "Google Ads write activation"} gate`,
    );
  }
  if (payload.billingConfigured !== true) {
    issues.push("API health: expected billingConfigured=true for production gate");
  }
  if (payload.supabaseConfigured !== true) {
    issues.push("API health: expected supabaseConfigured=true for production gate");
  }
  if (payload.authConfigured !== true) {
    issues.push("API health: expected authConfigured=true for production gate");
  }
}

function validateReadiness(payload, requireGo) {
  const production = payload?.scopes?.production;
  if (!production) {
    issues.push("API readiness: missing scopes.production");
    return;
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
      issues.push(`API readiness: missing production check ${id}`);
    }
  }

  if (!requireGo) return;

  if (production.decision !== "Go") {
    issues.push(`API readiness: expected production decision Go, got ${production.decision ?? "unknown"}`);
  }

  for (const check of checks) {
    if (check.status !== "pass") {
      issues.push(`API readiness: production check ${check.id ?? "unknown"} is ${check.status ?? "unknown"}`);
    }
  }
}

function validateWebApp(html, requireProductionReady) {
  if (!requireProductionReady) return;
  if (typeof html !== "string" || !html.trim()) {
    issues.push("Web app: expected HTML response for production gate");
    return;
  }
  if (!/<html[\s>]/i.test(html) || !/<div\s+id=["']root["']/i.test(html)) {
    issues.push("Web app: expected deployed app HTML with root element");
  }
}

async function validateWebAssets(html, origin) {
  const refs = extractWebAssetRefs(html);
  if (!refs.length) {
    issues.push("Web app: expected deployed HTML to reference JS or CSS assets");
    return { checked: 0 };
  }

  let checked = 0;
  for (const ref of refs) {
    checked += 1;
    await validateWebAsset(ref, origin);
  }
  return { checked };
}

function extractWebAssetRefs(html) {
  const refs = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    refs.push(match[1]);
  }
  for (const match of html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
    const tag = match[0];
    if (/\brel=["'][^"']*(stylesheet|modulepreload)[^"']*["']/i.test(tag)) {
      refs.push(match[1]);
    }
  }
  return [...new Set(refs)].filter((ref) => !ref.startsWith("data:"));
}

async function validateWebAsset(ref, origin) {
  let url;
  try {
    url = new URL(ref, origin);
  } catch {
    issues.push(`Web app asset: invalid reference ${ref}`);
    return;
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "*/*",
      },
    });
    const body = await response.text();
    if (!response.ok) {
      issues.push(`Web app asset ${url.pathname}: HTTP ${response.status}`);
      return;
    }
    if (looksLikeHtml(body, response.headers.get("content-type"))) {
      issues.push(`Web app asset ${url.pathname}: expected JS/CSS asset, got HTML`);
    }
  } catch (error) {
    issues.push(`Web app asset ${url.pathname}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function looksLikeHtml(body, contentType) {
  return String(contentType ?? "").toLowerCase().includes("text/html") || /^\s*<!doctype html/i.test(body) || /^\s*<html[\s>]/i.test(body);
}

function validateModernAgentServiceEnv() {
  const legacyAliases = [];
  if (process.env.ADK_AGENT_URL) legacyAliases.push("ADK_AGENT_URL");
  if (process.env.USE_ADK_AGENT === "true") legacyAliases.push("USE_ADK_AGENT");
  if (process.env.ADK_AGENT_TIMEOUT_MS) legacyAliases.push("ADK_AGENT_TIMEOUT_MS");
  if (legacyAliases.length) {
    issues.push(`Production smoke must use AGENT_SERVICE_* env only; remove legacy ADK aliases: ${legacyAliases.join(", ")}`);
  }
}

function printSummary(summary) {
  console.log("Deploy smoke summary:");
  console.log(`- API: ${redactUrl(summary.apiOrigin)}`);
  console.log(`- Agent: ${redactUrl(summary.agentServiceUrl)}`);
  console.log(`- Web: ${summary.webOrigin ? redactUrl(summary.webOrigin) : "not checked"}`);
  if (summary.apiHealth) {
    console.log(
      `- API health: ok=${String(summary.apiHealth.ok)}, mode=${summary.apiHealth.mode ?? "unknown"}, mediaWriteEnabled=${String(
        summary.apiHealth.mediaWriteEnabled,
      )}, billingConfigured=${String(summary.apiHealth.billingConfigured)}`,
    );
  }
  if (summary.agentHealth) {
    console.log(
      `- Agent health: ok=${String(summary.agentHealth.ok)}, mode=${summary.agentHealth.mode ?? "unknown"}, runtimeConfigured=${String(
        summary.agentHealth.runtimeConfigured,
      )}, dataSafetyConfigured=${String(summary.agentHealth.dataSafetyConfigured)}`,
    );
    const diagnostics = runtimeDiagnosticSummary(summary.agentHealth.runtimeDiagnostics);
    if (diagnostics) console.log(`- Agent runtime diagnostics: ${diagnostics}`);
  }
  const production = summary.readiness?.scopes?.production;
  if (production) {
    console.log(`- Production readiness: decision=${production.decision ?? "unknown"}`);
    const checks = Array.isArray(production.checks) ? production.checks : [];
    for (const check of checks) {
      console.log(`  - ${check.id ?? "unknown"}: ${check.status ?? "unknown"}`);
    }
  }
  if (summary.webOrigin) {
    console.log(`- Web app: html=${summary.webHtml ? "received" : "missing"}`);
    if (summary.webAssetSummary) {
      console.log(`- Web assets: checked=${summary.webAssetSummary.checked}`);
    }
  }
  console.log(`- Production gate: ${summary.productionGate}`);
  console.log(`- Require initial production Go: ${String(summary.expectProductionReady)}`);
  console.log(`- Require Google Ads write activation: ${String(summary.expectGoogleAdsWriteActivation)}`);
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

function reportAndExit(items) {
  console.error("Deploy smoke check failed:");
  for (const item of items) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com npm run smoke:deploy

Optional:
  EXPECT_PRODUCTION_READY=true               Initial production Go gate. Requires mediaWriteEnabled=false.
  EXPECT_GOOGLE_ADS_WRITE_ACTIVATION=true    Separate post-Go write activation gate. Requires mediaWriteEnabled=true.

Inputs:
  API_ORIGIN                  Deployed API origin. Falls back to VITE_API_BASE_URL.
  AGENT_SERVICE_URL           Deployed OpenAI Agent Service origin. Required; legacy ADK_AGENT_URL is not accepted.
  WEB_ORIGIN                              Deployed Cloudflare Pages web origin. Required for either production gate.
  EXPECT_PRODUCTION_READY                 Set only for the initial production Go gate.
  EXPECT_GOOGLE_ADS_WRITE_ACTIVATION      Set only after separate approval for the post-Go write activation gate.

The script calls:
  <API_ORIGIN>/health
  <API_ORIGIN>/readiness
  <AGENT_SERVICE_URL>/health
  <WEB_ORIGIN> and its referenced JS/CSS assets for either production gate

For both gates it requires API readiness Go, the staging-e2e-evidence-window readiness check,
and API health production capability flags. Initial production Go requires mediaWriteEnabled=false;
the later Google Ads write activation gate requires mediaWriteEnabled=true.
Both gates also require Agent health mode=openai/openai_agents, selectedRuntime=openai/openai_agents, runtimeConfigured=true, and dataSafetyConfigured=true.
It also requires the deployed web origin to return app HTML with the root element and reachable JS/CSS asset references.
It prints only non-secret health/readiness summaries.`);
}
