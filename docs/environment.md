# Environment Inventory

このドキュメントは M1-01 のための Supabase project / env 定義です。実装は含めず、local / staging / production で必要になるキーと扱いだけを整理します。

## 方針

- local / staging / production は別Supabase projectとして扱う。
- browserに出してよいのは `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` だけにする。
- `SUPABASE_SERVICE_ROLE_KEY`、OAuth client secret、developer token、`TOKEN_ENCRYPTION_KEY` はserver-side secretとして扱う。
- OAuth token / refresh token / API key / service role key は、AI prompt、agent tool output、agent memory、browser、application logに出さない。
- Stripe secret key / webhook secret / Google Ads developer token もbrowser、AI prompt、agent memory、application logに出さない。
- staging / production のsecret実体は `.env` にcommitせず、ホスティング環境のsecret managerで管理する。

## Environment Matrix

| Environment | Supabase | Web/API URL | OAuth redirect | Secret storage |
| --- | --- | --- | --- | --- |
| local | local stackまたは開発用Supabase project | `http://localhost:5173` / `http://localhost:8787` | localhost callback | local `.env` |
| staging | staging専用Supabase project | staging URL | staging callback | platform secret / Secret Manager |
| production | production専用Supabase project | production URL | production callback | platform secret / Secret Manager or KMS |

## Required Keys

### Public / browser-safe

| Key | Scope | Notes |
| --- | --- | --- |
| `APP_ENV` | all | `local`, `staging`, `production` のいずれか。 |
| `VITE_APP_ENV` | web | `local`, `staging`, `production` のいずれか。productionでは課金demo bypassを表示しない。 |
| `VITE_API_BASE_URL` | web | Browserから呼ぶAPI base URL。 |
| `VITE_SUPABASE_URL` | web | Supabase Auth client用。`SUPABASE_URL` と同じ値でよい。 |
| `VITE_SUPABASE_ANON_KEY` | web | Supabase anon key。service role keyを入れない。 |
| `VITE_AUTH_REDIRECT_PATH` | web | Auth callback path。標準は `/auth/callback`。 |

### Server-side app/API

| Key | Scope | Notes |
| --- | --- | --- |
| `SUPABASE_PROJECT_REF` | api/ops | project識別用。secretではないが環境ごとに分ける。 |
| `SUPABASE_URL` | api/agent | Supabase API URL。 |
| `SUPABASE_ANON_KEY` | api | JWT検証やpublic client設定用。 |
| `SUPABASE_SERVICE_ROLE_KEY` | api/admin jobs only | RLSをbypassできるため通常のagent DBアクセスでは使わない。browserへ出さない。 |
| `SUPABASE_DB_URL` | agent/server | Postgres接続が必要なserver-side処理用。 |
| `WEB_ORIGIN` | api | CORS許可元。localは `http://localhost:5173`。 |
| `API_PUBLIC_ORIGIN` | api/ops | staging / productionで外部から到達できるAPI origin。productionではlocalhost不可。 |
| `AGENT_SERVICE_URL` | api | APIからOpenAI Agent Serviceへ接続するURL。 |
| `AGENT_SERVICE_AUTH_MODE` | api | `none` / `bearer` / `google_id_token`。Cloud Run private Agentでは `google_id_token`。 |
| `AGENT_SERVICE_AUDIENCE` | api | Google ID tokenのaudience。productionで `AGENT_SERVICE_AUTH_MODE=google_id_token` の場合は明示必須。通常は `AGENT_SERVICE_URL`。 |
| `AGENT_SERVICE_AUTH_TOKEN` | api/server-side | `AGENT_SERVICE_AUTH_MODE=bearer` の場合だけ使う共有token。browserへ出さない。 |
| `USE_AGENT_SERVICE` | api | mockでは `false`、Agent Service接続検証時に `true`。 |
| `ADK_AGENT_URL` | api | 後方互換alias。新規設定では `AGENT_SERVICE_URL` を使う。 |
| `USE_ADK_AGENT` | api | 後方互換alias。新規設定では `USE_AGENT_SERVICE` を使う。 |
| `GOOGLE_ADS_WRITE_ENABLED` | api | `true` のときだけGoogle Ads campaign status / budget write routeを実行する。stagingでE2E確認するまでproductionでは有効化しない。 |
| `GOOGLE_ADS_MAX_BUDGET_AMOUNT` | api | Google Ads budget writeで許可する1回あたりの上限額。productionで `GOOGLE_ADS_WRITE_ENABLED=true` の場合は明示必須。 |

### Supabase Auth provider

