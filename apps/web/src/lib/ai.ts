import { runChatPipeline, runGeneratePipeline } from "@/lib/agents/runtime";
import type { AgentRuntimeDeps, ToolTraceEvent } from "@/lib/agents/types";
import { env } from "@/lib/env";
import type { AiInsightRequest, AiInsightResponse, ChatMessage } from "@/types/domain";

function mockText(input: AiInsightRequest) {
  return [
    "■ 結論",
    `${input.period}の主要指標ではCPA悪化への対応が最優先です。`,
    "",
    "■ 根拠（数値）",
    `異常件数: ${input.anomalies.length}件 / 上位キャンペーン: ${input.top_campaigns
      .map((c) => c.campaign)
      .join("、") || "なし"}`,
    "",
    "■ 考えられる原因",
    "配信ボリューム増加に対してCVが追随していない可能性。",
    "",
    "■ 優先アクション（最大3）",
    "1. CPA悪化媒体の入札/予算を段階調整",
    "2. CTR低下面のクリエイティブ差し替え",
    "3. CV計測タグの発火確認",
    "",
    "■ 参考ヘルプ",
    "bidding, creative, conversion_tracking",
  ].join("\n");
}

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

function resolveAiRuntime() {
  return env.aiRuntime;
}

function buildLegacyGeneratePrompt(payload: AiInsightRequest) {
  return `広告運用アシスタントとして、入力JSONを根拠に簡潔に提案してください。\n入力JSON: ${JSON.stringify(payload)}`;
}

function buildLegacyChatPrompt(messages: ChatMessage[], context?: unknown) {
  const conversation = messages
    .map((m) => `${m.role === "user" ? "ユーザー" : "アシスタント"}: ${m.content}`)
    .join("\n");
  return `広告運用アシスタントとして会話に回答してください。\ncontext: ${JSON.stringify(context ?? null)}\n${conversation}`;
}

async function requestGemini(prompt: string): Promise<
  | { ok: true; text: string; model: string }
  | { ok: false; reason: string }
> {
  if (!env.geminiApiKey) {
    return { ok: false, reason: "GEMINI_API_KEY が未設定です。" };
  }

  const failures: string[] = [];
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.geminiApiKey}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        failures.push(`${model}:${res.status}`);
        console.error("Gemini request failed", {
          model,
          status: res.status,
          body: body.slice(0, 400),
        });
        continue;
      }

      const json = await res.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text === "string" && text.trim()) {
        return { ok: true, text, model };
      }
      failures.push(`${model}:empty_response`);
    } catch (error) {
      failures.push(`${model}:network_error`);
      console.error("Gemini request exception", { model, error });
    }
  }

  return { ok: false, reason: `全モデル失敗: ${failures.join(", ")}` };
}

async function requestGeminiStream(
  prompt: string,
  onDelta: (delta: string) => void,
): Promise<
  | { ok: true; text: string; model: string }
  | { ok: false; reason: string }
> {
  if (!env.geminiApiKey) {
    return { ok: false, reason: "GEMINI_API_KEY が未設定です。" };
  }

  const failures: string[] = [];
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${env.geminiApiKey}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      });

      if (!res.ok || !res.body) {
        const body = await res.text();
        failures.push(`${model}:${res.status}`);
        console.error("Gemini stream failed", {
          model,
          status: res.status,
          body: body.slice(0, 400),
        });
        continue;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) {
            continue;
          }
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") {
            continue;
          }

          try {
            const json = JSON.parse(data);
            const candidateText =
              json.candidates?.[0]?.content?.parts
                ?.map((part: { text?: string }) => part?.text ?? "")
                .join("") ?? "";
            if (!candidateText) {
              continue;
            }

            let delta = candidateText;
            if (candidateText.startsWith(fullText)) {
              delta = candidateText.slice(fullText.length);
              fullText = candidateText;
            } else {
              fullText += candidateText;
            }

            if (delta) {
              onDelta(delta);
            }
          } catch (error) {
            console.error("Gemini stream parse failed", { model, error, data: data.slice(0, 120) });
          }
        }
      }

      if (fullText.trim()) {
        return { ok: true, text: fullText, model };
      }

      failures.push(`${model}:empty_response`);
    } catch (error) {
      failures.push(`${model}:network_error`);
      console.error("Gemini stream exception", { model, error });
    }
  }

  return { ok: false, reason: `全モデル失敗: ${failures.join(", ")}` };
}

