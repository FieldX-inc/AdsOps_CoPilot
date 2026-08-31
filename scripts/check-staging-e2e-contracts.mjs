#!/usr/bin/env node

import { spawn } from "node:child_process";
import http from "node:http";

const issues = [];

await runContract("Google status write requires a meaningful rollback note and different restore status", {
  env: {
    CHECK_GOOGLE_WRITE: "true",
    CONFIRM_GOOGLE_WRITE: "true",
    GOOGLE_CUSTOMER_ID: "1234567890",
    GOOGLE_CAMPAIGN_ID: "987654321",
    GOOGLE_WRITE_KIND: "status",
    GOOGLE_WRITE_STATUS: "PAUSED",
    GOOGLE_RESTORE_STATUS: "PAUSED",
    GOOGLE_WRITE_ROLLBACK: "short",
  },
  expectStatus: 1,
  mustIncludeStderr: [
    "GOOGLE_WRITE_ROLLBACK to at least 20 characters",
    "GOOGLE_WRITE_STATUS different from GOOGLE_RESTORE_STATUS",
  ],
});

await runContract("Google budget write is rejected for real-provider staging E2E", {
  env: {
    CHECK_GOOGLE_WRITE: "true",
    CONFIRM_GOOGLE_WRITE: "true",
    GOOGLE_CUSTOMER_ID: "1234567890",
    GOOGLE_CAMPAIGN_ID: "987654321",
    GOOGLE_WRITE_KIND: "budget",
    GOOGLE_WRITE_AMOUNT: "1000",
    GOOGLE_RESTORE_AMOUNT: "1000",
    GOOGLE_WRITE_ROLLBACK: "increase to 1000 then restore to 1000 after audit observation",
  },
  expectStatus: 1,
  mustIncludeStderr: ["GOOGLE_WRITE_KIND=status only", "budget is provider-fake/contract-test only"],
});

await runContract("Google status write rejects non-reversible REMOVED status", {
  env: {
    CHECK_GOOGLE_WRITE: "true",
    CONFIRM_GOOGLE_WRITE: "true",
    GOOGLE_CUSTOMER_ID: "1234567890",
    GOOGLE_CAMPAIGN_ID: "987654321",
    GOOGLE_WRITE_KIND: "status",
    GOOGLE_WRITE_STATUS: "REMOVED",
    GOOGLE_RESTORE_STATUS: "ENABLED",
    GOOGLE_WRITE_ROLLBACK: "restore campaign status to ENABLED after audit observation",
  },
  expectStatus: 1,
  mustIncludeStderr: ["GOOGLE_WRITE_STATUS to ENABLED or PAUSED"],
});

await runContract("Google status write evidence requires approval metadata on write and restore audit logs", {
  env: {
    CHECK_AGENT: "false",
    CHECK_STRIPE: "false",
    CHECK_BILLING_GATE: "false",
    CHECK_GOOGLE_READ: "false",
    CHECK_GOOGLE_WRITE: "true",
    CONFIRM_GOOGLE_WRITE: "true",
    GOOGLE_CUSTOMER_ID: "1234567890",
    GOOGLE_CAMPAIGN_ID: "987654321",
    GOOGLE_WRITE_KIND: "status",
    GOOGLE_WRITE_STATUS: "PAUSED",
    GOOGLE_RESTORE_STATUS: "ENABLED",
    GOOGLE_WRITE_ROLLBACK: "restore campaign status to ENABLED after audit observation",
  },
  expectStatus: 0,
  useLocalApi: true,
  googleWriteScenario: "completeApprovalMetadata",
  mustIncludeStdout: ["export GOOGLE_ADS_STAGING_E2E_PASSED_AT="],
  mustNotIncludeStdout: [
    "export OPENAI_AGENT_STAGING_E2E_PASSED_AT=",
    "export STRIPE_STAGING_E2E_PASSED_AT=",
  ],
});

