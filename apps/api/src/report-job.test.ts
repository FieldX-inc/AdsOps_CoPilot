import assert from "node:assert/strict";
import test from "node:test";

import { getBillingPlan } from "./billing.js";
import { isRetryableEmailStatus } from "./email.js";
import {
  ScheduledReportError,
  buildReconnectReportContent,
  buildReportContent,
  buildReportEmail,
  buildReportEmailSnapshot,
  hasSufficientReportData,
  reportFailurePolicy,
  reportPeriodLocalDates,
  sanitizeReportContext,
  scheduledReportUsageSource,
  validateStructuredReport,
} from "./report-job.js";
import {
  claimReportRun,
  isRetryableReportErrorCode,
  listReportRecipients,
  nextScheduledLocalNine,
  reportJobMaxRetries,
} from "./supabase.js";

const validStructuredReport = {
  conclusion: "CPAの変化を確認しました。",
  evidence: ["費用は前期比+10%"],
  hypotheses: ["CVR低下の影響"],
  recommended_actions: ["検索語句を確認"],
  operator_steps: ["管理画面を開く"],
  preflight_checks: ["CV計測を確認"],
  risks: ["判断に必要なCV数が少ない"],
  observation_plan: ["3日間のCPAを観察"],
  confidence: "medium" as const,
};

test("report cadence advances by local calendar days and preserves local 09:00 across DST", () => {
  const previous = new Date("2026-03-07T14:00:00.000Z"); // 09:00 America/New_York before DST.
  const next = nextScheduledLocalNine(previous, "America/New_York", 3, new Date("2026-03-07T15:00:00.000Z"));
  assert.equal(next.toISOString(), "2026-03-10T13:00:00.000Z"); // 09:00 after DST starts.
});

test("report cadence skips missed slots and returns the next future local 09:00", () => {
  const next = nextScheduledLocalNine(
    new Date("2026-07-01T00:00:00.000Z"),
    "Asia/Tokyo",
    3,
    new Date("2026-07-10T12:00:00.000Z"),
  );
  assert.equal(next.toISOString(), "2026-07-13T00:00:00.000Z");
});

test("report period uses three complete workspace-local dates across DST", () => {
  assert.deepEqual(
    reportPeriodLocalDates(new Date("2026-03-10T13:00:00.000Z"), "America/New_York"),
    { periodStartDate: "2026-03-07", periodEndDate: "2026-03-09" },
  );
});

test("scheduled report requires every structured answer section", () => {
  assert.ok(validateStructuredReport(validStructuredReport));
  assert.equal(validateStructuredReport({ ...validStructuredReport, risks: [] }), null);
});

test("report Agent context removes account IDs, token keys, and secret-looking strings", () => {
  assert.deepEqual(sanitizeReportContext({
    customerId: "1234567890",
    campaign: { id: "42", cost: 1000 },
    authToken: "hidden",
    note: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
  }), {
    campaign: { id: "42", cost: 1000 },
    note: "[REDACTED]",
  });
});

test("scheduled report retries only 429/5xx and advances after terminal or exhausted failures", () => {
  assert.equal(isRetryableEmailStatus(429), true);
  assert.equal(isRetryableEmailStatus(500), true);
  assert.equal(isRetryableEmailStatus(400), false);
  assert.equal(isRetryableEmailStatus(404), false);

  const retryable = reportFailurePolicy(new ScheduledReportError("agent_report_http_503", true), 1, 3);
  assert.equal(retryable.retryable, true);
  assert.equal(retryable.shouldAdvanceSchedule, false);
  assert.equal(isRetryableReportErrorCode(retryable.code), true);

  const exhausted = reportFailurePolicy(new ScheduledReportError("agent_report_http_429", true), 3, 3);
  assert.equal(exhausted.retryExhausted, true);
  assert.equal(exhausted.shouldAdvanceSchedule, true);

  const terminal = reportFailurePolicy(new ScheduledReportError("agent_report_http_400", false), 0, 3);
  assert.equal(terminal.retryable, false);
  assert.equal(terminal.shouldAdvanceSchedule, true);
  assert.equal(isRetryableReportErrorCode(terminal.code), false);
});

