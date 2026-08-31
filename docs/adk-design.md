# OpenAI Agent Service design

Updated: 2026-07-21

## Runtime

The production runtime is the Python OpenAI Agents SDK on a private Cloud Run service. The public API invokes it with a Google-signed OIDC ID token. `ADOPS_AGENT_RUNTIME=openai` is mandatory in production. Prompt/model data and tool data logging remain disabled, and traces must not include sensitive data.

## Initial agent set

Keep exactly these five agents until the root agent becomes demonstrably too large:

1. `root_agent`: route and compose the final structured response
2. `setup_advisor_agent`: pre-launch hearing and setup guidance
3. `performance_analyst_agent`: scoped KPI comparison and hypotheses
4. `action_plan_agent`: operator steps, preflight, risk, rollback and observation plan
5. `qa_agent`: evidence, required sections, no-secret and no-mutation review

No budget agent, media buyer agent, issue-specific agent or additional specialist is part of this release. Product runtime remains exactly five agents; implementation harness workers are development-time roles and are not added to the OpenAI Agent Service.

## Allowed and forbidden capabilities

Allowed tools are scoped ad-account/metrics reads, KPI calculation, period comparison, anomaly detection, stable user-memory reads/candidates, recommendation/human-task drafts and operator-feedback context.

Forbidden Agent tools:

- bid mutation
- ad or creative creation
- targeting mutation
- campaign mutation of any kind
- campaign creation, including draft creation in Google Ads
- direct Google Ads status/budget execution

Campaign status and budget execution belongs to the public API layer. The Agent may only emit a `write_candidate`.

For the setup questionnaire, `setup_advisor_agent` may turn radio-button answers and optional notes into a campaign draft expressed as structured recommendations and operator steps. That draft is advisory content only: it must not call a campaign-create API, claim that a campaign was created, or be converted into a mutation tool call.

## Structured output

`AdvisorStructuredOutput` is a Pydantic model with required fields:

- `conclusion`
- `evidence`
- `hypotheses`
- `recommended_actions`
- `operator_steps`
- `preflight_checks`
- `risks`
- `observation_plan`
- `confidence`: `high|medium|low`

Optional fields are `recommendation`, `human_task`, `write_candidate`, `memory_candidates`.

A write candidate contains only `campaign_status|campaign_budget`, customer/campaign IDs, expected/proposed value, approval reason and rollback condition. The public API drops the candidate unless those IDs exist in the request's workspace-scoped Google Ads context. It is never treated as executed.

## Required answer policy

Every substantive answer must include a conclusion, evidence, hypotheses, recommended action, human steps, preflight checks, risks, post-change observation and confidence. When evidence is insufficient, separate missing data from hypotheses and do not fabricate an analysis.

Direct user requests such as 「予算を上げて」are intercepted by the public API no-write policy before the Agent runtime. The response explains the approval path and does not call a mutation tool.

## Usage

Every production SDK run must return `_internalUsage` with model, request count and input/cached/output/reasoning/total token counts. The public API strips `_internalUsage` before the customer response, calculates the versioned estimated cost, and writes an idempotent `ai_usage_events` row. Missing usage or model-rate configuration fails closed in production.

Sources are independent:

- setup intake → `setup`
- normal advisor conversation → `chat`
- scheduled report → `scheduled_report`

Scheduled report credit never consumes chat credit.

## Memory policy

Only high-confidence stable `preference`, `communication_preference`, `business_context`, and `ongoing_policy` candidates may be persisted. The API rejects secret-like values, email/phone PII, customer lists, temporary time expressions and KPI snapshots. Each accepted memory stores source, source reference and a normalized dedupe hash. Feedback becomes memory only when it represents a continuing policy, never just because an action worked once.

## Context safety

The public API recursively removes keys matching token, secret, password, API key, authorization and service-role patterns. It also redacts secret-looking strings. OAuth tokens and customer lists must never be present in the Agent request. Scope IDs are supplied by the authenticated API, not trusted from free-form model output.

## Report mode

The report job calls the same `/chat` runtime with `reportMode=true`, experienced analysis routing, and sanitized scoped metrics. It requires structured output and usage. Authentication expiry or absent metrics bypasses the Agent and creates a reconnect-required report instead of a fabricated analysis.