function emitTextChunks(text: string, onDelta: (delta: string) => void) {
  const chunks = text.match(/.{1,24}/g) ?? [];
  for (const chunk of chunks) {
    onDelta(chunk);
  }
}

function getRuntimeDeps(): AgentRuntimeDeps {
  return {
    requestText: requestGemini,
    requestStream: requestGeminiStream,
    emitChunks: emitTextChunks,
  };
}

async function legacyGenerate(payload: AiInsightRequest): Promise<AiInsightResponse> {
  if (!env.geminiApiKey) {
    return { text: mockText(payload), mode: "mock", fallbackReason: "GEMINI_API_KEY が未設定です。" };
  }

  const prompt = buildLegacyGeneratePrompt(payload);
  const result = await requestGemini(prompt);
  if (!result.ok) {
    return {
      text: `Gemini接続に失敗したためモック結果を表示しています。\n\n${mockText(payload)}`,
      mode: "mock",
      fallbackReason: result.reason,
    };
  }

  return { text: result.text, mode: "gemini" };
}

export async function generateInsight(payload: AiInsightRequest): Promise<AiInsightResponse> {
  if (resolveAiRuntime() === "legacy") {
    return legacyGenerate(payload);
  }

  const result = await runGeneratePipeline(payload, getRuntimeDeps());
  return {
    text: result.text,
    mode: result.mode,
    fallbackReason: result.fallbackReason,
  };
}

export async function chatReply(messages: ChatMessage[], context?: unknown): Promise<ChatMessage> {
  const latest = [...messages].reverse().find((m) => m.role === "user");

  if (resolveAiRuntime() === "adk") {
    const result = await runChatPipeline(messages, context, () => undefined, getRuntimeDeps());
    return result.message;
  }

  if (!env.geminiApiKey) {
    return {
      role: "assistant",
      content: `モック応答: ${latest?.content ?? "質問を受け取りました"} に対する次アクションを提示します。`,
      createdAt: new Date().toISOString(),
    };
  }

  const prompt = buildLegacyChatPrompt(messages, context);
  const result = await requestGemini(prompt);
  if (result.ok) {
    return {
      role: "assistant",
      content: result.text,
      createdAt: new Date().toISOString(),
    };
  }

  return {
    role: "assistant",
    content: `Gemini接続に失敗したためモック応答です: ${latest?.content ?? "質問を受け取りました"}\n(${result.reason})`,
    createdAt: new Date().toISOString(),
  };
}

export async function streamChatReply(
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  context?: unknown,
  onTool?: (event: ToolTraceEvent) => void,
): Promise<ChatMessage> {
  const latest = [...messages].reverse().find((m) => m.role === "user");
  const createdAt = new Date().toISOString();

  if (resolveAiRuntime() === "adk") {
    const result = await runChatPipeline(messages, context, onDelta, getRuntimeDeps(), onTool);
    return result.message;
  }

  if (!env.geminiApiKey) {
    const content = `モック応答: ${latest?.content ?? "質問を受け取りました"} に対する次アクションを提示します。`;
    emitTextChunks(content, onDelta);
    return {
      role: "assistant",
      content,
      createdAt,
    };
  }

  const prompt = buildLegacyChatPrompt(messages, context);
  const result = await requestGeminiStream(prompt, onDelta);
  if (result.ok) {
    return {
      role: "assistant",
      content: result.text,
      createdAt,
    };
  }

  const fallback = `Gemini接続に失敗したためモック応答です: ${latest?.content ?? "質問を受け取りました"}\n(${result.reason})`;
  emitTextChunks(fallback, onDelta);
  return {
    role: "assistant",
    content: fallback,
    createdAt,
  };
}
