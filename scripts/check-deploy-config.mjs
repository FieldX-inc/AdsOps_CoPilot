#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const issues = [];

const files = {
  readme: "deploy/README.md",
  checklist: "deploy/production-readiness-checklist.md",
  releaseEvidence: "deploy/release-evidence.template.md",
  workflow: ".github/workflows/verify.yml",
  web: "deploy/cloudflare-pages.env.example",
  api: "deploy/cloud-run-api.env.example",
  agent: "deploy/cloud-run-agent.env.example",
  productionWeb: "deploy/production-cloudflare-pages.env.example",
  productionApi: "deploy/production-cloud-run-api.env.example",
  productionAgent: "deploy/production-cloud-run-agent.env.example",
};

for (const file of Object.values(files)) {
  if (!existsSync(file)) issues.push(`missing ${file}`);
}

if (!issues.length) {
  const web = parseEnv(files.web);
  const api = parseEnv(files.api);
  const agent = parseEnv(files.agent);
  const productionWeb = parseEnv(files.productionWeb);
  const productionApi = parseEnv(files.productionApi);
  const productionAgent = parseEnv(files.productionAgent);

  const webKeys = [
    "VITE_API_BASE_URL",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_AUTH_REDIRECT_PATH",
  ];
  expectKeys(files.web, web, webKeys);
  expectKeys(files.productionWeb, productionWeb, ["VITE_APP_ENV", ...webKeys]);
  rejectKeyMarkers(files.web, web, [
    "SECRET",
    "SERVICE_ROLE",
    "OPENAI",
    "STRIPE",
    "TOKEN",
    "DEVELOPER",
    "CLIENT_SECRET",
    "DATABASE",
    "DB_URL",
  ]);
  rejectKeyMarkers(files.productionWeb, productionWeb, [
    "SECRET",
    "SERVICE_ROLE",
    "OPENAI",
    "STRIPE",
    "TOKEN",
    "DEVELOPER",
    "CLIENT_SECRET",
    "DATABASE",
    "DB_URL",
  ]);

  const apiKeys = [
    "APP_ENV",
    "WEB_ORIGIN",
    "API_PUBLIC_ORIGIN",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TOKEN_ENCRYPTION_KEY",
    "TOKEN_ENCRYPTION_KEY_ID",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_REDIRECT_URI",
    "GOOGLE_ADS_WRITE_ENABLED",
    "GOOGLE_ADS_MAX_BUDGET_AMOUNT",
    "STRIPE_API_KEY",
    "BILLING_PLANS_JSON",
    "STRIPE_WEBHOOK_SECRET",
    "PREMIUM_ONBOARDING_BOOKING_URL",
    "MODEL_COST_CATALOG_JSON",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_EMAIL_API_TOKEN",
    "REPORT_EMAIL_DOMAIN",
    "NOTIFICATION_SIGNING_SECRET",
    "AGENT_SERVICE_URL",
    "AGENT_SERVICE_AUTH_MODE",
    "AGENT_SERVICE_AUDIENCE",
    "USE_AGENT_SERVICE",
  ];
  expectKeys(files.api, api, apiKeys);
  expectKeys(files.productionApi, productionApi, apiKeys);
  expectValues(files.productionApi, productionApi, {
    APP_ENV: "production",
    DEPLOY_SURFACE: "api",
    GOOGLE_ADS_WRITE_ENABLED: "false",
    GOOGLE_ADS_MAX_BUDGET_AMOUNT: "50000",
    USE_AGENT_SERVICE: "true",
    AGENT_SERVICE_AUTH_MODE: "google_id_token",
    DEPLOYMENT_RUNBOOK_ACK: "true",
  });
  expectKeys(files.productionApi, productionApi, [
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
    "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
    "STRIPE_STAGING_E2E_PASSED_AT",
    "SUPABASE_STAGING_E2E_PASSED_AT",
    "REPORT_EMAIL_STAGING_E2E_PASSED_AT",
  ]);

  const agentKeys = [
    "APP_ENV",
    "ADOPS_AGENT_RUNTIME",
    "OPENAI_API_KEY",
    "OPENAI_AGENTS_MODEL",
    "OPENAI_AGENTS_TIMEOUT_SECONDS",
    "OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA",
    "OPENAI_AGENTS_DONT_LOG_MODEL_DATA",
    "OPENAI_AGENTS_DONT_LOG_TOOL_DATA",
  ];
  expectKeys(files.agent, agent, agentKeys);
  expectKeys(files.productionAgent, productionAgent, agentKeys);
  expectValues(files.productionAgent, productionAgent, {
    APP_ENV: "production",
    DEPLOY_SURFACE: "agent",
    ADOPS_AGENT_RUNTIME: "openai",
    OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA: "0",
    OPENAI_AGENTS_DONT_LOG_MODEL_DATA: "1",
    OPENAI_AGENTS_DONT_LOG_TOOL_DATA: "1",
  });

  const readme = readFileSync(files.readme, "utf8");
  for (const snippet of [
    "Cloudflare Pages",
    "Cloud Run API",
    "Cloud Run Agent",
    "npm run deploy:preflight",
    "npm run check:goal",
    "npm run e2e:supabase",
    "Supabase migrations",
    "supabase db push",
    "npm run e2e:staging",
    "npm run smoke:deploy",
    "--env-vars-file",
    "operator-owned env file",
    "mode=agent-proxy",
    "mediaWriteEnabled=false",
    "mediaWriteEnabled=true",
    "EXPECT_GOOGLE_ADS_WRITE_ACTIVATION=true",
    "billingConfigured=true",
    "authConfigured=true",
    "roles/run.invoker",
    "AGENT_SERVICE_AUTH_MODE=google_id_token",
    "AGENT_SERVICE_AUDIENCE=<agent-service-url>",
  ]) {
    if (!readme.includes(snippet)) issues.push(`${files.readme}: missing "${snippet}"`);
  }

  const checklist = readFileSync(files.checklist, "utf8");
  for (const snippet of [
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
    "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
    "STRIPE_STAGING_E2E_PASSED_AT",
    "DEPLOYMENT_RUNBOOK_ACK",
    "EXPECT_PRODUCTION_READY=true",
    "EXPECT_GOOGLE_ADS_WRITE_ACTIVATION=true",
    "GOOGLE_ADS_WRITE_ENABLED=false",
    "GOOGLE_WRITE_KIND=budget",
    "provider live preview",
    "npm run deploy:preflight",
    "npm run e2e:supabase",
    "supabase link --project-ref",
    "supabase db push",
    "npm run e2e:staging",
    "npm run e2e:stripe-webhook",
    "npm run smoke:deploy",
    "--env-vars-file",
    "WEB_ENV_FILE",
    "roles/run.invoker",
    "AGENT_SERVICE_AUDIENCE=<agent-service-url>",
    "approvalNote",
    "[REDACTED]",
    "client_secret=",
  ]) {
    if (!checklist.includes(snippet)) issues.push(`${files.checklist}: missing "${snippet}"`);
  }

  const releaseEvidence = readFileSync(files.releaseEvidence, "utf8");
  for (const snippet of [
    "Release Evidence Template",
    "npm run deploy:preflight",
    "npm run e2e:supabase",
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
    "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
    "STRIPE_STAGING_E2E_PASSED_AT",
    "staging-e2e-evidence-window=pass",
    "npm run collect:release-evidence",
    "non-secret health/readiness summary",
    "EXPECT_PRODUCTION_READY=true npm run smoke:deploy",
    "EXPECT_GOOGLE_ADS_WRITE_ACTIVATION=true npm run smoke:deploy",
    "mediaWriteEnabled=false",
    "mediaWriteEnabled=true",
    "Rollback owner and rollback action",
    "roles/run.invoker",
    "AGENT_SERVICE_AUTH_MODE=google_id_token",
    "AGENT_SERVICE_AUDIENCE=<agent-service-url>",
  ]) {
    if (!releaseEvidence.includes(snippet)) issues.push(`${files.releaseEvidence}: missing "${snippet}"`);
  }

  const workflow = readFileSync(files.workflow, "utf8");
  for (const snippet of [
    "npm run verify",
    "npm run check:goal",
    "docker build -f apps/api/Dockerfile -t adops-api:verify .",
    "docker build -f services/adk-agent/Dockerfile -t adops-agent:verify .",
  ]) {
    if (!workflow.includes(snippet)) issues.push(`${files.workflow}: missing "${snippet}"`);
  }
}

if (issues.length) {
  console.error("Deploy config check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Deploy config check passed.");

function parseEnv(file) {
  const result = {};
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      issues.push(`${file}:${index + 1} is not KEY=value format`);
      continue;
    }
    result[match[1]] = match[2];
  }
  return result;
}

function expectKeys(file, env, keys) {
  for (const key of keys) {
    if (!(key in env)) issues.push(`${file}: missing ${key}`);
  }
}

function expectValues(file, env, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (env[key] !== value) issues.push(`${file}: expected ${key}=${value}`);
  }
}

function rejectKeyMarkers(file, env, markers) {
  for (const key of Object.keys(env)) {
    if (!key.startsWith("VITE_")) {
      issues.push(`${file}: ${key} is not a browser env key`);
      continue;
    }
    for (const marker of markers) {
      if (key.includes(marker)) {
        issues.push(`${file}: ${key} must not be configured in Cloudflare Pages`);
      }
    }
  }
}
