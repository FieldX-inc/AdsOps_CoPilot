# AdOps Advisor 要件定義

Version: 1.0
Updated: 2026-07-21
Pricing and entitlement source: Codex session `019f6426-50d9-73b1-846d-a805f7cdb914`

## 1. プロダクト定義

AdOps Advisor（顧客向け名称「ちょこっとインハウス」）は、自社で広告運用を行う中小企業向けのhuman-in-the-loop型AI広告コンサルタントである。AIは分析・提案・承認候補・人間向け作業手順までを作成し、広告媒体の設定を単独で変更しない。

現在の正本構成は次のとおり。

- Web: React + Vite、Cloudflare Pages
- Public API / OAuth callback: Node.js + Hono、Google Cloud Run
- Private Agent Service: Python + OpenAI Agents SDK、Google Cloud Run
- Scheduled report: Public APIと同一イメージのCloud Run Job
- Auth / Postgres / RLS: Supabase
- Billing: Stripe Checkout / Customer Portal / Webhook
- Email: Cloudflare Email Service REST API

Google Sheetsを主データソースとする旧MVP、TikTok、Gemini、Next.js、Vercel前提は廃止済みである。Meta Ads / Yahoo Ads、Cloud SQL、BigQuery、ユーザーKPI閾値設定、BI専用画面は本番Go後の別フェーズとする。

## 2. 完了定義

「全部完了」は、コード完成だけでなく次のすべてを満たす状態を指す。

1. local quality gateとコンテナbuildが成功する
2. stagingでSupabase、Google Ads、Stripe test mode、OpenAI、Cloudflare EmailのE2Eが成功する
3. 3プランの初期費用・月額料金と、実測原価をもとにしたAI利用枠がユーザー承認済みである
4. Stripe test/live catalog、Portal、Webhookが承認済み設定で動作する
5. 本番デプロイ、スモーク、ロールバック確認、リリース証跡が完了する
6. `/readiness`の実プロバイダ疎通とcompletion auditがGoになる。ただし初回本番Goは`GOOGLE_ADS_WRITE_ENABLED=false`を正常状態とし、write機能の開放判定と分離する

## 3. プランと権限

| 項目 | ミニマム | スタンダード | プレミアム |
|---|---:|---:|---:|
| ユーザー数 | 2名 | 2名 | 5名 |
| Google Adsアカウント数 | 1件 | 3件 | 10件 |
| AI初期設定 | あり | あり | あり |
| AI改善レポート | 3日ごと | 3日ごと | 3日ごと |
| 通常AIチャット | 利用不可・ロック表示 | あり | あり・大きい利用枠 |
| Google Ads承認付きwrite | 利用不可 | あり | あり |
| 初期有人支援 | なし | なし | 予約制で含む |
| 初期費用 | 50,000円 | 70,000円 | 70,000円 |
| 月額料金 | 9,800円/月 | 49,800円/月 | 69,800円/月 |
| 請求周期 | 月額 | 月額 | 月額 |
| 無料トライアル | なし | なし | なし |

スタンダードを主力とする。スタンダードとプレミアムの基本機能は共通とし、AI利用量、人数、広告アカウント数、有人支援で差を作る。初期費用と月額料金は2026-07-24承認済み。Standard/PremiumのAI利用枠と顧客向け相談回数目安は原価実測後の承認ゲートとする。年額販売は現時点で行わない。

## 4. Auth・workspace・課金導線

- Supabase Email認証とGoogleログインを使う
- 1 workspace = 1会社。1ユーザーは複数workspaceに所属できる
- 初回導線は「プラン選択 → 登録/ログイン → pending workspace作成 → Stripe Checkout → active化」
- 未認証ユーザーはsecretを含まない公開プラン一覧のみ閲覧できる。選択した`planId` / `interval`は認証後にサーバーで再検証し、pending workspaceとCheckout Sessionに紐付ける
- pending payment時は認証、workspace基本設定、プラン一覧、Checkout、ログアウトだけを許可する
- その他の製品APIは`402 billing_required`でfail closedする
- Checkoutと署名検証済みWebhook反映後にactiveにする
- owner/adminがメンバーを招待し、サーバー側とDB triggerの両方でプラン上限を強制する
- 最後のownerの削除は拒否する
- Premium初期支援は`PREMIUM_ONBOARDING_BOOKING_URL`へのボタン導線とし、予約管理システムは作らない。未設定時もボタンを表示し、`https://example.com`へ遷移する

