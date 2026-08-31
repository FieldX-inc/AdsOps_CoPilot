import { pathToFileURL } from "node:url";

import { getBillingPlan, type BillingPlan } from "./billing.js";
import { EmailDeliveryError, sendReportEmail } from "./email.js";
import { loadLocalEnv } from "./env.js";
import { createUnsubscribeToken } from "./notification-token.js";
import {
  claimReportRun,
  completeReportSchedule,
  getBillingSubscription,
  getLatestAdDataFromDb,
  listConnectionStatuses,
  listDueReportSchedules,
  listReportRecipients,
  recordAiUsageEvent,
  reportJobMaxRetries,
  updateReportRun,
} from "./supabase.js";
import { calculateUsageCharge, parseAgentUsage } from "./usage.js";

loadLocalEnv();

type StructuredReport = {
  conclusion: string;
  evidence: string[];
  hypotheses: string[];
  recommended_actions: string[];
  operator_steps: string[];
  preflight_checks: string[];
  risks: string[];
  observation_plan: string[];
  confidence: "high" | "medium" | "low";
};

type ReportEmailMetric = {
  value: number | null;
  change: number | null;
};

type ReportEmailSummary = {
  clicks: ReportEmailMetric;
  conversions: ReportEmailMetric;
  cpa: ReportEmailMetric;
  cost: ReportEmailMetric;
};

type ReportEmailCampaign = {
  name: string;
  clicks: number;
  conversions: number;
  cpa: number | null;
  cost: number;
};

export const scheduledReportUsageSource = "scheduled_report" as const;

export class ScheduledReportError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.retryable = retryable;
  }
}

export async function runDueReports(now = new Date()) {
  const schedules = await listDueReportSchedules(now.toISOString());
  const results = [];
  for (const schedule of schedules) {
    results.push(await runWorkspaceReport(schedule.workspace_id, new Date(schedule.next_run_at), schedule.timezone));
  }
  return results;
}

async function runWorkspaceReport(workspaceId: string, dueAt: Date, timezone: string) {
  const { periodStartDate, periodEndDate } = reportPeriodLocalDates(dueAt, timezone);
  const idempotencyKey = `report:${periodStartDate}:${periodEndDate}`;
  const run = await claimReportRun({
    workspaceId,
    periodStart: periodStartDate,
    periodEnd: periodEndDate,
    dueAt: dueAt.toISOString(),
    idempotencyKey,
  });
  if (!run) return { workspaceId, status: "duplicate" };

  try {
    const [subscription, connections, latestAdData] = await Promise.all([
      getBillingSubscription(workspaceId),
      listConnectionStatuses(workspaceId, "google"),
      getLatestAdDataFromDb(workspaceId, 3, "google"),
    ]);
    const plan = subscription?.status === "active" || subscription?.status === "checkout_completed"
      ? getBillingPlan(subscription.plan_id)
      : null;
    if (!plan) throw new Error("active_subscription_required");

    const connected = connections.some((connection) => connection.status === "connected");
    if (!connected || !latestAdData || !hasSufficientReportData(latestAdData)) {
      const reconnectContent = buildReconnectReportContent();
      await updateReportRun(workspaceId, run.id, { status: "needs_reconnect", content: reconnectContent });
      const delivery = await deliverReportEmails(workspaceId, run.id, reconnectContent, true);
      await updateReportRun(workspaceId, run.id, { email_status: delivery.status, email_result: delivery.result });
      await completeReportSchedule(workspaceId, new Date());
      return { workspaceId, reportRunId: run.id, status: "needs_reconnect" };
    }

    const response = await generateAgentReport(workspaceId, run.id, latestAdData);
    const structured = validateStructuredReport(response.structuredOutput);
    if (!structured) throw new Error("agent_report_structured_output_required");
    const usage = parseAgentUsage(response._internalUsage);
    if (!usage) throw new Error("agent_report_usage_required");
    const charge = calculateUsageCharge(usage);
    if (charge.rateVersion === "unconfigured") throw new Error("model_cost_catalog_required");
    const usageEvent = await recordAiUsageEvent({
      workspaceId,
      sourceType: scheduledReportUsageSource,
      sourceId: run.id,
      model: usage.model,
      requests: usage.requests,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.totalTokens,
      estimatedCostMicrounits: charge.estimatedCostMicrounits,
      creditUnits: charge.creditUnits,
      rateVersion: charge.rateVersion,
      idempotencyKey: `scheduled_report:${run.id}`,
    });
    const content = buildReportContent(
      structured,
      plan,
      { start: periodStartDate, end: periodEndDate },
      latestAdData,
    );
    await updateReportRun(workspaceId, run.id, { status: "completed", content, usage_event_id: usageEvent?.id ?? null });
    const delivery = await deliverReportEmails(workspaceId, run.id, content, false);
    await updateReportRun(workspaceId, run.id, { email_status: delivery.status, email_result: delivery.result });
    await completeReportSchedule(workspaceId, new Date());
    return { workspaceId, reportRunId: run.id, status: "completed", emailStatus: delivery.status };
  } catch (error) {
    const failure = reportFailurePolicy(error, run.retry_count);
    await updateReportRun(workspaceId, run.id, { status: "failed", error_code: failure.code });
    if (failure.shouldAdvanceSchedule) await completeReportSchedule(workspaceId, new Date());
    return {
      workspaceId,
      reportRunId: run.id,
      status: "failed",
      errorCode: failure.code,
      retryable: failure.retryable,
      retryExhausted: failure.retryExhausted,
    };
  }
}

