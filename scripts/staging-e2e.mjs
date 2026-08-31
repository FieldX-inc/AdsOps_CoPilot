#!/usr/bin/env node

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const config = {
  apiOrigin: cleanOrigin(process.env.API_ORIGIN || process.env.VITE_API_BASE_URL || ""),
  agentServiceUrl: cleanOrigin(process.env.AGENT_SERVICE_URL || ""),
  authToken: process.env.AUTH_TOKEN || "",
  unpaidAuthToken: process.env.UNPAID_AUTH_TOKEN || "",
  workspaceId: process.env.WORKSPACE_ID || "",
  userId: process.env.USER_ID || "staging-e2e-user",
  googleCustomerId: process.env.GOOGLE_CUSTOMER_ID || "",
  googleCampaignId: process.env.GOOGLE_CAMPAIGN_ID || "",
  googleWriteKind: process.env.GOOGLE_WRITE_KIND || "status",
  googleWriteStatus: process.env.GOOGLE_WRITE_STATUS || "PAUSED",
  googleRestoreStatus: process.env.GOOGLE_RESTORE_STATUS || "",
  googleWriteRollback: process.env.GOOGLE_WRITE_ROLLBACK || "",
  stripeFullE2eConfirmation: process.env.STRIPE_FULL_E2E_CONFIRMATION || "",
  checkAgent: envFlag("CHECK_AGENT", true),
  checkStripe: envFlag("CHECK_STRIPE", true),
  checkBillingGate: envFlag("CHECK_BILLING_GATE", true),
  checkGoogleRead: envFlag("CHECK_GOOGLE_READ", true),
  checkGoogleWrite: envFlag("CHECK_GOOGLE_WRITE", false),
  confirmGoogleWrite: envFlag("CONFIRM_GOOGLE_WRITE", false),
  confirmStagingTarget: envFlag("CONFIRM_STAGING_TARGET", false),
  stagingTargetConfirmation: process.env.STAGING_TARGET_CONFIRMATION || "",
};

const issues = [];
const passedEvidence = new Set();
const googleCampaignStatuses = new Set(["ENABLED", "PAUSED"]);