| Key | Scope | Notes |
| --- | --- | --- |
| `SUPABASE_AUTH_SITE_URL` | ops | Supabase Auth Site URL。 |
| `SUPABASE_AUTH_REDIRECT_URLS` | ops | 許可するredirect URL。標準は `<WEB_ORIGIN>/auth/callback`。複数環境で値を混ぜない。 |
| `SUPABASE_AUTH_GOOGLE_CLIENT_ID` | ops/server-side | アプリログイン用Google OAuth client。Google Ads OAuthとは別。 |
| `SUPABASE_AUTH_GOOGLE_CLIENT_SECRET` | ops/server-side | アプリログイン用Google OAuth secret。browserへ出さない。 |

### Token encryption

| Key | Scope | Notes |
| --- | --- | --- |
| `TOKEN_ENCRYPTION_KEY` | api/agent/server-side | OAuth token保存用。32 bytes相当のbase64 secretを想定。 |
| `TOKEN_ENCRYPTION_KEY_ID` | api/agent/server-side | key rotation用ID。例: `local-v1`, `staging-v1`, `prod-v1`。 |

### Advertising OAuth placeholders

これらはユーザーに入力させない。AdOps Advisor側のserver-side設定として管理し、UIはOAuthボタンだけを出す。

| Key | Scope | Notes |
| --- | --- | --- |
| `GOOGLE_ADS_CLIENT_ID` | api/server-side | Google Ads OAuth app。 |
| `GOOGLE_ADS_CLIENT_SECRET` | api/server-side | browser、AI、logへ出さない。 |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | api/server-side | Google Ads API用。ユーザーには要求しない。 |
| `GOOGLE_ADS_REDIRECT_URI` | api/ops | local/staging/prodでprovider consoleと一致させる。 |
| `GOOGLE_OAUTH_STATE_STORE` | api/ops | staging/prodは `db` 必須。`memory` は単一プロセスのlocal smoke専用。 |
| `META_APP_ID` | api/server-side | Meta Marketing API app。 |
| `META_APP_SECRET` | api/server-side | browser、AI、logへ出さない。 |
| `META_ADS_REDIRECT_URI` | api/ops | local/staging/prodでprovider consoleと一致させる。 |
| `YAHOO_ADS_CLIENT_ID` | api/server-side | Yahoo Ads API OAuth app。 |
| `YAHOO_ADS_CLIENT_SECRET` | api/server-side | browser、AI、logへ出さない。 |
| `YAHOO_ADS_REDIRECT_URI` | api/ops | local/staging/prodでprovider consoleと一致させる。 |

### Agent Runtime / OpenAI / ADK / Gemini

| Key | Scope | Notes |
| --- | --- | --- |
| `ADOPS_AGENT_RUNTIME` | agent/server-side | `openai` / `gemini` / `mock`。既定は `openai`。productionでは `openai` 以外を拒否する。 |
| `OPENAI_API_KEY` | agent/server-side | OpenAI Agents SDK runtime用。browser/API response/LLM promptへ出さない。 |
| `OPENAI_AGENTS_MODEL` | agent/server-side | OpenAI Agents SDKで使うmodel。 |
| `OPENAI_AGENTS_TIMEOUT_SECONDS` | agent/server-side | OpenAI Agents SDK request timeout。 |
| `OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA` | agent/server-side | `0` 推奨。traceへmodel/tool入出力のsensitive dataを含めない。 |
| `OPENAI_AGENTS_DONT_LOG_MODEL_DATA` | agent/server-side | `1` 推奨。SDK logへmodel dataを出さない。 |
| `OPENAI_AGENTS_DONT_LOG_TOOL_DATA` | agent/server-side | `1` 推奨。SDK logへtool dataを出さない。 |
| `OPENAI_AGENT_STAGING_E2E_PASSED_AT` | ops | stagingでAgent `/health` とAPI経由chat E2Eが通った日時。production Go証跡。 |
| `GEMINI_API_KEY` | agent/server-side | local ADK/Gemini検証用。 |
| `GOOGLE_API_KEY` | agent/server-side | `GEMINI_API_KEY` の代替。 |
| `GOOGLE_GENAI_USE_VERTEXAI` | agent/server-side | Vertex AI利用時の切り替え。 |
| `GEMINI_MODEL` | agent/server-side | 例: `gemini-flash-latest`。 |
| `GEMINI_RUNTIME` | agent/server-side | `auto` / `adk` / `rest` など。 |

OpenAI Agents SDK runtimeを正規runtimeとして扱う。Gemini/mock runtimeはlocal/dev fallbackとして残すが、`APP_ENV=production` のAgent Serviceでは `ADOPS_AGENT_RUNTIME=openai` 以外をfail-closedする。

