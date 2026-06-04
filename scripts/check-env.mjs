#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const defaultEnvFiles = [".env", ".env.example", "services/adk-agent/.env", "services/adk-agent/.env.example"];
const requestedEnvFiles = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const envFiles = requestedEnvFiles.length ? requestedEnvFiles : defaultEnvFiles;

const browserSafeKeys = new Set([
  "VITE_API_BASE_URL",
  "VITE_APP_ENV",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_AUTH_REDIRECT_PATH",
  "VITE_AUTH_REDIRECT_URL",
]);

const forbiddenViteMarkers = [
  "SECRET",
  "SERVICE_ROLE",
  "OPENAI",
  "STRIPE",
  "TOKEN",
  "DEVELOPER",
  "CLIENT_SECRET",
  "DB_URL",
  "DATABASE_URL",
  "PRIVATE",
  "PASSWORD",
];

const serverSecretKeys = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "TOKEN_ENCRYPTION_KEY",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "OPENAI_API_KEY",
];

const productionRequiredKeysBySurface = {
  combined: [
    "APP_ENV",
    "WEB_ORIGIN",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_AUTH_SITE_URL",
    "SUPABASE_AUTH_REDIRECT_URLS",
    "SUPABASE_AUTH_GOOGLE_CLIENT_ID",
    "SUPABASE_AUTH_GOOGLE_CLIENT_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "TOKEN_ENCRYPTION_KEY_ID",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_REDIRECT_URI",
    "GOOGLE_OAUTH_STATE_STORE",
    "GOOGLE_ADS_WRITE_ENABLED",
    "GOOGLE_ADS_MAX_BUDGET_AMOUNT",
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_ID",
    "STRIPE_WEBHOOK_SECRET",
    "API_PUBLIC_ORIGIN",
    "AGENT_SERVICE_URL",
    "AGENT_SERVICE_AUTH_MODE",
    "AGENT_SERVICE_AUDIENCE",
    "USE_AGENT_SERVICE",
    "ADOPS_AGENT_RUNTIME",
    "OPENAI_API_KEY",
    "OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA",
    "OPENAI_AGENTS_DONT_LOG_MODEL_DATA",
    "OPENAI_AGENTS_DONT_LOG_TOOL_DATA",
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
    "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
    "STRIPE_STAGING_E2E_PASSED_AT",
    "DEPLOYMENT_RUNBOOK_ACK",
  ],
  api: [
    "APP_ENV",
    "WEB_ORIGIN",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_AUTH_SITE_URL",
    "SUPABASE_AUTH_REDIRECT_URLS",
    "SUPABASE_AUTH_GOOGLE_CLIENT_ID",
    "SUPABASE_AUTH_GOOGLE_CLIENT_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "TOKEN_ENCRYPTION_KEY_ID",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_REDIRECT_URI",
    "GOOGLE_OAUTH_STATE_STORE",
    "GOOGLE_ADS_WRITE_ENABLED",
    "GOOGLE_ADS_MAX_BUDGET_AMOUNT",
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_ID",
    "STRIPE_WEBHOOK_SECRET",
    "API_PUBLIC_ORIGIN",
    "AGENT_SERVICE_URL",
    "AGENT_SERVICE_AUTH_MODE",
    "AGENT_SERVICE_AUDIENCE",
    "USE_AGENT_SERVICE",
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
    "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
    "STRIPE_STAGING_E2E_PASSED_AT",
    "DEPLOYMENT_RUNBOOK_ACK",
  ],
  agent: [
    "APP_ENV",
    "ADOPS_AGENT_RUNTIME",
    "OPENAI_API_KEY",
    "OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA",
    "OPENAI_AGENTS_DONT_LOG_MODEL_DATA",
    "OPENAI_AGENTS_DONT_LOG_TOOL_DATA",
  ],
  web: ["VITE_APP_ENV", "VITE_API_BASE_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"],
};

const productionRequiredKeys = productionRequiredKeysBySurface.combined;