if (!config.apiOrigin) issues.push("Set API_ORIGIN or VITE_API_BASE_URL.");
if (!config.authToken) issues.push("Set AUTH_TOKEN to a staging user access token.");
if (!config.workspaceId) issues.push("Set WORKSPACE_ID to the staging workspace id.");
if (config.checkAgent && !config.agentServiceUrl) {
  issues.push("Set AGENT_SERVICE_URL to the deployed OpenAI Agent Service origin. Legacy ADK_AGENT_URL is not accepted for staging evidence.");
}
const legacyAgentAliases = [];
if (process.env.ADK_AGENT_URL) legacyAgentAliases.push("ADK_AGENT_URL");
if (process.env.USE_ADK_AGENT === "true") legacyAgentAliases.push("USE_ADK_AGENT");
if (process.env.ADK_AGENT_TIMEOUT_MS) legacyAgentAliases.push("ADK_AGENT_TIMEOUT_MS");
if (config.checkAgent && legacyAgentAliases.length) {
  issues.push(`Remove legacy ADK agent aliases before staging evidence: ${legacyAgentAliases.join(", ")}.`);
}
if (!isSafeStagingOrigin(config.apiOrigin) && !stagingTargetOverrideLooksComplete(config)) {
  issues.push(
    "API_ORIGIN does not look like staging/local/test. Use a staging URL or set CONFIRM_STAGING_TARGET=true with STAGING_TARGET_CONFIRMATION containing staging and non-production.",
  );
}
if (config.checkGoogleWrite && !config.confirmGoogleWrite) {
  issues.push("Set CONFIRM_GOOGLE_WRITE=true to execute the Google Ads write E2E.");
}
if (config.checkGoogleWrite && config.googleWriteKind !== "status") {
  issues.push("Staging real-provider write E2E allows GOOGLE_WRITE_KIND=status only; budget is provider-fake/contract-test only.");
}
if (config.checkGoogleWrite && !config.googleCampaignId) {
  issues.push("Set GOOGLE_CAMPAIGN_ID for the Google Ads write E2E.");
}
if (config.checkGoogleWrite && !config.googleCustomerId) {
  issues.push("Set GOOGLE_CUSTOMER_ID for the Google Ads write E2E.");
}
if (config.checkGoogleWrite && !config.googleWriteRollback.trim()) {
  issues.push("Set GOOGLE_WRITE_ROLLBACK to describe the exact rollback or restore action before write E2E.");
}
if (config.checkGoogleWrite && config.googleWriteRollback.trim().length < 20) {
  issues.push("Set GOOGLE_WRITE_ROLLBACK to at least 20 characters with the reason, restore value, and observation window.");
}
if (config.checkGoogleWrite && config.googleWriteKind === "status" && !config.googleRestoreStatus) {
  issues.push("Set GOOGLE_RESTORE_STATUS to the original campaign status before status write E2E.");
}
if (config.checkGoogleWrite && config.googleWriteKind === "status" && config.googleWriteStatus && config.googleRestoreStatus && config.googleWriteStatus === config.googleRestoreStatus) {
  issues.push("Set GOOGLE_WRITE_STATUS different from GOOGLE_RESTORE_STATUS so the reversible write E2E proves mutation and restore.");
}
if (config.checkGoogleWrite && config.googleWriteKind === "status" && !googleCampaignStatuses.has(config.googleWriteStatus)) {
  issues.push("Set GOOGLE_WRITE_STATUS to ENABLED or PAUSED.");
}
if (config.checkGoogleWrite && config.googleWriteKind === "status" && !googleCampaignStatuses.has(config.googleRestoreStatus)) {
  issues.push("Set GOOGLE_RESTORE_STATUS to ENABLED or PAUSED.");
}
if (process.env.CONFIRM_STRIPE_FULL_E2E === "true" && !stripeConfirmationLooksComplete(config.stripeFullE2eConfirmation)) {
  issues.push(
    "Set STRIPE_FULL_E2E_CONFIRMATION to a note containing checkout, existing customer reuse, webhook, billing gate, and customer/workspace mismatch rejection before printing STRIPE_STAGING_E2E_PASSED_AT.",
  );
}
if (process.env.CONFIRM_STRIPE_FULL_E2E === "true" && !config.checkBillingGate) {
  issues.push("Keep CHECK_BILLING_GATE=true when CONFIRM_STRIPE_FULL_E2E=true so billing gate evidence is executed before printing STRIPE_STAGING_E2E_PASSED_AT.");
}
if (process.env.CONFIRM_STRIPE_FULL_E2E === "true" && config.checkBillingGate && !config.unpaidAuthToken) {
  issues.push("Set UNPAID_AUTH_TOKEN when CONFIRM_STRIPE_FULL_E2E=true so the script verifies authenticated 402 billing_required before printing STRIPE_STAGING_E2E_PASSED_AT.");
}

if (issues.length) reportAndExit(issues);

console.log("Staging E2E started.");
console.log(`- API: ${redactUrl(config.apiOrigin)}`);
if (config.agentServiceUrl) console.log(`- Agent: ${redactUrl(config.agentServiceUrl)}`);
console.log(`- Workspace: ${config.workspaceId}`);

await checkApiBasics();
if (config.checkStripe) await checkStripeBilling();
if (config.checkBillingGate) await checkBillingGate();
if (config.checkAgent) await checkAgentRuntime();
if (config.checkGoogleRead) await checkGoogleAdsRead();
if (config.checkGoogleWrite) await checkGoogleAdsWrite();

if (issues.length) reportAndExit(issues);

console.log("Staging E2E passed.");
printEvidenceEnv();

function cleanOrigin(value) {
  return value.trim().replace(/\/+$/, "");
}

function envFlag(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  return value === "true";
}

function stripeConfirmationLooksComplete(value) {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes("checkout") &&
    normalized.includes("existing customer") &&
    normalized.includes("reuse") &&
    normalized.includes("webhook") &&
    normalized.includes("billing gate") &&
    normalized.includes("mismatch")
  );
}

function isSafeStagingOrigin(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".test") ||
      hostname.includes("staging") ||
      hostname.includes("preview")
    );
  } catch {
    return false;
  }
}

function stagingTargetOverrideLooksComplete(value) {
  const normalized = value.stagingTargetConfirmation.trim().toLowerCase();
  return value.confirmStagingTarget && normalized.includes("staging") && normalized.includes("non-production");
}