await runContract("Google status write evidence rejects restore audit without approval metadata", {
  env: {
    CHECK_AGENT: "false",
    CHECK_STRIPE: "false",
    CHECK_BILLING_GATE: "false",
    CHECK_GOOGLE_READ: "false",
    CHECK_GOOGLE_WRITE: "true",
    CONFIRM_GOOGLE_WRITE: "true",
    GOOGLE_CUSTOMER_ID: "1234567890",
    GOOGLE_CAMPAIGN_ID: "987654321",
    GOOGLE_WRITE_KIND: "status",
    GOOGLE_WRITE_STATUS: "PAUSED",
    GOOGLE_RESTORE_STATUS: "ENABLED",
    GOOGLE_WRITE_ROLLBACK: "restore campaign status to ENABLED after audit observation",
  },
  expectStatus: 1,
  useLocalApi: true,
  googleWriteScenario: "missingRestoreApprovalMetadata",
  mustIncludeStderr: ["Google write audit: expected recent google_ads.campaign_status_updated", "audit log with approval metadata"],
  mustNotIncludeStdout: ["export GOOGLE_ADS_STAGING_E2E_PASSED_AT="],
});

await runContract("Google status write evidence requires final provider live preview to match restore status", {
  env: {
    CHECK_AGENT: "false",
    CHECK_STRIPE: "false",
    CHECK_BILLING_GATE: "false",
    CHECK_GOOGLE_READ: "false",
    CHECK_GOOGLE_WRITE: "true",
    CONFIRM_GOOGLE_WRITE: "true",
    GOOGLE_CUSTOMER_ID: "1234567890",
    GOOGLE_CAMPAIGN_ID: "987654321",
    GOOGLE_WRITE_KIND: "status",
    GOOGLE_WRITE_STATUS: "PAUSED",
    GOOGLE_RESTORE_STATUS: "ENABLED",
    GOOGLE_WRITE_ROLLBACK: "restore campaign status to ENABLED after audit observation",
  },
  expectStatus: 1,
  useLocalApi: true,
  googleWriteScenario: "finalLivePreviewMismatch",
  mustIncludeStderr: ["Google status final live preview", "audit rows alone are not sufficient evidence"],
  mustNotIncludeStdout: ["export GOOGLE_ADS_STAGING_E2E_PASSED_AT="],
});

await runContract("Stripe full evidence requires checkout, existing customer reuse, webhook, billing gate, and mismatch confirmation", {
  env: {
    CONFIRM_STRIPE_FULL_E2E: "true",
    STRIPE_FULL_E2E_CONFIRMATION: "checkout only",
    CHECK_AGENT: "false",
    CHECK_STRIPE: "false",
    CHECK_BILLING_GATE: "false",
    CHECK_GOOGLE_READ: "false",
  },
  expectStatus: 1,
  mustIncludeStderr: ["STRIPE_FULL_E2E_CONFIRMATION", "checkout, existing customer reuse, webhook, billing gate, and customer/workspace mismatch rejection"],
});

await runContract("Stripe full evidence requires the billing gate check and unpaid token", {
  env: {
    CONFIRM_STRIPE_FULL_E2E: "true",
    STRIPE_FULL_E2E_CONFIRMATION: "checkout completed; existing customer reuse verified; webhook rows updated; billing gate verified; customer/workspace mismatch rejected",
    CHECK_AGENT: "false",
    CHECK_STRIPE: "false",
    CHECK_BILLING_GATE: "false",
    CHECK_GOOGLE_READ: "false",
  },
  expectStatus: 1,
  mustIncludeStderr: ["Keep CHECK_BILLING_GATE=true when CONFIRM_STRIPE_FULL_E2E=true"],
});

await runContract("Stripe full evidence requires authenticated unpaid billing gate evidence", {
  env: {
    CONFIRM_STRIPE_FULL_E2E: "true",
    STRIPE_FULL_E2E_CONFIRMATION: "checkout completed; existing customer reuse verified; webhook rows updated; billing gate verified; customer/workspace mismatch rejected",
    CHECK_AGENT: "false",
    CHECK_STRIPE: "false",
    CHECK_GOOGLE_READ: "false",
  },
  expectStatus: 1,
  mustIncludeStderr: ["Set UNPAID_AUTH_TOKEN when CONFIRM_STRIPE_FULL_E2E=true"],
});

await runContract("Staging E2E refuses production-looking API origins before provider calls", {
  env: {
    API_ORIGIN: "https://api.example.com",
    CHECK_AGENT: "false",
    CHECK_STRIPE: "false",
    CHECK_BILLING_GATE: "false",
    CHECK_GOOGLE_READ: "false",
  },
  expectStatus: 1,
  mustIncludeStderr: ["API_ORIGIN does not look like staging/local/test"],
});

