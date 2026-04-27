# AGENTS.md - AdOps Advisor

このリポジトリは、自社で広告運用を行う中小企業向けの **AI広告コンサルタント** を作るためのものです。

## 1. 最重要方針

AdOps Advisor は、human-in-the-loop 前提の広告運用支援プロダクトです。

Google Ads / Meta Ads / Yahoo Ads のAPIから read-only でデータを取得し、AIが分析・提案・人間向け作業手順を作ります。MVPでは媒体設定を直接変更しません。

## 2. 現在の設計方針

- 認証: Supabase Auth
- tenant model: 1 workspace = 1会社
- 1 workspace に複数広告アカウントを紐付け可能
- 長期記憶: ログインユーザー単位
- 会社・商材・広告アカウント文脈: workspace単位
- AI runtime: Google Agent Development Kit（ADK）
- Dashboard: AI Advisorの補助
- 主データソース: 広告媒体API
- 旧Google Sheets前提のMVPは廃止済み

## 3. インフラ方針

現時点では以下を第一候補とします。

```txt
Cloudflare Pages / Workers
  - Web UI
  - 軽量API
  - OAuth callback

Google Cloud Run
  - ADK Agent Service
  - Python依存のagent処理
  - 重めの分析処理

Supabase
  - Auth
  - Postgres
  - RLS
```

Cloudflareにすべて寄せる判断はまだしません。ADK本体はPython/Google SDK/処理時間/運用監視の都合で Cloud Run の方が扱いやすい可能性が高いです。

## 4. リポジトリ構成

```txt
services/adk-agent/        # ADK Python agent service
supabase/migrations/       # DB schema
docs/                      # 設計メモ
packages/shared-schemas/   # 将来の共通schema
```

旧 `apps/web` や旧Next.js実装は削除済みです。

## 5. 作業前に読むもの

1. `REQUIREMENTS.md`
2. `DESIGN.md`
3. `docs/architecture.md`
4. `docs/database.md`
5. `docs/adk-design.md`
6. 作業対象のserviceファイル

## 6. 実装ルール

- まずどのRequirement/Milestoneに関係する作業か確認する
- 小さい差分で進める
- 仕様が曖昧なら先にdocs/requirementsを更新する
- human-in-the-loop制約を守る
- MVP中は媒体write toolを作らない
- AIに渡す文脈からsecret/tokenを除外する

## 7. コマンド実行ルール

確認なしでOK:

- ファイル読み取り
- 検索
- formatter
- lint / typecheck / test
- 非破壊的なscaffold作成

事前確認が必要:

- 依存関係のinstall
- network accessが必要なコマンド
- remote DBへのmigration適用
- push
- PR作成
- taskと無関係なユーザー作成物の削除

明示依頼なしでは禁止:

- force push
- DB drop
- production data削除
- secret commit
- 広告媒体write/execution tool追加

## 8. セキュリティルール

- OAuth token / refresh token / API key / Supabase service role key をログに出さない
- secretをLLM promptに渡さない
- tokenはserver-sideで暗号化保存する
- 事業データは原則 `workspace_id` を持つ
- data accessではworkspace scopeを必ず検証する
- agent memoryにsecretや顧客リストを保存しない

## 9. ADKルール

初期agentは以下に絞る。

- `root_agent`
- `setup_advisor_agent`
- `performance_analyst_agent`
- `action_plan_agent`
- `qa_agent`

最初から大きなmulti-agent構成にしない。root_agentが肥大化してから分割する。

許可tool:

- ad account read
- metrics read
- KPI計算
- 期間比較
- 異常検知
- user memory read/write
- recommendation作成
- human task作成
- operator feedback記録

禁止tool:

- budget変更
- campaign停止
- bid変更
- ad作成
- platform mutation

## 10. AI回答ルール

運用改善提案には以下を含める。

- 結論
- 根拠
- 原因仮説
- 推奨アクション
- 人間向け作業手順
- 実施前チェック
- リスク
- 実施後の観察
- 自信度

根拠が足りない場合は、足りないと明示する。

## 11. DBルール

schema変更は `supabase/migrations/` に置く。

- 可能な限りadditiveにする
- riskがある変更はrollback方針を書く
- production dataをdropできる前提にしない
- token columnは暗号化前提で命名する

## 12. UIルール

DashboardはAI Advisorの補助です。巨大なBIを先に作らない。

優先:

- onboarding
- 広告アカウント連携状態
- 最低限のKPI
- AI chat
- recommendation / human task review

画面を作るときは `DESIGN.md` を優先します。AIチャットは独立ページではなく、右サイドドロワーとして扱います。チャートは原則 `recharts` を使い、手書きDOMグラフは避けます。MVP初期のメインナビは `ダッシュボード / BI分析 / Adコラム / データ連携` を基本とし、Human Tasks は独立ページではなくAI回答内の作業手順として扱います。

## 13. ブランチ

このworkspaceでは `codex/<topic>` 形式のbranch作成が失敗する場合があります。

推奨:

```txt
codex-<topic>
```

## 14. 現在の優先順位

1. requirements / architecture docsを固める
2. DB schema方針を固める
3. ADK service skeletonを育てる
4. Supabase Auth / workspace基盤
5. Google / Meta / Yahoo read-only OAuth
6. 最初に価値が出るADK chat loop
