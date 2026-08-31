import assert from "node:assert/strict";
import test from "node:test";

import { calculateUsageCharge, parseAgentUsage, rateCatalogConfigurationIssues } from "./usage.js";

test("Agents SDK usage preserves the full token breakdown", () => {
  assert.deepEqual(parseAgentUsage({
    model: "gpt-test",
    requests: 2,
    inputTokens: 1000,
    cachedInputTokens: 400,
    outputTokens: 200,
    reasoningTokens: 50,
    totalTokens: 1200,
  }), {
    model: "gpt-test",
    requests: 2,
    inputTokens: 1000,
    cachedInputTokens: 400,
    outputTokens: 200,
    reasoningTokens: 50,
    totalTokens: 1200,
  });
  assert.equal(parseAgentUsage({ totalTokens: 10 }), null);
});

test("point-in-time model rates produce microunit cost and credit units", () => {
  withUsageEnv(() => {
    const charge = calculateUsageCharge({
      model: "gpt-test",
      requests: 1,
      inputTokens: 1000,
      cachedInputTokens: 400,
      outputTokens: 200,
      reasoningTokens: 50,
      totalTokens: 1200,
    });
    // outputTokens includes reasoningTokens: (600*1) + (400*0.1) + (150*2) + (50*3) micro-USD.
    assert.deepEqual(charge, { estimatedCostMicrounits: 1090, creditUnits: 2, rateVersion: "test-v1" });
    assert.deepEqual(rateCatalogConfigurationIssues(), []);
  });
});

test("an unknown runtime model fails closed even when a catalog exists", () => {
  withUsageEnv(() => {
    const charge = calculateUsageCharge({
      model: "gpt-unapproved",
      requests: 1,
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 20,
      reasoningTokens: 0,
      totalTokens: 120,
    });
    assert.equal(charge.estimatedCostMicrounits, 0);
    assert.equal(charge.rateVersion, "unconfigured");
  });
});

test("missing model-rate catalog is explicitly unconfigured", () => {
  const original = process.env.MODEL_COST_CATALOG_JSON;
  delete process.env.MODEL_COST_CATALOG_JSON;
  try {
    assert.ok(rateCatalogConfigurationIssues().length > 0);
  } finally {
    if (original !== undefined) process.env.MODEL_COST_CATALOG_JSON = original;
  }
});

function withUsageEnv(run: () => void) {
  const originalCatalog = process.env.MODEL_COST_CATALOG_JSON;
  const originalCredits = process.env.AI_CREDIT_TOKENS;
  process.env.MODEL_COST_CATALOG_JSON = JSON.stringify({
    version: "test-v1",
    currency: "usd",
    models: { "gpt-test": { inputPerMillion: 1, cachedInputPerMillion: 0.1, outputPerMillion: 2, reasoningPerMillion: 3 } },
  });
  process.env.AI_CREDIT_TOKENS = "1000";
  try {
    run();
  } finally {
    if (originalCatalog === undefined) delete process.env.MODEL_COST_CATALOG_JSON;
    else process.env.MODEL_COST_CATALOG_JSON = originalCatalog;
    if (originalCredits === undefined) delete process.env.AI_CREDIT_TOKENS;
    else process.env.AI_CREDIT_TOKENS = originalCredits;
  }
}
