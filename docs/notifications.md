# Scheduled reports and email notifications

Updated: 2026-07-15

## Schedule

Each active workspace has one `report_schedules` row: 3-day interval, IANA timezone, local 9:00 next run and enabled state. Default timezone is `Asia/Tokyo`. Cloud Scheduler runs hourly; the Cloud Run Job selects due rows and conditionally claims one `report_runs` row per workspace/period.

The Job reuses the API image with command:

```txt
node apps/api/dist/report-job.js
```

Failed runs retry on later Scheduler invocations up to `REPORT_JOB_MAX_RETRIES`. Duplicate completed/reconnect runs are not regenerated.

## Report and email content

The stored structured report contains KPI comparison, anomaly/change, hypotheses, recommendations, priority, operator steps, risk, observation and confidence. Minimum reports lock chat/write CTAs. Standard and Premium reports may link to the AI drawer and approved-write review.

Email is a summary, not the report itself. The HTML variant uses an email-client-safe, table-based layout with the report period, four overall KPIs and prior-period changes, up to six campaign summary rows, the AI change comment, recommended actions and a management UI CTA. The plain text variant carries the same metrics and actions. Both variants include no Google Ads internal ID, token, secret, customer list or raw model usage. Owner/admin are subscribed by default; each user can unsubscribe through an authenticated setting or signed 90-day unsubscribe link.

## Cloudflare Email Service

Required configuration:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_EMAIL_API_TOKEN` with Email Sending permission only
- `REPORT_EMAIL_DOMAIN` on Cloudflare DNS
- `REPORT_EMAIL_FROM_LOCAL_PART=reports`
- `REPORT_EMAIL_FROM_NAME=ちょこっとインハウス`
- `NOTIFICATION_SIGNING_SECRET`

The external domain gate includes domain ownership, SPF, DKIM and DMARC. Sender is `reports@<approved-domain>`.

429 and 5xx are retried with exponential backoff; 4xx is recorded without automatic retry. Provider `delivery`, `queue`, `bounce` and failure summaries are recorded in `report_runs.email_result` without message bodies or recipient lists.

If Google authorization is expired or scoped metrics are absent, the Job creates `needs_reconnect`, skips AI analysis and sends reconnect guidance. It never invents KPI analysis.
