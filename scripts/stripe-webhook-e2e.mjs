#!/usr/bin/env node

import { createHmac } from "node:crypto";

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const config = {
  apiOrigin: cleanOrigin(process.env.API_ORIGIN || process.env.VITE_API_BASE_URL || ""),
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  workspaceId: process.env.WORKSPACE_ID || "",
  userId: process.env.USER_ID || "",
  authToken: process.env.AUTH_TOKEN || "",
  confirm: process.env.CONFIRM_STRIPE_WEBHOOK_TEST === "true",
  confirmStagingTarget: process.env.CONFIRM_STAGING_TARGET === "true",
  stagingTargetConfirmation: process.env.STAGING_TARGET_CONFIRMATION || "",
  checkBillingStatus: process.env.CHECK_BILLING_STATUS !== "false",
  checkWorkspaceMismatch: process.env.CHECK_STRIPE_WEBHOOK_MISMATCH !== "false",
};

const issues = [];

if (!config.apiOrigin) issues.push("Set API_ORIGIN or VITE_API_BASE_URL.");
if (!isSafeStagingOrigin(config.apiOrigin) && !stagingTargetOverrideLooksComplete(config)) {
  issues.push(
    "API_ORIGIN does not look like staging/local/test. Use a staging URL or set CONFIRM_STAGING_TARGET=true with STAGING_TARGET_CONFIRMATION containing staging and non-production.",
  );
}
if (!config.webhookSecret) issues.push("Set STRIPE_WEBHOOK_SECRET.");
if (!config.workspaceId) issues.push("Set WORKSPACE_ID.");
if (!config.userId) issues.push("Set USER_ID.");
if (!config.confirm) issues.push("Set CONFIRM_STRIPE_WEBHOOK_TEST=true to write a test billing row.");
if (config.checkBillingStatus && !config.authToken) {
  issues.push("Set AUTH_TOKEN or CHECK_BILLING_STATUS=false.");
}

if (issues.length) reportAndExit(issues);

const suffix = `${Date.now()}`;
const customerId = process.env.STRIPE_TEST_CUSTOMER_ID || `cus_adops_staging_${suffix}`;
const subscriptionId = process.env.STRIPE_TEST_SUBSCRIPTION_ID || `sub_adops_staging_${suffix}`;
const mismatchWorkspaceId = process.env.STRIPE_MISMATCH_WORKSPACE_ID || makeMismatchWorkspaceId(config.workspaceId);
const priceId = process.env.STRIPE_TEST_PRICE_ID || process.env.STRIPE_PRICE_ID || "price_adops_staging_test";
const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
const checkoutEvent = {
  id: `evt_adops_staging_${suffix}`,
  type: "checkout.session.completed",
  data: {
    object: {
      id: `cs_adops_staging_${suffix}`,
      object: "checkout.session",
      customer: customerId,
      subscription: subscriptionId,
      client_reference_id: config.workspaceId,
      metadata: {
        workspace_id: config.workspaceId,
        user_id: config.userId,
      },
    },
  },
};
const subscriptionEvent = {
  id: `evt_adops_subscription_${suffix}`,
  type: "customer.subscription.updated",
  data: {
    object: {
      id: subscriptionId,
      object: "subscription",
      customer: customerId,
      status: "active",
      current_period_end: periodEnd,
      cancel_at_period_end: false,
      metadata: {
        workspace_id: config.workspaceId,
        user_id: config.userId,
      },
      items: {
        data: [
          {
            price: {
              id: priceId,
            },
          },
        ],
      },
    },
  },
};
const mismatchSubscriptionEvent = {
  id: `evt_adops_subscription_mismatch_${suffix}`,
  type: "customer.subscription.updated",
  data: {
    object: {
      id: `sub_mismatch_adops_staging_${suffix}`,
      object: "subscription",
      customer: customerId,
      status: "active",
      current_period_end: periodEnd,
      cancel_at_period_end: false,
      metadata: {
        workspace_id: mismatchWorkspaceId,
        user_id: config.userId,
      },
      items: {
        data: [
          {
            price: {
              id: priceId,
            },
          },
        ],
      },
    },
  },
};

console.log("Stripe webhook E2E started.");
console.log(`- API: ${redactUrl(config.apiOrigin)}`);
console.log(`- Workspace: ${config.workspaceId}`);
console.log(`- Events: ${checkoutEvent.type}, ${subscriptionEvent.type}`);

await sendStripeEvent(checkoutEvent, "Stripe checkout webhook");
await sendStripeEvent(subscriptionEvent, "Stripe subscription webhook");

if (config.checkWorkspaceMismatch) {
  await sendStripeEvent(mismatchSubscriptionEvent, "Stripe workspace mismatch webhook", {
    expectFailure: true,
    expectedErrorContains: "already linked to another workspace",
  });
}

