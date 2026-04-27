# Environment Inventory

このドキュメントは M1-01 のための Supabase project / env 定義です。実装は含めず、local / staging / production で必要になるキーと扱いだけを整理します。

## 方針

- local / staging / production は別Supabase projectとして扱う。
- browserに出してよいのは `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` だけにする。
- `SUPABASE_SERVICE_ROLE_KEY`、OAuth client secret、developer token、`TOKEN_ENCRYPTION_KEY` はserver-side secretとして扱う。
- OAuth token / refresh token / API key / service role key は、AI prompt、ADK tool output、agent memory、browser、application logに出さない。
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
| `VITE_API_BASE_URL` | web | Browserから呼ぶAPI base URL。 |
| `VITE_SUPABASE_URL` | web | Supabase Auth client用。`SUPABASE_URL` と同じ値でよい。 |
| `VITE_SUPABASE_ANON_KEY` | web | Supabase anon key。service role keyを入れない。 |

### Server-side app/API

| Key | Scope | Notes |
| --- | --- | --- |
| `SUPABASE_PROJECT_REF` | api/ops | project識別用。secretではないが環境ごとに分ける。 |
| `SUPABASE_URL` | api/agent | Supabase API URL。 |
| `SUPABASE_ANON_KEY` | api | JWT検証やpublic client設定用。 |
| `SUPABASE_SERVICE_ROLE_KEY` | api/admin jobs only | RLSをbypassできるため通常のagent DBアクセスでは使わない。browserへ出さない。 |
| `SUPABASE_DB_URL` | agent/server | Postgres接続が必要なserver-side処理用。 |
| `WEB_ORIGIN` | api | CORS許可元。localは `http://localhost:5173`。 |
| `ADK_AGENT_URL` | api | APIからADK Agent Serviceへ接続するURL。 |
| `USE_ADK_AGENT` | api | mockでは `false`、ADK接続検証時に `true`。 |

### Supabase Auth provider

| Key | Scope | Notes |
| --- | --- | --- |
| `SUPABASE_AUTH_SITE_URL` | ops | Supabase Auth Site URL。 |
| `SUPABASE_AUTH_REDIRECT_URLS` | ops | 許可するredirect URL。複数環境で値を混ぜない。 |
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
| `GOOGLE_ADS_CLIENT_ID` | api/server-side | Google Ads read-only OAuth app。 |
| `GOOGLE_ADS_CLIENT_SECRET` | api/server-side | browser、AI、logへ出さない。 |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | api/server-side | Google Ads API用。ユーザーには要求しない。 |
| `GOOGLE_ADS_REDIRECT_URI` | api/ops | local/staging/prodでprovider consoleと一致させる。 |
| `META_APP_ID` | api/server-side | Meta Marketing API app。 |
| `META_APP_SECRET` | api/server-side | browser、AI、logへ出さない。 |
| `META_ADS_REDIRECT_URI` | api/ops | local/staging/prodでprovider consoleと一致させる。 |
| `YAHOO_ADS_CLIENT_ID` | api/server-side | Yahoo Ads API OAuth app。 |
| `YAHOO_ADS_CLIENT_SECRET` | api/server-side | browser、AI、logへ出さない。 |
| `YAHOO_ADS_REDIRECT_URI` | api/ops | local/staging/prodでprovider consoleと一致させる。 |

### ADK / Gemini

| Key | Scope | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | agent/server-side | local ADK/Gemini検証用。 |
| `GOOGLE_API_KEY` | agent/server-side | `GEMINI_API_KEY` の代替。 |
| `GOOGLE_GENAI_USE_VERTEXAI` | agent/server-side | Vertex AI利用時の切り替え。 |
| `GEMINI_MODEL` | agent/server-side | 例: `gemini-flash-latest`。 |
| `GEMINI_RUNTIME` | agent/server-side | `auto` / `adk` / `rest` など。 |

## Local Setup Notes

1. `.env.example` を `.env` にコピーする。
2. `services/adk-agent/.env.example` を `services/adk-agent/.env` にコピーする。既に `GEMINI_API_KEY` などが入った `services/adk-agent/.env` がある場合は、値を消さずに不足しているキー名だけ追記する。
3. mockユーザーテストでは Supabase / Google / Meta / Yahoo / Gemini のsecretは空でよい。
4. Supabase Auth実装に進むときは、local用の `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` を先に設定する。
5. ADK serviceからDBへ直接接続する場合は、`SUPABASE_DB_URL` と同じPostgres URIを `ADOPS_DATABASE_URL` にも入れる。
6. service role key、DB URL、OAuth secret、Gemini keyをbrowser向けの `VITE_` keyに入れない。

## Supabase Dashboard から取得する手順

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
5. ADK serviceでDB repositoryを使う場合は、同じURIを `services/adk-agent/.env` の `ADOPS_DATABASE_URL` にも入れる。

## Staging / Production Notes

- staging と production は別project、別OAuth app、別redirect URIにする。
- production dataをlocalやstagingに流用しない。
- `SUPABASE_SERVICE_ROLE_KEY` はOAuth callback、token refresh、metrics syncなど必要なserver-side管理処理に限定する。
- `TOKEN_ENCRYPTION_KEY` のrotationでは、新規保存を新しい `TOKEN_ENCRYPTION_KEY_ID` にし、既存tokenは読める間に再暗号化する。
