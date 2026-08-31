# Demo account and fixture runbook

Issue #2 uses two deliberately separate surfaces:

1. The default local fixture is a deterministic JSON artifact. It never opens
   a network connection or touches a database/provider.
2. A staging demonstration uses a separately approved non-production Google
   Ads client account. It is an external rehearsal and is never populated by
   the local fixture command.

## Local deterministic fixture

Run the reset from the repository root:

```bash
npm run demo:reset
```

This atomically rewrites only
`harness/evidence/demo/current.json` from the fixed seed under
`fixtures/demo/`. Repeated resets produce the same bytes.

Verify the committed artifact and deterministic composition without writing:

```bash
npm run demo:reset -- --check
npm run check:demo-fixture
```

The fixture covers these stable states:

| State | Purpose |
| --- | --- |
| `onboarding` | Unconnected first-run flow |
| `active-dashboard` | Complete frozen KPI/dashboard snapshot |
| `partial-error` | Explicit partial data and recoverable warning |
| `setup` | Draft questionnaire and manual campaign setup instructions |
| `conversation` | Scoped history, recommendation, and existing task |
| `scheduled-report` | Frozen schedule with local-artifact delivery only |
| `write-review` | Unconfirmed status-write preview with no execution |

The command has no flag that applies data externally. provider/DB適用は未実行
and remains an explicit, separate operator process. Do not add real customer
names, routable contact details, numeric provider customer IDs, or
authentication material to fixture/evidence JSON.

## Staging prerequisites

The user must provide or approve all of the following before a staging
rehearsal. None of these identifiers belong in this repository.

- A non-production Google Ads client account reserved for demonstrations.
- A 専用workspace that contains only synthetic demonstration data.
- A 専用campaign with reversible `ENABLED` / `PAUSED` status and a
  pre-agreed baseline. campaign作成は対象外; create it manually in
  Google Ads before the rehearsal if it does not already exist.
- A named operator and reviewer, a fixed rehearsal window, and a written
  rollback note.
- `GOOGLE_ADS_WRITE_ENABLED=true` only for the approved staging service and
  rehearsal window. It remains false for the local fixture and production
  smoke checks.

Do not reuse a production customer workspace, active customer campaign, or
production landing page. Budget mutation remains provider-fake-only for this
rehearsal; the reversible live round trip is campaign status only.

## Approval and staging rehearsal

1. Confirm the API origin is staging and record the dedicated workspace,
   account, campaign, expected current status, reviewer, and rollback window.
2. Read the campaign through the staging API and compare it with the recorded
   baseline. Stop if the target, status, or workspace differs.
3. Produce a preview. The operator must provide 明示承認 with
   `confirmed=true`, a reason, expected current value, and rollback condition.
4. Execute only the approved `campaign_status` route. Do not use an Agent tool
   for the write and do not create campaigns, ads, bids, or targeting.
5. Re-read the provider status and the audit log. Evidence must identify the
   approving user and explicit-confirmation metadata without copying an
   authenticated provider response.
6. Perform Reset in the same window: preview and approve restoration to the
   exact baseline status, then re-read provider state and the restore audit.

Any target mismatch, stale expected value, missing audit metadata, or inability
to restore is a failed rehearsal. Stop further writes and escalate to the
named reviewer.

## Reset

Local Reset is always safe and deterministic:

```bash
npm run demo:reset
npm run demo:reset -- --check
```

Staging Reset is not this command. It is the explicitly approved restore step
above, scoped to the dedicated campaign. Confirm the provider status equals the
recorded baseline and retain the paired write/restore audit references.

## Cleanup

- Set `GOOGLE_ADS_WRITE_ENABLED=false` immediately after the rehearsal window.
- Confirm there are no pending staging write reviews or scheduled deliveries.
- Keep only redacted evidence references; do not commit provider responses or
  authenticated headers.
- Remove the synthetic staging workspace only after the reviewer confirms the
  restored campaign and retained evidence. Never delete a customer workspace.
- If the dedicated campaign is no longer needed, a human operator handles it
  manually under the provider retention policy; Agent-driven campaign作成は対象外
  and campaign deletion is not part of this runbook.

## Evidence checklist

- Local reset output and `--check` success.
- Static fixture contract check success.
- Staging target/baseline decision record.
- Preview and 明示承認 record.
- Redacted write and restore audit references.
- Final provider re-read proving the baseline was restored.
- A note that provider/DB適用は未実行 when only the local harness was
  run.
