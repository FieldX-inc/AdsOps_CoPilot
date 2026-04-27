# Database Design Draft

## 1. 目的

このDB設計は、以下を支える。

- 1会社 = 1 workspace
- Supabase Auth user
- Google / Meta / Yahoo のread-only広告アカウント連携
- ADK chat
- user memory
- recommendation
- human task
- operator feedback
- audit log

MVP初期はSupabase Auth/Postgresに置くが、公開版 / SaaS本番ではCloud SQL for PostgreSQLへ移行できる **Postgres-first** 設計にする。Supabase固有のAuth/RLSは初期実装の利点として使う一方、agent/service層は直接Supabase前提にしすぎない。

公開版候補:

- Cloud SQL for PostgreSQL: core DB
- Secret Manager / Cloud KMS: OAuth token暗号化keyとservice credentials
- BigQuery: 広告metricsの長期分析・集計

## 2. Core Tables

### `workspaces`

会社単位のtenant。

### `workspace_members`

Supabase Auth user と workspace の紐付け。

### `workspace_profiles`

会社・商材・ターゲット・CV定義・予算など、workspace単位の文脈。

### `ad_platform_connections`

媒体OAuth連携情報。

主なfield:

- `workspace_id`
- `user_id`
- `platform`
- `access_token_encrypted`
- `refresh_token_encrypted`
- `scopes`
- `expires_at`
- `status`

tokenは必ず暗号化保存する。plaintext tokenを保存してはいけない。

### `ad_accounts`

連携された広告アカウント。

### `campaign_snapshots`

campaignのread-only snapshot。

### `ad_group_snapshots`

ad group / ad set のread-only snapshot。

### `ad_daily_metrics`

日別の広告指標。account / campaign / ad group / ad の粒度を可能な範囲で持つ。

### `agent_threads` / `agent_messages`

AI chat履歴。

### `user_memories`

会話やfeedbackから抽出されたログインユーザー単位の長期記憶。

### `recommendations`

AIの提案を構造化して保存する。

### `human_tasks`

AI提案から派生する、人間が実行する作業task。

### `operator_feedback`

提案を採用したか、実施したか、成果がどうだったかを記録する。

### `agent_tool_calls`

ADK agentがどのtoolを呼んだかを記録する。

### `audit_logs`

監査ログ。

## 3. Scope Rules

- 事業データは原則 `workspace_id` を持つ
- user memory は `workspace_id` と `user_id` の両方を持つ
- tool call は `workspace_id` と `user_id` を記録する
- clientからtoken columnを読ませない
- Supabase Auth provider はMVPでは email + Google を前提にする
- client sessionでは `workspace_members` によるmembership確認をRLSで強制する
- ADK / OAuth callback / metrics sync などserver-side処理でも、DB操作前に `workspace_id` と `user_id` のscopeを検証する

## 4. RLS / Membership

`20260427_auth_workspace_rls.sql` でMVP用のRLSを追加する。

- `app.current_user_is_workspace_member(workspace_id)` でログインユーザーのmembershipを確認する
- `app.current_user_has_workspace_role(workspace_id, roles)` で owner / admin 操作を制限する
- `workspaces` はauthenticated userが作成でき、最初の `workspace_members` owner insert だけbootstrapとして許可する
- workspace配下の事業データは、原則workspace memberだけがselectできる
- `workspace_profiles` と membership 管理は owner / admin をwrite主体にする
- `viewer` はread-onlyとして扱い、chat / memory / recommendation / human task / feedbackのwriteは owner / admin / member に絞る
- `agent_threads` / user message / operator feedback / user memory は `user_id = auth.uid()` もwrite条件にする
- `agent_tool_calls` と `audit_logs` は owner / admin のreadに絞る
- `ad_platform_connections` はtoken columnを含むため、authenticated clientにはtoken columnのselect権限を付けない。UIは `ad_platform_connection_statuses` view で連携状態だけ読む

server-side service role はRLSをbypassできるため、OAuth callback、token refresh、metrics sync、ADK repositoryで使う場合も application layer でworkspace scopeを必ず検証する。

運用注意:

- `20260427_auth_workspace_rls.sql` は `20260426_reboot_schema.sql` の後に適用する
- `app` schemaのhelper関数はRLS policyから呼ぶため、authenticatedだけに実行権限を与え、PUBLIC/anonには開けない
- `workspace_members` は最後のownerを削除・降格できないtriggerを持つ。workspaceを削除する場合は、workspace本体のdelete cascadeでmembershipを消す
- memberが存在しないworkspaceは最初のownerとしてclaim可能なbootstrap policyになるため、通常運用でorphan workspaceを作らない
- `ad_platform_connections` のinsert/updateはauthenticated clientには許可しない。OAuth callback / token refreshなどserver-side処理だけがservice roleで書き込む
- `ad_platform_connection_statuses` は `security_invoker = true` のviewとして、呼び出しユーザーのRLSと列権限を使う

## 5. Updated At

`updated_at` を持つtableには `app.set_updated_at()` triggerを付ける。

対象:

- `workspaces`
- `workspace_profiles`
- `ad_platform_connections`
- `ad_accounts`
- `agent_threads`
- `user_memories`
- `recommendations`
- `human_tasks`

## 6. Token Storage

OAuth tokenはDB関数ではなくapplication layerで envelope encryption してから保存する。MVPでは以下を前提にする。

- 暗号化方式: AES-256-GCM
- key material: `TOKEN_ENCRYPTION_KEY` に32 bytes相当のbase64 secretを入れる
- key id: `TOKEN_ENCRYPTION_KEY_ID` と `ad_platform_connections.token_key_id` で管理する
- ciphertext format: version / key id / iv / tag / ciphertext を含むbase64またはJSON envelope
- key管理: localは`.env`、staging/productionはSecret ManagerまたはCloud KMS由来のsecretを使う
- rotation: 新規保存は新key id、既存tokenは読める間に再暗号化して `token_key_id` を更新する
- audit補助: token本文は記録せず、暗号化保存・再暗号化の時刻だけ `token_encrypted_at` に残す
- revoke: provider revoke後にtoken columnをnull化し、`status = 'revoked'` にする
- refresh失敗: `status = 'expired'` または `error` にし、`last_error` にはsecretを含めない

OAuth token / refresh token / API key / Supabase service role key は、AI prompt、ADK tool output、agent memory、application logに出してはいけない。`SUPABASE_SERVICE_ROLE_KEY` は通常のagent DBアクセスには使わず、必要なserver-side管理処理に限定する。

production前に詳細化するもの。

- token refresh方針
- 媒体ごとのscope最小化
- KMSでのkey wrapping有無

## 7. RLS Migration Rollback Notes

本番適用後にRLS migrationを戻す場合は、データをdropせず、以下の順で戻す。

1. applicationをmaintenance modeにして新規writeを止める
2. `ad_platform_connection_statuses` viewを参照しているUI/APIを止める
3. policiesをdropする
4. triggersをdropする
5. `ad_platform_connection_statuses` viewをdropする
6. 必要なら `ad_platform_connections.token_key_id` / `token_encrypted_at` と `human_tasks.updated_at` を残したままにする
7. RLSを一時停止する場合だけ `alter table ... disable row level security` を使う

token columnを含むtable権限を戻す場合も、plaintext tokenや暗号化済みtokenをclientへ返さないことを優先する。rollback中もservice role key、OAuth token、暗号化keyをlogやAI promptに出してはいけない。