const validDeploySurfaces = new Set(Object.keys(productionRequiredKeysBySurface));
const productionEvidenceKeys = [
  "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
  "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
  "STRIPE_STAGING_E2E_PASSED_AT",
];
const legacyAgentApiKeys = ["ADK_AGENT_URL", "USE_ADK_AGENT", "ADK_AGENT_TIMEOUT_MS"];
const productionGeminiAgentKeys = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_RUNTIME",
  "GEMINI_TIMEOUT_SECONDS",
  "GEMINI_REST_SHORT_MAX_OUTPUT_TOKENS",
  "GEMINI_REST_LIGHT_MAX_OUTPUT_TOKENS",
  "GEMINI_REST_MAX_OUTPUT_TOKENS",
];
const apiForbiddenAgentKeys = [
  "OPENAI_API_KEY",
  "OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA",
  "OPENAI_AGENTS_DONT_LOG_MODEL_DATA",
  "OPENAI_AGENTS_DONT_LOG_TOOL_DATA",
];
const agentForbiddenApiKeys = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "TOKEN_ENCRYPTION_KEY",
  "TOKEN_ENCRYPTION_KEY_ID",
  "SUPABASE_AUTH_GOOGLE_CLIENT_SECRET",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_REDIRECT_URI",
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
  "AGENT_SERVICE_URL",
  "AGENT_SERVICE_AUTH_TOKEN",
];
const maxEvidenceAgeMs = 90 * 24 * 60 * 60 * 1000;
const maxEvidenceSpreadMs = 7 * 24 * 60 * 60 * 1000;
const productionPlaceholderPattern = /^(replace-with-|your-|example-|placeholder$)/i;

const issues = [];
const loadedFiles = [];
const merged = { ...process.env };
let inspectedSurfaceFile = false;

for (const envFile of envFiles) {
  const path = resolve(envFile);
  if (!existsSync(path)) continue;
  loadedFiles.push(envFile);
  const parsed = parseEnvFile(readFileSync(path, "utf8"), envFile);
  for (const [key, value] of Object.entries(parsed)) {
    if (merged[key] === undefined) merged[key] = value;
  }
  inspectEnvObject(parsed, envFile);
  const inferredSurface = inferDeploySurface(parsed, envFile);
  if (inferredSurface) {
    inspectedSurfaceFile = true;
    inspectProductionReadiness({ ...parsed, DEPLOY_SURFACE: inferredSurface }, envFile);
  }
}

inspectEnvObject(process.env, "process.env");
if (!inspectedSurfaceFile) {
  inspectProductionReadiness(merged, "merged env");
}

if (issues.length) {
  console.error("Env check failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

const fileSummary = loadedFiles.length ? loadedFiles.join(", ") : "no env files found";
console.log(`Env check passed (${fileSummary}).`);

function parseEnvFile(content, source) {
  const result = {};
  const lines = content.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      issues.push(`${source}:${index + 1} is not KEY=value format`);
      continue;
    }
    const [, key, rawValue] = match;
    result[key] = stripQuotes(rawValue.trim());
  }
  return result;
}

function inferDeploySurface(env, source) {
  if (env.DEPLOY_SURFACE) return String(env.DEPLOY_SURFACE).toLowerCase();
  if (source.includes("cloudflare-pages.env")) return "web";
  return "";
}

function stripQuotes(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function inspectEnvObject(env, source) {
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("VITE_")) {
      inspectBrowserKey(key, value ?? "", source);
    }
  }
  for (const key of serverSecretKeys) {
    if (`VITE_${key}` in env) {
      issues.push(`${source}: VITE_${key} must not exist; keep ${key} server-side only`);
    }
  }
}

function inspectBrowserKey(key, value, source) {
  if (browserSafeKeys.has(key)) {
    if (key === "VITE_SUPABASE_ANON_KEY" && /service[_-]?role/i.test(value)) {
      issues.push(`${source}: ${key} appears to contain a service role key`);
    }
    return;
  }
  if (forbiddenViteMarkers.some((marker) => key.includes(marker))) {
    issues.push(`${source}: ${key} is not browser-safe`);
  }
}