async function generateAgentReport(workspaceId: string, reportRunId: string, latestAdData: Record<string, unknown>) {
  const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:8000";
  const headers = await agentHeaders(agentUrl);
  let response: Response;
  try {
    response = await fetch(`${agentUrl.replace(/\/+$/, "")}/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        workspaceId,
        userId: "scheduled-report-job",
        threadId: reportRunId,
        message: "直近3日間と前期を比較し、広告運用改善レポートを必須構造で作成してください。データが足りない場合は推測せず不足を明記してください。",
        context: {
          advisorMode: "experienced",
          agentEntry: "performance_analyst_agent",
          apiPersistence: true,
          reportMode: true,
        },
        latestAdData: sanitizeReportContext(latestAdData),
      }),
    });
  } catch {
    throw new ScheduledReportError("agent_report_network_error", false);
  }
  if (!response.ok) {
    throw new ScheduledReportError(`agent_report_http_${response.status}`, response.status === 429 || response.status >= 500);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

export function reportPeriodLocalDates(dueAt: Date, timezone: string) {
  const normalizedTimezone = validTimezone(timezone) ? timezone : "Asia/Tokyo";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizedTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dueAt);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const dueLocalDate = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  const periodStart = new Date(dueLocalDate.getTime() - 3 * 24 * 60 * 60 * 1000);
  const periodEnd = new Date(dueLocalDate.getTime() - 24 * 60 * 60 * 1000);
  return {
    periodStartDate: periodStart.toISOString().slice(0, 10),
    periodEndDate: periodEnd.toISOString().slice(0, 10),
  };
}

function validTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

async function agentHeaders(audience: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const mode = (process.env.AGENT_SERVICE_AUTH_MODE ?? "none").trim().toLowerCase();
  if (mode === "bearer") {
    const token = process.env.AGENT_SERVICE_AUTH_TOKEN?.trim();
    if (!token) throw new Error("agent_service_auth_token_required");
    headers.Authorization = `Bearer ${token}`;
  } else if (mode === "google_id_token") {
    const target = process.env.AGENT_SERVICE_AUDIENCE ?? audience;
    const response = await fetch(
      `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(target)}`,
      { headers: { "Metadata-Flavor": "Google" } },
    );
    if (!response.ok) {
      throw new ScheduledReportError(
        `agent_service_identity_token_http_${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    headers.Authorization = `Bearer ${(await response.text()).trim()}`;
  }
  return headers;
}

async function deliverReportEmails(workspaceId: string, reportRunId: string, content: Record<string, unknown>, reconnect: boolean) {
  const recipients = await listReportRecipients(workspaceId);
  if (!recipients.length) return { status: "skipped" as const, result: { reason: "no_recipients" } };
  const publicUrl = (process.env.APP_PUBLIC_URL || process.env.WEB_ORIGIN || "").replace(/\/+$/, "");
  const apiPublicUrl = (process.env.API_PUBLIC_ORIGIN || "").replace(/\/+$/, "");
  const conclusion = String(content.conclusion ?? "改善レポートを更新しました。");
  const actions = arrayOfStrings(content.recommended_actions ?? content.operatorSteps).slice(0, 3);
  const evidence = arrayOfStrings(content.evidence).slice(0, 2);
  const period = parseReportPeriod(content.period);
  const summary = parseReportEmailSummary(content.emailSummary);
  const campaigns = parseReportEmailCampaigns(content.emailCampaigns);
  const subject = reconnect ? "Google Adsの再接続が必要です" : "3日ごとのAI広告改善レポート";
  const results = [];
  for (const recipient of recipients) {
    const reportUrl = `${publicUrl}/?report=${encodeURIComponent(reportRunId)}`;
    const token = createUnsubscribeToken(workspaceId, recipient.userId);
    const unsubscribeUrl = `${apiPublicUrl}/notification-preferences/unsubscribe?token=${encodeURIComponent(token)}`;
    const email = buildReportEmail({
      subject,
      conclusion,
      actions,
      evidence,
      period,
      summary,
      campaigns,
      statusLabel: reconnect ? "要再接続" : "定期配信",
      reportUrl,
      unsubscribeUrl,
    });
    try {
      const result = await sendReportEmail({
        to: [recipient.email],
        subject: email.subject,
        html: email.html,
        text: email.text,
        unsubscribeUrl,
      });
      results.push({ userId: recipient.userId, delivered: result.delivered.length, queued: result.queued.length, bounced: result.permanent_bounces.length });
    } catch (error) {
      const retryable = error instanceof EmailDeliveryError && error.retryable;
      results.push({ userId: recipient.userId, error: error instanceof EmailDeliveryError ? `email_http_${error.status}` : "email_unknown", retryable });
    }
  }
  const hasError = results.some((result) => "error" in result);
  const hasBounce = results.some((result) => "bounced" in result && Number(result.bounced) > 0);
  const hasQueue = results.some((result) => "queued" in result && Number(result.queued) > 0);
  return {
    status: hasError ? "failed" as const : hasBounce ? "bounced" as const : hasQueue ? "queued" as const : "delivered" as const,
    result: {
      recipientCount: results.length,
      deliveredCount: results.reduce((sum, result) => sum + ("delivered" in result ? Number(result.delivered) : 0), 0),
      queuedCount: results.reduce((sum, result) => sum + ("queued" in result ? Number(result.queued) : 0), 0),
      bouncedCount: results.reduce((sum, result) => sum + ("bounced" in result ? Number(result.bounced) : 0), 0),
      failedCount: results.filter((result) => "error" in result).length,
      retryableFailureCount: results.filter((result) => "retryable" in result && result.retryable).length,
    },
  };
}

export function buildReconnectReportContent() {
  return {
    kind: "reconnect_required",
    conclusion: "Google Adsの認証または比較に必要な同期データを確認できないため、今回は数値分析を生成していません。",
    operatorSteps: ["データ連携画面でGoogle Adsの接続状態を確認する", "再接続または同期完了後にダッシュボードを確認する"],
  };
}

export function hasSufficientReportData(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return reportPeriodHasData(item.current) && reportPeriodHasData(item.comparison);
}

function reportPeriodHasData(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const totals = (value as Record<string, unknown>).totals;
  if (!totals || typeof totals !== "object") return false;
  const metrics = totals as Record<string, unknown>;
  return [metrics.impressions, metrics.clicks, metrics.cost, metrics.conversions, metrics.revenue]
    .some((metric) => Number.isFinite(Number(metric)) && Number(metric) > 0);
}

export function buildReportContent(
  structured: StructuredReport,
  plan: BillingPlan,
  period: { start: string; end: string },
  latestAdData?: unknown,
) {
  const emailSnapshot = buildReportEmailSnapshot(latestAdData);
  return {
    kind: "improvement_report",
    ...structured,
    period,
    entitlements: {
      planId: plan.id,
      aiChat: plan.entitlements.aiChat,
      googleAdsWrite: plan.entitlements.googleAdsWrite,
    },
    cta: plan.entitlements.aiChat
      ? { type: "chat", label: "AIアドバイザーに詳細を確認" }
      : { type: "locked", label: "通常AIチャットはスタンダード以上で利用できます" },
    writeCta: plan.entitlements.googleAdsWrite ? "available_after_confirmation" : "locked",
    ...(emailSnapshot ? {
      emailSummary: emailSnapshot.summary,
      emailCampaigns: emailSnapshot.campaigns,
    } : {}),
  };
}

export function buildReportEmailSnapshot(value: unknown): {
  summary: ReportEmailSummary;
  campaigns: ReportEmailCampaign[];
} | null {
  const root = asRecord(value);
  const current = asRecord(root?.current);
  const comparison = asRecord(root?.comparison);
  const currentTotals = asRecord(current?.totals);
  const comparisonTotals = asRecord(comparison?.totals);
  if (!currentTotals || !comparisonTotals) return null;

  const currentClicks = metricNumber(currentTotals.clicks) ?? 0;
  const previousClicks = metricNumber(comparisonTotals.clicks);
  const currentConversions = metricNumber(currentTotals.conversions) ?? 0;
  const previousConversions = metricNumber(comparisonTotals.conversions);
  const currentCost = metricNumber(currentTotals.cost) ?? 0;
  const previousCost = metricNumber(comparisonTotals.cost);
  const currentCpa = metricNumber(currentTotals.cpa) ?? (currentConversions > 0 ? currentCost / currentConversions : null);
  const previousCpa = metricNumber(comparisonTotals.cpa)
    ?? (previousConversions && previousConversions > 0 && previousCost !== null ? previousCost / previousConversions : null);

  const summary: ReportEmailSummary = {
    clicks: { value: currentClicks, change: relativeChange(currentClicks, previousClicks) },
    conversions: { value: currentConversions, change: relativeChange(currentConversions, previousConversions) },
    cpa: { value: currentCpa, change: relativeChange(currentCpa, previousCpa) },
    cost: { value: currentCost, change: relativeChange(currentCost, previousCost) },
  };

  const rawCampaigns = Array.isArray(root?.campaigns) ? root.campaigns : [];
  const campaigns = rawCampaigns
    .map((campaign): ReportEmailCampaign | null => {
      const item = asRecord(campaign);
      if (!item) return null;
      const nameValue = item.campaign ?? item.name;
      const name = typeof nameValue === "string" ? nameValue.trim().slice(0, 100) : "";
      if (!name) return null;
      const conversions = metricNumber(item.conversions) ?? 0;
      const cost = metricNumber(item.cost) ?? 0;
      return {
        name,
        clicks: metricNumber(item.clicks) ?? 0,
        conversions,
        cpa: metricNumber(item.cpa) ?? (conversions > 0 ? cost / conversions : null),
        cost,
      };
    })
    .filter((campaign): campaign is ReportEmailCampaign => Boolean(campaign))
    .slice(0, 6);

  return { summary, campaigns };
}

export function buildReportEmail(input: {
  subject: string;
  conclusion: string;
  actions: string[];
  evidence?: string[];
  period?: { start: string; end: string } | null;
  summary?: ReportEmailSummary | null;
  campaigns?: ReportEmailCampaign[];
  statusLabel?: string;
  reportUrl: string;
  unsubscribeUrl: string;
}) {
  const periodLabel = input.period ? `${formatReportDate(input.period.start)}〜${formatReportDate(input.period.end)}` : "最新の集計期間";
  const statusLabel = input.statusLabel?.trim() || "定期配信";
  const safeReportUrl = escapeHtml(input.reportUrl);
  const safeUnsubscribeUrl = escapeHtml(input.unsubscribeUrl);
  const summaryHtml = input.summary ? renderEmailSummary(input.summary) : "";
  const campaignsHtml = input.campaigns?.length ? renderEmailCampaigns(input.campaigns) : "";
  const evidenceText = input.evidence?.[0] || input.conclusion;
  const recommendationText = input.actions.length
    ? input.actions.slice(0, 2).join("。")
    : "管理画面で接続状態と最新データを確認してください。";
  const preheader = input.summary
    ? "広告実績の全体KPI、キャンペーン別集計、AIからの推奨アクションをお届けします。"
    : input.conclusion;

  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(input.subject)}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-shell { width: 100% !important; }
      .email-card { padding: 24px 18px !important; }
      .kpi-cell { display: block !important; width: 100% !important; }
      .campaign-table { font-size: 10px !important; }
      .campaign-name { width: 32% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f3f6f8;color:#14213d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans JP','Hiragino Kaku Gothic ProN',Meiryo,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f6f8;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" class="email-shell" style="width:600px;max-width:600px;">
          <tr>
            <td class="email-card" style="padding:30px 30px 22px;background:#ffffff;border:1px solid #dfe5ea;border-radius:12px;box-shadow:0 3px 12px rgba(20,33,61,.08);">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-size:13px;font-weight:700;color:#17233c;vertical-align:middle;"><span style="display:inline-block;margin-right:8px;color:#07999d;font-size:20px;vertical-align:middle;">⌂</span>ちょこっとインハウス</td>
                  <td align="right" style="vertical-align:middle;"><span style="display:inline-block;padding:6px 11px;border:1px solid #6ed0cf;border-radius:999px;background:#edfbfa;color:#07898d;font-size:11px;font-weight:700;">●&nbsp; ${escapeHtml(statusLabel)}</span></td>
                </tr>
              </table>

              <h1 style="margin:14px 0 2px;color:#07122d;font-size:30px;line-height:1.25;letter-spacing:-.02em;">広告レポート</h1>
              <p style="margin:0;color:#3e4a5e;font-size:12px;line-height:1.7;">対象期間：${escapeHtml(periodLabel)}</p>
              <p style="margin:1px 0 18px;color:#7a8495;font-size:11px;line-height:1.6;">前回期間と比較</p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:16px;border:1px solid #9cc0ff;border-radius:8px;background:#f3f7ff;">
                <tr>
                  <td width="50" style="padding:12px 0 12px 13px;vertical-align:middle;"><span style="display:inline-block;width:36px;height:36px;border-radius:50%;background:#1268df;color:#ffffff;font-size:20px;line-height:36px;text-align:center;">↗</span></td>
                  <td style="padding:12px 13px 12px 8px;color:#2d3a50;font-size:12px;line-height:1.65;">${input.summary ? "今回の配信サマリーです。まずは全体数値をご確認ください。" : escapeHtmlWithBreaks(input.conclusion)}</td>
                </tr>
              </table>

              ${summaryHtml}
              ${campaignsHtml}

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 7px;">
                <tr><td width="5" style="width:5px;background:#0868e5;border-radius:4px;"></td><td style="padding-left:8px;color:#10213d;font-size:15px;font-weight:800;">コメント</td></tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #f4bb43;border-radius:8px;background:#fffbef;">
                <tr>
                  <td width="50" style="padding:13px 0 10px 13px;vertical-align:top;"><span style="display:inline-block;width:34px;height:34px;border-radius:50%;background:#f2a915;color:#ffffff;font-size:18px;line-height:34px;text-align:center;">↗</span></td>
                  <td style="padding:12px 13px 10px 8px;color:#3a3323;font-size:12px;line-height:1.6;"><strong style="display:block;color:#242b38;font-size:12px;">前回からの変化</strong>${escapeHtmlWithBreaks(evidenceText)}</td>
                </tr>
                <tr><td colspan="2" style="padding:0 13px;"><div style="border-top:1px dashed #eacb88;"></div></td></tr>
                <tr>
                  <td width="50" style="padding:11px 0 13px 13px;vertical-align:top;"><span style="display:inline-block;width:34px;height:34px;border-radius:50%;background:#52b13d;color:#ffffff;font-size:18px;line-height:34px;text-align:center;">✓</span></td>
                  <td style="padding:10px 13px 13px 8px;color:#3a3323;font-size:12px;line-height:1.6;"><strong style="display:block;color:#242b38;font-size:12px;">推奨アクション</strong>${escapeHtmlWithBreaks(recommendationText)}</td>
                </tr>
              </table>

              <p style="margin:12px 0 7px;color:#7a8495;font-size:10px;text-align:center;">※詳細は管理画面でも確認できます</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                <tr><td align="center" bgcolor="#0968df" style="border-radius:5px;"><a href="${safeReportUrl}" style="display:inline-block;min-width:220px;padding:13px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;">管理画面を見る&nbsp;&nbsp; ›</a></td></tr>
              </table>

              <p style="margin:12px 0 0;color:#9aa3af;font-size:10px;line-height:1.7;text-align:center;">このメールは自動配信です。<br><a href="${safeUnsubscribeUrl}" style="color:#778397;text-decoration:underline;">レポートメールの配信を停止</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const summaryText = input.summary
    ? `\n\n【全体】\n${[
      `クリック数: ${formatInteger(input.summary.clicks.value)} (${formatDeltaText(input.summary.clicks.change)})`,
      `コンバージョン数: ${formatInteger(input.summary.conversions.value)} (${formatDeltaText(input.summary.conversions.change)})`,
      `コンバージョン単価: ${formatYen(input.summary.cpa.value)} (${formatDeltaText(input.summary.cpa.change)})`,
      `コスト: ${formatYen(input.summary.cost.value)} (${formatDeltaText(input.summary.cost.change)})`,
    ].join("\n")}`
    : "";
  const campaignText = input.campaigns?.length
    ? `\n\n【キャンペーン別】\n${input.campaigns.map((campaign) => `${campaign.name}: クリック ${formatInteger(campaign.clicks)} / CV ${formatInteger(campaign.conversions)} / CPA ${formatYen(campaign.cpa)} / コスト ${formatYen(campaign.cost)}`).join("\n")}`
    : "";
  const text = `ちょこっとインハウス\n広告レポート\n対象期間: ${periodLabel}\n状態: ${statusLabel}${summaryText}${campaignText}\n\n【コメント】\n前回からの変化\n${evidenceText}\n\n推奨アクション\n${input.actions.length ? input.actions.map((action) => `- ${action}`).join("\n") : `- ${recommendationText}`}\n\n詳細: ${input.reportUrl}\n配信停止: ${input.unsubscribeUrl}`;

  return { subject: input.subject, html, text };
}

function renderEmailSummary(summary: ReportEmailSummary) {
  const cells = [
    { label: "クリック数", metric: summary.clicks, format: formatInteger, favorableWhenDown: false },
    { label: "コンバージョン数", metric: summary.conversions, format: formatInteger, favorableWhenDown: false },
    { label: "コンバージョン単価", metric: summary.cpa, format: formatYen, favorableWhenDown: true },
    { label: "コスト", metric: summary.cost, format: formatYen, favorableWhenDown: true },
  ];
  const rows = [cells.slice(0, 2), cells.slice(2, 4)].map((row) => `<tr>${row.map((cell) => `
    <td class="kpi-cell" width="50%" style="width:50%;padding:4px;vertical-align:top;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #dfe3e8;border-radius:8px;background:#ffffff;">
        <tr><td align="center" style="padding:9px 7px 0;color:#253049;font-size:10px;font-weight:700;">${cell.label}</td></tr>
        <tr><td align="center" style="padding:1px 7px;color:#0968df;font-size:26px;line-height:1.25;font-weight:800;">${cell.format(cell.metric.value)}</td></tr>
        <tr><td align="center" style="padding:0 7px 8px;color:#596579;font-size:10px;">前回比&nbsp;&nbsp;${renderDelta(cell.metric.change, cell.favorableWhenDown)}</td></tr>
      </table>
    </td>`).join("")}</tr>`).join("");
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:14px 0 3px;">
      <tr><td width="5" style="width:5px;background:#0868e5;border-radius:4px;"></td><td style="padding-left:8px;color:#10213d;font-size:15px;font-weight:800;">全体</td></tr>
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 -4px;width:calc(100% + 8px);">${rows}</table>`;
}

function renderEmailCampaigns(campaigns: ReportEmailCampaign[]) {
  const rows = campaigns.map((campaign) => `<tr>
    <td style="padding:8px 7px;border-top:1px solid #dfe3e8;color:#273247;text-align:left;">${escapeHtml(campaign.name)}</td>
    <td style="padding:8px 5px;border-top:1px solid #dfe3e8;text-align:right;">${formatInteger(campaign.clicks)}</td>
    <td style="padding:8px 5px;border-top:1px solid #dfe3e8;text-align:right;">${formatInteger(campaign.conversions)}</td>
    <td style="padding:8px 5px;border-top:1px solid #dfe3e8;text-align:right;white-space:nowrap;">${formatYen(campaign.cpa)}</td>
    <td style="padding:8px 7px;border-top:1px solid #dfe3e8;text-align:right;white-space:nowrap;">${formatYen(campaign.cost)}</td>
  </tr>`).join("");
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0 7px;">
      <tr><td width="5" style="width:5px;background:#0868e5;border-radius:4px;"></td><td style="padding-left:8px;color:#10213d;font-size:15px;font-weight:800;">キャンペーン別</td></tr>
    </table>
    <table role="table" width="100%" cellspacing="0" cellpadding="0" border="0" class="campaign-table" style="width:100%;border:1px solid #d7dee7;border-radius:7px;border-collapse:separate;border-spacing:0;overflow:hidden;color:#273247;font-size:10px;">
      <thead><tr style="background:#eaf2fe;color:#293750;">
        <th class="campaign-name" width="35%" style="width:35%;padding:8px 7px;text-align:left;font-weight:700;">キャンペーン名</th>
        <th style="padding:8px 5px;text-align:right;font-weight:700;">クリック数</th>
        <th style="padding:8px 5px;text-align:right;font-weight:700;">CV数</th>
        <th style="padding:8px 5px;text-align:right;font-weight:700;">CV単価</th>
        <th style="padding:8px 7px;text-align:right;font-weight:700;">コスト</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderDelta(value: number | null, favorableWhenDown: boolean) {
  if (value === null) return `<span style="color:#8791a1;">比較なし</span>`;
  const favorable = value === 0 ? null : favorableWhenDown ? value < 0 : value > 0;
  const color = favorable === null ? "#8791a1" : favorable ? "#139a68" : "#e4493f";
  const arrow = value > 0 ? "↗" : value < 0 ? "↘" : "→";
  return `<span style="color:${color};font-weight:800;">${arrow}&nbsp;${formatDeltaText(value)}</span>`;
}

function parseReportPeriod(value: unknown) {
  const item = asRecord(value);
  return typeof item?.start === "string" && typeof item.end === "string"
    ? { start: item.start, end: item.end }
    : null;
}

function parseReportEmailSummary(value: unknown): ReportEmailSummary | null {
  const item = asRecord(value);
  if (!item) return null;
  const metric = (key: keyof ReportEmailSummary): ReportEmailMetric | null => {
    const source = asRecord(item[key]);
    if (!source) return null;
    return { value: metricNumber(source.value), change: metricNumber(source.change) };
  };
  const clicks = metric("clicks");
  const conversions = metric("conversions");
  const cpa = metric("cpa");
  const cost = metric("cost");
  return clicks && conversions && cpa && cost ? { clicks, conversions, cpa, cost } : null;
}

function parseReportEmailCampaigns(value: unknown): ReportEmailCampaign[] {
  if (!Array.isArray(value)) return [];
  return value.map((campaign): ReportEmailCampaign | null => {
    const item = asRecord(campaign);
    const name = typeof item?.name === "string" ? item.name.trim().slice(0, 100) : "";
    if (!item || !name) return null;
    return {
      name,
      clicks: metricNumber(item.clicks) ?? 0,
      conversions: metricNumber(item.conversions) ?? 0,
      cpa: metricNumber(item.cpa),
      cost: metricNumber(item.cost) ?? 0,
    };
  }).filter((campaign): campaign is ReportEmailCampaign => Boolean(campaign)).slice(0, 6);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function metricNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function relativeChange(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

function formatInteger(value: number | null) {
  return value === null ? "-" : Math.round(value).toLocaleString("ja-JP");
}

function formatYen(value: number | null) {
  return value === null ? "-" : `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function formatDeltaText(value: number | null) {
  if (value === null) return "比較なし";
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function formatReportDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : value;
}

function escapeHtmlWithBreaks(value: string) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

export function reportFailurePolicy(error: unknown, retryCount: number, maxRetries = reportJobMaxRetries()) {
  const retryable = error instanceof ScheduledReportError && error.retryable;
  const retryExhausted = retryable && retryCount >= maxRetries;
  const code = `${retryable ? "retryable" : "terminal"}:${safeErrorCode(error)}`.slice(0, 120);
  return {
    code,
    retryable,
    retryExhausted,
    shouldAdvanceSchedule: !retryable || retryExhausted,
  };
}

export function validateStructuredReport(value: unknown): StructuredReport | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const confidence = item.confidence;
  const report: StructuredReport = {
    conclusion: typeof item.conclusion === "string" ? item.conclusion.trim() : "",
    evidence: arrayOfStrings(item.evidence),
    hypotheses: arrayOfStrings(item.hypotheses),
    recommended_actions: arrayOfStrings(item.recommended_actions),
    operator_steps: arrayOfStrings(item.operator_steps),
    preflight_checks: arrayOfStrings(item.preflight_checks),
    risks: arrayOfStrings(item.risks),
    observation_plan: arrayOfStrings(item.observation_plan),
    confidence: confidence === "high" || confidence === "low" ? confidence : "medium",
  };
  return report.conclusion && Object.entries(report).every(([key, field]) => key === "conclusion" || key === "confidence" || (Array.isArray(field) && field.length))
    ? report
    : null;
}

export function sanitizeReportContext(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeReportContext);
  if (typeof value === "string" && /(?:\b(?:sk|pk|rk|whsec)[_-][A-Za-z0-9_-]{8,}\b|\bAIza[A-Za-z0-9_-]{20,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|Authorization\s*:\s*Bearer)/i.test(value)) {
    return "[REDACTED]";
  }
  if (!value || typeof value !== "object") return value;
  const safe: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/customerId|externalAccountId|token|secret|email/i.test(key)) continue;
    safe[key] = sanitizeReportContext(child);
  }
  return safe;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function safeErrorCode(error: unknown) {
  return (error instanceof Error ? error.message : "unknown_error").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120);
}

async function main() {
  const results = await runDueReports();
  console.log(JSON.stringify({ processed: results.length, results }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ error: safeErrorCode(error) }));
    process.exitCode = 1;
  });
}