if (config.checkBillingStatus) {
  const status = await requestJson(`${config.apiOrigin}/billing/status`, "Stripe billing status", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.authToken}`,
      Accept: "application/json",
    },
  });
  if (status?.access !== "active") {
    issues.push(`Stripe billing status: expected access=active after subscription webhook, got ${status?.access ?? "unknown"}.`);
  }
  if (status?.customer?.stripeCustomerId !== customerId) {
    issues.push("Stripe billing status: customer did not match the test webhook customer.");
  }
  if (status?.subscription?.stripeSubscriptionId !== subscriptionId) {
    issues.push("Stripe billing status: subscription did not match the test webhook subscription.");
  }
  if (status?.subscription?.status !== "active") {
    issues.push(`Stripe billing status: expected subscription.status=active, got ${status?.subscription?.status ?? "unknown"}.`);
  }
}

if (issues.length) reportAndExit(issues);

console.log("Stripe webhook E2E passed.");
console.log("Webhook evidence env candidate; this is not the full Stripe production evidence timestamp:");
console.log(`export STRIPE_WEBHOOK_STAGING_E2E_PASSED_AT=${new Date().toISOString()}`);
console.log("Set STRIPE_STAGING_E2E_PASSED_AT only after hosted Checkout, existing customer reuse, webhook delivery, row updates, login-time billing gate, and customer/workspace mismatch rejection are all confirmed.");

function cleanOrigin(value) {
  return value.trim().replace(/\/+$/, "");
}

function isSafeStagingOrigin(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".test") ||
      hostname.includes("staging") ||
      hostname.includes("preview")
    );
  } catch {
    return false;
  }
}

function stagingTargetOverrideLooksComplete(value) {
  const normalized = value.stagingTargetConfirmation.trim().toLowerCase();
  return value.confirmStagingTarget && normalized.includes("staging") && normalized.includes("non-production");
}

async function sendStripeEvent(event, label, options = {}) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", config.webhookSecret).update(`${timestamp}.${body}`).digest("hex");
  const result = await requestJsonWithStatus(`${config.apiOrigin}/billing/webhook`, label, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    },
    body,
  });
  if (options.expectFailure) {
    if (result.ok) {
      issues.push(`${label}: expected webhook to be rejected for workspace mismatch.`);
      return;
    }
    if (!result.body || !result.body.error) {
      issues.push(`${label}: expected error body for webhook mismatch rejection.`);
      return;
    }
    if (options.expectedErrorContains && !String(result.body.error).includes(options.expectedErrorContains)) {
      issues.push(`${label}: expected error body to contain ${options.expectedErrorContains}.`);
    }
    return;
  }
  const webhook = result.body;
  if (!result.ok) {
    issues.push(`${label}: HTTP ${result.status}${result.text ? ` ${truncate(result.text, 180)}` : ""}`);
    return;
  }
  if (webhook?.received !== true) {
    issues.push(`${label}: expected received=true.`);
  }
  if (webhook?.handled !== true) {
    issues.push(`${label}: expected handled=true for ${event.type}.`);
  }
  if (webhook?.eventType !== event.type) {
    issues.push(`${label}: expected eventType=${event.type}.`);
  }
}

function makeMismatchWorkspaceId(workspaceId) {
  if (!isUuid(workspaceId)) {
    const rand = Date.now().toString(16).padStart(12, "0").slice(-12);
    return `99999999-9999-4999-8999-${rand}`;
  }
  return `${workspaceId.slice(0, 34)}${workspaceId[35] === "9" ? "8" : "9"}${workspaceId.slice(35)}`;
}

async function requestJson(url, label, init) {
  const result = await requestJsonWithStatus(url, label, init);
  return result.body;
}

async function requestJsonWithStatus(url, label, init) {
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    if (text === "") {
      return { ok: response.ok, status: response.status, body: {}, text: "" };
    }
    try {
      return {
        ok: response.ok,
        status: response.status,
        body: JSON.parse(text),
        text,
      };
    } catch {
      issues.push(`${label}: response was not valid JSON`);
      return { ok: response.ok, status: response.status, body: null, text };
    }
  } catch (error) {
    issues.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, status: 0, body: null, text: "" };
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function truncate(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    if (url.username) url.username = "REDACTED";
    if (url.password) url.password = "REDACTED";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "[invalid-url]";
  }
}

function reportAndExit(items) {
  console.error("Stripe webhook E2E failed:");
  for (const item of items) console.error(`- ${item}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  API_ORIGIN=https://api.staging.example.com \\
  WORKSPACE_ID=<workspace-id> \\
  USER_ID=<user-id> \\
  CONFIRM_STRIPE_WEBHOOK_TEST=true \\
  npm run e2e:stripe-webhook

Required secret inputs:
  STRIPE_WEBHOOK_SECRET        Set in the operator environment before running; never paste into shell history.
  AUTH_TOKEN                   Set in the operator environment before running; never paste into shell history.

Optional:
  CHECK_BILLING_STATUS=false       Skip authenticated /billing/status verification.
  CHECK_STRIPE_WEBHOOK_MISMATCH=false  Run mismatch-rejection check with the same customer_id + different workspace_id.
  STRIPE_MISMATCH_WORKSPACE_ID=<uuid> Use a specific workspace id for mismatch test.
  CONFIRM_STAGING_TARGET=true      Allow a non-obvious staging URL only with STAGING_TARGET_CONFIRMATION.
  STAGING_TARGET_CONFIRMATION="staging non-production environment confirmed"
  STRIPE_TEST_CUSTOMER_ID=cus_...  Use a specific test customer id.
  STRIPE_TEST_SUBSCRIPTION_ID=sub_... Use a specific test subscription id.
  STRIPE_TEST_PRICE_ID=price_... Use a specific test price id.

This refuses API_ORIGIN values that do not look like staging/local/test unless CONFIRM_STAGING_TARGET=true and STAGING_TARGET_CONFIRMATION includes staging and non-production. It sends signed checkout.session.completed and customer.subscription.updated test events to /billing/webhook and can verify the login-time billing status row. It writes staging billing rows and must not be used against production.`);
}
