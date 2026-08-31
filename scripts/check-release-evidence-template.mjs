#!/usr/bin/env node

import { readFileSync } from "node:fs";

const templatePath = "deploy/release-evidence.template.md";
const content = readFileSync(templatePath, "utf8");
const issues = [];

const requiredSections = [
  "## Release Identity",
  "## Operator Preflight",
  "## Env And Secret Boundary",
  "## Supabase Evidence",
  "## OpenAI Agent Evidence",
  "## Google Ads Evidence",
  "## Stripe Evidence",
  "## Evidence Window",
  "## Initial Production Go Smoke",
  "## Post-Go Google Ads Write Activation Evidence",
  "## Go Decision",
];

const requiredSnippets = [
  "Do not commit real secrets",
  "npm run collect:release-evidence",
  "Collector printed `export PRODUCTION_SMOKE_PASSED_AT=...` and `export RELEASE_EVIDENCE_COLLECTED_AT=...` only after final production evidence passed",
  "non-secret health/readiness summary",
  "npm run verify",
  "npm run deploy:preflight",
  "npm run deploy:preflight -- --json",
  "overallStatus=pass",
  "docker info",
  "gcloud auth list --format=json",
  "gcloud config get-value project",
  "wrangler whoami",
  "supabase projects list",
  "stripe whoami",
  "gh auth status",
  "node scripts/check-env.mjs .env.production.api",
  "node scripts/check-env.mjs .env.production.agent",
  "node scripts/check-env.mjs .env.production.web",
  "gcloud run services add-iam-policy-binding",
  "roles/run.invoker",
  "AGENT_SERVICE_AUTH_MODE=google_id_token",
  "AGENT_SERVICE_AUDIENCE=<agent-service-url>",
  "matching `AGENT_SERVICE_URL` after trailing-slash normalization",
  "legacy ADK aliases (`ADK_AGENT_URL`, `USE_ADK_AGENT`, `ADK_AGENT_TIMEOUT_MS`)",
  "supabase/migrations/20260604_openai_google_write_stripe.sql",
  "supabase/migrations/20260715_pricing_usage_reports.sql",
  "supabase/migrations/20260716_service_role_app_schema.sql",
  "npm run e2e:supabase",
  "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
  "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
  "STRIPE_STAGING_E2E_PASSED_AT",
  "confirmed=true",
  "CONFIRM_GOOGLE_WRITE=true",
  "approvalNote",
  "[REDACTED]",
  "Authorization: Bearer",
  "client_secret=",
  "approvalType=explicit_user_confirmation",
  "approvedByUserId",
  "approvedAt",
  "/audit-logs/recent?eventTypePrefix=google_ads.",
  "STRIPE_FULL_E2E_CONFIRMATION",
  "checkout, existing customer reuse, webhook, billing gate, and customer/workspace mismatch rejection",
  "CHECK_BILLING_GATE=true",
  "UNPAID_AUTH_TOKEN",
  "Existing Stripe customer reuse sent `customer=<existing customer>` without `customer_email`",
  "Stripe customer/workspace mismatch returned `400` without mutating billing rows",
  "staging-e2e-evidence-window=pass",
  "agent-service-modern-env=pass",
  "EXPECT_PRODUCTION_READY=true npm run smoke:deploy",
  "Initial Go smoke used `AGENT_SERVICE_URL`, checked `WEB_ORIGIN` HTML/root plus JS/CSS asset references, and rejected legacy ADK aliases",
  "failed closed unless API health, Agent health, readiness `Go`, required readiness checks, and final smoke were complete",
  "PRODUCTION_SMOKE_PASSED_AT",
  "RELEASE_EVIDENCE_COLLECTED_AT",
  "RELEASE_EVIDENCE_NOTE_PATH",
  "pointed to this filled operator-owned release evidence note",
  "npm run audit:completion -- --with-verify",
  "overallStatus=complete",
  "mode=agent-proxy",
  "mediaWriteEnabled=false",
  "EXPECT_GOOGLE_ADS_WRITE_ACTIVATION=true",
  "mediaWriteEnabled=true",
  "GOOGLE_ADS_WRITE_ACTIVATION_PASSED_AT",
  "budget remained provider-fake/contract-test only",
  "audit rows alone were not used as final-state evidence",
  "billingConfigured=true",
  "supabaseConfigured=true",
  "authConfigured=true",
  "runtimeConfigured=true",
  "runtimeDiagnostics",
  "openaiApiKeyConfigured=true",
  "openaiAgentsSdkImportable=true",
  "openaiAgentsSdkAvailable=true",
  "no missing OpenAI Agents SDK symbols",
  "selectedRuntime=openai",
  "selectedRuntime=openai_agents",
  "dataSafetyConfigured=true",
  "production decision was `Go`",
  "DEPLOYMENT_RUNBOOK_ACK=true",
  "Rollback owner and rollback action",
];

let previousIndex = -1;
for (const section of requiredSections) {
  const index = content.indexOf(section);
  if (index === -1) {
    issues.push(`${templatePath}: missing section ${section}`);
    continue;
  }
  if (index < previousIndex) {
    issues.push(`${templatePath}: section order changed before ${section}`);
  }
  previousIndex = index;
}

for (const snippet of requiredSnippets) {
  if (!content.includes(snippet)) {
    issues.push(`${templatePath}: missing required release evidence field: ${snippet}`);
  }
}

if (/SECRET_KEY=.*|SERVICE_ROLE_KEY=.*|OPENAI_API_KEY=.*|AUTH_TOKEN=.*|WEBHOOK_SECRET=.*/.test(content)) {
  issues.push(`${templatePath}: template must not include secret-looking assignments`);
}

if (issues.length) {
  console.error("Release evidence template check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Release evidence template check passed.");
