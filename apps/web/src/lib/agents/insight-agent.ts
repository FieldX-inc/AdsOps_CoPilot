import type { AgentContext, LlmTextRequest, PlatformInsightOutput, RuntimeMode } from "@/lib/agents/types";

function uniqueTags(outputs: PlatformInsightOutput[]) {
  return [...new Set(outputs.flatMap((item) => item.tags))];
}

function flattenEvidence(outputs: PlatformInsightOutput[]) {
  return outputs.flatMap((output) => output.evidence.map((line) => `${output.platform}: ${line}`));
}

function flattenActions(outputs: PlatformInsightOutput[]) {
  return outputs.flatMap((output) => output.actions.map((action) => `${output.platform}: ${action}`));
}

export function buildDeterministicInsight(
  context: AgentContext,
  outputs: PlatformInsightOutput[],
): string {
  const evidence = flattenEvidence(outputs).slice(0, 5);
  const actions = flattenActions(outputs).slice(0, 3);
  const tags = uniqueTags(outputs);
  const topFinding = outputs[0]?.finding ?? "異常検知の件数が少なく、監視継続が必要です。";

  return [
    "■ 結論",
    topFinding,
    "",
    "■ 根拠（数値）",
    ...(evidence.length ? evidence.map((line) => `- ${line}`) : ["- 異常件数: 0", "- 費用: 0", "- CV: 0"]),
    "",
    "■ 考えられる原因",
    "- 配信調整と計測の変化が同時発生している可能性があります。",
    "- 高重要度異常のある媒体で効率低下が先行しています。",
    "",
    "■ 優先アクション（最大3）",
    ...(actions.length
      ? actions.map((action, index) => `${index + 1}. ${action}（期待効果: CPA/CVRの短期改善）`)
      : [
          "1. 高CPA媒体の入札を段階調整（期待効果: CPA改善）",
          "2. 低CTR面のクリエイティブ差し替え（期待効果: CTR改善）",
          "3. CVタグ発火確認（期待効果: 計測精度改善）",
        ]),
    "",
    "■ 参考ヘルプ",
    tags.length ? tags.join(", ") : "bidding, creative, conversion_tracking",
    context.intent === "chat" ? "" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildGeneratePrompt(context: AgentContext, outputs: PlatformInsightOutput[]) {
  return [
    "あなたは広告運用アシスタントです。以下の分析結果だけを根拠に回答してください。",
    "必須:",
    "- 数値根拠を3点以上含める",
    "- 推測質問で終わらない",
    "- 以下テンプレを厳守",
    "",
    "テンプレ:",
    "■ 結論",
    "■ 根拠（数値）",
    "■ 考えられる原因",
    "■ 優先アクション（最大3）",
    "■ 参考ヘルプ",
    "",
    `分析対象: ${JSON.stringify(context.insight)}`,
    `Tool結果: ${JSON.stringify(outputs)}`,
  ].join("\n");
}

function buildChatPrompt(context: AgentContext, outputs: PlatformInsightOutput[]) {
  const history = context.chatMessages
    .map((item) => `${item.role === "user" ? "ユーザー" : "アシスタント"}: ${item.content}`)
    .join("\n");

  return [
    "あなたは広告運用アシスタントです。",
    "必須:",
    "- 可能なら数値根拠を3点以上",
    "- 打ち手は優先順で最大3つ",
    "- 質問返しより先に実行可能な提案を出す",
    "",
    `会話履歴: ${history}`,
    `コンテキスト: ${JSON.stringify(context.insight ?? context.rawContext ?? null)}`,
    `Tool結果: ${JSON.stringify(outputs)}`,
  ].join("\n");
}

export async function runInsightGenerate(
  context: AgentContext,
  outputs: PlatformInsightOutput[],
  requestText: LlmTextRequest,
): Promise<{ text: string; mode: RuntimeMode; fallbackReason?: string }> {
  const prompt = buildGeneratePrompt(context, outputs);
  const result = await requestText(prompt);

  if (!result.ok) {
    return {
      text: buildDeterministicInsight(context, outputs),
      mode: "mock",
      fallbackReason: result.reason,
    };
  }

  return { text: result.text, mode: "gemini" };
}

export async function runInsightChat(
  context: AgentContext,
  outputs: PlatformInsightOutput[],
  deps: {
    requestText: LlmTextRequest;
  },
): Promise<{ text: string; mode: RuntimeMode; fallbackReason?: string }> {
  const prompt = buildChatPrompt(context, outputs);
  const result = await deps.requestText(prompt);

  if (!result.ok) {
    return {
      text: buildDeterministicInsight(context, outputs),
      mode: "mock",
      fallbackReason: result.reason,
    };
  }

  return { text: result.text, mode: "gemini" };
}

export async function regenerateWithGuardrail(
  reason: string,
  previousText: string,
  context: AgentContext,
  outputs: PlatformInsightOutput[],
  requestText: LlmTextRequest,
): Promise<{ text: string; mode: RuntimeMode; fallbackReason?: string }> {
  const prompt = [
    "以下の出力は要件違反です。修正してください。",
    `違反理由: ${reason}`,
    "",
    `前回出力: ${previousText}`,
    "",
    buildGeneratePrompt(context, outputs),
  ].join("\n");

  const result = await requestText(prompt);
  if (!result.ok) {
    return {
      text: buildDeterministicInsight(context, outputs),
      mode: "mock",
      fallbackReason: `guardrail_regen_failed:${result.reason}`,
    };
  }

  return { text: result.text, mode: "gemini" };
}
