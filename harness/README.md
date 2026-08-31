# AdOps Advisor implementation harness

This directory is the repository-native control plane for implementing the 18
open GitHub issues. It does not execute provider mutations. It records scope,
dependencies, ownership, approval gates, verification, and evidence contracts
so implementation agents can work in small, auditable slices.

## Commands

Run from the repository root:

```sh
npm run harness:validate
npm run harness:list
npm run harness:plan -- 12
node scripts/implementation-harness.mjs list --state=blocked
node scripts/implementation-harness.mjs plan 1 --json
```

- `validate` checks all manifests, dependency cycles, role references, path
  boundaries, E2E scenario references, and the exact open-issue inventory.
- `list` prints the current issue registry. Optional filters are `--state=`,
  `--wave=`, and `--agent=`.
- `plan <issue>` prints the dependency-ordered implementation plan, unresolved
  blockers, approval gates, allowed paths, checks, and required evidence.

## State model

```txt
blocked -> specified -> ready -> implemented -> local_verified
        -> browser_verified -> staging_verified -> release_ready -> done
```

State changes are deliberately manual. An agent may propose evidence, but the
orchestrator changes a manifest only after the matching checks and approvals
exist. `blocked` is reserved for missing product input. A dependency that is
not yet done affects execution order but does not make a fully specified issue
`blocked`.

## Ownership and concurrency

`implementation-orchestrator` owns sequencing and integration. It may run at
most three implementation lanes at once. A hotspot (`apps/web/src/main.tsx`,
`apps/api/src/index.ts`, or `supabase/migrations/**`) has exactly one active
owner at a time. Contract, UI, API/provider, Agent runtime, and independent QA
roles are defined under `agents/`.

The `allowedPaths` in each issue manifest are the maximum write scope, not an
instruction to modify every listed path. Existing user changes remain outside
the harness unless an issue explicitly needs and owns the same file.

## Evidence

Evidence belongs under `harness/evidence/<issue>/<commit-sha>/` and must conform
to `schemas/evidence.schema.json`. Provider operations, human approvals, and
rollback checks are separate records. Secrets, OAuth tokens, provider keys,
customer lists, and raw authenticated payloads must never be stored here.

The E2E matrix in `e2e-plan.json` separates deterministic local checks,
provider fakes, Playwright browser coverage, staging provider checks, and the
production read-only smoke. Google Ads budget changes stay mocked; staging may
round-trip only campaign `ENABLED`/`PAUSED`, with explicit approval and restore
evidence.
