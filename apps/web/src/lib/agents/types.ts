import type { AiInsightRequest, ChatMessage, Platform } from "@/types/domain";

export type AgentIntent = "generate" | "chat";

export type AgentContext = {
  intent: AgentIntent;
  insight: AiInsightRequest | null;
  chatMessages: ChatMessage[];
  userQuery: string;
  rawContext?: unknown;
};

export type PlatformInsightInput = {
  platform: Platform | "all";
  insight: AiInsightRequest;
};

export type PlatformInsightOutput = {
  platform: Platform | "all";
  finding: string;
  evidence: string[];
  actions: string[];
  tags: string[];
};

export type GuardrailResult = {
  ok: boolean;
  reasons: string[];
};

export type RuntimeMode = "mock" | "gemini";

export type RuntimeGenerateResult = {
  text: string;
  mode: RuntimeMode;
  fallbackReason?: string;
};

export type RuntimeChatResult = {
  message: ChatMessage;
  mode: RuntimeMode;
  fallbackReason?: string;
};

export type ToolTraceEvent = {
  phase: "start" | "done";
  tool: string;
  platform?: Platform | "all";
};

export type LlmTextResult =
  | { ok: true; text: string; model: string }
  | { ok: false; reason: string };

export type LlmTextRequest = (prompt: string) => Promise<LlmTextResult>;

export type LlmStreamRequest = (
  prompt: string,
  onDelta: (delta: string) => void,
) => Promise<LlmTextResult>;

export type AgentRuntimeDeps = {
  requestText: LlmTextRequest;
  requestStream: LlmStreamRequest;
  emitChunks: (text: string, onDelta: (delta: string) => void) => void;
};