Production envでは旧ADK aliasの `ADK_AGENT_URL` / `USE_ADK_AGENT` / `ADK_AGENT_TIMEOUT_MS` を使わず、API serviceは `AGENT_SERVICE_URL` / `USE_AGENT_SERVICE` / `AGENT_SERVICE_TIMEOUT_MS` を使う。Production Agent ServiceではGemini fallback用の `GEMINI_*` / `GOOGLE_API_KEY` を設定しない。

```sh
cd services/adk-agent
python3.11 -m pip install -e ".[dev]"
```

OpenAI runtimeでは manager/orchestrator agent が専門agentをtoolとして呼ぶ。handoffで会話を専門agentへ完全移譲するのではなく、rootが最終回答を保持して human-in-the-loop / no-secret / write approval を中央で守る。

### Stripe billing

| Key | Scope | Notes |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | api/server-side | Checkout / Portal API用。browserへ出さない。 |
| `STRIPE_PRICE_ID` | api/server-side | subscription checkoutで使うPrice ID。 |
| `STRIPE_WEBHOOK_SECRET` | api/server-side | `/billing/webhook` の署名検証用。 |

### Production go/no-go evidence

| Key | Scope | Notes |
| --- | --- | --- |
| `GOOGLE_ADS_STAGING_E2E_PASSED_AT` | ops | Google Ads OAuth、customer list、sync、承認付きstatus/budget writeがstagingで通った日時。 |
| `STRIPE_STAGING_E2E_PASSED_AT` | ops | Stripe Checkout、Portal、Webhook、ログイン時billing gateがstagingで通った日時。 |
| `DEPLOYMENT_RUNBOOK_ACK` | ops | `docs/deployment.md` のURL、secret運用、ログ確認、smoke手順が確定したら `true`。 |
| `PRODUCTION_SMOKE_PASSED_AT` | ops | `EXPECT_PRODUCTION_READY=true npm run smoke:deploy` がproduction URLで通った日時。`audit:completion` 用のoperator証跡。 |
| `RELEASE_EVIDENCE_COLLECTED_AT` | ops | `EXPECT_PRODUCTION_READY=true npm run collect:release-evidence` が通り、非secret release evidence noteを作った日時。 |
| `RELEASE_EVIDENCE_NOTE_PATH` | ops | 記入済みrelease evidence noteのローカルパス。`audit:completion` は最終証跡のタイムスタンプ値がこのnoteに記録されていることを確認する。 |

## Local Setup Notes

1. `.env.example` を `.env` にコピーする。
2. `services/adk-agent/.env.example` を `services/adk-agent/.env` にコピーする。既に `GEMINI_API_KEY` などが入った `services/adk-agent/.env` がある場合は、値を消さずに不足しているキー名だけ追記する。
3. mockユーザーテストでは Supabase / Google / Meta / Yahoo / OpenAI / Stripe のsecretは空でよい。
4. Supabase Auth実装に進むときは、local用の `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`SUPABASE_AUTH_SITE_URL`、`SUPABASE_AUTH_REDIRECT_URLS` を先に設定する。
5. Agent serviceからDBへ直接接続する場合は、`SUPABASE_DB_URL` と同じPostgres URIを `ADOPS_DATABASE_URL` にも入れる。
6. service role key、DB URL、OAuth secret、Gemini keyをbrowser向けの `VITE_` keyに入れない。

## ngrok Pre-SaaS Rehearsal

社内/身内向けにlocalhostを公開する場合は、WebとAPIを別々のngrok URLで公開する。

```txt
localhost:5173 -> https://<web-ngrok-domain>
localhost:8787 -> https://<api-ngrok-domain>
localhost:8000 -> 外部公開しない
```

`.env` は以下をngrok URLへ合わせる。

```sh
WEB_ORIGIN=https://<web-ngrok-domain>
VITE_API_BASE_URL=https://<api-ngrok-domain>
VITE_AUTH_REDIRECT_PATH=/auth/callback
GOOGLE_ADS_REDIRECT_URI=https://<api-ngrok-domain>/oauth/google/callback
SUPABASE_AUTH_SITE_URL=https://<web-ngrok-domain>
SUPABASE_AUTH_REDIRECT_URLS=https://<web-ngrok-domain>/auth/callback
AGENT_SERVICE_URL=http://localhost:8000
USE_AGENT_SERVICE=false
```

ngrok reserved domain がある場合は固定URLを使う。固定URLがない場合は、起動ごとに以下を更新する。

- Supabase Auth の Site URL / Redirect URLs
- Google Cloud OAuth client の Authorized redirect URI
- `.env` の `WEB_ORIGIN` / `VITE_API_BASE_URL` / `GOOGLE_ADS_REDIRECT_URI`

Googleログイン用OAuth clientとGoogle Ads API用OAuth clientは別物として扱う。Google Ads側では `https://www.googleapis.com/auth/adwords` scope、developer token、test user、ngrok API callback URLを確認する。Google Ads writeを試す環境では、stagingだけで `GOOGLE_ADS_WRITE_ENABLED=true` にし、対象campaign/budgetの戻し条件を先に決める。

