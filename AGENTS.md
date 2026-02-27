# AGENTS.md（v0.1）— Ad Insight Copilot

> Think of AGENTS.md as a README for agents: a dedicated, predictable place to provide context and instructions to help AI coding agents work on this project. 
> このリポジトリは **Gemini CLI / Codex での vibe coding** を前提に最適化する。

## 0. ゴール（最重要）

* 広告運用リテラシーが高くないインハウス担当者向けに、Sheetsローデータを取り込み、KPI可視化・異常検知・原因仮説・次アクション・ヘルプ誘導を行う **SaaS MVP** を作る。
* **MVPは手動更新**（自動スケジュール/媒体API連携はスコープ外）。

---

## 1. 現状の要件スコープ（MVP v1.0）

### 含む

* Google Sheets（URL）連携（手動更新）
* 4媒体（Google/Yahoo/Meta/TikTok）ローデータ取り込み
* 正規化（共通スキーマ化）＋バリデーション
* KPI算出（CTR/CVR/CPA/ROAS、ゼロ割禁止、nullは「-」）
* ルールベース異常検知（当日 vs 直近7日平均等）
* Gemini による提案生成（テンプレ固定、数値根拠必須、平易化）
* ヘルプ記事モデル＋異常タイプ→タグ→記事表示
* AIサイドバー（自動分析＋チャット、セッション中履歴保持）

### 含まない

* 媒体API直接接続、Slack通知、自動更新、自動入札変更、マルチクライアント

---

## 2. 技術スタック（前提）

* Next.js（App Router）
* Tailwind CSS
* Supabase（DB + Auth + Storage）
* Vercel

### 認証（MVP）

* 簡易ログイン
* {{TODO: 未確定}} 方式（例：メールリンク / マジックリンク / 招待URL / テストユーザー固定 など）

### Gemini

* **workspace単位**でAPIキーを保持し利用
* APIキーは暗号化保存（復号はサーバー側のみ）

---

## 3. 作業の進め方（エージェント向けルール）

### 3.1 進め方（必須）

1. まず `REQUIREMENTS.md` を参照し、作業対象の US（US-01〜06）を1つ選ぶ
2. そのUSに必要な **DBスキーマ / API / UI / エラー処理 / ログ** を洗い出す
3. 実装前に **最小の差分** で PR 単位（またはコミット単位）に分割提案
4. 不明点は推測で埋めない。**{{TODO: 未確定}}** として残し、質問を最大5つまで作る

### 3.2 禁止事項（安全）

* **コマンドの自動実行は禁止**（提案はOK、実行はユーザーが行う）
* 破壊的操作は禁止（例：`rm -rf`、DBのdrop/大量delete、強制push）
* マイグレーション／本番データ変更は必ず手順を明示し、ロールバック案を併記
* 秘密情報（APIキー、トークン）をコード・ログ・Issue に貼らない

---

## 4. 期待するリポジトリ構造（案）

> 実装開始時に作る。現時点は方針のみ。

* `apps/web` : Next.jsフロント
* `supabase/` : migrations / config
* `packages/shared` : 型・ユーティリティ（必要なら）
* `docs/` : {{TODO: 未確定}}（将来。MVPでは最小）

---

## 5. データパイプライン（MVP方針）

1. Sheets URL 登録
2. Raw Import Layer（媒体別の生データを保持）
3. Normalizer（共通スキーマへ）
4. Unified Metrics Table（集計・KPI）
5. Anomaly Engine（ルール判定）
6. Gemini（提案生成）
7. UI（Dashboard / BI / AI sidebar）

{{TODO: 未確定}} Sheets取得方式（公開URL/サービスアカウント/OAuth）により実装が大きく変わるため、最初に確定する。

---

## 6. ログ・エラーハンドリング

* Sheets取得失敗：エラー表示、前回データ保持、ログ保存
* AI失敗：再試行ボタン、ログ保存
* 監査：アクセスログ保持（最低限）

---

## 7. まず着手する実装優先度（提案）

* P0: US-01（更新）に必要な「Sheets取り込み + バリデーション + 重複排除」
* P0: 正規化 + KPI算出 + ダッシュボード最小表示（US-02）
* P1: 異常検知（US-03）
* P1: Gemini提案（US-04）＋ヘルプ紐付け（US-06）
* P2: チャット（US-05：セッション中履歴）