test("scheduled report retry count is bounded and accepts an explicit zero", () => {
  const original = process.env.REPORT_JOB_MAX_RETRIES;
  try {
    process.env.REPORT_JOB_MAX_RETRIES = "0";
    assert.equal(reportJobMaxRetries(), 0);
    process.env.REPORT_JOB_MAX_RETRIES = "999";
    assert.equal(reportJobMaxRetries(), 10);
    process.env.REPORT_JOB_MAX_RETRIES = "invalid";
    assert.equal(reportJobMaxRetries(), 3);
  } finally {
    if (original === undefined) delete process.env.REPORT_JOB_MAX_RETRIES;
    else process.env.REPORT_JOB_MAX_RETRIES = original;
  }
});

test("missing current or comparison metrics produces reconnect content without fabricated numbers", () => {
  assert.equal(hasSufficientReportData(null), false);
  assert.equal(hasSufficientReportData({
    current: { totals: { impressions: 100 } },
    comparison: { totals: { impressions: 0, clicks: 0, cost: 0 } },
  }), false);
  assert.equal(hasSufficientReportData({
    current: { totals: { impressions: 100 } },
    comparison: { totals: { impressions: 80 } },
  }), true);

  const reconnect = buildReconnectReportContent();
  assert.equal(reconnect.kind, "reconnect_required");
  assert.match(reconnect.conclusion, /数値分析を生成していません/);
  assert.equal("recommended_actions" in reconnect, false);
  assert.equal("evidence" in reconnect, false);
});

test("minimum report keeps operator steps and locks chat/write while standard reflects entitlements", () => {
  const minimum = getBillingPlan("minimum");
  const standard = getBillingPlan("standard");
  assert.ok(minimum);
  assert.ok(standard);
  const period = { start: "2026-07-01", end: "2026-07-03" };
  const minimumContent = buildReportContent(validStructuredReport, minimum, period);
  const standardContent = buildReportContent(validStructuredReport, standard, period);

  assert.deepEqual(minimumContent.operator_steps, validStructuredReport.operator_steps);
  assert.equal(minimumContent.cta.type, "locked");
  assert.equal(minimumContent.writeCta, "locked");
  assert.deepEqual(minimumContent.entitlements, { planId: "minimum", aiChat: false, googleAdsWrite: false });
  assert.equal(standardContent.cta.type, "chat");
  assert.equal(standardContent.writeCta, "available_after_confirmation");
  assert.deepEqual(standardContent.entitlements, { planId: "standard", aiChat: true, googleAdsWrite: true });
  assert.equal(scheduledReportUsageSource, "scheduled_report");
  assert.notEqual(scheduledReportUsageSource, "chat");
});

test("report email snapshot keeps aggregate metrics and campaign names without account identifiers", () => {
  const snapshot = buildReportEmailSnapshot({
    customerId: "customer-secret",
    current: { totals: { clicks: 1248, conversions: 38, cost: 159980, cpa: 4210 } },
    comparison: { totals: { clicks: 1114, conversions: 35, cost: 156840, cpa: 4478 } },
    campaigns: [
      { campaignId: "campaign-secret", customerId: "customer-secret", campaign: "Google検索", clicks: 420, conversions: 16, cost: 63680, cpa: 3980 },
    ],
  });

  assert.ok(snapshot);
  assert.equal(snapshot.summary.clicks.value, 1248);
  assert.equal(Math.round((snapshot.summary.clicks.change ?? 0) * 100), 12);
  assert.equal(Math.round((snapshot.summary.cpa.change ?? 0) * 100), -6);
  assert.deepEqual(snapshot.campaigns, [{ name: "Google検索", clicks: 420, conversions: 16, cost: 63680, cpa: 3980 }]);
  assert.doesNotMatch(JSON.stringify(snapshot), /customer-secret|campaign-secret/);
});