## 5. Stripe Billing

- plan IDは`minimum` / `standard` / `premium`で固定する
- `BILLING_PLANS_JSON`に各プランの月額Priceと一回払いの初期費用Price、表示額、通貨、AI枠、相談回数目安を持たせる
- `GET /billing/plans`はPrice IDやsecretを返さない
- Checkout入力は`{ planId, interval: "month" }`とし、サーバーが承認済みの月額Priceと初期費用Priceへ変換する
- subscription modeのCheckoutに月額Priceと一回払いPriceを同梱し、初期費用は初回invoiceだけに載せる。trialは設定しない
- Customer Portalでプラン/周期変更、キャンセルを行う
- 既存Stripe Customerを再利用する
- Webhookは署名、workspace/customer一致、Price一致を検証する
- 未払い、解約、不明Priceはfail closedする
- downgradeで上限超過した既存データは消さず、新規追加だけを停止する
- 本番は必要最小限のRestricted API Keyを使う

## 6. AI利用量と原価

- Agents SDKの実行結果からrequests、input/cached input/output/reasoning/total tokensを取得する
- `ai_usage_events`にworkspace/user、`setup|chat|scheduled_report`、source ID、model、token内訳、実行時点の推定原価、credit、rate version、idempotency keyを保存する
- model別原価表は`MODEL_COST_CATALOG_JSON`でversion管理する
- chat creditとscheduled report creditは分離する
- ミニマムのchat creditは0、Standard/Premiumの上限は設定駆動とする
- 顧客UIはtoken数と原価を出さず、月間利用率、残り相談量の目安、リセット日、アップグレード導線だけを表示する
- chat上限後も履歴閲覧、定期レポート、設定を止めない

## 7. 3日ごとの改善レポート

- workspace timezoneの9:00を基準に3日ごと。未設定時は`Asia/Tokyo`
- Cloud Schedulerは1時間ごとにCloud Run Jobを起動し、Jobが`next_run_at`以前のworkspaceをDB上でclaimする
- 同一期間はidempotency keyで重複生成しない。失敗時は上限付き再試行する
- レポートはKPI比較、変化、原因仮説、改善候補、優先度、手順、リスク、観察、自信度を含む
- ミニマムは手順まで。write CTAと通常chat CTAはロック表示にする
- メールは概要だけをHTML/plain textで送り、詳細は管理画面へ誘導する
- owner/adminは初期購読ON。各ユーザーが自分の購読をON/OFFできる
- Cloudflare Email Service REST APIで`reports@<専用ドメイン>`、表示名「ちょこっとインハウス」から送る
- 429/5xxだけ指数バックオフし、4xxは自動再送しない
- Google認証切れ/データ不足時は分析を捗造せず再接続通知に切り替える

## 8. 広告データとUI

メインナビは「ダッシュボード / 広告準備 / ヘルプ / データ連携」とする。BI分析とAdコラムの独立ページは設けない。AIチャットは独立ページではなく右サイドドロワーとする。Human Tasksは独立ナビにせずAI回答内の作業手順として扱う。

- Dashboard / AI / reportの全てに同じ`platform?` / `adAccountId?`フィルタを適用する
- 不正なアカウント値は400、workspace越境は403、platform不一致は400
- accountにexternal ID/currency/timezone/status/last sync、campaignにad account ID/customer ID/statusを含める
- account接続時に1/3/10件のプラン上限をサーバーとDBで強制する
- setup scoreはサーバー/UIとも`0〜10`にclampする
- loading、空データ、同期失敗、部分データを明示する
- 利用不可機能は非表示にせずロックとアップグレード導線を表示する
- `?preview=setup`とモックダッシュボード切替はlocal/stagingの確認用とし、productionで強制無効化する

### 広告準備とキャンペーン作成案

