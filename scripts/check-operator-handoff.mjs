#!/usr/bin/env node

import { readFileSync } from "node:fs";

const handoffPath = "deploy/operator-handoff.md";
const content = readFileSync(handoffPath, "utf8");
const issues = [];

const requiredSnippets = [
  "npm run deploy:preflight",
  "npm run deploy:preflight -- --json",
  "npm run audit:production-candidate",
  "npm run deploy:next",
  "overallStatus=pass",
  "Docker CLI",
  "Docker daemon",
  "Docker Desktop",
  "brew install --cask docker",
  "docker info",
  "Google Cloud CLI",
  "brew install --cask google-cloud-sdk",
  "gcloud auth login",
  "gcloud config set project",
  "gcloud config get-value project",
  "GCP_PROJECT",
  "EXPECTED_GCP_PROJECT",
  "requires it to match exactly",
  "Cloudflare Wrangler CLI",
  "npm install -g wrangler",
  "wrangler login",
  "wrangler whoami",
  "EXPECTED_CLOUDFLARE_ACCOUNT",
  "Supabase CLI",
  "brew install supabase/tap/supabase",
  "supabase login",
  "supabase projects list",
  "EXPECTED_SUPABASE_PROJECT_REF",
  "Stripe CLI",
  "brew install stripe/stripe-cli/stripe",
  "stripe login",
  "stripe whoami",
  "EXPECTED_STRIPE_ACCOUNT",
  "GitHub CLI",
  "gh auth status",
  "npm run verify",
  "node scripts/check-env.mjs .env.production.api .env.production.agent .env.production.web",
  '--env-vars-file="$API_ENV_FILE"',
  '--env-vars-file="$AGENT_ENV_FILE"',
  "operator-owned",
  "WEB_ENV_FILE",
  "wrangler pages deploy",
  "gcloud run services add-iam-policy-binding",
  "roles/run.invoker",
  "AGENT_SERVICE_AUTH_MODE=google_id_token",
  "AGENT_SERVICE_AUDIENCE=<agent-service-url>",
  "AGENT_SERVICE_AUDIENCE` must match `AGENT_SERVICE_URL",
  "npm run e2e:supabase",
  "requires the Supabase service role key in the operator environment",
  "supabase db push",
  "npm run e2e:staging",
  "UNPAID_AUTH_TOKEN` is required when `CONFIRM_STRIPE_FULL_E2E=true",
  "npm run e2e:stripe-webhook",
  "requires `STRIPE_WEBHOOK_SECRET` and `AUTH_TOKEN` from the operator environment",
  "npm run smoke:deploy",
  "npm run collect:release-evidence",
  "deploy/release-evidence.template.md",
  "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
  "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
  "STRIPE_STAGING_E2E_PASSED_AT",
  "CONFIRM_STAGING_TARGET",
  "STAGING_TARGET_CONFIRMATION",
  "staging non-production environment confirmed",
  "EXPECT_PRODUCTION_READY=true",
  "production decision `Go`",
  "agent-service-modern-env",
  "mode=agent-proxy",
  "mediaWriteEnabled=true",
  "billingConfigured=true",
  "supabaseConfigured=true",
  "authConfigured=true",
  "runtimeConfigured=true",
  "runtimeDiagnostics",
  "openaiApiKeyConfigured",
  "openaiAgentsSdkImportable",
  "openaiAgentsSdkAvailable",
  "missingOpenaiAgentsSymbols",
  "selectedRuntime=openai",
  "selectedRuntime=openai_agents",
  "dataSafetyConfigured=true",
  "rollback ownership",
  "ALLOW_INCOMPLETE_EVIDENCE=true",
  "customer/workspace mismatch",
  "stripe_customer_id",
];

for (const snippet of requiredSnippets) {
  if (!content.includes(snippet)) {
    issues.push(`${handoffPath}: missing required handoff contract: ${snippet}`);
  }
}

const orderedMilestones = [
  "## 1. Local Operator Tools",
  "## 2. Code And Env Contracts",
  "## 3. Supabase Evidence",
  "## 4. Staging Provider Evidence",
  "## 5. Production Smoke",
];
let previousIndex = -1;
for (const milestone of orderedMilestones) {
  const index = content.indexOf(milestone);
  if (index === -1) {
    issues.push(`${handoffPath}: missing milestone ${milestone}`);
    continue;
  }
  if (index < previousIndex) {
    issues.push(`${handoffPath}: milestone order changed before ${milestone}`);
  }
  previousIndex = index;
}

