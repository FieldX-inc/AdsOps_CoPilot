import type { PlatformInsightInput, PlatformInsightOutput } from "@/lib/agents/types";
import {
  PLATFORM_LABELS,
  byPlatform,
  collectSummaryEvidence,
  dominantAnomalyType,
  tagsFromTypes,
  topCampaignEvidence,
} from "@/lib/agents/tools/shared";

export function analyzeTikTok(input: PlatformInsightInput): PlatformInsightOutput {
  const platform = "tiktok" as const;
  const rows = byPlatform(input.insight, platform);
  const dominant = dominantAnomalyType(input.insight, platform);
  const tags = tagsFromTypes(rows.map((item) => item.type));

  const actions =
    dominant.type === "CPA悪化"
      ? [
          "高CPA広告グループの入札上限を調整して配信を圧縮する",
          "コンバージョン発生面へ予算配分を寄せる",
          "学習中セットの頻繁な予算変更を止める",
        ]
      : dominant.type === "CTR低下"
        ? [
            "冒頭フック違いの動画を3本追加する",
            "低視聴完了率クリエイティブを停止して差し替える",
            "CTAテキストを明確化しクリック意図を強める",
          ]
        : [
            "TikTok Pixelイベントの欠損を確認する",
            "アプリ内ブラウザ遷移後のCV計測を点検する",
            "LP表示速度を改善し離脱を抑える",
          ];

  return {
    platform,
    finding: `${PLATFORM_LABELS[platform]}は${dominant.type}の影響で効率が落ちています。`,
    evidence: [
      `異常件数(${PLATFORM_LABELS[platform]}): ${rows.length}`,
      ...collectSummaryEvidence(input.insight).slice(0, 3),
      ...topCampaignEvidence(input.insight, 1),
    ],
    actions,
    tags,
  };
}
