#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const issues = [];

const files = {
  readme: "README.md",
  packageJson: "package.json",
  api: "apps/api/src/index.ts",
  apiTests: "apps/api/src/index.test.ts",
  googleAds: "apps/api/src/google-ads.ts",
  web: "apps/web/src/main.tsx",
  runtime: "services/adk-agent/ad_ops_advisor/runtime.py",
  chatRuntime: "services/adk-agent/ad_ops_advisor/chat_runtime.py",
  openaiRuntime: "services/adk-agent/ad_ops_advisor/openai_agents_runtime.py",
  router: "services/adk-agent/ad_ops_advisor/conversation_router.py",
  qaGate: "services/adk-agent/ad_ops_advisor/qa_gate.py",
  agentTests: "services/adk-agent/tests/test_openai_agents_runtime.py",
  httpServerTests: "services/adk-agent/tests/test_http_server.py",
  routerTests: "services/adk-agent/tests/test_conversation_router.py",
  behaviorTests: "services/adk-agent/tests/test_behavior_evals.py",
  routingEval: "services/adk-agent/ad_ops_advisor/evals/routing_contract.test.json",
  promptContextEval: "services/adk-agent/ad_ops_advisor/evals/prompt_context_safety.test.json",
  qaGateEval: "services/adk-agent/ad_ops_advisor/evals/qa_gate_behavior.test.json",
  migration: "supabase/migrations/20260604_openai_google_write_stripe.sql",
  agentReadme: "services/adk-agent/README.md",
  agentDesign: "docs/adk-design.md",
  environmentDocs: "docs/environment.md",
  deployment: "docs/deployment.md",
  checklist: "deploy/production-readiness-checklist.md",
  operatorHandoff: "deploy/operator-handoff.md",
  handoffTasks: "docs/pre-saas-implementation-tasks.md",
  dockerChecks: "scripts/check-dockerfiles.mjs",
  smokeDeploy: "scripts/smoke-deploy.mjs",
  smokeContracts: "scripts/check-smoke-deploy-contracts.mjs",
  deployPreflight: "scripts/deploy-preflight.mjs",
  deployPreflightContracts: "scripts/check-deploy-preflight-contracts.mjs",
  operatorPrereqNote: "scripts/operator-prereq-note.mjs",
  operatorPrereqNoteContracts: "scripts/check-operator-prereq-note-contracts.mjs",
  deployNext: "scripts/deploy-next-actions.mjs",
  deployNextContracts: "scripts/check-deploy-next-actions-contracts.mjs",
  deployCommands: "scripts/deploy-command-plan.mjs",
  deployCommandsContracts: "scripts/check-deploy-command-plan-contracts.mjs",
  productionCandidateAudit: "scripts/production-candidate-audit.mjs",
  productionCandidateAuditContracts: "scripts/check-production-candidate-audit-contracts.mjs",
  completionAudit: "scripts/completion-audit.mjs",
  completionAuditContracts: "scripts/check-completion-audit-contracts.mjs",
  completionEvidenceNote: "scripts/completion-evidence-note.mjs",
  completionEvidenceNoteContracts: "scripts/check-completion-evidence-note-contracts.mjs",
  envCheck: "scripts/check-env.mjs",
  envContracts: "scripts/check-env-contracts.mjs",
  releaseEvidenceCollector: "scripts/collect-release-evidence.mjs",
  releaseEvidenceCollectorContracts: "scripts/check-release-evidence-collector-contracts.mjs",
  releaseEvidenceTemplate: "deploy/release-evidence.template.md",
  stagingE2e: "scripts/staging-e2e.mjs",
  stagingE2eContracts: "scripts/check-staging-e2e-contracts.mjs",
  productionApiEnv: "deploy/production-cloud-run-api.env.example",
  productionAgentEnv: "deploy/production-cloud-run-agent.env.example",
  productionWebEnv: "deploy/production-cloudflare-pages.env.example",
};

for (const [label, file] of Object.entries(files)) {
  if (!existsSync(file)) issues.push(`${label}: missing ${file}`);
}