await runContract("Agent staging evidence requires AGENT_SERVICE_URL instead of legacy ADK_AGENT_URL", {
  env: {
    ADK_AGENT_URL: "https://legacy-agent.staging.example.com",
    CHECK_STRIPE: "false",
    CHECK_BILLING_GATE: "false",
    CHECK_GOOGLE_READ: "false",
  },
  expectStatus: 1,
  useLocalApi: true,
  mustIncludeStderr: [
    "Set AGENT_SERVICE_URL to the deployed OpenAI Agent Service origin",
    "Legacy ADK_AGENT_URL is not accepted",
    "Remove legacy ADK agent aliases before staging evidence: ADK_AGENT_URL",
  ],
});

await runContract("Agent staging evidence rejects legacy ADK runtime switches", {
  env: {
    USE_ADK_AGENT: "true",
    ADK_AGENT_TIMEOUT_MS: "35000",
    CHECK_STRIPE: "false",
    CHECK_BILLING_GATE: "false",
    CHECK_GOOGLE_READ: "false",
  },
  expectStatus: 1,
  useLocalApi: true,
  agentHealth: {
    ok: true,
    service: "openai-agent",
    mode: "openai",
    selectedRuntime: "openai",
  },
  mustIncludeStderr: ["Remove legacy ADK agent aliases before staging evidence: USE_ADK_AGENT, ADK_AGENT_TIMEOUT_MS"],
});

await runContract("Agent health requires selected OpenAI runtime before staging evidence", {
  env: {
    CHECK_STRIPE: "false",
    CHECK_BILLING_GATE: "false",
    CHECK_GOOGLE_READ: "false",
  },
  expectStatus: 1,
  useLocalApi: true,
  agentHealth: {
    ok: true,
    service: "openai-agent",
    mode: "openai",
    selectedRuntime: "mock",
  },
  mustIncludeStderr: ["expected selectedRuntime=openai/openai_agents"],
  mustNotIncludeStdout: ["OPENAI_AGENT_STAGING_E2E_PASSED_AT"],
});

await runStripeWebhookContract("Stripe webhook E2E refuses production-looking API origins before writes", {
  env: {
    API_ORIGIN: "https://api.example.com",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    WORKSPACE_ID: "workspace-test",
    USER_ID: "user-test",
    AUTH_TOKEN: "test-token",
    CONFIRM_STRIPE_WEBHOOK_TEST: "true",
  },
  expectStatus: 1,
  mustIncludeStderr: ["API_ORIGIN does not look like staging/local/test"],
});

await runStripeWebhookContract("Stripe webhook E2E requires handled webhook responses", {
  env: {
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    WORKSPACE_ID: "workspace-test",
    USER_ID: "user-test",
    CONFIRM_STRIPE_WEBHOOK_TEST: "true",
    CHECK_BILLING_STATUS: "false",
    CHECK_STRIPE_WEBHOOK_MISMATCH: "false",
  },
  useLocalWebhookApi: true,
  expectStatus: 1,
  mustIncludeStderr: ["expected handled=true"],
});

await runStripeWebhookContract("Stripe webhook E2E prints only webhook evidence export on success", {
  env: {
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    WORKSPACE_ID: "workspace-test",
    USER_ID: "user-test",
    CONFIRM_STRIPE_WEBHOOK_TEST: "true",
    CHECK_BILLING_STATUS: "false",
    CHECK_STRIPE_WEBHOOK_MISMATCH: "false",
  },
  useLocalWebhookApi: true,
  webhookResponse: { received: true, handled: true },
  expectStatus: 0,
  mustIncludeStdout: [
    "Webhook evidence env candidate; this is not the full Stripe production evidence timestamp:",
    "export STRIPE_WEBHOOK_STAGING_E2E_PASSED_AT=",
  ],
  mustNotIncludeStdout: ["export STRIPE_STAGING_E2E_PASSED_AT="],
});

await runStripeWebhookContract("Stripe webhook E2E detects workspace mismatch rejection", {
  env: {
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    WORKSPACE_ID: "11111111-1111-4111-8111-111111111111",
    USER_ID: "11111111-1111-4111-8111-111111111111",
    CONFIRM_STRIPE_WEBHOOK_TEST: "true",
    CHECK_BILLING_STATUS: "false",
    CHECK_STRIPE_WEBHOOK_MISMATCH: "true",
    STRIPE_MISMATCH_WORKSPACE_ID: "99999999-9999-4999-8999-999999999999",
  },
  useLocalWebhookApi: true,
  webhookResponse: {
    received: true,
    handled: true,
    mismatchWorkspaceId: "99999999-9999-4999-8999-999999999999",
    mismatchError: "webhook customer is already linked to another workspace.",
    mismatchStatusCode: 400,
  },
  expectStatus: 0,
  mustIncludeStdout: [
    "Webhook evidence env candidate; this is not the full Stripe production evidence timestamp:",
    "export STRIPE_WEBHOOK_STAGING_E2E_PASSED_AT=",
  ],
  mustNotIncludeStdout: ["export STRIPE_STAGING_E2E_PASSED_AT="],
});

