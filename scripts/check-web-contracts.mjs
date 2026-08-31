#!/usr/bin/env node

import { readFileSync } from "node:fs";

const source = readFileSync("apps/web/src/main.tsx", "utf8");
const designGuide = readFileSync("apps/web/DESIGN.md", "utf8");
const viteConfig = readFileSync("apps/web/vite.config.ts", "utf8");
const issues = [];

expectIncludes(
  "const billingActive = localSetupPreview || Boolean(workspaceSession && billingStatus?.access === \"active\");",
  "billingActive must require workspaceSession and /billing/status access=active outside the production-disabled setup preview",
);
expectIncludes("const allowBillingDemoBypass = appEnv !== \"production\";", "billing demo bypass must be disabled in production");
expectIncludes("fetch(`${apiBaseUrl}/billing/status`", "login-time billing status fetch must exist");
expectIncludes("<h1>プランを選択</h1>", "pre-auth plan selection heading must exist");
expectIncludes("billingPreferenceStorageKey", "the pre-auth plan choice must survive the OAuth redirect");
expectIncludes("const localAuthPreview = allowBillingDemoBypass", "the auth E2E preview must remain unavailable in production");
expectIncludes("onGoogleLogin={handleGoogleLogin}", "the auth preview and live login must use the real Google OAuth handler");
expectIncludes("preferredPlanId={preferredPlanId}", "the selected pre-auth plan must resume at the billing gate");
expectIncludes("<BillingGate", "billing gate must render before the app shell");
expectIncludes("if (!billingActive) return;", "app data effects must guard on billingActive");
expectIncludes("if (!billingActive || !aiChatAvailable)", "sendMessage must refuse before billing is active or the plan enables AI chat");
expectIncludes("通常AIチャットはスタンダードまたはプレミアムで利用できます。", "sendMessage must explain the AI chat entitlement lock");
expectIncludes(
  "allowBillingDemoBypass && (billingStatus?.configured === false || !billingStatus)",
  "billing demo bypass must be gated by allowBillingDemoBypass",
);
expectIncludes("approvalNote.trim().length < 10", "Google Ads write must require reason and rollback condition");
expectIncludes("hasRollbackCondition(approvalNote)", "Google Ads write UI must require an explicit rollback/restore condition");
expectIncludes("approvalNote, rollbackAuditId", "Google Ads write must send approvalNote to the API");
expectIncludes("function GoogleWriteModal", "Google Ads approval must live in the actual campaign-change flow");
expectIncludes("対象・現在値・変更後・リスクを確認し、実行を承認します。", "Google Ads execution must require explicit confirmation");
expectIncludes("変更と監査記録が完了しました。", "Google Ads execution must confirm its audit record");
expectIncludes("audit ID:", "Google Ads execution result must surface its audit ID");
expectIncludes("className=\"connection-list\"", "data connections must render as a vertical list");
expectIncludes("className={`connection-row platform-${connection.platform}`}", "each ad platform must render as a plain connection row");
expectIncludes("className=\"md3-filled-button\" onClick={() => void openGoogleOAuth()}", "Google OAuth must use the shared primary button style");
expectIncludes("className=\"md3-outlined-button\" disabled={googleStatus !== \"connected\"}", "Google account selection must use the shared secondary button style");
expectIncludes("className=\"connection-disclosure\"", "connection safety details must remain available on demand");
for (const retiredConnectionSurface of ["connection-grid-simplified", "connection-card-simple", "connection-safety-bar"]) {
  if (source.includes(retiredConnectionSurface)) {
    issues.push(`data connections must not render the retired card surface: ${retiredConnectionSurface}`);
  }
}
expectIncludes("`${apiBaseUrl}/google/customers?workspaceId=${workspace.workspaceId}`", "Google customers UI must use canonical /google/customers endpoint");
expectIncludes("type View = \"dashboard\" | \"setup\" | \"help\" | \"connections\" | \"settings\";", "primary routes must use Help and retire BI");
expectIncludes("/dashboard/filter-options", "Dashboard must fetch the scoped account/campaign/ad-group/ad hierarchy");
expectIncludes("<HierarchySelector", "Dashboard must render the hierarchy selector");
expectIncludes("dashboardMetricKeys", "Dashboard metric controls must use the explicitly allowed metric set");
expectIncludes("metric !== \"roas\"", "ROAS must be absent from interactive Dashboard metric filters");
expectIncludes("subLabel: \"コンバージョン率\"", "CVR must have a consistent Japanese label");
expectIncludes("広告アカウントのタイムゾーン: {timezone}", "custom dates must name the account timezone");
expectIncludes("document.getElementById(\"ai-chat-input\")?.focus();", "Dashboard consultation must focus the existing chat drawer input");
expectIncludes("const selectedScopeLabels = {", "visible Dashboard consultation context must resolve human-readable labels");
expectIncludes("scope: { adAccount: string; campaign: string; adGroup: string; ad: string }", "the visible consultation prompt must not accept raw hierarchy IDs");
expectIncludes("className=\"dashboard-advisor-hero\"", "Dashboard must lead with the mascot briefing and decision summary");
expectIncludes("className=\"dashboard-trend-filters\"", "Dashboard filters must sit near the trend chart");
expectIncludes("className={mockDashboardOpen ? \"md3-outlined-button\" : \"md3-tonal-button\"}", "Dashboard mock toggle must preserve a complete button style in both states");
expectIncludes("ちょこっとくん推奨アクション", "Dashboard must expose the recommended action queue from Mori's reference");
expectIncludes("buildAnomalyConsultationPrompt(", "Dashboard anomaly actions must hand scoped context to the existing AI drawer");
expectIncludes("className=\"anomaly-ask-button\"", "Dashboard anomaly rows must expose a keyboard-operable AI consultation action");
expectIncludes("const primaryDashboardMetrics: MetricKey[] = [\"cost\", \"conversions\", \"cpa\", \"ctr\"]", "Dashboard must preserve the primary KPI hierarchy");
expectIncludes("<h2>補助指標</h2>", "Dashboard must separate supporting metrics from primary KPIs");
expectIncludes("className=\"setup-session-menu\"", "setup session management must stay in a secondary menu");
expectIncludes("className=\"setup-questionnaire\"", "setup must render as a dedicated questionnaire instead of a chat surface");
expectIncludes("className=\"setup-question-progress\"", "setup must show the six-question progress");
expectIncludes("className=\"setup-question-stage\"", "setup must show one structured question at a time");
expectIncludes("className=\"setup-answer-review\"", "setup must provide an answer review and edit surface");
expectIncludes("className=\"setup-campaign-draft\"", "completed setup must render an inline campaign draft");
expectIncludes("提案のみ・未実行", "setup campaign draft must remain visibly unexecuted");
expectIncludes("媒体管理画面で人が確認する手順", "completed setup must include an explicit human procedure");
expectIncludes("`${apiBaseUrl}/setup/intake/answer`", "setup answers must use the structured answer endpoint");
expectIncludes("{view !== \"setup\" && (", "setup must not show the global AI chat launcher beside the questionnaire");
expectIncludes("role=\"radio\"", "setup and plan choices must use keyboard-operable radio semantics");
expectIncludes("公開コンテンツを再取得", "Help must expose an explicit retry after CMS fallback");
expectIncludes("基本ヘルプを表示中", "Help must visibly distinguish bundled fallback content from microCMS content");
expectIncludes("<MarkdownContent content={detail.article.body} />", "microCMS Help body must use the safe Markdown renderer");
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
if (/type View\s*=.*\"bi\"/.test(source)) {
  issues.push("apps/web/src/main.tsx: BI must not remain an active product route");
}
if (source.includes("/campaigns/create") || source.includes("campaign_create")) {
  issues.push("apps/web/src/main.tsx: setup must not expose a campaign-create mutation");
}
if (source.includes("GoogleWriteAuditReviewPanel") || source.includes("google-write-audit-card")) {
  issues.push("apps/web/src/main.tsx: data connections must not include the campaign write audit-review panel");
}
if (source.includes("onGoogleLogin={async () => undefined}")) {
  issues.push("apps/web/src/main.tsx: Google login must not be replaced with a no-op in auth preview");
}
if (source.includes("setup-next-actions") || source.includes("保存済みfacts")) {
  issues.push("apps/web/src/main.tsx: setup must not restore redundant instruction cards or always-visible saved facts");
}
for (const chatSurface of ["setup-intake-chat", "setup-intake-messages", "setup-intake-composer", "setup-readiness-panel", "/setup/intake/message"]) {
  if (source.includes(chatSurface)) {
    issues.push(`apps/web/src/main.tsx: setup questionnaire must not restore chat surface ${chatSurface}`);
  }
}
for (const retiredSetupSurface of ["setup-steps-modal", "広告マネージャー操作手順", "Ad manager checklist", "編集内容を保存"]) {
  if (source.includes(retiredSetupSurface)) {
    issues.push(`apps/web/src/main.tsx: setup must not restore the retired editable checklist surface ${retiredSetupSurface}`);
  }
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

const authPlanSelectionIndex = source.indexOf("className=\"auth-plan-options\"");
const authLoginSectionIndex = source.indexOf("className=\"auth-login-section\"");
if (authPlanSelectionIndex === -1 || authLoginSectionIndex === -1 || authPlanSelectionIndex > authLoginSectionIndex) {
  issues.push("apps/web/src/main.tsx: plan selection must precede authentication");
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
