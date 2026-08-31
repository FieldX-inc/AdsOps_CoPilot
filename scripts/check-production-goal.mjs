#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const issues = [];

const requiredFiles = [
  "REQUIREMENTS.md",
  "DESIGN.md",
  "apps/api/src/billing.ts",
  "apps/api/src/usage.ts",
  "apps/api/src/email.ts",
  "apps/api/src/report-job.ts",
  "apps/api/src/notification-token.ts",
  "supabase/migrations/20260715_pricing_usage_reports.sql",
  "apps/web/public/_redirects",
  "docs/billing.md",
  "docs/notifications.md",
];
for (const file of requiredFiles) {
  if (!existsSync(file)) issues.push(`missing required implementation artifact: ${file}`);
}

if (!issues.length) {
  checkApiRouteContract();
  checkGoogleMutationBoundary();
  checkProductionUiGuards();
  checkMigrationContract();
  runBehaviorGate("API behavior tests", ["--workspace", "@adops/api", "test"], "npm");
  runBehaviorGate(
    "Agent structured-output and policy tests",
    ["-m", "pytest", "services/adk-agent/tests/test_openai_agents_runtime.py", "services/adk-agent/tests/test_setup_intake_runtime.py", "services/adk-agent/tests/test_behavior_evals.py", "-q"],
    "python3.11",
  );
}

if (issues.length) {
  console.error("Production contract audit failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Production contract audit passed (routes, entitlements, mutation boundary, production UI guards, migration shape, and behavior tests).");

function checkApiRouteContract() {
  const source = sourceFile("apps/api/src/index.ts");
  const routes = new Set();
  visit(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (!ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== "app") return;
    const method = node.expression.name.text.toUpperCase();
    const first = node.arguments[0];
    if (!["GET", "POST", "PATCH", "DELETE"].includes(method) || !first || !ts.isStringLiteralLike(first)) return;
    routes.add(`${method} ${first.text}`);
  });

  const requiredRoutes = [
    "GET /billing/plans",
    "POST /billing/checkout-session",
    "POST /billing/portal-session",
    "POST /billing/webhook",
    "GET /billing/status",
    "GET /usage/current",
    "GET /reports",
    "GET /reports/:reportId",
    "GET /notification-preferences",
    "PATCH /notification-preferences",
    "POST /workspace/invitations",
    "POST /workspace/invitations/accept",
    "DELETE /workspace/members/:userId",
    "GET /dashboard",
    "GET /ad-data/latest",
    "POST /agent/chat",
    "POST /agent/chat/stream",
    "GET /google/customers/:customerId/campaigns/:campaignId/change-preview",
    "POST /google/customers/:customerId/campaigns/:campaignId/status",
    "POST /google/customers/:customerId/campaigns/:campaignId/budget",
    "GET /readiness",
  ];
  for (const route of requiredRoutes) {
    if (!routes.has(route)) issues.push(`required route is missing: ${route}`);
  }
  for (const route of routes) {
    if (/\/debug\//.test(route)) issues.push(`debug route must not ship: ${route}`);
  }
}

function checkGoogleMutationBoundary() {
  const source = sourceFile("apps/api/src/google-ads.ts");
  const mutationEndpoints = new Set();
  const identifiers = new Set();
  visit(source, (node) => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    if (ts.isStringLiteralLike(node) && /:mutate$/.test(node.text)) mutationEndpoints.add(node.text);
  });
  const allowed = new Set(["campaigns:mutate", "campaignBudgets:mutate"]);
  for (const endpoint of mutationEndpoints) {
    if (!allowed.has(endpoint)) issues.push(`forbidden Google Ads mutation endpoint: ${endpoint}`);
  }
  for (const endpoint of allowed) {
    if (!mutationEndpoints.has(endpoint)) issues.push(`approved Google Ads mutation endpoint missing: ${endpoint}`);
  }
  for (const forbidden of ["debugGoogleAdsEnv", "tokenFingerprint", "updateGoogleBid", "createGoogleAd", "updateGoogleTargeting"]) {
    if (identifiers.has(forbidden)) issues.push(`forbidden Google Ads identifier remains: ${forbidden}`);
  }
}

function checkProductionUiGuards() {
  const source = sourceFile("apps/web/src/main.tsx", ts.ScriptKind.TSX);
  const declarations = new Map();
  const identifiers = new Set();
  visit(source, (node) => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.set(node.name.text, node.initializer.getText(source));
    }
  });
  const mockGuard = declarations.get("allowMockDashboard") ?? "";
  const billingGuard = declarations.get("allowBillingDemoBypass") ?? "";
  const previewGuard = declarations.get("localSetupPreview") ?? "";
  if (!mockGuard.includes("appEnv") || !mockGuard.includes("production")) issues.push("allowMockDashboard must be gated by production mode");
  if (!billingGuard.includes("appEnv") || !billingGuard.includes("production")) issues.push("allowBillingDemoBypass must be gated by production mode");
  if (!previewGuard.includes("allowBillingDemoBypass") || !previewGuard.includes("&&")) issues.push("localSetupPreview must depend on the production-safe billing bypass guard");
  for (const forbidden of ["kpiThresholds", "saveKpiThresholds", "debugGoogleAdsEnv"]) {
    if (identifiers.has(forbidden)) issues.push(`removed UI feature remains: ${forbidden}`);
  }
}

function checkMigrationContract() {
  const sql = readFileSync("supabase/migrations/20260715_pricing_usage_reports.sql", "utf8");
  for (const table of ["ai_usage_events", "report_schedules", "report_runs", "notification_preferences", "workspace_invitations", "stripe_webhook_events"]) {
    if (!new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${table}\\b`, "i").test(sql)) {
      issues.push(`migration table is missing: ${table}`);
    }
  }
  for (const structuralRule of [
    /unique\s*\(workspace_id,\s*idempotency_key\)/i,
    /source_type\s+text[^;]+setup[^;]+chat[^;]+scheduled_report/is,
    /interval_days\s+integer[^;]+check\s*\(interval_days\s*=\s*3\)/is,
    /prevent_last_workspace_owner/i,
    /enforce_workspace_member_plan_limit/i,
    /enforce_ad_account_plan_limit/i,
    /manager_customer_id\s+text/i,
    /claim_stripe_webhook_event/i,
    /finish_stripe_webhook_event/i,
    /coalesce\(new\.status,\s*''\)\s+in\s*\('removed',\s*'revoked'\)/i,
  ]) {
    if (!structuralRule.test(sql)) issues.push(`migration structural rule failed: ${structuralRule}`);
  }
  if (/drop\s+(table|column)\b/i.test(sql)) issues.push("release migration must remain additive; destructive DROP detected");
}

function runBehaviorGate(label, args, command) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", env: process.env });
  if (result.status !== 0) {
    issues.push(`${label} failed: ${(result.stderr || result.stdout).trim().slice(-1500)}`);
  }
}

function sourceFile(path, scriptKind = ts.ScriptKind.TS) {
  const source = readFileSync(path, "utf8");
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}
