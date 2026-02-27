import type { GuardrailResult } from "@/lib/agents/types";

const REQUIRED_HEADERS = [
  "■ 結論",
  "■ 根拠（数値）",
  "■ 考えられる原因",
  "■ 優先アクション（最大3）",
  "■ 参考ヘルプ",
];

function hasAllHeaders(text: string) {
  return REQUIRED_HEADERS.every((header) => text.includes(header));
}

function countNumericTokens(text: string) {
  return text.match(/\d+(?:\.\d+)?/g)?.length ?? 0;
}

function isQuestionOnly(text: string) {
  const compact = text.replace(/\s+/g, "").trim();
  return (
    compact.length < 120 &&
    (compact.includes("教えて") || compact.includes("ください") || compact.includes("ですか"))
  );
}

export function validateGenerateOutput(text: string): GuardrailResult {
  const reasons: string[] = [];

  if (!hasAllHeaders(text)) {
    reasons.push("テンプレ見出し不足");
  }
  if (countNumericTokens(text) < 3) {
    reasons.push("数値根拠不足");
  }
  if (isQuestionOnly(text)) {
    reasons.push("質問返しのみ");
  }

  return { ok: reasons.length === 0, reasons };
}

export function validateChatOutput(text: string, hasContext: boolean): GuardrailResult {
  const reasons: string[] = [];

  if (isQuestionOnly(text)) {
    reasons.push("質問返しのみ");
  }
  if (hasContext && countNumericTokens(text) < 3) {
    reasons.push("数値根拠不足");
  }

  return { ok: reasons.length === 0, reasons };
}
