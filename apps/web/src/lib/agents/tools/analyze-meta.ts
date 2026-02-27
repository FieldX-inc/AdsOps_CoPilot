import type { PlatformInsightInput, PlatformInsightOutput } from "@/lib/agents/types";
import {
  PLATFORM_LABELS,
  byPlatform,
  collectSummaryEvidence,
  dominantAnomalyType,
  tagsFromTypes,
  topCampaignEvidence,
} from "@/lib/agents/tools/shared";

export function analyzeMeta(input: PlatformInsightInput): PlatformInsightOutput {
  const platform = "meta" as const;
  const rows = byPlatform(input.insight, platform);
  const dominant = dominantAnomalyType(input.insight, platform);
  const tags = tagsFromTypes(rows.map((item) => item.type));

  const actions =
    dominant.type === "CPA悪化"
      ? [
          "高CPA広告セットの予算を-10%し、学習安定セットへ再配分する",
          "オーディエンス重複を抑えるため配信面を整理する",
          "最適化イベントを購入/リードで再確認する",
        ]
      : dominant.type === "CTR低下"
        ? [
            "クリエイティブを静止画・動画で最低2軸差し替える",
            "冒頭3秒の訴求を強化してスクロール停止率を上げる",
            "頻度上昇セットにクリエイティブローテーションを追加する",
          ]
        : [
            "Pixel/CAPIのイベント重複や欠損を確認する",
            "アトリビューション設定変更履歴を点検する",
            "LP遷移後の離脱率高区間を改善する",
          ];

  return {
    platform,
    finding: `${PLATFORM_LABELS[platform]}では${dominant.type}がボトルネックです。`,
    evidence: [
      `異常件数(${PLATFORM_LABELS[platform]}): ${rows.length}`,
      ...collectSummaryEvidence(input.insight).slice(0, 3),
      ...topCampaignEvidence(input.insight, 1),
    ],
    actions,
    tags,
  };
}
