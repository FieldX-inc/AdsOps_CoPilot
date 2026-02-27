import type { Anomaly, KpiSummary, NormalizedMetric, Platform } from "@/types/domain";

export function calcRate(numerator: number, denominator: number): number | null {
  if (!denominator) {
    return null;
  }
  return numerator / denominator;
}

export function summarizeKpi(rows: NormalizedMetric[]): KpiSummary {
  const totals = rows.reduce(
    (acc, row) => {
      acc.impressions += row.impressions;
      acc.clicks += row.clicks;
      acc.conversions += row.conversions;
      acc.revenue += row.revenue;
      acc.cost += row.cost;
      return acc;
    },
    { impressions: 0, clicks: 0, conversions: 0, revenue: 0, cost: 0 },
  );

  return {
    ...totals,
    ctr: calcRate(totals.clicks, totals.impressions),
    cvr: calcRate(totals.conversions, totals.clicks),
    cpa: calcRate(totals.cost, totals.conversions),
    roas: calcRate(totals.revenue, totals.cost),
  };
}

function toDateIndex(rows: NormalizedMetric[]) {
  const byDate = new Map<string, KpiSummary>();
  for (const row of rows) {
    const cur = byDate.get(row.date) ?? summarizeKpi([]);
    byDate.set(row.date, summarizeKpi([...expandSummary(cur), row]));
  }
  return byDate;
}

function expandSummary(summary: KpiSummary): NormalizedMetric[] {
  return [
    {
      workspace_id: "",
      date: "",
      platform: "google",
      campaign: "",
      adgroup: "",
      cost: summary.cost,
      impressions: summary.impressions,
      clicks: summary.clicks,
      conversions: summary.conversions,
      revenue: summary.revenue,
    },
  ];
}

export function detectAnomalies(
  rows: NormalizedMetric[],
  platform: Platform | "all",
  workspaceId: string,
): Anomaly[] {
  const filtered =
    platform === "all" ? rows : rows.filter((row) => row.platform === platform);

  const sortedDates = [...new Set(filtered.map((r) => r.date))].sort();
  if (sortedDates.length < 7) {
    return [
      {
        workspace_id: workspaceId,
        date: sortedDates[sortedDates.length - 1] ?? new Date().toISOString().slice(0, 10),
        platform,
        campaign: "全体",
        type: "検知スキップ",
        severity: "Low",
        metric_value: 0,
        baseline_value: 0,
        detail: "データが7日未満のため異常検知をスキップしました。",
        tags: ["reporting"],
      },
    ];
  }

  const latestDate = sortedDates[sortedDates.length - 1];
  const baselineDates = sortedDates.slice(-8, -1);

  const byDate = toDateIndex(filtered);
  const today = byDate.get(latestDate) ?? summarizeKpi([]);
  const baselineRows = baselineDates.map((d) => byDate.get(d) ?? summarizeKpi([]));
  const baseline = summarizeKpi(
    baselineRows.map((item) => ({
      workspace_id: workspaceId,
      date: latestDate,
      platform: "google",
      campaign: "baseline",
      adgroup: "baseline",
      cost: item.cost,
      impressions: item.impressions,
      clicks: item.clicks,
      conversions: item.conversions,
      revenue: item.revenue,
    })),
  );

  const anomalies: Anomaly[] = [];

  if (today.cpa && baseline.cpa && today.cpa > baseline.cpa * 1.2) {
    const ratio = today.cpa / baseline.cpa;
    anomalies.push({
      workspace_id: workspaceId,
      date: latestDate,
      platform,
      campaign: "全体",
      type: "CPA悪化",
      severity: ratio >= 1.3 ? "High" : ratio >= 1.2 ? "Medium" : "Low",
      metric_value: today.cpa,
      baseline_value: baseline.cpa,
      detail: `当日CPAが7日平均比 ${(ratio * 100 - 100).toFixed(1)}% 増加。`,
      tags: ["bidding", "budget_change"],
    });
  }

  if (today.conversions < baseline.conversions * 0.7) {
    const ratio = today.conversions / (baseline.conversions || 1);
    anomalies.push({
      workspace_id: workspaceId,
      date: latestDate,
      platform,
      campaign: "全体",
      type: "CV減少",
      severity: ratio <= 0.6 ? "High" : ratio <= 0.7 ? "Medium" : "Low",
      metric_value: today.conversions,
      baseline_value: baseline.conversions,
      detail: `当日CVが7日平均比 ${((1 - ratio) * 100).toFixed(1)}% 低下。`,
      tags: ["creative", "conversion_tracking"],
    });
  }

  const prevDate = sortedDates[sortedDates.length - 2];
  const prev = byDate.get(prevDate) ?? summarizeKpi([]);
  if (today.ctr && prev.ctr && today.ctr < prev.ctr * 0.75) {
    const ratio = today.ctr / prev.ctr;
    anomalies.push({
      workspace_id: workspaceId,
      date: latestDate,
      platform,
      campaign: "全体",
      type: "CTR低下",
      severity: ratio <= 0.6 ? "High" : ratio <= 0.75 ? "Medium" : "Low",
      metric_value: today.ctr,
      baseline_value: prev.ctr,
      detail: `CTRが前日比 ${((1 - ratio) * 100).toFixed(1)}% 低下。`,
      tags: ["creative", "reporting"],
    });
  }

  return anomalies;
}

export function formatPercent(value: number | null) {
  if (value === null) {
    return "-";
  }
  return `${(value * 100).toFixed(2)}%`;
}

export function formatNumber(value: number | null, maximumFractionDigits = 0) {
  if (value === null) {
    return "-";
  }
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits }).format(value);
}