function inspectProductionReadiness(env, source = "production env") {
  const appEnv = String(env.APP_ENV ?? "local").toLowerCase();
  const deploySurface = String(env.DEPLOY_SURFACE ?? "combined").toLowerCase();
  if (!validDeploySurfaces.has(deploySurface)) {
    issues.push(`${source}: DEPLOY_SURFACE must be one of ${Array.from(validDeploySurfaces).join(", ")}`);
    return;
  }
  if (deploySurface === "web") {
    inspectWebProductionEnv(env);
    return;
  }
  if (appEnv !== "production") return;

  const requiredKeys = productionRequiredKeysBySurface[deploySurface] ?? productionRequiredKeys;
  for (const key of requiredKeys) {
    const value = String(env[key] ?? "").trim();
    if (!value) {
      issues.push(`${source}: ${key} is required`);
    } else if (looksPlaceholder(value)) {
      issues.push(`${source}: ${key} still contains a placeholder value`);
    }
  }

  if (deploySurface === "api" || deploySurface === "combined") {
    inspectApiProductionEnv(env, deploySurface);
  }
  if (deploySurface === "agent" || deploySurface === "combined") {
    inspectAgentProductionEnv(env, deploySurface);
  }
}

function inspectApiProductionEnv(env, deploySurface) {
  if (deploySurface === "api") {
    rejectPresentKeys(env, apiForbiddenAgentKeys, "production API env", "belong to the Agent Service env");
  }
  for (const key of ["WEB_ORIGIN", "API_PUBLIC_ORIGIN", "AGENT_SERVICE_URL", "SUPABASE_URL"]) {
    if (!isHttpsUrl(env[key])) {
      issues.push(`production env: ${key} must be an https URL`);
    }
  }
  for (const key of legacyAgentApiKeys) {
    if (String(env[key] ?? "").trim()) {
      issues.push(`production env: ${key} is a legacy ADK alias; use AGENT_SERVICE_* and USE_AGENT_SERVICE instead`);
    }
  }
  if (env.USE_AGENT_SERVICE !== "true") {
    issues.push("production env: USE_AGENT_SERVICE must be true");
  }
  if (!["none", "bearer", "google_id_token"].includes(String(env.AGENT_SERVICE_AUTH_MODE ?? "").toLowerCase())) {
    issues.push("production env: AGENT_SERVICE_AUTH_MODE must be none, bearer, or google_id_token");
  }
  if (env.AGENT_SERVICE_AUTH_MODE === "bearer" && !String(env.AGENT_SERVICE_AUTH_TOKEN ?? "").trim()) {
    issues.push("production env: AGENT_SERVICE_AUTH_TOKEN is required when AGENT_SERVICE_AUTH_MODE=bearer");
  }
  if (env.AGENT_SERVICE_AUTH_MODE === "google_id_token" && !String(env.AGENT_SERVICE_AUDIENCE ?? "").trim()) {
    issues.push("production env: AGENT_SERVICE_AUDIENCE is required when AGENT_SERVICE_AUTH_MODE=google_id_token");
  }
  if (
    env.AGENT_SERVICE_AUTH_MODE === "google_id_token" &&
    String(env.AGENT_SERVICE_AUDIENCE ?? "").trim() &&
    stripTrailingSlash(env.AGENT_SERVICE_AUDIENCE) !== stripTrailingSlash(env.AGENT_SERVICE_URL)
  ) {
    issues.push("production env: AGENT_SERVICE_AUDIENCE must match AGENT_SERVICE_URL when AGENT_SERVICE_AUTH_MODE=google_id_token");
  }
  if (String(env.AGENT_SERVICE_URL ?? "").match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/)) {
    issues.push("production env: AGENT_SERVICE_URL must not point to localhost");
  }
  if (String(env.API_PUBLIC_ORIGIN ?? "").match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/)) {
    issues.push("production env: API_PUBLIC_ORIGIN must not point to localhost");
  }
  if (String(env.WEB_ORIGIN ?? "").match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/)) {
    issues.push("production env: WEB_ORIGIN must not point to localhost");
  }
  if (stripTrailingSlash(env.SUPABASE_AUTH_SITE_URL) !== stripTrailingSlash(env.WEB_ORIGIN)) {
    issues.push("production env: SUPABASE_AUTH_SITE_URL must match WEB_ORIGIN");
  }
  if (env.GOOGLE_ADS_WRITE_ENABLED === "true") {
    const maxBudgetAmount = Number(env.GOOGLE_ADS_MAX_BUDGET_AMOUNT);
    if (!Number.isFinite(maxBudgetAmount) || maxBudgetAmount <= 0) {
      issues.push("production env: GOOGLE_ADS_MAX_BUDGET_AMOUNT must be a positive number when GOOGLE_ADS_WRITE_ENABLED=true");
    }
  }
  if (!isBase64Bytes(env.TOKEN_ENCRYPTION_KEY, 32)) {
    issues.push("production env: TOKEN_ENCRYPTION_KEY must be 32 bytes base64");
  }
  if (!isProductionTokenKeyId(env.TOKEN_ENCRYPTION_KEY_ID)) {
    issues.push("production env: TOKEN_ENCRYPTION_KEY_ID must be a production key id and must not be local/test");
  }
  if (String(env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_") || String(env.STRIPE_SECRET_KEY ?? "").startsWith("rk_test_")) {
    issues.push("production env: STRIPE_SECRET_KEY must not be a Stripe test key");
  }
  if (!String(env.STRIPE_PRICE_ID ?? "").startsWith("price_")) {
    issues.push("production env: STRIPE_PRICE_ID must be a Stripe price id");
  }
  if (!String(env.STRIPE_WEBHOOK_SECRET ?? "").startsWith("whsec_")) {
    issues.push("production env: STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret");
  }
  const expectedAuthCallback = `${stripTrailingSlash(env.WEB_ORIGIN)}/auth/callback`;
  const redirectUrls = splitEnvList(env.SUPABASE_AUTH_REDIRECT_URLS).map(stripTrailingSlash);
  if (!redirectUrls.includes(expectedAuthCallback)) {
    issues.push("production env: SUPABASE_AUTH_REDIRECT_URLS must include <WEB_ORIGIN>/auth/callback");
  }
  if (env.SUPABASE_AUTH_GOOGLE_CLIENT_ID && env.SUPABASE_AUTH_GOOGLE_CLIENT_ID === env.GOOGLE_ADS_CLIENT_ID) {
    issues.push("production env: SUPABASE_AUTH_GOOGLE_CLIENT_ID must be separate from GOOGLE_ADS_CLIENT_ID");
  }
  if (env.SUPABASE_AUTH_GOOGLE_CLIENT_SECRET && env.SUPABASE_AUTH_GOOGLE_CLIENT_SECRET === env.GOOGLE_ADS_CLIENT_SECRET) {
    issues.push("production env: SUPABASE_AUTH_GOOGLE_CLIENT_SECRET must be separate from GOOGLE_ADS_CLIENT_SECRET");
  }
  if (env.GOOGLE_ADS_WRITE_ENABLED !== "true") {
    issues.push("production env: GOOGLE_ADS_WRITE_ENABLED must be true after staging write E2E passes");
  }
  if (stripTrailingSlash(env.GOOGLE_ADS_REDIRECT_URI) !== `${stripTrailingSlash(env.API_PUBLIC_ORIGIN)}/oauth/google/callback`) {
    issues.push("production env: GOOGLE_ADS_REDIRECT_URI must equal <API_PUBLIC_ORIGIN>/oauth/google/callback");
  }
  if (env.GOOGLE_OAUTH_STATE_STORE !== "db") {
    issues.push("production env: GOOGLE_OAUTH_STATE_STORE must be db");
  }
  if (env.DEPLOYMENT_RUNBOOK_ACK !== "true") {
    issues.push("production env: DEPLOYMENT_RUNBOOK_ACK must be true after staging URLs, env ownership, and logs are documented");
  }
  inspectEvidenceTimestamps(env);
}

