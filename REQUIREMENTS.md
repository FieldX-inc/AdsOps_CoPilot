# Ad Insight Copilot — REQUIREMENTS.md（ドラフト v0.1）

> このドキュメントは MVP v1.0 要件定義（最終版）をもとにした「実装のための要求仕様」ドラフトです。
> 未確定事項は **{{TODO: 未確定}}** として残します。

---

## 1. 概要

### 1.1 プロダクト名

* Ad Insight Copilot（仮）

### 1.2 目的

広告運用リテラシーが高くないインハウス担当者向けに、媒体ローデータを吸収し、KPI可視化・異常検知・原因仮説・次アクション提示・ヘルプ誘導を行う「思考支援ツール」を提供する。

### 1.3 対象ユーザー

* インハウス広告担当者（専門知識が限定的）

### 1.4 MVP（v1.0）スコープ

#### 含む

* Google Sheets 連携（**手動更新**）
* 4媒体ローデータ対応（Google / Yahoo / Meta / TikTok）
* 正規化処理（統一スキーマへ変換）
* KPI算出（CTR/CVR/CPA/ROAS）
* ルールベース異常検知
* Gemini による提案生成（テンプレ固定）
* 異常タイプ→タグ→ヘルプ記事表示
* AIサイドバーUI + チャット（セッション中履歴保持）

#### 含まない

* 媒体API直接接続
* 自動入札変更
* Slack通知
* 自動スケジュール更新
* マルチクライアント機能

---

## 2. 前提・技術方針

### 2.1 標準スタック

* Next.js（App Router）
* Tailwind CSS
* Supabase（DB + Auth + Storage）
* Vercel

> ユーザー回答より：MVPは **SaaS** 前提

### 2.2 認証

* 簡易ログイン（MVP）
* {{TODO: 未確定}} 簡易ログインの方式（メールリンク/共通PW/招待リンク/テストユーザー固定など）

### 2.3 Gemini 利用

* workspace 単位で APIキーを保持・利用
* APIキーは暗号化保存する

---

## 3. ドメイン・権限モデル

### 3.1 ワークスペース

* 1社 = 1 workspace
* 全テーブルに workspace_id を保持

### 3.2 ロール

* owner / editor / viewer
* MVPでは owner のみ実装可（ただし設計は拡張可能）

---

## 4. データ連携（Google Sheets）

### 4.1 接続方式

* Sheets の **URL** を登録して取得
* {{TODO: 未確定}} 取得方式（公開URL/サービスアカウント/ユーザーOAuth）

### 4.2 必須シート名

* GoogleAds
* YahooAds
* MetaAds
* TikTokAds

### 4.3 更新（手動）

* UIの「更新」ボタン押下で処理開始
* 成功時：「更新完了」表示
* 失敗時：エラー表示 + 前回データ保持 + ログ保存
* 重複データ登録なし

---

## 5. 入力データ仕様

### 5.1 ローデータ形式

#### GoogleAds

* Date / Campaign / Ad group / Cost / Impr. / Clicks / Conversions / Conv. value

#### YahooAds

* 日付 / キャンペーン名 / 広告グループ名 / ご利用金額 / インプレッション数 / クリック数 / コンバージョン数 / コンバージョン値

#### MetaAds

* Reporting starts / Campaign name / Ad set name / Amount spent / Impressions / Link clicks / Purchases / Purchase value

#### TikTokAds

* Date / Campaign name / Ad group name / Spend / Impressions / Clicks / Conversions / Conversion value

---

## 6. 正規化仕様

### 6.1 内部共通スキーマ

* date
* platform
* campaign
* adgroup
* cost
* impressions
* clicks
* conversions
* revenue

### 6.2 マッピング

* 媒体ごとの列名を統一マッピングして内部共通スキーマへ変換

### 6.3 バリデーション

| 条件         | 動作       |
| ---------- | -------- |
| 必須列欠損      | 更新失敗     |
| 数値型不一致     | 更新失敗     |
| 日付フォーマット違い | 自動変換     |
| データ7日未満    | 異常検知スキップ |

---

## 7. KPI 定義

* CTR = clicks / impressions
* CVR = conversions / clicks
* CPA = cost / conversions
* ROAS = revenue / cost

制約：

* ゼロ割禁止
* null は表示上「-」

---

## 8. 異常検知

### 8.1 比較ロジック

* 当日 vs 直近7日平均

### 8.2 判定条件

| 種別    | 条件                 |
| ----- | ------------------ |
| CPA悪化 | 当日CPA > 7日平均 × 1.2 |
| CV減少  | 当日CV < 7日平均 × 0.7  |
| CTR低下 | 前日比 -25%           |

### 8.3 重要度

* High：+30%以上
* Medium：+20%以上
* Low：軽微

---

## 9. AI（Gemini）

### 9.1 入力構造

```json
{
  "summary": {},
  "anomalies": [],
  "top_campaigns": [],
  "period": "7d"
}
```

### 9.2 出力テンプレ（固定）

* ■ 結論
* ■ 根拠（数値）
* ■ 考えられる原因
* ■ 優先アクション（最大3）
* ■ 参考ヘルプ

### 9.3 制約

* 数値根拠必須
* 曖昧表現禁止
* 専門用語は平易化

---

## 10. ヘルプ

### 10.1 記事モデル

* id
* platform
* tags
* difficulty
* body
* updated_at

### 10.2 タグ

* bidding
* budget_change
* conversion_tracking
* creative
* reporting

### 10.3 紐付け

* 異常タイプ → 固定タグ → 記事表示

---

## 11. UI / 画面要件

### 11.1 レイアウト

* 左サイドナビ固定（250px）
* 右コンテンツ
* ヘッダーなし

### 11.2 ダッシュボード

* KPIカード
* 異常一覧
* AIボタン（右下固定）

### 11.3 BI画面

* 期間切替（7/14/30日）
* 媒体フィルタ
* 時系列グラフ
* 構成比グラフ

### 11.4 AIサイドバー

* 幅 400px
* 自動分析表示
* チャット履歴保持（セッション中）
* 閉じるボタン

---

## 12. エラー処理

### 12.1 Sheets取得失敗

* エラー表示
* 前回データ保持
* ログ保存

### 12.2 AI失敗

* 再試行ボタン
* ログ保存

---

## 13. 非機能要件

### 13.1 パフォーマンス

* 更新 15秒以内
* AI応答 5秒以内
* 初期表示 3秒以内

### 13.2 セキュリティ

* Workspace 分離
* APIキー暗号化保存
* アクセスログ保持

---

## 14. ユーザーストーリー（MVP）

* US-01 データ更新
* US-02 KPI閲覧
* US-03 異常検知
* US-04 AI提案表示
* US-05 チャット利用
* US-06 ヘルプ誘導

---

## 15. 成功指標

* AIサイドバー利用率 60%以上
* 週3回以上利用 40%以上
* ヘルプクリック率 30%以上