function authHeaders(extra = {}) {
  return bearerHeaders(config.authToken, extra);
}

function unpaidAuthHeaders(extra = {}) {
  return bearerHeaders(config.unpaidAuthToken, extra);
}

function bearerHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function checkApiBasics() {
  const health = await getJson(`${config.apiOrigin}/health`, "API health");
  if (health?.ok !== true || health?.service !== "adops-api") {
    issues.push("API health: expected ok=true and service=adops-api");
  }

  const readiness = await getJson(`${config.apiOrigin}/readiness`, "API readiness");
  if (!readiness?.scopes?.production?.checks) {
    issues.push("API readiness: missing production checks");
  }
}

async function checkAgentRuntime() {
  if (config.agentServiceUrl) {
    const health = await getJson(`${config.agentServiceUrl}/health`, "Agent health");
    if (health?.ok !== true || health?.service !== "openai-agent") {
      issues.push("Agent health: expected ok=true and service=openai-agent");
    }
    if (!["openai", "openai_agents"].includes(String(health?.mode ?? ""))) {
      issues.push(`Agent health: expected OpenAI runtime mode, got ${health?.mode ?? "unknown"}`);
    }
    if (!["openai", "openai_agents"].includes(String(health?.selectedRuntime ?? ""))) {
      issues.push(`Agent health: expected selectedRuntime=openai/openai_agents, got ${health?.selectedRuntime ?? "unknown"}`);
    }
  }

  await checkAgentChatMode("beginner", "今週の広告状況を、初心者向けに結論、根拠、次の確認に分けて短く整理して。");
  await checkAgentChatMode("experienced", "CPAが悪化している原因を、実務者向けにKPI分解と優先順位で分析して。");
  await checkAgentWriteGuard();
  passedEvidence.add("OPENAI_AGENT_STAGING_E2E_PASSED_AT");
}

async function checkAgentChatMode(advisorMode, message) {
  const payload = {
    workspaceId: config.workspaceId,
    userId: config.userId,
    threadId: `staging-e2e-${advisorMode}-${Date.now()}`,
    message,
    context: {
      range: 7,
      platform: "google",
      advisorMode,
    },
  };
  const response = await postJson(`${config.apiOrigin}/agent/chat`, `Agent chat ${advisorMode}`, payload);
  const content = response?.message?.content;
  if (typeof content !== "string" || content.length < 20) {
    issues.push(`Agent chat ${advisorMode}: expected an assistant message with content`);
  }
  const responseMode = String(response?.mode ?? "");
  if (responseMode !== "openai_agents") {
    issues.push(`Agent chat ${advisorMode}: expected mode=openai_agents, got ${responseMode || "missing"}`);
  }
}

async function checkAgentWriteGuard() {
  const response = await postJson(`${config.apiOrigin}/agent/chat`, "Agent write guard", {
    workspaceId: config.workspaceId,
    userId: config.userId,
    threadId: `staging-e2e-write-guard-${Date.now()}`,
    message: "Google広告の予算を今すぐ上げて。",
    context: {
      range: 7,
      platform: "google",
      advisorMode: "experienced",
    },
  });
  if (response?.mode !== "write-approval-required") {
    issues.push(`Agent write guard: expected mode=write-approval-required, got ${response?.mode ?? "missing"}`);
  }
  if (response?.policy?.platformMutationExecuted !== false) {
    issues.push("Agent write guard: expected platformMutationExecuted=false");
  }
}

async function checkStripeBilling() {
  const status = await getJson(`${config.apiOrigin}/billing/status`, "Stripe billing status", true);
  if (status?.configured !== true) {
    issues.push("Stripe billing status: expected configured=true");
  }
  if (!["active", "billing_required"].includes(status?.access)) {
    issues.push("Stripe billing status: expected access to be active or billing_required");
  }

  const checkout = await postJson(`${config.apiOrigin}/billing/checkout-session`, "Stripe checkout session", {});
  if (typeof checkout?.url !== "string" || !checkout.url.startsWith("https://")) {
    issues.push("Stripe checkout session: expected an https checkout url");
    return;
  }
  if (status?.access === "active" && process.env.CONFIRM_STRIPE_FULL_E2E === "true") {
    passedEvidence.add("STRIPE_STAGING_E2E_PASSED_AT");
  } else {
    console.log("- Stripe: API status and Checkout session passed. Set CONFIRM_STRIPE_FULL_E2E=true only after hosted Checkout, existing customer reuse, webhook row update, and billing gates are manually confirmed.");
  }
}

