export type AgentUsage = {
  model: string;
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

type ModelRate = {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
  reasoningPerMillion: number;
};

type RateCatalog = {
  version: string;
  currency: string;
  models: Record<string, ModelRate>;
};

export function parseAgentUsage(value: unknown): AgentUsage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const model = typeof item.model === "string" ? item.model.trim() : "";
  if (!model) return null;
  const usage = {
    model,
    requests: integer(item.requests),
    inputTokens: integer(item.inputTokens),
    cachedInputTokens: integer(item.cachedInputTokens),
    outputTokens: integer(item.outputTokens),
    reasoningTokens: integer(item.reasoningTokens),
    totalTokens: integer(item.totalTokens),
  };
  if (usage.totalTokens === 0) usage.totalTokens = usage.inputTokens + usage.outputTokens;
  return usage;
}

export function rateCatalogConfigurationIssues() {
  const catalog = rateCatalog();
  if (!catalog) return ["MODEL_COST_CATALOG_JSON must contain a version and model rates"];
  return [];
}

export function calculateUsageCharge(usage: AgentUsage) {
  const catalog = rateCatalog();
  const rate = catalog?.models[usage.model];
  const cachedInput = Math.min(usage.inputTokens, usage.cachedInputTokens);
  const uncachedInput = Math.max(0, usage.inputTokens - cachedInput);
  // Agents SDK output_tokens includes reasoning_tokens. Price the visible output
  // and reasoning portions separately so reasoning is not counted twice.
  const reasoningOutput = Math.min(usage.outputTokens, usage.reasoningTokens);
  const nonReasoningOutput = Math.max(0, usage.outputTokens - reasoningOutput);
  const estimatedCostMicrounits = rate
    ? Math.round(
        uncachedInput * rate.inputPerMillion
        + cachedInput * rate.cachedInputPerMillion
        + nonReasoningOutput * rate.outputPerMillion
        + reasoningOutput * rate.reasoningPerMillion,
      )
    : 0;
  const tokensPerCredit = positiveInteger(process.env.AI_CREDIT_TOKENS) ?? 1000;
  return {
    estimatedCostMicrounits,
    creditUnits: usage.totalTokens === 0 ? 0 : Math.ceil(usage.totalTokens / tokensPerCredit),
    rateVersion: rate ? catalog.version : "unconfigured",
  };
}

function rateCatalog(): RateCatalog | null {
  const raw = process.env.MODEL_COST_CATALOG_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const version = typeof parsed.version === "string" ? parsed.version.trim() : "";
    const currency = typeof parsed.currency === "string" ? parsed.currency.trim().toLowerCase() : "usd";
    if (!version || !parsed.models || typeof parsed.models !== "object") return null;
    const models: Record<string, ModelRate> = {};
    for (const [model, value] of Object.entries(parsed.models as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const item = value as Record<string, unknown>;
      models[model] = {
        inputPerMillion: nonNegativeNumber(item.inputPerMillion),
        cachedInputPerMillion: nonNegativeNumber(item.cachedInputPerMillion),
        outputPerMillion: nonNegativeNumber(item.outputPerMillion),
        reasoningPerMillion: nonNegativeNumber(item.reasoningPerMillion),
      };
    }
    return Object.keys(models).length ? { version, currency, models } : null;
  } catch {
    return null;
  }
}

function integer(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}
