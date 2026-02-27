import type { AiInsightRequest, Platform } from "@/types/domain";

export const PLATFORM_LABELS: Record<Platform | "all", string> = {
  google: "Google",
  yahoo: "Yahoo",
  meta: "Meta",
  tiktok: "TikTok",
  all: "全媒体",
};

export const DEFAULT_TAGS = ["reporting"];

export function round(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

export function collectSummaryEvidence(insight: AiInsightRequest) {
  return [
    `CTR: ${round(insight.summary.ctr, 4)}`,
    `CVR: ${round(insight.summary.cvr, 4)}`,
    `CPA: ${round(insight.summary.cpa, 2)}`,
    `ROAS: ${round(insight.summary.roas, 2)}`,
    `費用: ${Math.round(insight.summary.cost)}`,
    `CV: ${Math.round(insight.summary.conversions)}`,
  ];
}

export function topCampaignEvidence(insight: AiInsightRequest, limit = 2) {
  return insight.top_campaigns.slice(0, limit).map((item) => {
    const roas = item.cost > 0 ? item.revenue / item.cost : 0;
    return `${item.campaign}: cost=${Math.round(item.cost)}, revenue=${Math.round(item.revenue)}, roas=${round(roas, 2)}`;
  });
}

export function byPlatform(insight: AiInsightRequest, platform: Platform | "all") {
  if (platform === "all") {
    return insight.anomalies;
  }
  return insight.anomalies.filter((item) => item.platform === platform || item.platform === "all");
}

export function dominantAnomalyType(insight: AiInsightRequest, platform: Platform | "all") {
  const rows = byPlatform(insight, platform);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const current = counts.get(row.type) ?? 0;
    counts.set(row.type, current + 1);
  }

  let bestType = "検知スキップ";
  let bestCount = 0;
  for (const [type, count] of counts.entries()) {
    if (count > bestCount) {
      bestType = type;
      bestCount = count;
    }
  }

  return { type: bestType, count: bestCount, total: rows.length };
}

export function tagsFromTypes(types: string[]) {
  const tags = new Set<string>();
  for (const type of types) {
    if (type.includes("CPA")) {
      tags.add("bidding");
      tags.add("budget_change");
    }
    if (type.includes("CTR")) {
      tags.add("creative");
    }
    if (type.includes("CV")) {
      tags.add("conversion_tracking");
    }
  }

  if (!tags.size) {
    tags.add("reporting");
  }

  return [...tags];
}
