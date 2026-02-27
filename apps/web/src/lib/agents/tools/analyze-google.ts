import type { PlatformInsightInput, PlatformInsightOutput } from "@/lib/agents/types";
import {
  PLATFORM_LABELS,
  byPlatform,
  collectSummaryEvidence,
  dominantAnomalyType,
  tagsFromTypes,
  topCampaignEvidence,
} from "@/lib/agents/tools/shared";

export function analyzeGoogle(input: PlatformInsightInput): PlatformInsightOutput {
  const platform = "google" as const;
  const rows = byPlatform(input.insight, platform);
  const dominant = dominantAnomalyType(input.insight, platform);
  const tags = tagsFromTypes(rows.map((item) => item.type));

  const actions =
    dominant.type === "CPA悪化"
      ? [
          "入札単価を高CPA面から段階的に-10%調整する",
          "学習中キャンペーンの予算変更を20%以内に制御する",
          "CV獲得面の検索語句/配信面を優先配分する",
        ]
      : dominant.type === "CTR低下"
        ? [
            "訴求軸の異なるRSA/画像バリエーションを3本追加する",
            "低CTR広告の表示オプションを見直して差し替える",
            "配信クエリの除外を追加し無駄表示を削減する",
          ]
        : [
            "CVタグ発火をTag Managerで再確認する",
            "コンバージョン定義の重複計測を点検する",
            "LP速度とフォーム離脱点を確認する",
          ];

  return {
    platform,
    finding: `${PLATFORM_LABELS[platform]}は${dominant.type}が中心（${dominant.total}件中${dominant.count}件）です。`,
    evidence: [
      `異常件数(${PLATFORM_LABELS[platform]}): ${rows.length}`,
      ...collectSummaryEvidence(input.insight).slice(0, 3),
      ...topCampaignEvidence(input.insight, 1),
    ],
    actions,
    tags,
  };
}
