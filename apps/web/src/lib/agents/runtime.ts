import {
  coerceInsightRequest,
  createAgentContext,
  runOrchestrator,
} from "@/lib/agents/orchestrator-agent";
import { validateChatOutput, validateGenerateOutput } from "@/lib/agents/guardrail-agent";
import {
  buildDeterministicInsight,
  regenerateWithGuardrail,
  runInsightChat,
  runInsightGenerate,
} from "@/lib/agents/insight-agent";
import { fetchHelpArticlesByTags } from "@/lib/agents/tools/fetch-help-articles";
import type {
  AgentRuntimeDeps,
  RuntimeChatResult,
  RuntimeGenerateResult,
  ToolTraceEvent,
} from "@/lib/agents/types";
import type { AiInsightRequest, ChatMessage } from "@/types/domain";

function attachHelpTags(baseText: string, tags: string[]) {
  if (!tags.length) {
    return baseText;
  }
  if (baseText.includes("■ 参考ヘルプ")) {
    return baseText;
  }
  return `${baseText}\n\n■ 参考ヘルプ\n${tags.join(", ")}`;
}

function extractTagsFromText(text: string): string[] {
  const line = text
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.includes(",") && /^[a-z_,\s]+$/i.test(item));

  if (!line) {
    return [];
  }

  return [...new Set(line.split(",").map((item) => item.trim()).filter(Boolean))];
}

export async function runGeneratePipeline(
  payload: AiInsightRequest,
  deps: AgentRuntimeDeps,
): Promise<RuntimeGenerateResult> {
  const context = createAgentContext({ intent: "generate", insight: payload });
  const orchestrated = runOrchestrator(context);

  const initial = await runInsightGenerate(context, orchestrated, deps.requestText);
  let next = initial;

  const guardrail = validateGenerateOutput(next.text);
  if (!guardrail.ok) {
    next = await regenerateWithGuardrail(
      guardrail.reasons.join(","),
      next.text,
      context,
      orchestrated,
      deps.requestText,
    );

    const second = validateGenerateOutput(next.text);
    if (!second.ok) {
      const fallback = buildDeterministicInsight(context, orchestrated);
      return {
        text: fallback,
        mode: "mock",
        fallbackReason: `guardrail_failed:${second.reasons.join(",")}`,
      };
    }
  }

  const tags = extractTagsFromText(next.text);
  const articles = await fetchHelpArticlesByTags(tags);
  const articleTags = [...new Set(articles.flatMap((item) => item.tags))].slice(0, 3);

  return {
    text: attachHelpTags(next.text, articleTags),
    mode: next.mode,
    fallbackReason: next.fallbackReason,
  };
}

export async function runChatPipeline(
  messages: ChatMessage[],
  contextInput: unknown,
  onDelta: (delta: string) => void,
  deps: AgentRuntimeDeps,
  onTool?: (event: ToolTraceEvent) => void,
): Promise<RuntimeChatResult> {
  const insight = coerceInsightRequest(contextInput);

  const context = createAgentContext({
    intent: "chat",
    insight,
    rawContext: contextInput,
    chatMessages: messages,
  });

  const orchestrated = runOrchestrator(context, onTool);
  const chat = await runInsightChat(context, orchestrated, {
    requestText: deps.requestText,
  });

  let finalText = chat.text;
  const guardrail = validateChatOutput(finalText, Boolean(context.insight));

  if (!guardrail.ok) {
    finalText = buildDeterministicInsight(context, orchestrated);
  }

  deps.emitChunks(finalText, onDelta);

  return {
    message: {
      role: "assistant",
      content: finalText,
      createdAt: new Date().toISOString(),
    },
    mode: guardrail.ok ? chat.mode : "mock",
    fallbackReason: !guardrail.ok
      ? `guardrail_failed:${guardrail.reasons.join(",")}`
      : chat.fallbackReason,
  };
}