await runContract("Agent staging evidence prints export only after OpenAI runtime checks pass", {
  env: {
    CHECK_STRIPE: "false",
    CHECK_BILLING_GATE: "false",
    CHECK_GOOGLE_READ: "false",
  },
  expectStatus: 0,
  useLocalApi: true,
  agentHealth: {
    ok: true,
    service: "openai-agent",
    mode: "openai",
    selectedRuntime: "openai",
  },
  mustIncludeStdout: [
    "Evidence env candidates; copy only the lines backed by this run and recorded operator evidence:",
    "export OPENAI_AGENT_STAGING_E2E_PASSED_AT=",
  ],
  mustNotIncludeStdout: [
    "export GOOGLE_ADS_STAGING_E2E_PASSED_AT=",
    "export STRIPE_STAGING_E2E_PASSED_AT=",
  ],
});

await runContract("Minimal no-op staging E2E can pass without evidence when all optional sections are off", {
  env: {
    CHECK_AGENT: "false",
    CHECK_STRIPE: "false",
    CHECK_BILLING_GATE: "false",
    CHECK_GOOGLE_READ: "false",
  },
  expectStatus: 0,
  useLocalApi: true,
  mustIncludeStdout: ["Staging E2E passed."],
  mustNotIncludeStdout: [
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
    "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
    "STRIPE_STAGING_E2E_PASSED_AT",
  ],
});