function inspectAgentProductionEnv(env, deploySurface) {
  if (deploySurface === "agent") {
    rejectPresentKeys(env, agentForbiddenApiKeys, "production Agent env", "belong to the API service env");
  }
  for (const key of productionGeminiAgentKeys) {
    if (String(env[key] ?? "").trim()) {
      issues.push(`production env: ${key} must not be set on the production OpenAI Agent Service`);
    }
  }
  if (!["openai", "openai_agents"].includes(String(env.ADOPS_AGENT_RUNTIME ?? "").toLowerCase())) {
    issues.push("production env: ADOPS_AGENT_RUNTIME must be openai");
  }
  if (!String(env.OPENAI_API_KEY ?? "").startsWith("sk-")) {
    issues.push("production env: OPENAI_API_KEY must look like an OpenAI API key");
  }
  if (env.OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA !== "0") {
    issues.push("production env: OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA must be 0");
  }
  if (env.OPENAI_AGENTS_DONT_LOG_MODEL_DATA !== "1") {
    issues.push("production env: OPENAI_AGENTS_DONT_LOG_MODEL_DATA must be 1");
  }
  if (env.OPENAI_AGENTS_DONT_LOG_TOOL_DATA !== "1") {
    issues.push("production env: OPENAI_AGENTS_DONT_LOG_TOOL_DATA must be 1");
  }
}

