import type { PlatformInsightInput, PlatformInsightOutput } from "@/lib/agents/types";
import {
  PLATFORM_LABELS,
  byPlatform,
  collectSummaryEvidence,
  dominantAnomalyType,
  tagsFromTypes,
  topCampaignEvidence,
} from "@/lib/agents/tools/shared";

export function analyzeYahoo(input: PlatformInsightInput): PlatformInsightOutput {
  const platform = "yahoo" as const;
  const rows = byPlatform(input.insight, platform);
  const dominant = dominantAnomalyType(input.insight, platform);
  const tags = tagsFromTypes(rows.map((item) => item.type));

  const actions =
    dominant.type === "CPA悪化"
      ? [
          "高CPAキャンペーンを入札調整率で段階的に抑制する",
          "時間帯・デバイス別の係数を再設定する",
          "成果面への予算比率を増やし探索面を縮小する",
        ]
      : dominant.type === "CTR低下"
        ? [
            "広告文見出しを3案入れ替えて訴求軸を分散する",
            "表示URL・説明文の一致度を上げる",
            "不要キーワード除外で表示無駄を減らす",
          ]
        : [
            "CVタグとCV定義の同期ズレを確認する",
            "媒体側計測遅延を考慮して当日比較を補正する",
            "LPフォーム離脱率の高いセクションを改修する",
          ];

  return {
    platform,
    finding: `${PLATFORM_LABELS[platform]}は${dominant.type}の影響が大きく、改善優先度が高い状態です。`,
    evidence: [
      `異常件数(${PLATFORM_LABELS[platform]}): ${rows.length}`,
      ...collectSummaryEvidence(input.insight).slice(0, 3),
      ...topCampaignEvidence(input.insight, 1),
    ],
    actions,
    tags,
  };
}