test("report content carries a safe email snapshot when ad metrics are available", () => {
  const minimum = getBillingPlan("minimum");
  assert.ok(minimum);
  const content = buildReportContent(
    validStructuredReport,
    minimum,
    { start: "2026-08-01", end: "2026-08-03" },
    {
      current: { totals: { clicks: 100, conversions: 5, cost: 10000 } },
      comparison: { totals: { clicks: 80, conversions: 4, cost: 9600 } },
      campaigns: [{ campaign: "検索", clicks: 100, conversions: 5, cost: 10000, campaignId: "do-not-store" }],
    },
  );
  assert.ok(content.emailSummary);
  assert.ok(content.emailCampaigns);
  assert.equal(content.emailSummary.clicks.value, 100);
  assert.equal(content.emailSummary.cpa.value, 2000);
  assert.equal(content.emailCampaigns[0]?.name, "検索");
  assert.doesNotMatch(JSON.stringify(content.emailCampaigns), /do-not-store/);
});

test("report email renders equivalent HTML/plain metrics, comments, CTA, and unsubscribe URL", () => {
  const email = buildReportEmail({
    subject: "3日ごとのAI広告改善レポート",
    conclusion: "CPAが改善しました。",
    evidence: ["費用を抑えながらCVが増加しました。"],
    actions: ["検索語句を確認", "低CPA広告の配信継続"],
    period: { start: "2026-08-01", end: "2026-08-03" },
    statusLabel: "定期配信",
    summary: {
      clicks: { value: 1248, change: 0.12 },
      conversions: { value: 38, change: 0.09 },
      cpa: { value: 4210, change: -0.06 },
      cost: { value: 159980, change: 0.02 },
    },
    campaigns: [{ name: "Google検索<script>", clicks: 420, conversions: 16, cpa: 3980, cost: 63680 }],
    reportUrl: "https://app.example.test/?report=report-1",
    unsubscribeUrl: "https://api.example.test/notification-preferences/unsubscribe?token=user-specific",
  });
  assert.match(email.html, /<!doctype html>/);
  assert.match(email.html, /role="presentation"/);
  assert.match(email.html, /対象期間：2026\/08\/01〜2026\/08\/03/);
  assert.match(email.html, /クリック数/);
  assert.match(email.html, /1,248/);
  assert.match(email.html, /キャンペーン別/);
  assert.match(email.html, /Google検索&lt;script&gt;/);
  assert.doesNotMatch(email.html, /Google検索<script>/);
  assert.match(email.html, /前回からの変化/);
  assert.match(email.html, /検索語句を確認/);
  assert.match(email.text, /検索語句を確認/);
  assert.match(email.text, /1,248/);
  assert.match(email.text, /Google検索<script>/);
  assert.match(email.html, /token=user-specific/);
  assert.match(email.text, /token=user-specific/);
  assert.match(email.html, /配信を停止/);
  assert.match(email.text, /配信停止/);
});

