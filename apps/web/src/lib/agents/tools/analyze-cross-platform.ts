import type { PlatformInsightInput, PlatformInsightOutput } from "@/lib/agents/types";
import { collectSummaryEvidence, tagsFromTypes, topCampaignEvidence } from "@/lib/agents/tools/shared";

export function analyzeCrossPlatform(input: PlatformInsightInput): PlatformInsightOutput {
  const rows = input.insight.anomalies;
  const highCount = rows.filter((item) => item.severity === "High").length;
  const dominantTags = tagsFromTypes(rows.map((item) => item.type));

  const actions = [
    "高重要度異常が多い媒体から順に予算配分を見直す",
    "共通で悪化している指標を1つ選び、改善実験を2週間で回す",
    "計測定義を全媒体でそろえ、日次比較のブレを減らす",
  ];

  return {
    platform: "all",
    finding: `全媒体で異常${rows.length}件（High ${highCount}件）。媒体横断で優先順位付けが必要です。`,
    evidence: [
      `異常件数(全媒体): ${rows.length}`,
      `High件数: ${highCount}`,
      ...collectSummaryEvidence(input.insight).slice(0, 3),
      ...topCampaignEvidence(input.insight, 2),
    ],
    actions,
    tags: dominantTags,
  };
}
