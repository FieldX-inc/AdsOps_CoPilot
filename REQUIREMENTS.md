# AdOps Advisor - REQUIREMENTS.md v0.3

## 1. プロダクト定義

AdOps Advisor は、自社で広告運用を行う中小企業の担当者向けの **AI広告コンサルタント** である。

主役はダッシュボードではない。ダッシュボードはAIが判断するための補助情報であり、プロダクト価値の中心は「広告運用に詳しくない担当者が、AIに相談しながら広告設計・分析・改善判断を進められること」にある。

旧MVPの Google Sheets 手動取り込み前提は廃止する。今後は Google Ads / Meta Ads / Yahoo Ads のAPI連携を前提に再設計する。

## 2. 対象ユーザー

- 自社で広告を運用している中小企業の担当者
- 広告運用の専門知識が深くないマーケティング担当者
- 広告代理店ではなく、自社の商材・予算・成果に責任を持つ人
- 広告の初期設計から運用改善まで相談相手が欲しい人

## 3. 提供価値

AdOps Advisor は、広告コンサルタントのように振る舞う。

広告開始前:

- 商材理解
- ペルソナ設計
- ターゲット整理
- 訴求軸の整理
- 媒体選定
- 初期キャンペーン構成の提案

広告運用中:

- KPIの読み解き
- CPA悪化、CVR低下、CTR低下などの原因仮説
- 媒体横断での優先順位付け
- 次に見るべきキャンペーンの提示
- 人間が管理画面で実行するための作業手順作成

実施後:

- 提案が採用されたかを記録
- 実施後の結果や担当者フィードバックを記憶
- 次回以降の提案に反映

## 4. MVPスコープ

### 含む

- Supabase Auth によるログイン
- 1 workspace = 1会社
- 1 workspace に複数広告アカウントを連携可能
- Google Ads / Meta Ads / Yahoo Ads の read-only API連携
- 最低限のダッシュボード
- Google Agent Development Kit（ADK）ベースのAIチャット
- ログインユーザー単位の長期記憶
- workspace単位の会社・商材・広告アカウント文脈
- human-in-the-loop の改善提案
- 人間向け作業指示書
- human task 管理
- operator feedback の記録
- agent tool call / audit log の記録

### 含まない

- 媒体APIによる広告設定の直接変更
- 予算変更、入札変更、キャンペーン停止、広告作成の自動実行
- 自動最適化
- 定期実行型の自律エージェント
- Slack通知
- 代理店向けマルチクライアント管理
- 高度なBIツール
- CSV / Google Sheets を主データソースにすること

CSV / Sheets は将来的なデモ、検証、fallback では使ってよいが、プロダクトの主軸にはしない。

## 5. ワークスペース設計

MVPでは以下の設計にする。

- `workspace` = 1会社
- `user` = Supabase Auth のログインユーザー
- 1 workspace に複数 user を紐付けられる設計にしておく
- 1 workspace に Google / Meta / Yahoo の複数広告アカウントを紐付けられる
- ユーザー記憶は user 単位
- 会社情報・商材情報・広告アカウント情報は workspace 単位

代理店向けの複数クライアント切り替えUIはMVPでは作らない。ただしDBは将来拡張できる形にしておく。

## 6. 認証・広告アカウント連携

### UX方針

ユーザーには「ログインしたらそのまま広告アカウントも連携できる」ように感じさせたい。

ただし、アプリログインと広告API認可は技術的に別物として扱う。

ユーザーに広告媒体のAPIキー、developer token、client secret、app secret の取得や入力を求めない。ユーザー向けUIは `Google Ads と連携` のようなOAuthボタンを基本にし、各媒体の認可画面でログインしてread-only権限を許可してもらう。媒体アプリのclient secretやdeveloper tokenが必要な場合はAdOps Advisor側のサーバー設定として管理し、ワークスペース利用者には見せない。

### 技術方針

- アプリログイン: Supabase Auth
- Google Ads連携: Google Ads API 用 OAuth
- Meta Ads連携: Meta Marketing API 用 OAuth
- Yahoo Ads連携: Yahoo Ads API 用 OAuth

OAuth token は暗号化して保存する。token はサーバー側だけで扱い、ブラウザ、ログ、AIプロンプト、agent memory に出してはいけない。

## 7. インフラ方針

### 現時点の推奨

MVP初期は **Cloudflare + Cloud Run + Supabase** の組み合わせを第一候補にする。

- Web / 軽量API / OAuth callback:
  - Cloudflare Pages / Workers を候補にする
- ADK Agent Service:
  - Google Cloud Run を第一候補にする
- DB / Auth:
  - Supabase