if (!/Do not treat the release as production-ready until[\s\S]*npm run deploy:preflight[\s\S]*staging E2E evidence[\s\S]*EXPECT_PRODUCTION_READY=true/.test(content)) {
  issues.push(`${handoffPath}: must explicitly block production-ready claims until preflight, staging evidence, and final production smoke pass`);
}

if (!/Google Ads write evidence[\s\S]*reversible[\s\S]*confirmed=true[\s\S]*CONFIRM_GOOGLE_WRITE=true[\s\S]*restore value different from the write value[\s\S]*approvalType=explicit_user_confirmation[\s\S]*approvedByUserId[\s\S]*approvedAt[\s\S]*audit review panel[\s\S]*GOOGLE_ADS_STAGING_E2E_PASSED_AT/.test(content)) {
  issues.push(`${handoffPath}: must preserve human-approved reversible Google Ads write evidence requirements`);
}

if (!/Stripe[\s\S]*CONFIRM_STRIPE_FULL_E2E=true[\s\S]*hosted Checkout[\s\S]*existing Stripe customer reuse[\s\S]*customer=<existing customer>[\s\S]*without `customer_email`[\s\S]*webhook[\s\S]*CHECK_BILLING_GATE=true[\s\S]*UNPAID_AUTH_TOKEN[\s\S]*billing gate/.test(content)) {
  issues.push(`${handoffPath}: must preserve full Stripe Checkout, existing customer reuse, webhook, and billing gate evidence requirements`);
}

if (!/Stripe[\s\S]*customer\/workspace mismatch[\s\S]*400[\s\S]*billing_customers[\s\S]*billing_subscriptions[\s\S]*stripe_customer_id/.test(content)) {
  issues.push(`${handoffPath}: must preserve Stripe customer/workspace mismatch rejection evidence requirements`);
}

if (!/npm run smoke:deploy[\s\S]*npm run collect:release-evidence[\s\S]*non-secret health\/readiness\/smoke summary/.test(content)) {
  issues.push(`${handoffPath}: must run release evidence collection after final smoke and describe the non-secret summary`);
}

if (!/final smoke[\s\S]*agent-service-modern-env[\s\S]*staging-e2e-evidence-window[\s\S]*all production checks pass/.test(content)) {
  issues.push(`${handoffPath}: must preserve final smoke readiness check requirements including agent-service-modern-env`);
}

if (!/final smoke[\s\S]*Agent `\/health`[\s\S]*selectedRuntime=openai[\s\S]*selectedRuntime=openai_agents[\s\S]*runtimeConfigured=true[\s\S]*dataSafetyConfigured=true/.test(content)) {
  issues.push(`${handoffPath}: must preserve Agent selectedRuntime and runtime/data-safety final smoke requirements`);
}

if (!/collect:release-evidence[\s\S]*must independently fail[\s\S]*API health[\s\S]*Agent health[\s\S]*readiness `Go`[\s\S]*required readiness checks[\s\S]*final smoke[\s\S]*ALLOW_INCOMPLETE_EVIDENCE=true/.test(content)) {
  issues.push(`${handoffPath}: must preserve collector failure behavior unless partial evidence is explicitly requested`);
}

if (!/private Cloud Run Agent Service[\s\S]*gcloud run services add-iam-policy-binding[\s\S]*roles\/run\.invoker[\s\S]*AGENT_SERVICE_AUTH_MODE=google_id_token[\s\S]*AGENT_SERVICE_AUDIENCE=<agent-service-url>[\s\S]*AGENT_SERVICE_AUDIENCE` must match `AGENT_SERVICE_URL/.test(content)) {
  issues.push(`${handoffPath}: must preserve private Agent Service IAM and google_id_token audience setup`);
}

if (/AUTH_TOKEN=|SUPABASE_SERVICE_ROLE_KEY=|STRIPE_WEBHOOK_SECRET=/.test(content)) {
  issues.push(`${handoffPath}: command examples must not include secret assignment forms; use operator env wording instead`);
}

if (issues.length) {
  console.error("Operator handoff check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Operator handoff check passed.");