function inspectWebProductionEnv(env) {
  const requiredKeys = productionRequiredKeysBySurface.web;
  for (const key of requiredKeys) {
    const value = String(env[key] ?? "").trim();
    if (!value) {
      issues.push(`production env: ${key} is required`);
    } else if (looksPlaceholder(value)) {
      issues.push(`production env: ${key} still contains a placeholder value`);
    }
  }
  for (const key of ["VITE_API_BASE_URL", "VITE_SUPABASE_URL"]) {
    if (!isHttpsUrl(env[key])) {
      issues.push(`production env: ${key} must be an https URL`);
    }
  }
}

function looksPlaceholder(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return false;
  return productionPlaceholderPattern.test(normalized) || normalized.includes("replace-with-");
}

function inspectEvidenceTimestamps(env) {
  const now = Date.now();
  const parsedEvidence = [];
  for (const key of productionEvidenceKeys) {
    const value = String(env[key] ?? "").trim();
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      issues.push(`production env: ${key} must be an ISO timestamp`);
      continue;
    }
    if (parsed > now + 24 * 60 * 60 * 1000) {
      issues.push(`production env: ${key} must not be more than 24 hours in the future`);
    }
    if (now - parsed > maxEvidenceAgeMs) {
      issues.push(`production env: ${key} must be refreshed within 90 days of production release`);
    }
    parsedEvidence.push({ key, parsed });
  }

  if (parsedEvidence.length === productionEvidenceKeys.length) {
    const oldest = parsedEvidence.reduce((current, candidate) => (candidate.parsed < current.parsed ? candidate : current));
    const newest = parsedEvidence.reduce((current, candidate) => (candidate.parsed > current.parsed ? candidate : current));
    if (newest.parsed - oldest.parsed > maxEvidenceSpreadMs) {
      issues.push(
        `production env: staging E2E evidence timestamps must be from the same release validation window (${oldest.key} and ${newest.key} differ by more than 7 days)`,
      );
    }
  }
}

function splitEnvList(value) {
  return String(value ?? "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripTrailingSlash(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function isHttpsUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isBase64Bytes(value, expectedByteLength) {
  const text = String(value ?? "").trim();
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false;
  try {
    return Buffer.from(text, "base64").length === expectedByteLength;
  } catch {
    return false;
  }
}

function isProductionTokenKeyId(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(text)) return false;
  return !/(^|[-_.])(local|test|dev|demo)([-_.]|$)/.test(text);
}

function rejectPresentKeys(env, keys, label, reason) {
  for (const key of keys) {
    if (String(env[key] ?? "").trim()) {
      issues.push(`production env: ${key} must not be set on ${label}; ${reason}`);
    }
  }
}
