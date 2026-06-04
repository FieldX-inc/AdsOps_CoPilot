#!/usr/bin/env node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = mkdtempSync(join(tmpdir(), "adops-env-contracts-"));
const issues = [];

try {
  const validPath = writeEnvFile("valid-production.env", validProductionEnv());
  const valid = runCheckEnv(validPath);
  if (valid.status !== 0) {
    issues.push(`valid production env should pass: ${valid.stderr || valid.stdout}`);
  }

  const missingAuthPath = writeEnvFile(
    "missing-auth-production.env",
    validProductionEnv({
      SUPABASE_AUTH_SITE_URL: "",
      SUPABASE_AUTH_REDIRECT_URLS: "",
      SUPABASE_AUTH_GOOGLE_CLIENT_ID: "",
      SUPABASE_AUTH_GOOGLE_CLIENT_SECRET: "",
    }),
  );
  const missingAuth = runCheckEnv(missingAuthPath);
  if (missingAuth.status === 0) {
    issues.push("production env missing Supabase Auth provider settings should fail");
  }
  if (!missingAuth.stderr.includes("SUPABASE_AUTH_SITE_URL") || !missingAuth.stderr.includes("SUPABASE_AUTH_REDIRECT_URLS")) {
    issues.push("missing Supabase Auth failure should name site URL and redirect URL requirements");
  }

  const reusedGooglePath = writeEnvFile(
    "reused-google-production.env",
    validProductionEnv({
      SUPABASE_AUTH_GOOGLE_CLIENT_ID: "google-ads-client-id",
      SUPABASE_AUTH_GOOGLE_CLIENT_SECRET: "google-ads-client-secret",
    }),
  );
  const reusedGoogle = runCheckEnv(reusedGooglePath);
  if (reusedGoogle.status === 0) {
    issues.push("production env reusing Google Ads OAuth credentials for app login should fail");
  }
  if (!reusedGoogle.stderr.includes("must be separate from GOOGLE_ADS_CLIENT_ID")) {
    issues.push("reused Google credential failure should name the credential separation contract");
  }

  const apiOnlyPath = writeEnvFile(
    "api-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const apiOnly = runCheckEnv(apiOnlyPath);
  if (apiOnly.status !== 0) {
    issues.push(`API production env should not require Agent-only OpenAI secrets: ${apiOnly.stderr || apiOnly.stdout}`);
  }

  const apiWithOpenAiKeyPath = writeEnvFile(
    "api-with-openai-key-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      OPENAI_API_KEY: "sk-contract-openai-key",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const apiWithOpenAiKey = runCheckEnv(apiWithOpenAiKeyPath);
  if (apiWithOpenAiKey.status === 0) {
    issues.push("API production env with Agent-owned OpenAI key should fail");
  }
  if (!apiWithOpenAiKey.stderr.includes("OPENAI_API_KEY must not be set on production API env")) {
    issues.push("API env OpenAI key failure should name Agent Service ownership");
  }

  const agentOnlyPath = writeEnvFile("agent-production.env", validAgentProductionEnv());
  const agentOnly = runCheckEnv(agentOnlyPath);
  if (agentOnly.status !== 0) {
    issues.push(`Agent production env should not require API Google/Stripe/Supabase secrets: ${agentOnly.stderr || agentOnly.stdout}`);
  }

  const agentWithApiSecretsPath = writeEnvFile(
    "agent-with-api-secrets-production.env",
    validAgentProductionEnv({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      GOOGLE_ADS_CLIENT_SECRET: "google-ads-client-secret",
      STRIPE_SECRET_KEY: "sk_live_contract",
    }),
  );
  const agentWithApiSecrets = runCheckEnv(agentWithApiSecretsPath);
  if (agentWithApiSecrets.status === 0) {
    issues.push("Agent production env with API-owned secrets should fail");
  }
  if (
    !agentWithApiSecrets.stderr.includes("SUPABASE_SERVICE_ROLE_KEY must not be set on production Agent env") ||
    !agentWithApiSecrets.stderr.includes("GOOGLE_ADS_CLIENT_SECRET must not be set on production Agent env") ||
    !agentWithApiSecrets.stderr.includes("STRIPE_SECRET_KEY must not be set on production Agent env")
  ) {
    issues.push("Agent env API secret failure should name API service ownership");
  }

  const webOnlyPath = writeEnvFile("web-production.env", validWebProductionEnv());
  const webOnly = runCheckEnv(webOnlyPath);
  if (webOnly.status !== 0) {
    issues.push(`Web production env should pass with browser-safe HTTPS URLs: ${webOnly.stderr || webOnly.stdout}`);
  }

  const httpApiOriginPath = writeEnvFile(
    "http-api-origin-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      API_PUBLIC_ORIGIN: "http://api.example.test",
      GOOGLE_ADS_REDIRECT_URI: "http://api.example.test/oauth/google/callback",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const httpApiOrigin = runCheckEnv(httpApiOriginPath);
  if (httpApiOrigin.status === 0) {
    issues.push("API production env with an HTTP public origin should fail");
  }
  if (!httpApiOrigin.stderr.includes("API_PUBLIC_ORIGIN must be an https URL")) {
    issues.push("HTTP API origin failure should require HTTPS");
  }

  const httpAgentOriginPath = writeEnvFile(
    "http-agent-origin-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      AGENT_SERVICE_URL: "http://agent.example.test",
      AGENT_SERVICE_AUDIENCE: "http://agent.example.test",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const httpAgentOrigin = runCheckEnv(httpAgentOriginPath);
  if (httpAgentOrigin.status === 0) {
    issues.push("API production env with an HTTP Agent service URL should fail");
  }
  if (!httpAgentOrigin.stderr.includes("AGENT_SERVICE_URL must be an https URL")) {
    issues.push("HTTP Agent URL failure should require HTTPS");
  }

  const httpWebEnvPath = writeEnvFile(
    "http-web-production.env",
    validWebProductionEnv({
      VITE_API_BASE_URL: "http://api.example.test",
    }),
  );
  const httpWebEnv = runCheckEnv(httpWebEnvPath);
  if (httpWebEnv.status === 0) {
    issues.push("Web production env with an HTTP API base URL should fail");
  }
  if (!httpWebEnv.stderr.includes("VITE_API_BASE_URL must be an https URL")) {
    issues.push("HTTP web API base failure should require HTTPS");
  }

  const badGoogleCallbackPath = writeEnvFile(
    "bad-google-callback-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      GOOGLE_ADS_REDIRECT_URI: "https://wrong.example.test/oauth/google/callback",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const badGoogleCallback = runCheckEnv(badGoogleCallbackPath);
  if (badGoogleCallback.status === 0) {
    issues.push("API production env with mismatched Google Ads callback should fail");
  }
  if (!badGoogleCallback.stderr.includes("GOOGLE_ADS_REDIRECT_URI must equal")) {
    issues.push("mismatched Google Ads callback failure should name the redirect URI contract");
  }

  const memoryGoogleStatePath = writeEnvFile(
    "memory-google-oauth-state-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      GOOGLE_OAUTH_STATE_STORE: "memory",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const memoryGoogleState = runCheckEnv(memoryGoogleStatePath);
  if (memoryGoogleState.status === 0) {
    issues.push("API production env using memory Google OAuth state should fail");
  }
  if (!memoryGoogleState.stderr.includes("GOOGLE_OAUTH_STATE_STORE must be db")) {
    issues.push("Google OAuth state store failure should require db-backed state in production");
  }

  const badGoogleBudgetCapPath = writeEnvFile(
    "bad-google-budget-cap-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      GOOGLE_ADS_MAX_BUDGET_AMOUNT: "0",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const badGoogleBudgetCap = runCheckEnv(badGoogleBudgetCapPath);
  if (badGoogleBudgetCap.status === 0) {
    issues.push("API production env with invalid Google Ads budget cap should fail");
  }
  if (!badGoogleBudgetCap.stderr.includes("GOOGLE_ADS_MAX_BUDGET_AMOUNT must be a positive number")) {
    issues.push("invalid Google Ads budget cap failure should name GOOGLE_ADS_MAX_BUDGET_AMOUNT");
  }

  const badTokenEncryptionKeyPath = writeEnvFile(
    "bad-token-encryption-key-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      TOKEN_ENCRYPTION_KEY: Buffer.from("too-short").toString("base64"),
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const badTokenEncryptionKey = runCheckEnv(badTokenEncryptionKeyPath);
  if (badTokenEncryptionKey.status === 0) {
    issues.push("API production env with a non-32-byte token encryption key should fail");
  }
  if (!badTokenEncryptionKey.stderr.includes("TOKEN_ENCRYPTION_KEY must be 32 bytes base64")) {
    issues.push("invalid token encryption key failure should name the 32-byte base64 contract");
  }

  const localTokenKeyIdPath = writeEnvFile(
    "local-token-key-id-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      TOKEN_ENCRYPTION_KEY_ID: "local-v1",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const localTokenKeyId = runCheckEnv(localTokenKeyIdPath);
  if (localTokenKeyId.status === 0) {
    issues.push("API production env with a local token key id should fail");
  }
  if (!localTokenKeyId.stderr.includes("TOKEN_ENCRYPTION_KEY_ID must be a production key id")) {
    issues.push("local token key id failure should name the production key id contract");
  }

  const stripeTestKeyPath = writeEnvFile(
    "stripe-test-key-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      STRIPE_SECRET_KEY: "sk_test_contract",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const stripeTestKey = runCheckEnv(stripeTestKeyPath);
  if (stripeTestKey.status === 0) {
    issues.push("API production env with a Stripe test secret key should fail");
  }
  if (!stripeTestKey.stderr.includes("STRIPE_SECRET_KEY must not be a Stripe test key")) {
    issues.push("Stripe test key failure should name the live-key contract");
  }

  const badStripeWebhookSecretPath = writeEnvFile(
    "bad-stripe-webhook-secret-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      STRIPE_WEBHOOK_SECRET: "webhook-secret",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const badStripeWebhookSecret = runCheckEnv(badStripeWebhookSecretPath);
  if (badStripeWebhookSecret.status === 0) {
    issues.push("API production env with an invalid Stripe webhook secret should fail");
  }
  if (!badStripeWebhookSecret.stderr.includes("STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret")) {
    issues.push("Stripe webhook secret failure should require whsec_");
  }

  const missingAgentAuthModePath = writeEnvFile(
    "missing-agent-auth-mode-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      AGENT_SERVICE_AUTH_MODE: "",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const missingAgentAuthMode = runCheckEnv(missingAgentAuthModePath);
  if (missingAgentAuthMode.status === 0) {
    issues.push("API production env missing Agent auth mode should fail");
  }
  if (!missingAgentAuthMode.stderr.includes("AGENT_SERVICE_AUTH_MODE")) {
    issues.push("missing Agent auth mode failure should name AGENT_SERVICE_AUTH_MODE");
  }

  const missingAgentAudiencePath = writeEnvFile(
    "missing-agent-audience-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      AGENT_SERVICE_AUDIENCE: "",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const missingAgentAudience = runCheckEnv(missingAgentAudiencePath);
  if (missingAgentAudience.status === 0) {
    issues.push("API production env missing Agent ID-token audience should fail");
  }
  if (!missingAgentAudience.stderr.includes("AGENT_SERVICE_AUDIENCE")) {
    issues.push("missing Agent audience failure should name AGENT_SERVICE_AUDIENCE");
  }

  const mismatchedAgentAudiencePath = writeEnvFile(
    "mismatched-agent-audience-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      AGENT_SERVICE_AUDIENCE: "https://wrong-agent.example.test",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const mismatchedAgentAudience = runCheckEnv(mismatchedAgentAudiencePath);
  if (mismatchedAgentAudience.status === 0) {
    issues.push("API production env with mismatched Agent ID-token audience should fail");
  }
  if (!mismatchedAgentAudience.stderr.includes("AGENT_SERVICE_AUDIENCE must match AGENT_SERVICE_URL")) {
    issues.push("mismatched Agent audience failure should name the URL/audience match contract");
  }

  const legacyAdkAliasPath = writeEnvFile(
    "legacy-adk-alias-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      ADK_AGENT_URL: "https://legacy-agent.example.test",
      USE_ADK_AGENT: "true",
      ADK_AGENT_TIMEOUT_MS: "35000",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const legacyAdkAlias = runCheckEnv(legacyAdkAliasPath);
  if (legacyAdkAlias.status === 0) {
    issues.push("API production env using legacy ADK aliases should fail");
  }
  if (!legacyAdkAlias.stderr.includes("ADK_AGENT_URL is a legacy ADK alias") || !legacyAdkAlias.stderr.includes("USE_ADK_AGENT is a legacy ADK alias")) {
    issues.push("legacy ADK alias failure should name ADK_AGENT_URL and USE_ADK_AGENT");
  }

  const geminiAgentPath = writeEnvFile(
    "gemini-agent-production.env",
    validAgentProductionEnv({
      GEMINI_API_KEY: "gemini-key",
      GOOGLE_API_KEY: "google-api-key",
      GEMINI_RUNTIME: "auto",
    }),
  );
  const geminiAgent = runCheckEnv(geminiAgentPath);
  if (geminiAgent.status === 0) {
    issues.push("Agent production env with Gemini fallback keys should fail");
  }
  if (!geminiAgent.stderr.includes("GEMINI_API_KEY must not be set") || !geminiAgent.stderr.includes("GOOGLE_API_KEY must not be set")) {
    issues.push("Gemini production Agent env failure should name Gemini/Google API keys");
  }

  const badOpenAiKeyPath = writeEnvFile(
    "bad-openai-key-production.env",
    validAgentProductionEnv({
      OPENAI_API_KEY: "openai-api-key",
    }),
  );
  const badOpenAiKey = runCheckEnv(badOpenAiKeyPath);
  if (badOpenAiKey.status === 0) {
    issues.push("Agent production env with an invalid OpenAI API key shape should fail");
  }
  if (!badOpenAiKey.stderr.includes("OPENAI_API_KEY must look like an OpenAI API key")) {
    issues.push("invalid OpenAI API key failure should name the OpenAI key shape contract");
  }

  const badEvidenceTimestampPath = writeEnvFile(
    "bad-evidence-timestamp-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      OPENAI_AGENT_STAGING_E2E_PASSED_AT: "not-a-timestamp",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const badEvidenceTimestamp = runCheckEnv(badEvidenceTimestampPath);
  if (badEvidenceTimestamp.status === 0) {
    issues.push("API production env with malformed staging E2E timestamp should fail");
  }
  if (!badEvidenceTimestamp.stderr.includes("OPENAI_AGENT_STAGING_E2E_PASSED_AT must be an ISO timestamp")) {
    issues.push("malformed staging evidence timestamp failure should name the evidence timestamp contract");
  }

  const oldGoogleEvidenceDate = new Date();
  oldGoogleEvidenceDate.setDate(oldGoogleEvidenceDate.getDate() - 8);
  const mixedEvidenceWindowPath = writeEnvFile(
    "mixed-evidence-window-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      GOOGLE_ADS_STAGING_E2E_PASSED_AT: oldGoogleEvidenceDate.toISOString(),
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const mixedEvidenceWindow = runCheckEnv(mixedEvidenceWindowPath);
  if (mixedEvidenceWindow.status === 0) {
    issues.push("API production env with staging evidence spread across different release windows should fail");
  }
  if (!mixedEvidenceWindow.stderr.includes("same release validation window")) {
    issues.push("mixed staging evidence timestamp failure should name the release validation window contract");
  }

  const placeholderPath = writeEnvFile(
    "placeholder-production.env",
    validProductionEnv({
      DEPLOY_SURFACE: "api",
      STRIPE_SECRET_KEY: "replace-with-production-stripe-secret-key",
      ADOPS_AGENT_RUNTIME: "",
      OPENAI_API_KEY: "",
      OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "",
      OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "",
      OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "",
    }),
  );
  const placeholder = runCheckEnv(placeholderPath);
  if (placeholder.status === 0) {
    issues.push("API production env with an unreplaced placeholder should fail");
  }
  if (!placeholder.stderr.includes("STRIPE_SECRET_KEY still contains a placeholder value")) {
    issues.push("placeholder failure should name the unreplaced production key");
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (issues.length) {
  console.error("Env contract check failed:");
  for (const issue of issues) console.error(`- ${issue.trim()}`);
  process.exit(1);
}

console.log("Env contract check passed.");

function writeEnvFile(name, values) {
  const path = join(tempDir, name);
  const content = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  writeFileSync(path, `${content}\n`, "utf8");
  return path;
}

function runCheckEnv(path) {
  return spawnSync(process.execPath, ["scripts/check-env.mjs", path], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: cleanProcessEnv(),
  });
}

function cleanProcessEnv() {
  const kept = {};
  for (const key of ["PATH", "HOME", "SHELL", "TMPDIR", "USER", "LOGNAME"]) {
    if (process.env[key] !== undefined) kept[key] = process.env[key];
  }
  return kept;
}

function validProductionEnv(overrides = {}) {
  const now = new Date().toISOString();
  return {
    APP_ENV: "production",
    WEB_ORIGIN: "https://app.example.test",
    API_PUBLIC_ORIGIN: "https://api.example.test",
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    SUPABASE_AUTH_SITE_URL: "https://app.example.test",
    SUPABASE_AUTH_REDIRECT_URLS: "https://app.example.test/auth/callback",
    SUPABASE_AUTH_GOOGLE_CLIENT_ID: "login-client-id",
    SUPABASE_AUTH_GOOGLE_CLIENT_SECRET: "login-client-secret",
    TOKEN_ENCRYPTION_KEY: Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
    TOKEN_ENCRYPTION_KEY_ID: "production-v1",
    GOOGLE_ADS_CLIENT_ID: "google-ads-client-id",
    GOOGLE_ADS_CLIENT_SECRET: "google-ads-client-secret",
    GOOGLE_ADS_DEVELOPER_TOKEN: "developer-token",
    GOOGLE_ADS_REDIRECT_URI: "https://api.example.test/oauth/google/callback",
    GOOGLE_OAUTH_STATE_STORE: "db",
    GOOGLE_ADS_WRITE_ENABLED: "true",
    GOOGLE_ADS_MAX_BUDGET_AMOUNT: "50000",
    STRIPE_SECRET_KEY: "sk_live_contract",
    STRIPE_PRICE_ID: "price_contract",
    STRIPE_WEBHOOK_SECRET: "whsec_contract",
    AGENT_SERVICE_URL: "https://agent.example.test",
    AGENT_SERVICE_AUTH_MODE: "google_id_token",
    AGENT_SERVICE_AUDIENCE: "https://agent.example.test",
    USE_AGENT_SERVICE: "true",
    ADOPS_AGENT_RUNTIME: "openai",
    OPENAI_API_KEY: "sk-contract-openai-key",
    OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "0",
    OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "1",
    OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "1",
    OPENAI_AGENT_STAGING_E2E_PASSED_AT: now,
    GOOGLE_ADS_STAGING_E2E_PASSED_AT: now,
    STRIPE_STAGING_E2E_PASSED_AT: now,
    DEPLOYMENT_RUNBOOK_ACK: "true",
    ...overrides,
  };
}

function validAgentProductionEnv(overrides = {}) {
  return {
    APP_ENV: "production",
    DEPLOY_SURFACE: "agent",
    ADOPS_AGENT_RUNTIME: "openai",
    OPENAI_API_KEY: "sk-contract-openai-key",
    OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "0",
    OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "1",
    OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "1",
    ...overrides,
  };
}

function validWebProductionEnv(overrides = {}) {
  return {
    DEPLOY_SURFACE: "web",
    VITE_APP_ENV: "production",
    VITE_API_BASE_URL: "https://api.example.test",
    VITE_SUPABASE_URL: "https://supabase.example.test",
    VITE_SUPABASE_ANON_KEY: "anon-key",
    ...overrides,
  };
}