async function checkBillingGate() {
  const unauth = await requestJsonExpectStatus(
    `${config.apiOrigin}/dashboard?workspaceId=${encodeURIComponent(config.workspaceId)}`,
    "Billing gate unauthenticated dashboard",
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
    401,
  );
  if (unauth?.code !== "authentication_required") {
    issues.push(`Billing gate unauthenticated dashboard: expected code=authentication_required, got ${unauth?.code ?? "missing"}`);
  }

  if (!config.unpaidAuthToken) {
    console.log("- Billing gate: unauthenticated 401 passed; set UNPAID_AUTH_TOKEN to also verify authenticated 402 billing_required.");
    return;
  }

  const unpaid = await requestJsonExpectStatus(
    `${config.apiOrigin}/agent/chat`,
    "Billing gate unpaid agent chat",
    {
      method: "POST",
      headers: unpaidAuthHeaders(),
      body: JSON.stringify({
        workspaceId: config.workspaceId,
        userId: config.userId,
        threadId: `staging-e2e-unpaid-${Date.now()}`,
        message: "今週のCPA悪化理由を分析して",
        context: {
          range: 7,
          platform: "google",
          advisorMode: "experienced",
        },
      }),
    },
    402,
  );
  if (unpaid?.code !== "billing_required" || unpaid?.access !== "billing_required") {
    issues.push(
      `Billing gate unpaid agent chat: expected code/access=billing_required, got code=${unpaid?.code ?? "missing"} access=${unpaid?.access ?? "missing"}`,
    );
  }
}

async function checkGoogleAdsRead() {
  const startUrl = await getJson(`${config.apiOrigin}/oauth/google/start-url`, "Google OAuth start-url", true);
  if (typeof startUrl?.url !== "string" || !startUrl.url.includes("accounts.google.com")) {
    issues.push("Google OAuth start-url: expected a Google consent url");
  }

  const customers = await getJson(
    `${config.apiOrigin}/google/customers?workspaceId=${encodeURIComponent(config.workspaceId)}`,
    "Google customers",
    true,
  );
  if (!Array.isArray(customers?.customers)) {
    issues.push("Google customers: expected customers array. Complete OAuth first if this fails.");
    return;
  }

  if (!config.googleCustomerId) {
    console.log("- Google read: customer list passed; set GOOGLE_CUSTOMER_ID to also connect and sync.");
    return;
  }

  await postJson(
    `${config.apiOrigin}/google/customers/${encodeURIComponent(config.googleCustomerId)}/connect?workspaceId=${encodeURIComponent(config.workspaceId)}`,
    "Google customer connect",
    {},
  );
  const sync = await postJson(`${config.apiOrigin}/sync/google`, "Google sync", {
    customerId: config.googleCustomerId,
    days: 7,
  });
  if (typeof sync?.rowsSynced !== "number") {
    issues.push("Google sync: expected rowsSynced number");
  }
}

async function checkGoogleAdsWrite() {
  console.log(`- Google write rollback plan: ${config.googleWriteRollback}`);
  const preview = await getJson(
    `${config.apiOrigin}/google/customers/${encodeURIComponent(config.googleCustomerId)}/campaigns/${encodeURIComponent(config.googleCampaignId)}/change-preview`,
    "Google change preview",
    true,
  );
  if (!preview?.preview?.current) {
    issues.push("Google write: live change preview is required before mutation.");
    return;
  }
  const currentStatus = String(preview.preview.current.status ?? "").toUpperCase();
  if (currentStatus !== config.googleRestoreStatus) {
    issues.push(`Google status write: live preview is ${currentStatus || "unknown"}, not configured restore status; no mutation was executed.`);
    return;
  }
  const write = await executeGoogleStatusWrite(config.googleWriteStatus, currentStatus, "Google status write");
  if (!write) return;
  try {
    await checkGoogleWriteAudit("google_ads.campaign_status_updated", { status: config.googleWriteStatus, approvalNote: config.googleWriteRollback });
  } finally {
    const restore = await executeGoogleStatusWrite(config.googleRestoreStatus, config.googleWriteStatus, "Google status restore", write.auditId);
    if (!restore) issues.push("Google status restore failed after a successful mutation; restore manually immediately.");
  }
  await checkGoogleWriteAudit("google_ads.campaign_status_updated", { status: config.googleRestoreStatus, approvalNote: config.googleWriteRollback });
  const finalPreview = await getJson(
    `${config.apiOrigin}/google/customers/${encodeURIComponent(config.googleCustomerId)}/campaigns/${encodeURIComponent(config.googleCampaignId)}/change-preview`,
    "Google final live preview",
    true,
  );
  const finalStatus = String(finalPreview?.preview?.current?.status ?? "").toUpperCase();
  if (finalStatus !== config.googleRestoreStatus) {
    issues.push(
      `Google status final live preview: expected restored ${config.googleRestoreStatus}, got ${finalStatus || "unknown"}; audit rows alone are not sufficient evidence.`,
    );
  }
  if (!issues.some((issue) => issue.startsWith("Google "))) passedEvidence.add("GOOGLE_ADS_STAGING_E2E_PASSED_AT");
}

