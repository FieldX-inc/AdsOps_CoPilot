# M2-01 Persistence Inventory

Scope: inventory only for ADK service persistence. This compares `docs/database.md`, current Supabase migrations, and `services/adk-agent/ad_ops_advisor` repository/tool implementation.

Milestone: M2-01 from `docs/pre-saas-implementation-tasks.md`.

## Summary

The current migrations already create the core M2 persistence tables listed in `docs/database.md`: chat threads/messages, recommendations, human tasks, operator feedback, user memories, ad account/metric read models, tool calls, and audit logs. The ADK service repository currently implements only the subset needed for DB-backed fallback chat context, memory, human task creation, message append, and tool-call audit.

Main gap: schema exists for most M2 targets, but ADK/API repository methods are missing for thread lifecycle, recommendation persistence, human task review/update, operator feedback, and general audit logs.

## Schema Inventory

| Area | Tables or objects in migrations | Database doc expectation | Inventory result |
| --- | --- | --- | --- |
| Workspace/Auth | `workspaces`, `workspace_members`, `workspace_profiles`; RLS helpers and membership triggers | 1 workspace = 1 company, workspace membership scope | Present. ADK repository currently validates non-empty IDs only; membership enforcement is DB trigger/RLS/service-role application responsibility. |
| OAuth connections | `ad_platform_connections`, `ad_platform_connection_statuses`; `token_key_id`, `token_encrypted_at` added by RLS migration | read-only Google/Meta/Yahoo OAuth, encrypted tokens, client status view | Present. No ADK repository method currently reads connection status or writes OAuth records. Token columns are intentionally outside ADK tool outputs. |
| Ad account read model | `ad_accounts` | connected ad accounts | Present and used by `list_ad_accounts`. |
| Campaign/ad group snapshots | `campaign_snapshots`, `ad_group_snapshots` | read-only platform snapshots | Present. Not currently used by ADK repository. |
| Metrics read model | `ad_daily_metrics` | daily account/campaign/ad group/ad metrics | Present and used by `fetch_campaign_metrics` / `compare_period_metrics` at campaign rollup level. |
| Chat | `agent_threads`, `agent_messages` | chat history persistence | Tables present. Repository can append messages only; no create/get/list thread method yet. |
| Memory | `user_memories` | user-scoped long-term memory | Present and used by `read_user_memory` / `write_user_memory`. Secret-like content is rejected before insert. |
| Recommendations | `recommendations` | structured AI recommendations | Present. No ADK repository/tool method currently inserts or updates recommendations. Runtime response returns recommendation JSON but does not persist it. |
| Human tasks | `human_tasks`; `updated_at` added by RLS migration | human-executable task review | Present. Repository can create a task only; no list/update/status/feedback workflow method yet. |
| Operator feedback | `operator_feedback` | adopted/rejected/done/result memo | Present. No ADK repository/tool method currently records feedback. |
| Tool audit | `agent_tool_calls` | agent tool call audit log | Present and used by repository plus `audited_tool`. Input/output summaries are sanitized. |
| General audit | `audit_logs` | application audit log | Present. No ADK repository method currently writes audit events. |

## Current ADK Repository/API Mapping

| ADK service operation | Current implementation | Backing table(s) | Missing for M2 completion |
| --- | --- | --- | --- |
| `list_ad_accounts(workspace_id)` | `PostgresRepository.list_ad_accounts` via `ad_account_tools` | `ad_accounts` | Connection status view is not exposed here; likely belongs to API/UI connection surface, not ADK analysis tools. |
| `fetch_campaign_metrics(workspace_id, ad_account_id, date_range)` | `PostgresRepository.fetch_campaign_metrics` via `metrics_tools` | `ad_daily_metrics` | No snapshot joins; no platform/ad group/ad level filter API yet. |
| `compare_period_metrics(...)` | Repository composes two metric reads | `ad_daily_metrics` | Comparison period is caller-supplied or fixed fallback; no persisted analysis record. |
| `read_user_memory(workspace_id, user_id)` | Repository select latest 20 memories | `user_memories` | No source thread filtering or memory type filtering yet. |
| `write_user_memory(...)` | Repository insert after secret check | `user_memories` | No update/dedupe/merge policy yet. |
| `create_human_task(...)` | Repository insert | `human_tasks` | Missing list/update/status transition APIs for review flow. |
| User/assistant message append | `chat_runtime.handle_chat` calls `append_agent_message` | `agent_messages` | Missing `agent_threads` create/get. Current chat assumes `threadId` already exists. |
| Tool audit | `record_tool_call` and `audited_tool` | `agent_tool_calls` | Started/succeeded can be double-recorded when chat runtime manually records context tools and tool decorator also audits direct ADK tool calls; acceptable but should be documented when full runner is wired. |
| Recommendation response | Runtime returns `recommendation` in response body | none persisted | Need repository insert into `recommendations`, probably linked to `thread_id`, `ad_account_id`, and optional `human_tasks`. |
| Operator feedback | Not implemented | `operator_feedback` | Need create/read API and repository methods. |
| Audit log | Not implemented | `audit_logs` | Need sanitized write method for server events if M2 requires app audit beyond tool calls. |

## Column-Level Notes

| Table | Column/status note | Impact |
| --- | --- | --- |
| `agent_threads` | Has `id`, `workspace_id`, `user_id`, `title`, timestamps. | M2-02 needs repository/API to create or fetch a thread before `append_agent_message` can reliably persist chat. |
| `agent_messages` | Has `metadata jsonb`; repository stores assistant response mode there. | Good fit for current fallback/runtime mode. No migration needed for current append behavior. |
| `recommendations` | Has all response contract columns: `title`, `conclusion`, `evidence`, `diagnosis`, `recommended_actions`, `operator_steps`, `risks`, `observation_plan`, `confidence`, `status`. | Schema can persist the AI response contract, but runtime needs mapping from generated text/JSON to these columns. |
| `human_tasks` | Base migration lacked `updated_at`; RLS migration adds it. | Matches `docs/database.md` updated-at trigger list after both migrations are applied. |
| `ad_platform_connections` | Base migration has encrypted token columns; RLS migration adds `token_key_id` and `token_encrypted_at`. | Matches token storage doc after both migrations are applied. ADK tools should continue avoiding this table except non-secret status if ever needed. |
| `agent_tool_calls` | Has sanitized summaries and status. | Current repository sanitizes secret-like keys/values before insert. |
| `audit_logs` | Has generic `payload jsonb`. | If used, must reuse `_sanitize` or equivalent to avoid token/log leakage. |

## Suggested M2 Follow-Up Order

1. M2-02: add repository/API thread create/get using `agent_threads`, then make chat append depend on a real thread row.
2. M2-03: keep current `agent_messages` append path, but add tests for restart-safe history retrieval once API exists.
3. M2-04: persist structured recommendations to `recommendations`; do not invent media write tools.
4. M2-05: add human task list/update/status review APIs around existing `create_human_task`.
5. M2-06: add operator feedback repository/API for `operator_feedback`.
6. M2-07: decide whether `agent_tool_calls` is enough for ADK audit or whether separate `audit_logs` writes are required for app/server events.

## No Migration Needed For M2-01

No schema change is required by this inventory. The main M2 gaps are repository/API coverage and runtime mapping, not missing persistence tables.