test("report run claim returns null when the same workspace period is already completed", async () => {
  await withReportSupabase(async () => {
    let patchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = String(init.method ?? "GET").toUpperCase();
      if (url.pathname !== "/rest/v1/report_runs") throw new Error(`unexpected ${method} ${url}`);
      if (method === "POST") return Response.json([]);
      if (method === "GET") return Response.json([reportRunRow("completed", null, 0)]);
      patchCalls += 1;
      return Response.json([]);
    };
    try {
      const claimed = await claimReportRun(reportClaimInput());
      assert.equal(claimed, null);
      assert.equal(patchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("report run claim retries only rows marked retryable and keeps the retry bound", async () => {
  await withReportSupabase(async () => {
    const originalFetch = globalThis.fetch;
    const originalMaxRetries = process.env.REPORT_JOB_MAX_RETRIES;
    let existing = reportRunRow("failed", "terminal:agent_report_http_400", 0);
    let patchCalls = 0;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = String(init.method ?? "GET").toUpperCase();
      if (url.pathname !== "/rest/v1/report_runs") throw new Error(`unexpected ${method} ${url}`);
      if (method === "POST") return Response.json([]);
      if (method === "GET") return Response.json([existing]);
      patchCalls += 1;
      const patch = JSON.parse(String(init.body)) as { retry_count: number; status: string };
      return Response.json([{ ...existing, ...patch }]);
    };
    try {
      assert.equal(await claimReportRun(reportClaimInput()), null);
      assert.equal(patchCalls, 0);

      existing = reportRunRow("failed", "retryable:agent_report_http_503", 1);
      const retried = await claimReportRun(reportClaimInput());
      assert.equal(retried?.status, "running");
      assert.equal(retried?.retry_count, 2);
      assert.equal(patchCalls, 1);

      process.env.REPORT_JOB_MAX_RETRIES = "2";
      existing = reportRunRow("failed", "retryable:agent_report_http_503", 2);
      assert.equal(await claimReportRun(reportClaimInput()), null);
      assert.equal(patchCalls, 1);
    } finally {
      if (originalMaxRetries === undefined) delete process.env.REPORT_JOB_MAX_RETRIES;
      else process.env.REPORT_JOB_MAX_RETRIES = originalMaxRetries;
      globalThis.fetch = originalFetch;
    }
  });
});

test("report recipients default owner/admin on, default members off, and honor member opt-in", async () => {
  await withReportSupabase(async () => {
    const preferenceWrites: Array<{ user_id: string; report_email_enabled: boolean }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = String(init.method ?? "GET").toUpperCase();
      if (url.pathname === "/rest/v1/workspace_members") {
        return Response.json([
          { user_id: "owner-user", role: "owner" },
          { user_id: "opted-in-member", role: "member" },
          { user_id: "default-member", role: "member" },
        ]);
      }
      if (url.pathname === "/rest/v1/notification_preferences" && method === "GET") {
        const userId = url.searchParams.get("user_id")?.replace(/^eq\./, "");
        return Response.json(userId === "opted-in-member"
          ? [{ workspace_id: "report-workspace", user_id: userId, report_email_enabled: true }]
          : []);
      }
      if (url.pathname === "/rest/v1/notification_preferences" && method === "POST") {
        const body = JSON.parse(String(init.body)) as { user_id: string; report_email_enabled: boolean };
        preferenceWrites.push(body);
        return Response.json([body]);
      }
      if (url.pathname.startsWith("/auth/v1/admin/users/")) {
        const userId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        return Response.json({ email: `${userId}@example.test` });
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    try {
      const recipients = await listReportRecipients("report-workspace");
      assert.deepEqual(recipients.map((item) => item.userId), ["owner-user", "opted-in-member"]);
      assert.deepEqual(preferenceWrites.map((item) => [item.user_id, item.report_email_enabled]), [
        ["owner-user", true],
        ["default-member", false],
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function reportClaimInput() {
  return {
    workspaceId: "report-workspace",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-03",
    dueAt: "2026-07-04T00:00:00.000Z",
    idempotencyKey: "report:2026-07-01:2026-07-03",
  };
}

function reportRunRow(status: "completed" | "failed", errorCode: string | null, retryCount: number) {
  return {
    id: "report-run",
    workspace_id: "report-workspace",
    period_start: "2026-07-01",
    period_end: "2026-07-03",
    due_at: "2026-07-04T00:00:00.000Z",
    status,
    content: {},
    email_status: "pending",
    email_result: {},
    retry_count: retryCount,
    error_code: errorCode,
    idempotency_key: "report:2026-07-01:2026-07-03",
    created_at: "2026-07-04T00:00:00.000Z",
    updated_at: "2026-07-04T00:00:00.000Z",
  };
}

async function withReportSupabase(run: () => Promise<void>) {
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.SUPABASE_URL = "https://supabase.report.test";
  process.env.SUPABASE_ANON_KEY = "anon-report";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-report";
  try {
    await run();
  } finally {
    for (const key of keys) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