async function executeGoogleStatusWrite(status, expectedCurrentStatus, label, rollbackAuditId) {
  const response = await postJson(
    `${config.apiOrigin}/google/customers/${encodeURIComponent(config.googleCustomerId)}/campaigns/${encodeURIComponent(config.googleCampaignId)}/status`,
    label,
    { status, expectedCurrentStatus, confirmed: true, approvalNote: config.googleWriteRollback, rollbackAuditId },
  );
  if (response?.mode !== "executed") issues.push(`${label}: expected mode=executed`);
  return response?.mode === "executed" ? response : null;
}

async function checkGoogleWriteAudit(expectedEventType, expectedPayload = {}) {
  const result = await getJson(
    `${config.apiOrigin}/audit-logs/recent?workspaceId=${encodeURIComponent(config.workspaceId)}&eventTypePrefix=google_ads.&limit=10`,
    "Google write audit",
    true,
  );
  const logs = Array.isArray(result?.logs) ? result.logs : [];
  const matched = logs.some((log) => {
    if (log?.event_type !== expectedEventType) return false;
    if (!Object.entries(expectedPayload).every(([key, value]) => String(log?.payload?.[key] ?? "") === String(value))) return false;
    return googleWriteAuditApprovalMetadataLooksComplete(log?.payload);
  });
  if (!matched) {
    const payloadHint = Object.keys(expectedPayload).length ? ` with payload ${JSON.stringify(expectedPayload)}` : "";
    issues.push(`Google write audit: expected recent ${expectedEventType}${payloadHint} audit log with approval metadata.`);
  }
}

function googleWriteAuditApprovalMetadataLooksComplete(payload) {
  return (
    payload?.platform === "google" &&
    String(payload?.customerId ?? "") === String(config.googleCustomerId) &&
    String(payload?.campaignId ?? "") === String(config.googleCampaignId) &&
    payload?.confirmed === true &&
    payload?.approvalType === "explicit_user_confirmation" &&
    typeof payload?.approvedByUserId === "string" &&
    payload.approvedByUserId.trim().length > 0 &&
    timestampLooksValid(payload?.approvedAt)
  );
}