### 公開版 / SaaS本番の候補

公開版では、Google Ads API、ADK、分析処理、監査・運用監視をGoogle Cloud側に寄せるため、**Google Cloud中心構成** を第一候補にする。

- Web / API:
  - Cloud Run または Cloudflare Pages / Workers + Cloud Run API
- ADK Agent Service:
  - Google Cloud Run
- DB:
  - Cloud SQL for PostgreSQL
- secret / encryption key:
  - Secret Manager / Cloud KMS
- 長期分析・集計:
  - BigQuery

ただしMVP開発速度を優先し、当面はSupabase Auth/Postgresで進める。DB schemaとservice実装は **Postgres-first** とし、Supabase固有機能への依存は認証・RLS・DB境界に閉じ込める。agent/service層はCloud SQL for PostgreSQLへ移行しやすい形を保つ。

### 理由

Cloudflare はフロント配信、軽量API、OAuth callback、エッジ実行に強い。一方で、ADK本体はPython依存、Google系SDK、長めのagent処理、将来的なジョブ実行・観測性を考えると Cloud Run の方が扱いやすい。

したがって、全部をCloudflareに寄せるより、以下の分担がよい。

```txt
Cloudflare Pages / Workers
  - Web UI
  - BFF / 軽量API
  - OAuth callback

Google Cloud Run
  - ADK Agent Service
  - 重い分析処理
  - Google系SDKとの連携

Supabase
  - Auth
  - Postgres
  - Row Level Security
```

公開版候補:

```txt
Google Cloud Run
  - Web/API backend
  - ADK Agent Service

Cloud SQL for PostgreSQL
  - SaaS core DB

Secret Manager / Cloud KMS
  - OAuth token encryption key
  - service credentials

BigQuery
  - 広告metricsの長期分析・集計
```

### 未確定

Next.jsを使うか、別のWebフレームワークを使うかは未確定。Cloudflareを使うなら、Cloudflare Pagesとの相性を考慮して決める。

## 8. データ要件

### 広告アカウント情報

各連携広告アカウントについて、最低限以下を保持する。

- platform
- external account id
- account name
- currency
- timezone
- status
- connection status

### 指標データ

最低限、以下の粒度を扱えるようにする。

- account
- campaign
- ad group / ad set
- ad / creative（取得可能な場合）

最低限の指標:

- impressions
- clicks
- cost
- conversions
- revenue / conversion value
- CTR
- CVR
- CPC
- CPA
- ROAS

KPI算出ルール:

- CTR = clicks / impressions
- CVR = conversions / clicks
- CPC = cost / clicks
- CPA = cost / conversions
- ROAS = revenue / cost
- ゼロ割は禁止
- 算出不能な値はUIでは `-` 表示

## 9. ダッシュボード要件

ダッシュボードは最小限でよい。AIに相談するための状況把握画面として作る。

必須:

- 連携アカウント状態
- 期間フィルタ
- 媒体 / アカウントフィルタ
- KPIカード
- キャンペーン別パフォーマンス表
- シンプルな時系列グラフ
- 最近のAI提案 / human task

MVPでは不要:

- 高度なBI
- 自由なレポートビルダー
- スライド自動生成
- 細かいデザイン作り込み

## 10. AI Advisor要件

AI Advisor は、広告に関する広い質問に答えられることを目指す。

例:

- 「誰をターゲットにすべき？」
- 「ペルソナを一緒に考えて」
- 「キャンペーン構成どうすればいい？」
- 「CPAが悪化した理由を教えて」
- 「どのキャンペーンから見るべき？」
- 「次に何をすればいい？」
- 「作業チェックリストにして」
- 「初心者にもわかるように説明して」

広告データが足りない場合は、推測で断言せず、足りない情報を明示する。商材情報が足りない場合は、必要な質問をする。

## 11. ADK Agent構成

最初から巨大なmulti-agent構成にしない。まずは小さく始める。

### 初期agent

- `root_agent`
  - 全質問の入口
  - intent判定
  - tool / sub-agent 呼び出し
  - 最終回答の統合

- `setup_advisor_agent`
  - 広告開始前の相談
  - 商材、ペルソナ、ターゲット、訴求、媒体選定、初期構成

- `performance_analyst_agent`
  - 広告指標の読み取り
  - 期間比較
  - KPI変化の説明
  - 原因仮説

- `action_plan_agent`
  - 提案を人間向け作業手順に変換
  - チェックリスト、リスク、期待効果、観察計画

- `qa_agent`
  - 根拠確認
  - 自信度調整
  - 危険な断定の抑制
  - write禁止チェック

### 後で分離するagent候補

