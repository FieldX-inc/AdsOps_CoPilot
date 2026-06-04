#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = "supabase/migrations";
const files = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

const issues = [];
const allSql = files.map((file) => readFileSync(join(migrationsDir, file), "utf8")).join("\n").toLowerCase();
const byFile = new Map(files.map((file) => [file, readFileSync(join(migrationsDir, file), "utf8").toLowerCase()]));

expectFile("20260426_reboot_schema.sql");
expectFile("20260427_auth_workspace_rls.sql");
expectFile("20260508_pre_saas_rehearsal.sql");
expectFile("20260604_openai_google_write_stripe.sql");
expectOrder("20260426_reboot_schema.sql", "20260427_auth_workspace_rls.sql");
expectOrder("20260427_auth_workspace_rls.sql", "20260604_openai_google_write_stripe.sql");

expectAll("base schema", [
  "create table if not exists workspaces",
  "create table if not exists workspace_members",
  "create table if not exists ad_platform_connections",
  "create table if not exists audit_logs",
]);

expectAll("workspace rls helpers", [
  "create schema if not exists app",
  "create or replace function app.current_user_is_workspace_member",
  "create or replace function app.current_user_has_workspace_role",
  "create or replace function app.set_updated_at",
  "create or replace function app.enforce_workspace_user_membership",
]);

expectAll("google oauth/token storage", [
  "create table if not exists oauth_states",
  "code_verifier text not null",
  "create trigger trg_oauth_states_membership",
  "alter table oauth_states enable row level security",
  "add column if not exists token_key_id",
  "add column if not exists token_encrypted_at",
  "create trigger trg_ad_platform_connections_set_token_encrypted_at",
  "grant select (",
  "on ad_platform_connections to authenticated",
]);

expectAll("billing schema and rls", [
  "create table if not exists billing_customers",
  "create table if not exists billing_subscriptions",
  "unique (workspace_id)",
  "unique (stripe_customer_id)",
  "unique (workspace_id, stripe_customer_id)",
  "create unique index if not exists idx_billing_subscriptions_stripe_subscription_unique",
  "where stripe_subscription_id is not null",
  "create trigger set_billing_customers_updated_at",
  "create trigger set_billing_subscriptions_updated_at",
  "create trigger trg_billing_customers_membership",
  "alter table billing_customers enable row level security",
  "alter table billing_subscriptions enable row level security",
  "create policy billing_customers_member_select",
  "create policy billing_subscriptions_member_select",
  "grant select on billing_customers to authenticated",
  "grant select on billing_subscriptions to authenticated",
]);

expectAll("google ads write audit", [
  "comment on table audit_logs is 'includes google_ads.* write events",
  "create trigger trg_audit_logs_membership",
  "alter table audit_logs enable row level security",
  "grant select on audit_logs to authenticated",
]);

const billingMigration = byFile.get("20260604_openai_google_write_stripe.sql") ?? "";
expectInText("billing migration", billingMigration, [
  "app.set_updated_at()",
  "app.enforce_workspace_user_membership()",
  "app.current_user_is_workspace_member(workspace_id)",
  "revoke all on billing_customers from anon",
  "revoke all on billing_subscriptions from anon",
]);

expectInText("server-side oauth state", allSql, [
  "create policy \"oauth states are server-side only\"",
  "using (false)",
  "with check (false)",
]);

expectInText("token column browser safety", allSql, [
  "revoke all on ad_platform_connections from anon, authenticated",
  "grant select (",
  "token_key_id",
  "token_encrypted_at",
]);

if (issues.length) {
  console.error("Migration check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`Migration check passed (${files.length} files).`);

function expectFile(file) {
  if (!files.includes(file)) issues.push(`missing migration: ${file}`);
}

function expectOrder(before, after) {
  const beforeIndex = files.indexOf(before);
  const afterIndex = files.indexOf(after);
  if (beforeIndex === -1 || afterIndex === -1) return;
  if (beforeIndex >= afterIndex) issues.push(`migration order: ${before} must run before ${after}`);
}

function expectAll(label, snippets) {
  expectInText(label, allSql, snippets);
}

function expectInText(label, text, snippets) {
  for (const snippet of snippets) {
    if (!text.includes(snippet.toLowerCase())) {
      issues.push(`${label}: missing "${snippet}"`);
    }
  }
}
