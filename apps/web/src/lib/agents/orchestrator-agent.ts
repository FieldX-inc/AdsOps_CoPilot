import type {
  AgentContext,
  PlatformInsightInput,
  PlatformInsightOutput,
  ToolTraceEvent,
} from "@/lib/agents/types";
import { analyzeCrossPlatform } from "@/lib/agents/tools/analyze-cross-platform";
import { analyzeGoogle } from "@/lib/agents/tools/analyze-google";
import { analyzeMeta } from "@/lib/agents/tools/analyze-meta";
import { analyzeTikTok } from "@/lib/agents/tools/analyze-tiktok";
import { analyzeYahoo } from "@/lib/agents/tools/analyze-yahoo";
import type { AiInsightRequest, ChatMessage, Platform } from "@/types/domain";

function hasInsightShape(value: unknown): value is AiInsightRequest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.summary === "object" &&
    Array.isArray(obj.anomalies) &&
    Array.isArray(obj.top_campaigns) &&
    typeof obj.period === "string"
  );
}

export function coerceInsightRequest(input: unknown): AiInsightRequest | null {
  if (hasInsightShape(input)) {
    return input;
  }
  return null;
}

export function createAgentContext(params: {
  intent: AgentContext["intent"];
  insight?: AiInsightRequest | null;
  rawContext?: unknown;
  chatMessages?: ChatMessage[];
}): AgentContext {
  const chatMessages = params.chatMessages ?? [];
  const latestUser = [...chatMessages].reverse().find((item) => item.role === "user");

  return {
    intent: params.intent,
    insight: params.insight ?? null,
    chatMessages,
    userQuery: latestUser?.content ?? "",
    rawContext: params.rawContext,
  };
}

function inferPlatforms(context: AgentContext): Array<Platform | "all"> {
  if (!context.insight) {
    return [];
  }

  const anomalies = context.insight.anomalies;
  const detected = new Set<Platform>();
  for (const row of anomalies) {
    if (row.platform === "google" || row.platform === "yahoo" || row.platform === "meta" || row.platform === "tiktok") {
      detected.add(row.platform);
    }
  }

  if (!detected.size) {
    return ["google", "yahoo", "meta", "tiktok", "all"];
  }

  return [...detected, "all"];
}

export function runOrchestrator(
  context: AgentContext,
  onTool?: (event: ToolTraceEvent) => void,
): PlatformInsightOutput[] {
  if (!context.insight) {
    return [];
  }

  const platforms = inferPlatforms(context);
  const outputs: PlatformInsightOutput[] = [];

  for (const platform of platforms) {
    const input: PlatformInsightInput = {
      platform,
      insight: context.insight,
    };

    if (platform === "google") {
      onTool?.({ phase: "start", tool: "analyze_google", platform });
      outputs.push(analyzeGoogle(input));
      onTool?.({ phase: "done", tool: "analyze_google", platform });
      continue;
    }
    if (platform === "yahoo") {
      onTool?.({ phase: "start", tool: "analyze_yahoo", platform });
      outputs.push(analyzeYahoo(input));
      onTool?.({ phase: "done", tool: "analyze_yahoo", platform });
      continue;
    }
    if (platform === "meta") {
      onTool?.({ phase: "start", tool: "analyze_meta", platform });
      outputs.push(analyzeMeta(input));
      onTool?.({ phase: "done", tool: "analyze_meta", platform });
      continue;
    }
    if (platform === "tiktok") {
      onTool?.({ phase: "start", tool: "analyze_tiktok", platform });
      outputs.push(analyzeTikTok(input));
      onTool?.({ phase: "done", tool: "analyze_tiktok", platform });
      continue;
    }

    onTool?.({ phase: "start", tool: "analyze_cross_platform", platform: "all" });
    outputs.push(analyzeCrossPlatform(input));
    onTool?.({ phase: "done", tool: "analyze_cross_platform", platform: "all" });
  }

  return outputs;
}
