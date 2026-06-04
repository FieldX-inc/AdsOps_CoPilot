#!/usr/bin/env node

import { readFileSync } from "node:fs";

const source = readFileSync("apps/web/src/main.tsx", "utf8");
const designGuide = readFileSync("apps/web/DESIGN.md", "utf8");
const viteConfig = readFileSync("apps/web/vite.config.ts", "utf8");
const issues = [];

expectIncludes(
  "const billingActive = Boolean(workspaceSession && billingStatus?.access === \"active\");",
  "billingActive must be derived from workspaceSession and /billing/status access=active",
);
expectIncludes("const allowBillingDemoBypass = appEnv !== \"production\";", "billing demo bypass must be disabled in production");
expectIncludes("fetch(`${apiBaseUrl}/billing/status`", "login-time billing status fetch must exist");
expectIncludes("<BillingGate", "billing gate must render before the app shell");
expectIncludes("if (!billingActive) return;", "app data effects must guard on billingActive");
expectIncludes("課金状態がactiveになるまでAI相談は利用できません。", "sendMessage must refuse before billing is active");
expectIncludes(
  "allowBillingDemoBypass && (billingStatus?.configured === false || !billingStatus)",
  "billing demo bypass must be gated by allowBillingDemoBypass",
);
expectIncludes("approvalNote.length < 10", "Google Ads write must require reason and rollback condition");
expectIncludes("hasRollbackCondition(approvalNote)", "Google Ads write UI must require an explicit rollback/restore condition");
expectIncludes("approvalNote }", "Google Ads write must send approvalNote to the API");
expectIncludes("/audit-logs/recent?workspaceId=${workspace.workspaceId}&eventTypePrefix=google_ads.&limit=8", "Google Ads write UI must fetch recent google_ads audit logs");
expectIncludes("googleWriteAuditMatches", "Google Ads write UI must verify the target audit log after execution");
expectIncludes("approvalType\") === \"explicit_user_confirmation\"", "Google Ads write UI must check explicit approval metadata");
expectIncludes("approvedByUserId", "Google Ads write UI must surface the approving user metadata");
expectIncludes("audit review", "Google Ads write UI must render an audit review panel");
expectIncludes("`${apiBaseUrl}/google/customers?workspaceId=${workspace.workspaceId}`", "Google customers UI must use canonical /google/customers endpoint");
expectDesignIncludes("承認付きwrite候補", "LP design guide must allow Google Ads write candidates after human approval");
expectDesignIncludes("戻し条件", "LP design guide must preserve rollback-condition messaging for Google Ads write");
expectDesignIncludes("AI単独の自動変更なし", "LP design guide must forbid autonomous AI media changes");
expectViteIncludes("manualChunks", "Vite production build must split large vendor bundles");
expectViteIncludes("charts: [\"recharts\"]", "Vite build must isolate Recharts from the app shell chunk");
expectViteIncludes("supabase: [\"@supabase/supabase-js\"]", "Vite build must isolate Supabase client from the app shell chunk");
for (const proxyPath of ["/billing", "/google", "/sync", "/audit-logs"]) {
  expectViteIncludes(`"${proxyPath}": "http://localhost:8787"`, `Vite dev proxy must include ${proxyPath}`);
}
if (source.includes("/google-ads/customers")) {
  issues.push("apps/web/src/main.tsx: must not call legacy /google-ads/customers endpoint");
}
if (/read-only連携\s*→/.test(designGuide)) {
  issues.push("apps/web/DESIGN.md: must not keep the old read-only-only LP step flow");
}

for (const endpoint of [
  "/dashboard",
  "/readiness",
  "/agent/threads",
  "/recommendations",
  "/tasks",
  "/agent/chat/stream",
]) {
  if (!source.includes(endpoint)) {
    issues.push(`apps/web/src/main.tsx: expected ${endpoint} integration`);
  }
}

const billingGuardCount = countOccurrences(source, "if (!billingActive) return;");
if (billingGuardCount < 5) {
  issues.push(`apps/web/src/main.tsx: expected at least 5 billingActive fetch guards, found ${billingGuardCount}`);
}

const billingStatusIndex = source.indexOf("fetch(`${apiBaseUrl}/billing/status`");
const billingGateIndex = source.indexOf("<BillingGate");
const appShellIndex = source.indexOf("<div className=\"app-shell\">");
if (billingStatusIndex === -1 || billingGateIndex === -1 || appShellIndex === -1 || billingStatusIndex > billingGateIndex || billingGateIndex > appShellIndex) {
  issues.push("apps/web/src/main.tsx: billing status check should be defined before the app shell render");
}

if (issues.length) {
  console.error("Web contract check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Web contract check passed.");

function expectIncludes(snippet, message) {
  if (!source.includes(snippet)) {
    issues.push(`apps/web/src/main.tsx: ${message}`);
  }
}

function expectDesignIncludes(snippet, message) {
  if (!designGuide.includes(snippet)) {
    issues.push(`apps/web/DESIGN.md: ${message}`);
  }
}

function expectViteIncludes(snippet, message) {
  if (!viteConfig.includes(snippet)) {
    issues.push(`apps/web/vite.config.ts: ${message}`);
  }
}

function countOccurrences(value, needle) {
  let count = 0;
  let index = 0;
  while (true) {
    index = value.indexOf(needle, index);
    if (index === -1) return count;
    count += 1;
    index += needle.length;
  }
}