if (!issues.length) {
  const sources = Object.fromEntries(Object.entries(files).map(([label, file]) => [label, readFileSync(file, "utf8")]));

  expectIncludes("README production candidate summary", sources.readme, [
    "Google Ads OAuth / read / sync / 承認付きcampaign status・budget write",
    "OpenAI Agent Service",
    "Stripe billing",
    "production goal audit / smoke / staging-E2E contract / release-evidence contract",
    "npm run audit:production-candidate",
    "npm run audit:completion",
    "npm run audit:completion-note",
    "npm run deploy:prereq-note",
    "npm run deploy:preflight -- --json",
    "npm run deploy:next",
    "npm run deploy:commands -- --target=staging",
    "npm run deploy:commands -- --target=production",
    "-- --with-verify",
  ]);
  expectExcludes("README stale implementation summary", sources.readme, [
    "媒体OAuthと実データ連携は後続フェーズ",
  ]);

  expectIncludes("OpenAI Agent runtime", sources.runtime, [
    "ADOPS_AGENT_RUNTIME",
    "openai",
    "APP_ENV",
    "is_production_env",
    "Production Agent Service requires ADOPS_AGENT_RUNTIME=openai",
    "is_openai_agents_configured",
    "generate_openai_agents_response",
  ]);
  expectIncludes("OpenAI chat runtime dispatch", sources.chatRuntime, [
    "is_agent_runtime_configured",
    "generate_agent_response",
    "OpenAI Agent runtime",
    "agent_api_persistence",
    "agent_demo",
  ]);
  expectExcludes("OpenAI chat runtime dispatch", sources.chatRuntime, [
    "is_gemini_configured",
    "generate_advisor_response",
    "GeminiRuntimeError",
    "gemini_api_persistence",
    "gemini_demo",
  ]);
  expectIncludes("OpenAI Agent prompts/tools/QA", sources.openaiRuntime, [
    "Agents SDK",
    "is_openai_agents_sdk_available",
    "openai_agents_configuration_status",
    "openaiApiKeyConfigured",
    "openaiAgentsSdkAvailable",
    "missingOpenaiAgentsSymbols",
    "_prompt",
    "qa_agent",
    "OAuth token",
    "GOOGLE_ADS_WRITE_ENABLED=true",
  ]);
  expectIncludes("beginner/expert routing", sources.router, [
    "advisorMode",
    "beginner",
    "experienced",
    "build_route_plan",
  ]);
  expectIncludes("agent behavior tests", sources.behaviorTests, ["EVAL_DIR.glob", "SUPPORTED_RUNNERS", "openai_orchestration"]);
  expectIncludes("routing eval", sources.routingEval, ["route_plan", "diagnosis_with_evidence", "budget_learning_agent"]);
  expectIncludes("prompt context eval", sources.promptContextEval, ["prompt_context", "refresh_token", "access_token_encrypted"]);
  expectIncludes("QA gate eval", sources.qaGateEval, ["qa_gate", "Authorization: Bearer", "pk-test-dummy", "AIzaSyDummy", "overconfident_claim_tempered"]);
  expectIncludes("OpenAI runtime tests", sources.agentTests, [
    "OpenAI",
    "qa_review",
    "GOOGLE_ADS_WRITE_ENABLED=true",
    "test_openai_agents_configuration_status_names_missing_sdk_symbols",
    "test_production_agent_runtime_rejects_non_openai_runtime",
    "ADOPS_AGENT_RUNTIME=openai",
  ]);
  expectIncludes("QA gate tests", sources.qaGate, ["sk|pk|rk", "aiza"]);
  expectIncludes("Agent health tests", sources.httpServerTests, [
    "test_http_health_reports_openai_runtime_and_data_safety",
    "test_http_health_does_not_report_openai_runtime_when_sdk_is_missing",
    "test_http_health_fails_closed_in_production_when_runtime_is_missing",
    "test_http_health_fails_closed_in_production_when_data_safety_is_missing",
    "runtimeDiagnostics",
  ]);
  expectIncludes("router tests", sources.routerTests, ["beginner", "experienced"]);

  expectIncludes("Google Ads read/write API", sources.api, [
    "/oauth/google/start-url",
    "/google/customers",
    "/campaigns/:campaignId/status",
    "/campaigns/:campaignId/budget",
    "requireBillingAccess",
    "approvalNote",
    "hasRollbackCondition",
  ]);
  expectIncludes("Google Ads write implementation", sources.googleAds, [
    "updateGoogleCampaignStatus",
    "updateGoogleCampaignBudget",
    "GoogleAdsWriteError",
    "refreshGoogleAccessToken",
    "getConnectedAdAccount",
    "readPlatformConnectionTokens",
    "GOOGLE_ADS_WRITE_ENABLED",
    "GOOGLE_ADS_MAX_BUDGET_AMOUNT",
    "approvalNote",
    "approvalType",
    "approvedByUserId",
    "approvedAt",
    "Google Ads customer list取得に失敗しました: ${redact",
    "Google OAuth token exchangeに失敗しました: ${redact",
    "google_ads.oauth_connected",
    "google_ads.oauth_token_refreshed",
    "google_ads.campaign_status_updated",
    "google_ads.campaign_status_update_failed",
    "google_ads.campaign_budget_updated",
    "google_ads.campaign_budget_update_failed",
  ]);
  expectIncludes("Google Ads write tests", sources.apiTests, [
    "google oauth callback stores encrypted tokens and audits connection without secrets",
    "google customer list provider errors are redacted before API response",
    "google ads campaign write requires approval note for auditability",
    "google ads campaign write requires rollback condition in approval note",
    "google ads campaign write requires connected customer in workspace",
    "assert.equal(res.status, 503)",
    "google ads campaign status write calls mutate only after explicit approval",
    "google ads campaign status write audits provider failures without secrets",
    "explicit_user_confirmation",
    "approvedByUserId",
    "approvedAt",
    "google ads campaign status write rejects non-reversible REMOVED status",
    "google ads campaign write refreshes expired access tokens before mutation",
    "google_ads.oauth_token_refreshed",
    "google ads campaign budget write resolves budget resource and audits execution",
    "google ads campaign budget write rejects amounts above the configured safety cap",
  ]);
  expectIncludes("Google Ads web write UI", sources.web, [
    "read-write-after-human-approval",
    "hasRollbackCondition(approvalNote)",
    "approvalNote }",
    "AI提案を確認した後",
  ]);

  expectIncludes("Stripe API and login gate", sources.api, [
    "/billing/status",
    "/billing/checkout-session",
    "/billing/portal-session",
    "/billing/webhook",
    "requireStripeConfigured",
    "redactStripeProviderError",
    "billing_required",
    "billing_not_configured",
    "StripeWebhookError",
    "stripeCheckoutWebhookWorkspaceId",
    "requireStripeWebhookUuid",
    "optionalStripeWebhookUuid",
    "metadata.workspace_id must match client_reference_id",
    "assertStripeCustomerWorkspace",
    "getBillingCustomerByStripeCustomerId",
    "handled: true",
    "stripe.portal_session_created",
  ]);
  expectIncludes("Stripe tests", sources.apiTests, [
    "billing status reports active subscription after login",
    "billing checkout session reuses existing Stripe customer without customer_email",
    "billing checkout provider errors are redacted before API response",
    "billing portal session uses existing customer and writes non-secret audit log",
    "stripe webhook verifies signature and upserts billing records",
    "stripe webhook rejects invalid signatures without mutating billing rows",
    "stripe webhook rejects handled events without workspace metadata",
    "stripe webhook rejects invalid workspace metadata before billing mutations",
    "stripe webhook rejects invalid user metadata before billing mutations",
    "stripe webhook rejects mismatched workspace metadata before billing mutations",
    "stripe webhook rejects customer already linked to another workspace",
    "stripe webhook ignores unsupported events without mutating billing rows",
    "billing gate blocks authenticated agent chat before assistant work",
    "production product APIs fail closed when Stripe is not configured",
    "billing session APIs fail closed when Stripe is not configured",
  ]);
  expectIncludes("Stripe web login gate", sources.web, [
    "Stripe Checkoutへ進む",
    "billing_required",
    "VITE_APP_ENV",
  ]);
  expectIncludes("Agent context secret boundary", sources.api, [
    "sanitizeAgentContext",
    "buildProductionAgentContext",
    "operatorFeedbackSummary",
  ]);
  expectIncludes("Agent context secret tests", sources.apiTests, [
    "authenticated Agent Service context is sanitized before prompt routing",
    "raw-refresh-token-value-forbidden",
    "client-secret-value-forbidden",
  ]);
  expectIncludes("Stripe migration", sources.migration, [
    "billing_customers",
    "billing_subscriptions",
    "idx_billing_subscriptions_stripe_subscription_unique",
  ]);

  expectIncludes("production readiness gates", sources.api, [
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
    "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
    "STRIPE_STAGING_E2E_PASSED_AT",
    "DEPLOYMENT_RUNBOOK_ACK",
    "Date.parse",
    "staging-e2e-evidence-window",
    "maxStagingEvidenceSpreadMs",
  ]);
  expectIncludes("production env gates", sources.envCheck, [
    "GOOGLE_OAUTH_STATE_STORE",
    "GOOGLE_OAUTH_STATE_STORE must be db",
    "legacy ADK alias",
    "production OpenAI Agent Service",
  ]);
  expectIncludes("production env contract tests", sources.envContracts, [
    "memory-google-oauth-state-production.env",
    "GOOGLE_OAUTH_STATE_STORE: \"memory\"",
    "GOOGLE_OAUTH_STATE_STORE must be db",
    "legacy-adk-alias-production.env",
    "gemini-agent-production.env",
  ]);
  expectIncludes("private Agent Service auth", sources.api, [
    "AGENT_SERVICE_AUTH_MODE",
    "google_id_token",
    "Metadata-Flavor",
    "AGENT_SERVICE_AUDIENCE",
    "agent_service_auth_failed",
  ]);
  expectIncludes("private Agent Service auth tests", sources.apiTests, [
    "Agent Service call can use Cloud Run Google ID token auth",
    "Agent Service Google ID token auth failure does not call private Agent without auth",
    "readiness rejects legacy ADK Agent aliases in production env",
    "metadata-id-token",
  ]);
  expectIncludes("deployment docs", sources.deployment, [
    "npm run deploy:preflight",
    "npm run e2e:supabase",
    "npm run e2e:staging",
    "npm run e2e:stripe-webhook",
    "requires `AUTH_TOKEN`",
    "requires the Supabase service role in the operator env",
    "requires `STRIPE_WEBHOOK_SECRET` and `AUTH_TOKEN` from the operator env",
    "npm run smoke:deploy",
    "STRIPE_STAGING_E2E_PASSED_AT",
    "mediaWriteEnabled=true",
    "billingConfigured=true",
    "STRIPE_FULL_E2E_CONFIRMATION",
    "existing customer reuse",
    "Stripe customer/workspace mismatches must also return `400`",
    "write value must differ from the restore value",
    "spread more than 7 days apart",
    "GOOGLE_OAUTH_STATE_STORE=db",
    "Preflight now requires non-secret target markers",
    "GCP_PROJECT` or `EXPECTED_GCP_PROJECT",
    "EXPECTED_CLOUDFLARE_ACCOUNT",
    "SUPABASE_PROJECT_REF` or `EXPECTED_SUPABASE_PROJECT_REF",
    "EXPECTED_SUPABASE_PROJECT_REF",
    "EXPECTED_STRIPE_ACCOUNT",
    "gcloud run services add-iam-policy-binding",
    "roles/run.invoker",
    "AGENT_SERVICE_AUDIENCE=<agent-service-url>",
    "AGENT_SERVICE_AUDIENCE` must match `AGENT_SERVICE_URL",
  ]);
  expectExcludes("deployment docs", sources.deployment, [
    "AUTH_TOKEN=",
    "SUPABASE_SERVICE_ROLE_KEY=",
    "STRIPE_WEBHOOK_SECRET=",
  ]);
  expectIncludes("OpenAI production runtime docs", sources.agentReadme + sources.agentDesign + sources.environmentDocs + sources.productionAgentEnv, [
    "ADOPS_AGENT_RUNTIME=openai",
    "APP_ENV=production",
    "fail-closed",
  ]);
  expectIncludes("completion audit evidence docs", sources.environmentDocs, [
    "PRODUCTION_SMOKE_PASSED_AT",
    "RELEASE_EVIDENCE_COLLECTED_AT",
    "RELEASE_EVIDENCE_NOTE_PATH",
    "audit:completion",
  ]);
  expectIncludes("production checklist", sources.checklist, [
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
    "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
    "STRIPE_STAGING_E2E_PASSED_AT",
    "EXPECT_PRODUCTION_READY=true",
    "mode=agent-proxy",
    "authConfigured=true",
    "agent-service-modern-env=pass",
    "STRIPE_FULL_E2E_CONFIRMATION",
    "existing customer reuse",
    "customer/workspace mismatch returns `400`",
    "approvalType=explicit_user_confirmation",
    "approvedByUserId",
    "approvedAt",
    "handled=true",
    "write value differs from restore value",
    "no more than 7 days apart",
    "GOOGLE_OAUTH_STATE_STORE=db",
    "roles/run.invoker",
    "AGENT_SERVICE_AUDIENCE=<agent-service-url>",
    "matching `AGENT_SERVICE_URL` after trailing-slash normalization",
    "legacy ADK aliases",
    "Final smoke used `AGENT_SERVICE_URL`, checked `WEB_ORIGIN` HTML/root plus JS/CSS asset references, and rejected legacy ADK aliases",
    "EXPECT_PRODUCTION_READY=true npm run collect:release-evidence` printed `export PRODUCTION_SMOKE_PASSED_AT=...`",
    "PRODUCTION_SMOKE_PASSED_AT` and `RELEASE_EVIDENCE_COLLECTED_AT` were copied from the successful collector output",
    "RELEASE_EVIDENCE_NOTE_PATH",
    "npm run audit:completion -- --with-verify",
    "overallStatus=complete",
  ]);
  expectIncludes("deploy smoke production health gate", sources.smokeDeploy, [
    "validateApiHealth",
    "validateWebAssets",
    "extractWebAssetRefs",
    "runtimeDiagnosticSummary",
    "openaiAgentsSdkImportable",
    "missingOpenaiAgentsSymbols",
    "mode=agent-proxy",
    "mediaWriteEnabled=true",
    "billingConfigured=true",
    "supabaseConfigured=true",
    "authConfigured=true",
    "selectedRuntime",
    "validateModernAgentServiceEnv",
    "Production smoke must use AGENT_SERVICE_* env only",
    "agent-service-modern-env",
    "staging-e2e-evidence-window",
  ]);
  expectIncludes("deploy smoke contract tests", sources.smokeContracts, [
    "productionApiHealth",
    "productionAgentHealth",
    "productionReadiness",
    "runtimeDiagnostics",
    "Agent health runtime diagnostics",
    "selectedRuntime",
    "agent-service-modern-env",
    "fails when API health is still mock or write/billing disabled",
    "fails when Agent runtime or data safety is not production-ready",
    "fails when readiness omits staging evidence window check",
    "fails final production smoke when legacy ADK aliases are present",
  ]);
  expectIncludes("Docker production runtime gate", sources.dockerChecks, [
    "production image must not include",
    "production runtime dependencies must not include",
    "google-adk must remain optional-only",
    "openai-agents",
  ]);
  expectIncludes("deploy preflight", sources.deployPreflight, [
    "--json",
    "overallStatus",
    "Docker daemon",
    "Google Cloud CLI auth",
    "Cloudflare Wrangler auth",
    "Supabase CLI auth",
    "Stripe CLI auth",
    "Recommended remediation",
  ]);
  expectIncludes("deploy preflight contracts", sources.deployPreflightContracts, [
    "passes when all operator tools and auth checks pass",
    "fails with remediation when required CLIs are missing",
    "fails with remediation when auth or daemon checks fail",
    "prints non-secret JSON evidence for release notes",
    "prints JSON remediation when operator prerequisites fail",
    "Start Docker Desktop",
    "Run `gcloud auth login`",
    "Run `wrangler login`",
    "Run `supabase login`",
    "Run `stripe login`",
  ]);
  expectIncludes("operator prereq note", sources.operatorPrereqNote, [
    "Operator Prerequisite Note",
    "DEPLOY_PREFLIGHT_JSON",
    "Verification command",
    "docker info",
    "stripe whoami",
    "npm run deploy:preflight -- --json",
  ]);
  expectIncludes("operator prereq note contracts", sources.operatorPrereqNoteContracts, [
    "prints required fixes when preflight is blocked",
    "prints next deploy commands when preflight passes",
    "mustNotIncludeStdout",
  ]);
  expectIncludes("deploy next actions", sources.deployNext, [
    "Deploy next actions are blocked because deploy preflight is not passing",
    "npm run deploy:preflight -- --json",
    "npm run verify",
    "node scripts/check-env.mjs .env.staging.api .env.staging.agent .env.staging.web",
    "npm run deploy:commands -- --target=staging",
    "npm run deploy:commands -- --target=production",
    "supabase db push",
    "roles/run.invoker",
    "npm run e2e:staging",
    "CONFIRM_GOOGLE_WRITE=true",
    "npm run e2e:stripe-webhook",
    "EXPECT_PRODUCTION_READY=true",
    "npm run collect:release-evidence",
  ]);
  expectIncludes("deploy next action contracts", sources.deployNextContracts, [
    "blocks next actions when preflight is failing",
    "prints ordered operator sequence after preflight passes",
    "Docker daemon: docker daemon unavailable",
    "Run `stripe login`",
    "roles/run.invoker",
    "CONFIRM_GOOGLE_WRITE=true",
    "Keep real secrets out",
  ]);
  expectIncludes("deploy command plan", sources.deployCommands, [
    "Deploy Command Plan",
    "--target=staging",
    "--target=production",
    "gcloud run deploy",
    "adops-api-staging",
    "adops-agent-prod",
    "wrangler pages deploy apps/web/dist",
    "EXPECT_PRODUCTION_READY=true",
    "Copy export PRODUCTION_SMOKE_PASSED_AT=... and export RELEASE_EVIDENCE_COLLECTED_AT=... from the successful collector output",
    "RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>",
    "Do not paste service role keys",
  ]);
  expectIncludes("deploy command plan contracts", sources.deployCommandsContracts, [
    "prints staging command template",
    "prints production command template",
    "rejects unknown target",
    "mustNotIncludeStdout",
  ]);
  expectIncludes("production candidate audit", sources.productionCandidateAudit, [
    "Production Candidate Audit",
    "Repository goal contract status",
    "Full verify status",
    "Deploy preflight status",
    "Overall status",
    "preflight-ready-verify-not-run",
    "ready-for-staging-e2e",
    "not-ready",
    "remainingOperatorPrerequisites",
    "completionStillRequires",
    "--with-verify",
    "staging Supabase migration and schema/RLS evidence",
    "Google Ads OAuth, read/sync, reversible write, restore, and audit evidence",
    "Stripe hosted Checkout, webhook delivery, subscription rows, and billing gate evidence",
    "production env checks and EXPECT_PRODUCTION_READY=true smoke evidence",
  ]);
  expectIncludes("completion audit", sources.completionAudit, [
    "Completion Audit",
    "openai_agents_sdk_runtime",
    "google_ads_read_write",
    "stripe_billing",
    "local_repository_verification",
    "operator_deploy_prerequisites",
    "staging_provider_evidence",
    "final_production_smoke",
    "EXPECT_PRODUCTION_READY=true npm run smoke:deploy",
    "PRODUCTION_SMOKE_PASSED_AT",
    "RELEASE_EVIDENCE_COLLECTED_AT",
    "RELEASE_EVIDENCE_NOTE_PATH",
    "finalSmokeEvidenceIsCurrent",
    "releaseEvidenceNoteIsCurrent",
    "missingFinalSmokeEvidence",
    "nextActions",
    "stagingEvidenceNextActions",
    "finalSmokeNextActions",
    "preflightNextActions",
    "This command intentionally exits non-zero",
  ]);
  expectIncludes("completion audit contracts", sources.completionAuditContracts, [
    "reports incomplete when preflight and staging evidence are missing",
    "stays incomplete when staging evidence is proven but final smoke evidence is missing",
    "reports complete only when verify, preflight, staging evidence, and final smoke evidence are proven",
    "keeps staging evidence missing when timestamps are stale or spread too far apart",
    "keeps final smoke evidence missing when timestamps are spread too far apart",
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
    "DEPLOYMENT_RUNBOOK_ACK=true",
  ]);
  expectIncludes("completion evidence note", sources.completionEvidenceNote, [
    "Completion Evidence Note",
    "COMPLETION_AUDIT_JSON",
    "npm run audit:completion -- --json",
    "npm run audit:completion-note -- --with-verify",
    "npm run collect:release-evidence",
    "deploy/release-evidence.template.md",
    "RELEASE_EVIDENCE_NOTE_PATH",
    "Do not paste secrets",
  ]);
  expectIncludes("completion evidence note contracts", sources.completionEvidenceNoteContracts, [
    "prints non-secret markdown for incomplete audit",
    "exits zero only when completion audit is complete",
    "operator_deploy_prerequisites",
    "mustNotIncludeStdout",
  ]);
  expectIncludes("production candidate audit contracts", sources.productionCandidateAuditContracts, [
    "reports not-ready when operator preflight is blocked",
    "prints json status when requested",
    "prints json ready status when verify is explicitly confirmed",
    "reports ready for staging e2e when verify is explicitly confirmed",
    "reports preflight-ready but verify-not-run when contracts and preflight pass",
    "Docker daemon: docker daemon unavailable",
    "nextCommand",
  ]);
  expectIncludes("release evidence collector", sources.releaseEvidenceCollector, [
    "collect:release-evidence",
    "EXPECT_PRODUCTION_READY=true",
    "ALLOW_INCOMPLETE_EVIDENCE",
    "safeChildEnv",
    "runtimeDiagnosticSummary",
    "openaiAgentsSdkImportable",
    "missingOpenaiAgentsSymbols",
    "Do not paste secrets",
    "staging-e2e-evidence-window",
    "agent-service-modern-env",
    "ok: true",
    "Agent health ok expected true",
    "selectedRuntime",
    "Agent health selectedRuntime expected OpenAI runtime",
    "Remove legacy ADK agent aliases before collecting production release evidence",
    "existing customer reuse",
    "customer/workspace mismatch rejection evidence",
    "Manual Evidence Still Required",
  ]);
  expectIncludes("release evidence collector contracts", sources.releaseEvidenceCollectorContracts, [
    "prints non-secret evidence when health/readiness/smoke pass",
    "runtimeDiagnostics",
    "openaiAgentsSdkImportable",
    "secret-auth-token-that-must-not-print",
    "whsec-secret-that-must-not-print",
    "fails when final production smoke is requested but readiness is No-Go",
    "fails with named production evidence issues when health ok flags are false",
    "fails production release evidence when legacy ADK aliases are present",
    "selectedRuntime",
    "allows partial evidence when explicitly requested",
    "mustNotIncludeStdout",
    "mustNotIncludeStderr",
  ]);
  expectIncludes("release evidence template", sources.releaseEvidenceTemplate, [
    "Release Evidence Template",
    "npm run collect:release-evidence",
    "npm run deploy:preflight -- --json",
    "overallStatus=pass",
    "runtimeDiagnostics",
    "openaiAgentsSdkImportable=true",
    "openaiAgentsSdkAvailable=true",
    "Do not commit real secrets",
    "staging-e2e-evidence-window=pass",
    "Existing Stripe customer reuse sent `customer=<existing customer>` without `customer_email`",
    "Stripe customer/workspace mismatch returned `400` without mutating billing rows",
    "EXPECT_PRODUCTION_READY=true npm run smoke:deploy",
    "RELEASE_EVIDENCE_NOTE_PATH",
    "Final smoke used `AGENT_SERVICE_URL`, checked `WEB_ORIGIN` HTML/root plus JS/CSS asset references, and rejected legacy ADK aliases",
    "agent-service-modern-env=pass",
    "approvalType=explicit_user_confirmation",
    "approvedByUserId",
    "approvedAt",
    "Rollback owner and rollback action",
  ]);
  expectIncludes("operator handoff release evidence collection", sources.operatorHandoff, [
    "npm run collect:release-evidence",
    "npm run deploy:preflight -- --json",
    "npm run audit:production-candidate",
    "npm run deploy:next",
    "overallStatus=pass",
    "runtimeDiagnostics",
    "openaiAgentsSdkImportable",
    "missingOpenaiAgentsSymbols",
    "non-secret health/readiness/smoke summary",
    "ALLOW_INCOMPLETE_EVIDENCE=true",
    "selectedRuntime=openai",
    "selectedRuntime=openai_agents",
    "must fail",
    "handled=true",
    "existing customer reuse",
    "customer/workspace mismatch",
    "stripe_customer_id",
    "approvalType=explicit_user_confirmation",
    "approvedByUserId",
    "approvedAt",
    "roles/run.invoker",
    "AGENT_SERVICE_AUDIENCE=<agent-service-url>",
    "AGENT_SERVICE_AUDIENCE` must match `AGENT_SERVICE_URL",
    "final `EXPECT_PRODUCTION_READY=true npm run smoke:deploy` gate requires `AGENT_SERVICE_URL` and rejects legacy ADK aliases",
  ]);
  expectIncludes("staging E2E evidence gates", sources.stagingE2e, [
    "STRIPE_FULL_E2E_CONFIRMATION",
    "stripeConfirmationLooksComplete",
    "Legacy ADK_AGENT_URL is not accepted for staging evidence",
    "Remove legacy ADK agent aliases before staging evidence",
    "selectedRuntime",
    "expected selectedRuntime=openai/openai_agents",
    "existing customer",
    "reuse",
    "customer/workspace mismatch rejection",
    "UNPAID_AUTH_TOKEN",
    "CHECK_BILLING_GATE=true",
    "CONFIRM_STAGING_TARGET",
    "isSafeStagingOrigin",
    "GOOGLE_WRITE_ROLLBACK",
    "different from GOOGLE_RESTORE",
    "at least 20 characters",
  ]);
  expectIncludes("staging E2E contract tests", sources.stagingE2eContracts, [
    "Google status write requires a meaningful rollback note",
    "Google status write rejects non-reversible REMOVED status",
    "Google budget write requires different write and restore amounts",
    "Stripe full evidence requires checkout, existing customer reuse, webhook, billing gate, and mismatch confirmation",
    "Stripe full evidence requires authenticated unpaid billing gate evidence",
    "Stripe webhook E2E requires handled webhook responses",
    "Agent staging evidence requires AGENT_SERVICE_URL instead of legacy ADK_AGENT_URL",
    "Agent staging evidence rejects legacy ADK runtime switches",
    "refuses production-looking API origins",
    "mustNotIncludeStdout",
  ]);
  expectIncludes("production handoff tasks", sources.handoffTasks, [
    "Production Handoff Tasks",
    "OpenAI Agents SDK",
    "Google Ads read/write",
    "Stripe Billing",
    "Requires `SUPABASE_SERVICE_ROLE_KEY` in the operator environment",
    "Requires `AUTH_TOKEN` in the operator environment",
    "Requires `AUTH_TOKEN` and `STRIPE_WEBHOOK_SECRET` in the operator environment",
    "Goal completion requires this smoke to pass against deployed API, Agent, and Web services",
  ]);
  expectExcludes("production handoff task secret command examples", sources.handoffTasks, [
    "AUTH_TOKEN=",
    "SUPABASE_SERVICE_ROLE_KEY=",
    "STRIPE_WEBHOOK_SECRET=",
  ]);
  expectIncludes("production env templates", sources.productionApiEnv, [
    "APP_ENV=production",
    "DEPLOY_SURFACE=api",
    "GOOGLE_ADS_WRITE_ENABLED=true",
    "GOOGLE_ADS_MAX_BUDGET_AMOUNT=50000",
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
    "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
    "STRIPE_STAGING_E2E_PASSED_AT",
    "DEPLOYMENT_RUNBOOK_ACK=true",
  ]);
  expectIncludes("production Agent env template", sources.productionAgentEnv, [
    "APP_ENV=production",
    "DEPLOY_SURFACE=agent",
    "ADOPS_AGENT_RUNTIME=openai",
    "OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA=0",
    "OPENAI_AGENTS_DONT_LOG_MODEL_DATA=1",
    "OPENAI_AGENTS_DONT_LOG_TOOL_DATA=1",
  ]);
  expectIncludes("production Web env template", sources.productionWebEnv, [
    "VITE_APP_ENV=production",
    "VITE_API_BASE_URL",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
  ]);
  expectIncludes("npm scripts", sources.packageJson, [
    "deploy:preflight",
    "smoke:deploy",
    "e2e:staging",
    "e2e:supabase",
    "e2e:stripe-webhook",
    "check:smoke",
    "check:staging-e2e",
  ]);
}

if (issues.length) {
  console.error("Production goal check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Production goal check passed.");

function expectIncludes(label, source, snippets) {
  for (const snippet of snippets) {
    if (!source.includes(snippet)) issues.push(`${label}: missing "${snippet}"`);
  }
}

function expectExcludes(label, source, snippets) {
  for (const snippet of snippets) {
    if (source.includes(snippet)) issues.push(`${label}: should not include "${snippet}"`);
  }
}
