#!/usr/bin/env node

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const config = {
  supabaseUrl: cleanOrigin(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ""),
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
};

const issues = [];

if (!config.supabaseUrl) {
  issues.push("Set SUPABASE_URL to the deployed Supabase project URL.");
}
if (!config.serviceRoleKey) {
  issues.push("Set SUPABASE_SERVICE_ROLE_KEY for this server-side read-only schema check.");
}

if (issues.length) reportAndExit(issues);

const targets = [
  {
    name: "billing_customers",
    columns: ["id", "workspace_id", "user_id", "stripe_customer_id", "created_at", "updated_at"],
  },
  {
    name: "billing_subscriptions",
    columns: [
      "id",
      "workspace_id",
      "stripe_customer_id",
      "stripe_subscription_id",
      "stripe_price_id",
      "status",
      "current_period_end",
      "cancel_at_period_end",
      "raw",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "oauth_states",
    columns: ["id", "state", "workspace_id", "user_id", "code_verifier", "expires_at", "created_at"],
  },
  {
    name: "ad_platform_connections",
    columns: [
      "id",
      "workspace_id",
      "user_id",
      "platform",
      "status",
      "access_token_encrypted",
      "token_key_id",
      "token_encrypted_at",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "audit_logs",
    columns: ["id", "workspace_id", "user_id", "event_type", "level", "payload", "created_at"],
  },
  {
    name: "ad_platform_connection_statuses",
    columns: ["workspace_id", "user_id", "platform", "status", "external_customer_id", "updated_at"],
  },
];

console.log("Supabase schema E2E started.");
console.log(`- Supabase: ${redactUrl(config.supabaseUrl)}`);

for (const target of targets) {
  await checkTarget(target);
}

if (issues.length) reportAndExit(issues);

console.log("Supabase schema E2E passed.");
console.log(`- Checked ${targets.length} tables/views through PostgREST.`);
console.log("- This was read-only. Keep RLS/policy review in the Supabase dashboard or SQL console as a separate production checklist item.");

async function checkTarget(target) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/${target.name}`);
  url.searchParams.set("select", target.columns.join(","));
  url.searchParams.set("limit", "1");

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
    });
    const body = await response.text();
    if (!response.ok) {
      issues.push(`${target.name}: HTTP ${response.status}${body ? ` ${truncate(body, 180)}` : ""}`);
      return;
    }
    try {
      const parsed = body ? JSON.parse(body) : [];
      if (!Array.isArray(parsed)) {
        issues.push(`${target.name}: expected PostgREST array response`);
      }
    } catch {
      issues.push(`${target.name}: response was not valid JSON`);
      return;
    }
    console.log(`- ${target.name}: ok`);
  } catch (error) {
    issues.push(`${target.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function cleanOrigin(value) {
  return value.trim().replace(/\/+$/, "");
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
  console.error("Supabase schema E2E failed:");
  for (const item of items) console.error(`- ${item}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  SUPABASE_URL=https://your-staging-project.supabase.co \\
  npm run e2e:supabase

Inputs:
  SUPABASE_URL                 Deployed Supabase project URL. Falls back to VITE_SUPABASE_URL.
  SUPABASE_SERVICE_ROLE_KEY    Set in the operator environment before running; used only for read-only schema checks.

The script calls PostgREST with select+limit=1 for production-critical tables/views:
  billing_customers
  billing_subscriptions
  oauth_states
  ad_platform_connections
  audit_logs
  ad_platform_connection_statuses

It never prints SUPABASE_SERVICE_ROLE_KEY and performs no writes.`);
}
