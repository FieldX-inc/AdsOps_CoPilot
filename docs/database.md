# Database and RLS

Updated: 2026-07-21

## Principles

- 1 workspace = 1会社
- 事業データは原則`workspace_id`を持つ
- browser accessはSupabase JWT + RLS、server accessはservice role + API workspace validation
- migrationはadditiveを基本とし、production dataのdropを前提にしない
- token columnは`*_encrypted`と`token_key_id`を持ち、AES-256-GCMで暗号化する

## Core tables

| Area | Tables | Scope / note |
|---|---|---|
| Tenant | `workspaces`, `workspace_members`, `workspace_invitations` | billing state, role, primary workspace, invite token hash |
| Ads | `ad_platform_connections`, `ad_accounts`, `campaign_snapshots`, `ad_group_snapshots`, `daily_ad_metrics` | workspace + platform + external ID; MCC childは`manager_customer_id`も保存 |
| Agent | `agent_threads`, `agent_messages`, `recommendations`, `human_tasks`, `operator_feedback`, `user_memories` | user memory stays user-scoped |
| Setup | `ad_setup_intakes`, `ad_setup_intake_messages` | score 0–10 at API/UI boundary |
| Billing | `billing_customers`, `billing_subscriptions`, `stripe_webhook_events` | plan/interval/Price/status synchronized from Stripe; webhookはDB claimで二重処理を防止 |
| Usage | `ai_usage_events` | raw token totals + point-in-time estimated cost + credits |
| Reports | `report_schedules`, `report_runs`, `notification_preferences` | 3-day timezone schedule, claim/retry/email state |
| Audit | `audit_logs`, `agent_tool_calls`, `oauth_states` | redacted payload and one-time OAuth state |

## Billing constraints

`workspaces.billing_state` is one of `pending_payment|active|past_due|cancelled`. `billing_subscriptions.plan_id` is `minimum|standard|premium`. New sales use `month`; the database still accepts `year` only as a legacy-compatible stored value.

初回導線の順序は公開プラン選択 → 認証 → pending workspace作成 → Checkoutとする。未認証の選択値をDB権限の根拠にせず、workspace作成時にAPIが`plan_id` / `interval`を承認済みStripe catalogで再検証する。該当workspaceとStripe customer/sessionの一致はWebhook反映時にも検証する。

DB triggers reject new `workspace_members` / `ad_accounts` rows above these limits:

| Plan | Members | Ad accounts |
|---|---:|---:|
| minimum | 2 | 1 |
| standard | 2 | 3 |
| premium | 5 | 10 |

Downgradeで既存件数が上限を超えても削除しない。新規insertだけを拒否する。最後のowner削除もDB triggerで拒否する。

## Usage ledger

`ai_usage_events` is append-only in product code and unique on `(workspace_id, idempotency_key)`.

Required fields:

- `source_type`: `setup|chat|scheduled_report`
- `source_id`, `model`, `requests`
- input, cached input, output, reasoning, total tokens
- `estimated_cost_microunits`, `credit_units`, `rate_version`
- `occurred_at`

Customer-facing APIs aggregate credits only. They must not return token counts or estimated cost.

## Report claim and retry

`report_runs` is unique on `(workspace_id, idempotency_key)`. A new run starts as `running`. Existing `failed` rows may be claimed by a conditional update while `retry_count < REPORT_JOB_MAX_RETRIES`. `completed` and `needs_reconnect` are terminal for the period. `report_schedules.next_run_at` advances to the next future local 9:00 at the 3-day cadence.

## User memory

`user_memories` includes `source_type`, `source_ref`, `dedupe_key`. API persistence accepts only stable high-confidence preference/business/policy candidates. Temporary metrics, PII, customer lists, tokens and secrets are rejected before insert. The dedupe key is a SHA-256 hash of normalized type/content.

## RLS acceptance matrix

| Actor | Own workspace | Other workspace | Own user memory | Other user's memory |
|---|---|---|---|---|
| owner | allowed by policy/role | denied | allowed | denied unless explicitly admin-safe API |
| admin | allowed by policy/role | denied | allowed | denied |
| member | product reads allowed | denied | allowed | denied |
| nonmember | denied | denied | denied | denied |

Tests must cover owner/member/nonmember and cross-workspace paths for each newly exposed table. The API must also validate workspace membership even when using the service role.

## Migration and rollback

Canonical additive migration for pricing/usage/reports is `supabase/migrations/20260715_pricing_usage_reports.sql`. Apply only after backup and staging verification. Rollback is operational: disable report Scheduler/write flag, deploy the previous API revision, and leave additive columns/tables in place until data retention and dependencies are reviewed. Do not drop production tables as an emergency rollback.
