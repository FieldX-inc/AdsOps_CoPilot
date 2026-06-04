# Architecture Draft

## 1. 全体方針

AdOps Advisor は、ダッシュボードSaaSではなくAI広告コンサルタントである。

Web UIは以下を提供する。

- login / onboarding
- 広告アカウント連携
- 最低限のKPI確認
- AI chat
- recommendation / human task の確認

OpenAI Agent Service は以下を提供する。

- intent routing
- 広告開始前の設計支援
- 広告パフォーマンス分析
- 人間向けaction plan作成
- QA / policy check

## 2. 推奨インフラ構成

MVP初期は開発速度を優先し、Supabase Auth/Postgresを使う。

```txt
Browser
  -> Cloudflare Pages / Workers
    -> Supabase Auth
    -> Supabase Postgres
    -> OAuth callback
    -> Lightweight API / BFF
    -> Cloud Run OpenAI Agent Service
      -> data tools
      -> memory tools
      -> recommendation/task tools
```

公開版 / SaaS本番ではGoogle Cloud中心構成を第一候補にする。

```txt
Browser
  -> Cloud Run API or Cloudflare Pages / Workers
    -> Cloud Run OpenAI Agent Service
      -> Cloud SQL for PostgreSQL
      -> Secret Manager / Cloud KMS
      -> BigQuery
      -> Google Ads read/write APIs
      -> Stripe Billing APIs
```

DB schemaとagent serviceはPostgres-firstで実装し、Supabase固有のAuth/RLSはMVPの境界に閉じ込める。Cloud SQL for PostgreSQLへ移行するときにagent tool contractを変えないことを優先する。

## 3. Cloudflareの位置づけ

Cloudflareは以下に向いている。

- Web UI hosting
- 軽量API
- OAuth callback
- edge cache
- routing / security layer

一方、OpenAI Agents SDK runtimeは以下の理由で Cloud Run を第一候補にする。

- Python runtime / dependency の扱いやすさ
- agent処理が長くなる可能性
- logs / monitoring / job化のしやすさ

最初からすべてをCloudflare Workersに載せる必要はない。

## 4. データフロー

1. ユーザーがSupabase Authでログインする。
2. ユーザーがGoogle / Meta / Yahooの広告アカウントを連携する。
3. server側でOAuth tokenを暗号化保存する。tokenはAI prompt、tool output、logに出さない。
4. Google Ads APIで広告アカウント・指標データを取得する。
5. 最低限のdashboardに状態を表示する。
6. ユーザーがAI Advisorに質問する。
7. OpenAI root/orchestrator agentがintentを判定する。
8. 必要なtoolでworkspace/user scope済みデータを読む。
9. QA agentが根拠・自信度・承認付きwrite境界を確認する。
10. AIが提案と人間向け作業手順を返す。
11. 必要に応じてrecommendation / human_task / feedbackを保存する。

## 5. OpenAI Agent境界

OpenAI Agent Serviceはアプリ認証を直接担当しない。

Web/API layer が user/session を検証し、agentには以下のようなscope済みcontextを渡す。

- `workspace_id`
- `user_id`
- `thread_id`
- `ad_account_id`
- date range

agent tools側でも必ずworkspace scopeを検証する。

Agent Serviceの通常DBアクセスでは `SUPABASE_SERVICE_ROLE_KEY` を前提にしない。必要な管理処理で使う場合もserver-side限定とし、agent promptやtool responseには絶対に含めない。

## 6. Write Approval制約

Google Ads writeは、認証済みユーザーが明示承認したAPI routeだけで実行する。

AIは変更候補、理由、戻し条件、観察計画を出す。媒体API mutationはagent toolではなくAPI layerに置き、workspace scope、`confirmed=true`、`GOOGLE_ADS_WRITE_ENABLED=true`、監査ログを必須にする。

## 7. 最初に作りたい価値ある体験

質問例:

```txt
CPAが悪化している理由を教えて。次に何をすればいい？
```

期待flow:

1. root_agentがperformance diagnosis intentと判定
2. performance_analystが対象期間・比較期間の指標を読む
3. metrics toolがCPA/CVR/CTR/CPC/cost/conversionsを計算
4. 原因仮説を出す
5. action_plan_agentが人間向け作業手順に変換
6. qa_agentが根拠・自信度・危険表現を確認
7. 最終回答に、結論、根拠、原因仮説、作業手順、リスク、観察計画、自信度を含める
