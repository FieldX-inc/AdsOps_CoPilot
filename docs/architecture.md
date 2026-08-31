# Architecture

Updated: 2026-07-21

## Runtime topology

```txt
Browser
  ├─ Cloudflare Pages: React/Vite SPA
  └─ Google Cloud Run: public Hono API
       ├─ Supabase Auth/Postgres/RLS
       ├─ Stripe Checkout/Portal/Webhook
       ├─ microCMS help content + bundled fallback
       ├─ Google Ads OAuth/read/approved status+budget write
       ├─ Cloudflare Email Service REST API
       └─ Google-signed OIDC ID token
            └─ private Cloud Run: Python OpenAI Agent Service

Cloud Scheduler (hourly)
  └─ Cloud Run Job: same public API image, report-job entrypoint
       ├─ claim due workspace in Supabase
       ├─ private Agent Service
       └─ Cloudflare Email Service
```

WebとAPIの境界はHTTPS JSON/NDJSON。APIとprivate Agentの境界はservice-to-service OIDC。AgentにSupabase service role、Stripe、Google Ads OAuth token、Cloudflare Email tokenを与えない。

## Trust boundaries

| Boundary | Authentication | Enforcement |
|---|---|---|
| Browser → API | Supabase JWT | membership, billing state, plan entitlement, account scope |
| Stripe → API | webhook signature | customer/workspace/Price match, idempotency |
| Google OAuth → API | state + PKCE | one-time DB state, workspace/user binding |
| API/Job → Agent | Google OIDC ID token | private ingress and `roles/run.invoker` |
| API/Job → Supabase | service role | server-side only; RLS is also tested for browser paths |
| Job → Email | Email Sending-only API token | configured sending domain and redacted payload |

## Product state flow

```txt
public plan selection
  → signup/login
  → workspace(pending_payment, selected plan)
  → Stripe Checkout
  → verified webhook
  → workspace(active)
  → product APIs
```

`GET /billing/plans`は未認証でも取得できる公開表示データとし、Price IDやsecretは含めない。選択値は認証後にAPIが承認済みcatalogで再検証してからpending workspaceとCheckout Sessionに紐付ける。`pending_payment`, `past_due`, `cancelled`, unknown Priceは製品APIでfail closedする。プランによる制限はUIだけでなくAPIとDB triggerで強制する。

## Data path

Google Adsの30日同期でaccount metadata、campaign status、metrics snapshotをworkspace scopeで保存する。Dashboard、AI、reportは同じ`platform` / `adAccountId`フィルタを使う。Agentに渡すのはscope済みでsecretを除いたcontextだけ。

Agentが生成するwrite candidateはブラウザへ返す前に、実contextのcustomer/campaign IDと一致するかAPIで検証する。実行時は別のlive preview/write APIがGoogle Adsから現在値を再取得する。

広告準備の初期質問票とAgentが生成するキャンペーン作成案は、媒体管理画面で人が実行するための手順に限定する。campaign create endpointもAgent toolも設けない。

## Help content

Public APIがmicroCMSから公開済みヘルプを取得し、必要項目に整形してBrowserへ返す。microCMSのAPI keyはserver-sideに閉じる。未設定、timeout、4xx/5xx、schema不整合、空レスポンスでは、同一のレスポンスschemaでバージョン管理された内蔵ヘルプを返す。ヘルプ取得失敗はDashboardやAI Advisorを停止させない。

## Scheduled reports

`report_schedules.next_run_at`はworkspace timezoneの9:00。Scheduler自体は1時間ごとに起動する。JobはDB unique keyとconditioned updateで同一期間を1回だけclaimし、失敗は`REPORT_JOB_MAX_RETRIES`まで次のScheduler起動で再試行する。report usageはchat quotaと分離する。

## Deployment units

- `apps/web`: Cloudflare Pages Direct Upload。`public/_redirects`でSPA fallback
- `apps/api`: Cloud Run Service。同一imageで`node apps/api/dist/report-job.js`をJob commandに使う
- `services/adk-agent`: private Cloud Run Service
- `supabase/migrations`: stagingで先に検証し、承認後にproductionへ同じ順で適用

Cloud SQL、BigQuery、Meta/Yahooは後続フェーズ。

## Production gates

初回本番Goはread-onlyスモークと主要プロバイダ疎通を必須とし、`GOOGLE_ADS_WRITE_ENABLED=false`で完了できる。status/budget writeの本番開放は、staging往復テスト、監査、復元、管理上限の証跡を確認する別ゲートとする。