- 広告準備はチャットではなく、schema-drivenな一問一答の質問票として提供する。会話履歴、吹き出し、チャット入力欄は置かない
- 初期質問票はラジオボタンを中心とし、必須回答、戻る、回答ごとの途中保存、再開、回答一覧での確認と編集を提供する
- 選択肢にない情報は各質問の任意補足としてだけ自由入力で受ける
- 質問票の主画面は罫線と余白で階層化し、質問や回答項目をカードの集合として並べない
- AIは回答からキャンペーン作成案、根拠、実施前チェック、Google Ads管理画面で人が行う手順を作る
- キャンペーン作成APIとAgentの作成toolは実装しない。作成案は実行済みと扱わず、人間が媒体管理画面で確認して作成する

### ヘルプ

- Adコラムに代わり、操作手順、KPIの見方、OAuth、承認付きwriteの注意点を検索・閲覧できるヘルプを提供する
- コンテンツの正常系はmicroCMSから取得し、credentialやAPIレスポンスをブラウザへ露出しない
- microCMS未設定、timeout、4xx/5xx、空レスポンス時は、ビルドに含む最小ヘルプへフォールバックし、媒体の設定・実行に関わる誤った手順を表示しない

## 9. Agent・提案・記憶

初期Agentは`root_agent`、`setup_advisor_agent`、`performance_analyst_agent`、`action_plan_agent`、`qa_agent`の5つだけとする。IssueごとのAgentや別の専門Agentは追加しない。Agentに媒体mutation toolを与えない。

最終出力はPydantic構造化出力とし、結論、根拠、原因仮説、推奨アクション、人間向け作業手順、実施前チェック、リスク、実施後の観察、自信度を必須とする。recommendation、human task、write candidate、memory candidatesはoptionalとする。

- write candidateは当該requestのworkspace scope済み実コンテキストに存在するcustomer/campaign IDだけを許可する
- 長期記憶は安定した好み・会社文脈・継続方針に限り、source/dedupe keyを持たせる
- 一時的KPI、顧客一覧、PII、secret、tokenは保存しない
- Agent promptにsecret/token/顧客一覧を渡さない

## 10. Google Ads承認付きwrite

実行はcampaign statusとcampaign budgetだけに限る。Agent toolではなくAPI layerが実行する。

- live preview APIで現在値をGoogle Adsから取る
- requestにexpected current value、`confirmed=true`、承認理由、ロールバック条件を必須化する
- 実行直前に再取得し、差分があれば409で停止する
- 認証、workspace所属、active subscription、Standard/Premium、write flag、budget上限をすべて満たす場合だけ実行する
- before/after/audit ID/rollback payloadを返し、成功・失敗・競合をredact済み監査ログへ残す
- 復元実行は`rollbackAuditId`で元auditと関係付ける
- キャンペーン表とAI提案の両方から確認モーダルを開ける
- 本番初回公開時は`GOOGLE_ADS_WRITE_ENABLED=false`とし、別の承認で有効化する

## 11. セキュリティと受け入れ

- 全事業データはworkspace scopeを検証し、RLSとAPIの両方で越境を拒否する
- OAuth token、refresh token、API key、service role keyはログ、ブラウザ、Agent prompt、memory、メールに出さない
- tokenはサーバー側でAES-256-GCM暗号化保存する
- preview/auth bypass/mock toggleはproductionで無効とする
- 顧客にtoken数や内部原価を開示しない
- stagingでstatusを`ENABLED ↔ PAUSED`と往復し必ず復元する。budgetはprovider mock/契約テストだけで実媒体は変更しない

## 12. 外部入力・承認ゲート

次はコード実装者が決めず、ユーザー承認後に実施する。

- 製品専用メール送信ドメインの取得と文字列確定
- Standard/PremiumのAI利用枠と相談回数目安（初期費用・月額料金は2026-07-24承認済み）
- remote Supabase migration
- Stripe Product/Price、Portal、Webhookのtest/live設定
- Google Ads staging/production write
- 本番write flag有効化

Issue由来の次の項目は、必要な外部入力が揃うまで`blocked`とし、推測で実装しない。

- #5「【要判断】ポイント」: 意味、対象画面、受入条件が未定義。定義またはIssue終了の判断が必要
- #15「森さんのチャット要件をダッシュボードへ反映」: 原文または同等の要件一覧、対象画面、受入条件が必要

各ゲートの現状と証跡は`deploy/production-readiness-checklist.md`とrelease evidenceに記録する。初回本番Goと本番write有効化は別の承認証跡を持たせる。
