# Harness fixtures

Deterministic demo and provider-fake fixtures will live here. They must contain
synthetic workspace, account, campaign, metrics, conversation, report, billing,
and audit data only. Never copy production customer IDs, email addresses,
OAuth tokens, refresh tokens, API keys, or authenticated provider responses.

Issue #2 owns the executable reset fixture. Until that issue is implemented,
`e2e-plan.json` is the contract for the required fixture states.