- `budget_advisor_agent`
- `creative_review_agent`
- `reporting_agent`
- `help_agent`

## 12. Tool Policy

### 許可するtool

- 広告アカウント一覧の取得
- 指標データの取得
- KPI計算
- 期間比較
- 異常検知
- user memory の読み書き
- recommendation の作成
- human task の作成
- operator feedback の記録

### 禁止するtool

- campaign budget 更新
- campaign 停止 / 有効化
- bid / bid strategy 変更
- ad 作成 / 編集
- targeting 変更
- 媒体APIへの mutation

MVPではwrite系toolをコードベースに作らない。存在しないtoolは誤って呼ばれない。

## 13. AI回答フォーマット

運用改善の回答では、原則として以下の形にする。

```txt
結論:
何が起きているか

根拠:
どの期間・どの数値を見たか

原因仮説:
なぜそうなった可能性があるか

推奨アクション:
優先度つきの打ち手

人間向け作業手順:
媒体管理画面で人間がどう確認・操作するか

実施前チェック:
変更前に確認すべきこと

リスク:
何が悪化する可能性があるか

実施後の観察:
いつ、どの指標を見るか

自信度:
High / Medium / Low と理由
```

## 14. Memory要件

Memory は会話と operator feedback から自動抽出する。

### user memory

- 担当者の好み
- 説明の粒度
- 重視KPI
- 過去の意思決定
- 採用されやすい提案 / されにくい提案
- 過去のフィードバック

### workspace profile

- 会社概要
- 商材概要
- ターゲット
- CV定義
- 月予算
- 制約条件
- 連携広告アカウント

### thread state

- 現在の会話内だけの一時文脈

Memory に OAuth token、API key、顧客リスト、個人情報、秘密情報を保存してはいけない。

## 15. Human Task / Feedback

AIの提案は `human_tasks` に変換できるようにする。

task status:

- `draft`
- `suggested`
- `accepted`
- `doing`
- `done`
- `rejected`
- `ignored`

operator feedback では以下を記録する。

- 提案を採用したか
- 採用しなかった理由
- 実施したか
- 実施後に成果が改善したか
- 担当者コメント
- 必要なら実施後の観察指標

## 16. DB設計方針

初期schemaには以下を含める。

- `workspaces`
- `workspace_members`
- `workspace_profiles`
- `ad_platform_connections`
- `ad_accounts`
- `campaign_snapshots`
- `ad_group_snapshots`
- `ad_daily_metrics`
- `agent_threads`
- `agent_messages`
- `user_memories`
- `agent_tool_calls`
- `recommendations`
- `human_tasks`
- `operator_feedback`
- `audit_logs`

事業データには原則 `workspace_id` を持たせる。

## 17. セキュリティ・ガードレール

- すべてのデータアクセスで workspace scope を強制する
- OAuth token は暗号化保存する
- token をAIプロンプトに渡さない
- agent tool call を記録する
- 数値根拠なしの成果断定は禁止
- 提案には自信度を付ける
- 予算関連の提案にはリスク説明を必須にする
- 「必ず改善します」のような保証表現は禁止
- ユーザーが依頼しても、媒体設定の直接変更は拒否する

## 18. 開発マイルストーン

### Milestone 0: Repository Reboot

- 旧Sheets-first MVPコードを削除
- `REQUIREMENTS.md` を新方針で書き直す
- `AGENTS.md` を書き直す
- DB schema 初稿を追加
- ADK service skeleton を追加

### Milestone 1: Auth / Workspace基盤

- Supabase Auth
- workspace / member model
- 基本app shell

### Milestone 2: Platform OAuth / Read-only Data

- Google Ads / Meta Ads / Yahoo Ads のOAuth連携
- token暗号化保存
- 広告アカウント一覧取得
- campaign metrics 取得

### Milestone 3: Minimal Dashboard

- 連携アカウント状態
- KPI cards
- campaign table
- trend chart

### Milestone 4: ADK Chat MVP

- root agent
- setup advisor
- performance analyst
- action plan agent
- QA guardrail
- user memory extraction

### Milestone 5: Human Tasks / Feedback

- recommendation 保存
- human task 作成
- operator feedback 記録
- feedback を次回以降の会話に反映

## 19. 未確定事項

- Supabase Auth の初期providerを email / Google / 両方 のどれにするか
- Webフレームワークを何にするか
- Cloudflare Pages / Workers をどこまで使うか
- ADK Agent Service を最初から Cloud Run に載せるか、ローカル開発優先にするか
- OAuth token の具体的な暗号化方式
- 3媒体で共通化できる指標と、媒体固有指標の扱い
- platform APIから都度読むか、DBにどの粒度でcacheするか