if (issues.length) {
  console.error("Staging E2E contract check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Staging E2E contract check passed.");

async function runContract(name, contract) {
  const api = contract.useLocalApi ? await createApiServer(contract.googleWriteScenario) : null;
  const agent = contract.agentHealth ? await createJsonServer(contract.agentHealth) : null;
  try {
    const result = await runStagingE2e(contract.env, {
      ...(api ? { API_ORIGIN: origin(api) } : {}),
      ...(agent ? { AGENT_SERVICE_URL: origin(agent) } : {}),
    });
    if (result.status !== contract.expectStatus) {
      issues.push(`${name}: expected exit ${contract.expectStatus}, got ${result.status}. stdout=${result.stdout} stderr=${result.stderr}`);
    }
    for (const snippet of contract.mustIncludeStdout ?? []) {
      if (!result.stdout.includes(snippet)) {
        issues.push(`${name}: stdout missing "${snippet}"`);
      }
    }
    for (const snippet of contract.mustNotIncludeStdout ?? []) {
      if (result.stdout.includes(snippet)) {
        issues.push(`${name}: stdout must not include "${snippet}"`);
      }
    }
    for (const snippet of contract.mustIncludeStderr ?? []) {
      if (!result.stderr.includes(snippet)) {
        issues.push(`${name}: stderr missing "${snippet}"`);
      }
    }
  } finally {
    if (api) await closeServer(api);
    if (agent) await closeServer(agent);
  }
}

async function runStripeWebhookContract(name, contract) {
  const api = contract.useLocalWebhookApi ? await createStripeWebhookApiServer(contract.webhookResponse) : null;
  try {
    const result = await runScript("scripts/stripe-webhook-e2e.mjs", {
      ...(api ? { API_ORIGIN: origin(api) } : {}),
      ...contract.env,
    });
    if (result.status !== contract.expectStatus) {
      issues.push(`${name}: expected exit ${contract.expectStatus}, got ${result.status}. stdout=${result.stdout} stderr=${result.stderr}`);
    }
    for (const snippet of contract.mustIncludeStderr ?? []) {
      if (!result.stderr.includes(snippet)) {
        issues.push(`${name}: stderr missing "${snippet}"`);
      }
    }
    for (const snippet of contract.mustIncludeStdout ?? []) {
      if (!result.stdout.includes(snippet)) {
        issues.push(`${name}: stdout missing "${snippet}"`);
      }
    }
    for (const snippet of contract.mustNotIncludeStdout ?? []) {
      if (result.stdout.includes(snippet)) {
        issues.push(`${name}: stdout must not include "${snippet}"`);
      }
    }
  } finally {
    if (api) await closeServer(api);
  }
}

function createApiServer(googleWriteScenario = "") {
  return new Promise((resolve) => {
    const context = {
      googleWriteScenario,
      googleWriteAuditLogs: [],
      googleWriteCount: 0,
      googleCampaignStatus: "ENABLED",
      googleCampaignBudgetAmount: 1000,
    };
    const server = http.createServer(async (req, res) => {
      const payload = await localApiPayload(req, context);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function localApiPayload(req, context) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.url === "/readiness") {
    return { scopes: { production: { checks: [{ id: "contract", status: "todo" }] } } };
  }
  if (url.pathname === "/audit-logs/recent" && req.method === "GET") {
    return { logs: context.googleWriteAuditLogs };
  }
  const previewMatch = url.pathname.match(/^\/google\/customers\/([^/]+)\/campaigns\/([^/]+)\/change-preview$/);
  if (previewMatch && req.method === "GET") {
    return {
      preview: {
        current: {
          status: context.googleCampaignStatus,
          budgetAmount: context.googleCampaignBudgetAmount,
        },
      },
    };
  }
  const writeMatch = url.pathname.match(/^\/google\/customers\/([^/]+)\/campaigns\/([^/]+)\/(status|budget)$/);
  if (writeMatch && req.method === "POST") {
    const [, customerId, campaignId, kind] = writeMatch;
    const body = await readRequestJson(req);
    context.googleWriteCount += 1;
    const omitApprovalMetadata =
      context.googleWriteScenario === "missingRestoreApprovalMetadata" && context.googleWriteCount === 2;
    context.googleWriteAuditLogs.unshift({
      event_type: kind === "status" ? "google_ads.campaign_status_updated" : "google_ads.campaign_budget_updated",
      payload: googleWriteAuditPayload({
        body,
        campaignId: decodeURIComponent(campaignId),
        customerId: decodeURIComponent(customerId),
        kind,
        omitApprovalMetadata,
      }),
    });
    if (!(kind === "status" && context.googleWriteScenario === "finalLivePreviewMismatch" && context.googleWriteCount === 2)) {
      if (kind === "status") context.googleCampaignStatus = body.status;
    }
    if (kind === "budget") context.googleCampaignBudgetAmount = body.amount;
    return { mode: "executed", auditId: `00000000-0000-4000-8000-${String(context.googleWriteCount).padStart(12, "0")}` };
  }
  if (req.url === "/agent/chat" && req.method === "POST") {
    const body = await readRequestJson(req);
    if (String(body?.message ?? "").includes("予算を今すぐ上げて")) {
      return {
        mode: "write-approval-required",
        policy: { platformMutationExecuted: false },
      };
    }
    return {
      mode: "openai_agents",
      message: { content: "OpenAI Agent Service staging contract response with enough content." },
    };
  }
  return { ok: true, service: "adops-api" };
}

function googleWriteAuditPayload({ body, campaignId, customerId, kind, omitApprovalMetadata }) {
  return {
    platform: "google",
    customerId,
    campaignId,
    ...(kind === "status" ? { status: body?.status } : { amount: body?.amount }),
    approvalNote: body?.approvalNote,
    confirmed: body?.confirmed,
    ...(omitApprovalMetadata
      ? {}
      : {
          approvalType: "explicit_user_confirmation",
          approvedByUserId: "contract-user",
          approvedAt: new Date().toISOString(),
        }),
  };
}

function createJsonServer(payload) {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function readRequestJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function createStripeWebhookApiServer(payload = { received: true }) {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const body = await readRequestJson(req);
      if (
        payload &&
        payload.mismatchWorkspaceId &&
        body?.type === "customer.subscription.updated" &&
        body?.data?.object?.metadata?.workspace_id === payload.mismatchWorkspaceId
      ) {
        const mismatchStatusCode = Number(payload.mismatchStatusCode ?? 400);
        res.writeHead(Number.isFinite(mismatchStatusCode) ? mismatchStatusCode : 400, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            error: payload.mismatchError || "webhook customer is already linked to another workspace.",
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ eventType: body?.type, ...payload }));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function origin(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function runStagingE2e(extraEnv, baseEnv = {}) {
  return runScript("scripts/staging-e2e.mjs", extraEnv, baseEnv);
}

function runScript(script, extraEnv, baseEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        API_ORIGIN: "https://api.staging.example.com",
        AUTH_TOKEN: "test-token",
        WORKSPACE_ID: "workspace-test",
        ...baseEnv,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