function timestampLooksValid(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

async function getJson(url, label, authenticated = false) {
  return requestJson(url, label, {
    method: "GET",
    headers: authenticated ? authHeaders({ "Content-Type": undefined }) : { Accept: "application/json" },
  });
}

async function postJson(url, label, body) {
  return requestJson(url, label, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

async function requestJson(url, label, init) {
  const headers = stripUndefinedHeaders(init.headers ?? {});
  try {
    const response = await fetch(url, { ...init, headers });
    const text = await response.text();
    if (!response.ok) {
      issues.push(`${label}: HTTP ${response.status}${text ? ` ${truncate(text, 180)}` : ""}`);
      return null;
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      issues.push(`${label}: response was not valid JSON`);
      return null;
    }
  } catch (error) {
    issues.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function requestJsonExpectStatus(url, label, init, expectedStatus) {
  const headers = stripUndefinedHeaders(init.headers ?? {});
  try {
    const response = await fetch(url, { ...init, headers });
    const text = await response.text();
    if (response.status !== expectedStatus) {
      issues.push(`${label}: expected HTTP ${expectedStatus}, got HTTP ${response.status}${text ? ` ${truncate(text, 180)}` : ""}`);
      return null;
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      issues.push(`${label}: response was not valid JSON`);
      return null;
    }
  } catch (error) {
    issues.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function stripUndefinedHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined));
}

function truncate(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
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

function printEvidenceEnv() {
  const now = new Date().toISOString();
  const evidenceKeys = [
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
    "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
    "STRIPE_STAGING_E2E_PASSED_AT",
  ];
  const passed = evidenceKeys.filter((key) => passedEvidence.has(key));
  if (!passed.length) return;

  console.log("Evidence env candidates; copy only the lines backed by this run and recorded operator evidence:");
  for (const key of passed) {
    console.log(`export ${key}=${now}`);
  }
}

function reportAndExit(items) {
  console.error("Staging E2E failed:");
  for (const item of items) console.error(`- ${item}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  API_ORIGIN=https://api.staging.example.com \\
  AGENT_SERVICE_URL=https://agent.staging.example.com \\
  WORKSPACE_ID=<workspace-id> \\
  npm run e2e:staging

Required secret inputs:
  AUTH_TOKEN                  Set in the operator environment before running; never paste into shell history.

Optional Google read/sync:
  GOOGLE_CUSTOMER_ID=1234567890

Optional Google write E2E:
  CHECK_GOOGLE_WRITE=true \\
  CONFIRM_GOOGLE_WRITE=true \\
  GOOGLE_WRITE_ROLLBACK="restore campaign status to ENABLED after confirming audit log" \\
  GOOGLE_CUSTOMER_ID=1234567890 \\
  GOOGLE_CAMPAIGN_ID=987654321 \\
  GOOGLE_WRITE_KIND=status \\
  GOOGLE_WRITE_STATUS=PAUSED \\
  GOOGLE_RESTORE_STATUS=ENABLED

Section toggles:
  CHECK_AGENT=true|false       Default true
  CHECK_STRIPE=true|false      Default true
  CHECK_BILLING_GATE=true|false Default true
  CHECK_GOOGLE_READ=true|false Default true
  CHECK_GOOGLE_WRITE=true|false Default false

Optional billing gate:
  UNPAID_AUTH_TOKEN           Set in the operator environment when checking unpaid-user billing gates. Required with CONFIRM_STRIPE_FULL_E2E=true.
  CONFIRM_STRIPE_FULL_E2E=true  Print STRIPE_STAGING_E2E_PASSED_AT only after hosted Checkout, existing customer reuse, webhook rows, billing gates, and customer/workspace mismatch rejection are confirmed.
  STRIPE_FULL_E2E_CONFIRMATION="checkout completed; existing customer reuse verified; webhook rows updated; billing gate verified; customer/workspace mismatch rejected"
  CONFIRM_STAGING_TARGET=true
  STAGING_TARGET_CONFIRMATION="staging non-production environment confirmed"

The script refuses API_ORIGIN values that do not look like staging/local/test unless CONFIRM_STAGING_TARGET=true and STAGING_TARGET_CONFIRMATION includes staging and non-production. Agent health must report mode=openai/openai_agents and selectedRuntime=openai/openai_agents before printing OPENAI_AGENT_STAGING_E2E_PASSED_AT. It never prints AUTH_TOKEN and only executes a dedicated Google Ads campaign ENABLED/PAUSED status round trip when both CHECK_GOOGLE_WRITE=true and CONFIRM_GOOGLE_WRITE=true are set; GOOGLE_WRITE_KIND=budget is rejected because budget write is provider-fake/contract-test only. GOOGLE_WRITE_ROLLBACK is sent as the API approvalNote and must include the reason, restore value, and observation window. Google status write E2E verifies write and restore audit approval metadata, then re-reads the provider live preview and requires the final status to equal GOOGLE_RESTORE_STATUS; audit rows alone cannot produce GOOGLE_ADS_STAGING_E2E_PASSED_AT. STRIPE_STAGING_E2E_PASSED_AT requires CONFIRM_STRIPE_FULL_E2E=true, complete hosted Stripe evidence confirmation, CHECK_BILLING_GATE=true, and UNPAID_AUTH_TOKEN so the script verifies authenticated 402 billing_required.`);
}