Googleログイン用OAuth clientのGoogle Cloud Authorized redirect URIは、Web URLではなくSupabase callbackを登録する。

```txt
https://<supabase-project-ref>.supabase.co/auth/v1/callback
```

Supabase AuthのURL設定は以下を環境ごとに固定する。

```txt
Site URL: <WEB_ORIGIN>
Redirect URLs: <WEB_ORIGIN>/auth/callback
```

Pre-SaaS rehearsal では `supabase/migrations/20260508_pre_saas_rehearsal.sql` まで適用してからGoogle Ads OAuthを試す。未適用で一時的に動作確認だけしたい場合は `GOOGLE_OAUTH_STATE_STORE=memory` にすると、OAuth state / PKCE をプロセス内だけに保存する。

## Supabase Dashboard から取得する手順

### Auth redirect contract

アプリログインの戻り先は `/auth/callback` に統一する。

- local: `http://localhost:5173/auth/callback`
- staging: `https://<staging-web-domain>/auth/callback`
- production: `https://<production-web-domain>/auth/callback`

Webは `VITE_AUTH_REDIRECT_PATH=/auth/callback` を使い、Googleログイン、Magic Link、email signup の `redirectTo` / `emailRedirectTo` を同じURLに揃える。Supabase AuthのSite URLだけに戻す設定は使わない。

### Google provider for app login

1. Google Cloudで「アプリログイン用」のOAuth clientを作る。Google Ads OAuth clientと共有しない。
2. Authorized redirect URIに `https://<supabase-project-ref>.supabase.co/auth/v1/callback` を登録する。
3. Supabase Dashboard -> Authentication -> Providers -> Google を有効化する。
4. Google Cloudのclient id / client secretをSupabase Google providerに設定する。
5. Supabase Dashboard -> Authentication -> URL Configuration で Site URL と Redirect URLs を環境のWeb URLに合わせる。
6. `/readiness` の `supabase-auth-env` / `auth-site-url` / `auth-callback-url` / `google-login-provider` がpassになることを確認する。

### `SUPABASE_PROJECT_REF`

1. Supabase Dashboardで対象projectを開く。
2. URLの `/project/<project-ref>` 部分を見る。
3. `<project-ref>` を `SUPABASE_PROJECT_REF` に入れる。

### `SUPABASE_URL` / `VITE_SUPABASE_URL`

1. Supabase Dashboardで対象projectを開く。
2. Project Settings -> Data API または API を開く。
3. `Project URL` をコピーする。
4. server用に `SUPABASE_URL`、browser用に `VITE_SUPABASE_URL` へ同じ値を入れる。

### `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY`

1. Project Settings -> Data API または API を開く。
2. `Project API keys` の `anon public` keyをコピーする。
3. server用に `SUPABASE_ANON_KEY`、browser用に `VITE_SUPABASE_ANON_KEY` へ同じ値を入れる。
4. このkeyはbrowser-safeだが、RLS有効化を前提に使う。

### `SUPABASE_SERVICE_ROLE_KEY`

1. Project Settings -> Data API または API を開く。
2. `Project API keys` の `service_role` または `secret` keyをコピーする。
3. `SUPABASE_SERVICE_ROLE_KEY` に入れる。
4. `VITE_` 付きkeyには絶対に入れない。

### `SUPABASE_DB_URL` / `ADOPS_DATABASE_URL`

1. Project Settings -> Database を開く。
2. Connection string の `URI` 形式を選ぶ。
3. 表示されたURIのpassword部分をDB passwordに置き換える。
4. `SUPABASE_DB_URL` に入れる。
5. Agent serviceでDB repositoryを使う場合は、同じURIを `services/adk-agent/.env` の `ADOPS_DATABASE_URL` にも入れる。

## Staging / Production Notes

- staging と production は別project、別OAuth app、別redirect URIにする。
- production dataをlocalやstagingに流用しない。
- `SUPABASE_SERVICE_ROLE_KEY` はOAuth callback、token refresh、metrics syncなど必要なserver-side管理処理に限定する。
- `TOKEN_ENCRYPTION_KEY` のrotationでは、新規保存を新しい `TOKEN_ENCRYPTION_KEY_ID` にし、既存tokenは読める間に再暗号化する。
- production envでは `GOOGLE_ADS_STAGING_E2E_PASSED_AT`、`STRIPE_STAGING_E2E_PASSED_AT`、`OPENAI_AGENT_STAGING_E2E_PASSED_AT`、`DEPLOYMENT_RUNBOOK_ACK=true` が揃うまで `/readiness` は `No-Go` にする。
