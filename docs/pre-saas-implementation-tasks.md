# Pre-SaaS Implementation Tasks

このタスク表は、AdOps Advisorを「mockユーザーテスト」から「実広告APIで限定運用できるPre-SaaS MVP」へ引き上げるための実装計画です。

## 0. 到達状態

目標:

- 限定ユーザーがログインできる
- 1 workspace = 1会社としてtenant境界が守られる
- Google Ads / Meta Ads / Yahoo Adsをread-only OAuthで連携できる
- 実広告データをDashboard / BI / AI Advisorで扱える
- AIは分析、提案、人間向け作業手順、human task作成まで行う
- 媒体API write toolは存在しない
- secret/token/API keyをLLM prompt、agent memory、tool output、log、ブラウザへ出さない
- Cloudflare移行前の状態として、Web/API/OAuth callbackを移し替えやすい境界になっている

対象外:

- 媒体設定の自動変更
- 代理店向けマルチクライアントUI
- 高度なBI
- Slack通知
- 定期自律実行
- Cloudflare Workersへの完全移行

## 1. Milestone Map

| ID | Milestone | 目的 | 完了条件 |
| --- | --- | --- | --- |
| M0 | Stabilize Current MVP | 現在のmock版を壊さず、実装土台を安定させる | test/build/typecheckが通り、readinessで残タスクが見える |
| M1 | Supabase Auth / Workspace | tenant境界を作る | login後、自workspaceだけ読める |
| M2 | DB Persistence | in-memory/demo固定をやめる | chat/recommendation/taskがDB永続化される |
| M3 | Google Ads Read-only | 最初の実媒体連携を完成させる | Google Ads実データでDashboardとAI回答が動く |
| M4 | Cloud Run ADK Deploy | 実ADK serviceをデプロイする | APIからCloud Run ADKへ安全に接続できる |
| M5 | Meta Ads Read-only | SNS広告データを横断分析に入れる | Meta実データが正規化される |
| M6 | Yahoo Ads Read-only | 国内MVP対象媒体を満たす | Yahoo実データが正規化される |
| M7 | Limited Production Deploy | 限定ユーザーがURLで使える | ローカルなしでlogin/OAuth/AI相談が完了 |
| M8 | Cloudflare Migration Ready | SaaS化移行の境界を整える | Pages/Workersへ移す作業だけが残る |

## 2. M0 Stabilize Current MVP

Requirement:

- `REQUIREMENTS.md` 4. MVPスコープ
- `REQUIREMENTS.md` 17. セキュリティ・ガードレール
- `docs/user-test-readiness.md`

Tasks:

- [ ] M0-01: Python 3.11以上でADK testを実行できるローカル手順を作る
  - Owner: backend
  - Depends on: none
  - Output: READMEまたはdocsにPython 3.11実行手順
  - Verify: `python3.11 -m pytest` in `services/adk-agent`

- [ ] M0-02: `npm run typecheck` / `npm run build` / `python3.11 -m pytest` を標準検証コマンドにする
  - Owner: fullstack
  - Depends on: M0-01
  - Output: README更新、必要ならscript追加
  - Verify: 3コマンドが成功

- [ ] M0-03: API入口でsecret guardを実装する
  - Owner: backend
  - Depends on: current ADK secret guard
  - Output: `apps/api`のchat routeでsecretらしき入力をDB/ADKへ渡さず拒否
  - Verify: dummy secret入力で値を再掲しない

- [ ] M0-04: no-write policyをAPIとADKの両方で統一する
  - Owner: backend
  - Depends on: none
  - Output: shared policyまたは同等テスト
  - Verify: 「キャンペーンを停止して」「予算を上げて」「広告を入稿して」が拒否/手順化される

- [ ] M0-05: `/readiness` を `mock` と `production` 観点に分ける
  - Owner: fullstack
  - Depends on: current `/readiness`
  - Output: API responseとUI表示
  - Verify: mock testはGo、productionは未完了項目が出る

- [ ] M0-06: API成功時でもmockデータであることをUIで明示する
  - Owner: frontend
  - Depends on: API response mode
  - Output: Dashboard / BI / Connectionsにmock banner
  - Verify: 実データ接続済みと誤認しない文言

- [ ] M0-07: データ連携画面を社内テスト用に未接続状態として見せる
  - Owner: frontend
  - Depends on: `/connections`
  - Output: Google / Meta / Yahooがread-only OAuth予定として表示
  - Verify: APIキー入力欄がない

Exit Criteria:

- [ ] `npm run typecheck` success
- [ ] `npm run build` success
- [ ] `python3.11 -m pytest` success
- [ ] secret/no-write smoke test success
- [ ] docs/user-test-readiness.mdのGo条件を満たす

## 3. M1 Supabase Auth / Workspace

Requirement:

- `REQUIREMENTS.md` 5. ワークスペース設計
- `REQUIREMENTS.md` 6. 認証・広告アカウント連携
- `docs/database.md` 4. RLS / Membership

Tasks:

- [ ] M1-01: Supabase project/envを定義する
  - Owner: infra
  - Depends on: none
  - Output: env list, local/staging/prodの区分
  - Verify: `.env.example`に必要キーが揃う

- [ ] M1-02: WebにSupabase Auth clientを追加する
  - Owner: frontend
  - Depends on: M1-01
  - Output: login/logout/session restore
  - Verify: localでemail loginまたはmagic link loginが動く

- [ ] M1-03: APIでSupabase JWTを検証するmiddlewareを追加する
  - Owner: backend
  - Depends on: M1-01
  - Output: authenticated API boundary
  - Verify: tokenなしは401、valid tokenは通る

- [ ] M1-04: workspace bootstrap flowを作る
  - Owner: fullstack
  - Depends on: M1-02, M1-03
  - Output: 初回ログイン時にworkspace作成/owner membership作成
  - Verify: `workspaces` と `workspace_members` に作成される

- [ ] M1-05: APIでworkspace membershipを検証する
  - Owner: backend
  - Depends on: M1-03, M1-04
  - Output: `workspaceId` query/bodyを信用せずmembership確認
  - Verify: 他workspace ID指定で403

- [ ] M1-06: Webのdemo payload固定をauth session由来に置き換える
  - Owner: frontend
  - Depends on: M1-04, M1-05
  - Output: `userId`, `workspaceId`, `threadId`の実値化
  - Verify: demo user固定が通常導線から消える

- [ ] M1-07: RLS migrationをlocal/stagingで適用検証する
  - Owner: backend
  - Depends on: M1-04
  - Output: migration apply notes
  - Verify: owner/member/viewerのselect/write境界が期待通り

Exit Criteria:

- [ ] login/logout works
- [ ] workspace create works
- [ ] API rejects unauthenticated requests
- [ ] other workspace access returns 403
- [ ] no service role key in browser

## 4. M2 DB Persistence

Requirement:

- `docs/database.md` 2. Core Tables
- `REQUIREMENTS.md` 11. DBルール

Tasks:

- [ ] M2-01: 現行migrationとrepository実装の差分を棚卸しする
  - Owner: backend
  - Depends on: M1
  - Output: missing table/column list
  - Verify: docs/database.mdとの差分が説明できる

- [ ] M2-02: `agent_threads` 作成/取得APIを実装する
  - Owner: backend
  - Depends on: M1-05
  - Output: thread UUID運用
  - Verify: thread作成後にDBへ保存される

- [ ] M2-03: `agent_messages` DB保存へ切り替える
  - Owner: backend
  - Depends on: M2-02
  - Output: user/assistant message persistence
  - Verify: 再起動後も会話履歴が残る

- [ ] M2-04: recommendationsをDB保存へ切り替える
  - Owner: backend
  - Depends on: M2-03
  - Output: `recommendations` repository/API
  - Verify: AI回答後にrecommendationがDBへ保存される

- [ ] M2-05: human tasksをDB保存へ切り替える
  - Owner: backend
  - Depends on: M2-04
  - Output: `human_tasks` repository/API
  - Verify: task status updateがworkspace scopedで動く

- [ ] M2-06: operator feedbackを実装する
  - Owner: fullstack
  - Depends on: M2-05
  - Output: adopted/rejected/done/result memo
  - Verify: feedbackがuser/workspace/threadに紐づく

- [ ] M2-07: agent tool audit logをDB保存する
  - Owner: backend
  - Depends on: M2-03
  - Output: `agent_tool_calls`
  - Verify: tool started/succeeded/failedが保存される

Exit Criteria:

- [ ] chat history persists
- [ ] recommendations persist
- [ ] human tasks persist
- [ ] operator feedback persists
- [ ] all persistence is workspace scoped

## 5. M3 Google Ads Read-only OAuth

Requirement:

- `REQUIREMENTS.md` 6. 認証・広告アカウント連携
- `docs/database.md` 6. Token Storage

Tasks:

- [ ] M3-01: Google Ads OAuth app設定を整理する
  - Owner: infra
  - Depends on: M1
  - Output: redirect URI, scopes, env list
  - Verify: OAuth consent画面にread-only目的が表示される

- [ ] M3-02: token encryption moduleを実装する
  - Owner: backend
  - Depends on: M3-01
  - Output: AES-256-GCM envelope encryption
  - Verify: encrypt/decrypt unit test, plaintext tokenを保存しない

- [ ] M3-03: OAuth state/PKCE storageを実装する
  - Owner: backend
  - Depends on: M3-02
  - Output: state nonce, workspace/user binding, expiry
  - Verify: invalid state is rejected

- [ ] M3-04: Google OAuth start routeを実装する
  - Owner: backend
  - Depends on: M3-03
  - Output: `/oauth/google/start`
  - Verify: authenticated userだけ開始できる

- [ ] M3-05: Google OAuth callback routeを実装する
  - Owner: backend
  - Depends on: M3-04
  - Output: code exchange, token encryption save
  - Verify: token columnはencrypted only

- [ ] M3-06: Google Ads customer list取得を実装する
  - Owner: backend
  - Depends on: M3-05
  - Output: accessible customers list
  - Verify: customer ID/name/currency/timezoneを保存できる

- [ ] M3-07: ad account選択/紐付けUIを実装する
  - Owner: frontend
  - Depends on: M3-06
  - Output: account picker
  - Verify: selected accountが`ad_accounts`に保存される

- [ ] M3-08: Google campaign metrics syncを実装する
  - Owner: backend
  - Depends on: M3-07
  - Output: account/campaign daily metrics
  - Verify: `ad_daily_metrics`に日別指標が保存される

- [ ] M3-09: token refreshを実装する
  - Owner: backend
  - Depends on: M3-05
  - Output: refresh before expiry, failure status
  - Verify: expired tokenでstatusが安全に更新される

- [ ] M3-10: Google Ads dataをDashboard/APIへ接続する
  - Owner: fullstack
  - Depends on: M3-08
  - Output: mock fallbackではなくDB metricsを返す
  - Verify: 実Google Ads指標がDashboardに出る

- [ ] M3-11: Google Ads dataをADK contextへ渡す
  - Owner: backend
  - Depends on: M3-10, M2
  - Output: scope済みmetrics context
  - Verify: AI回答の根拠に実指標が含まれる

- [ ] M3-12: Google Ads OAuth/security testsを追加する
  - Owner: backend
  - Depends on: M3-05
  - Output: state, token redaction, no prompt leakage tests
  - Verify: dummy tokenがlog/responseに出ない

Exit Criteria:

- [ ] Google OAuth read-only connection works
- [ ] Google Ads account is selectable
- [ ] Google campaign metrics sync works
- [ ] Dashboard uses real Google Ads data
- [ ] AI uses real Google Ads evidence
- [ ] no media write tool exists
- [ ] token is encrypted and never returned to browser

## 6. M4 Cloud Run ADK Deploy

Tasks:

- [ ] M4-01: ADK service Dockerfileを作る
  - Owner: infra/backend
  - Depends on: M0
  - Output: Cloud Run compatible container
  - Verify: local container starts `/health`

- [ ] M4-02: Cloud Run serviceを作成する
  - Owner: infra
  - Depends on: M4-01
  - Output: staging Cloud Run ADK URL
  - Verify: `/health` success

- [ ] M4-03: APIからCloud Run ADKを呼ぶ認証方式を決める
  - Owner: backend/infra
  - Depends on: M4-02
  - Output: service auth or shared internal token
  - Verify: direct unauthenticated access is rejected or non-public

- [ ] M4-04: API `USE_ADK_AGENT=true` staging動作確認
  - Owner: backend
  - Depends on: M4-03
  - Output: staging API -> Cloud Run ADK
  - Verify: `/agent/chat/stream`がADK経由で応答

- [ ] M4-05: ADK logsからsecretを除外する
  - Owner: backend
  - Depends on: M4-04
  - Output: redaction/logging policy
  - Verify: dummy secret smoke testでlogに出ない

- [ ] M4-06: ADK eval/contract testsをCI相当にまとめる
  - Owner: backend
  - Depends on: M4-04
  - Output: no-write, evidence, response format checks
  - Verify: eval test suite success

Exit Criteria:

- [ ] ADK Cloud Run deployed
- [ ] API can call ADK securely
- [ ] ADK responses follow required format
- [ ] no-write and secret exclusion enforced

## 7. M5 Meta Ads Read-only OAuth

Tasks:

- [ ] M5-01: Meta OAuth app/scopesを整理する
- [ ] M5-02: Meta OAuth start/callbackを実装する
- [ ] M5-03: Meta ad account一覧を取得する
- [ ] M5-04: Meta campaign/ad set/ad metrics syncを実装する
- [ ] M5-05: Meta指標を共通metric schemaへ正規化する
- [ ] M5-06: creative fatigue分析に必要なfrequency/CTR/CVR/CPAを扱う
- [ ] M5-07: Dashboard/BIのplatform filterでMeta実データを表示する
- [ ] M5-08: ADK contextへMeta metricsを渡す
- [ ] M5-09: token refresh/error handling/security testsを追加する

Exit Criteria:

- [ ] Meta read-only OAuth works
- [ ] Meta metrics sync works
- [ ] Google + Meta横断Dashboardが動く
- [ ] AIがplatform差を踏まえて回答する

## 8. M6 Yahoo Ads Read-only OAuth

Tasks:

- [ ] M6-01: Yahoo Ads OAuth/API仕様を整理する
- [ ] M6-02: Yahoo OAuth start/callbackを実装する
- [ ] M6-03: Yahoo account一覧を取得する
- [ ] M6-04: Yahoo campaign metrics syncを実装する
- [ ] M6-05: Google検索広告に近い指標へ正規化する
- [ ] M6-06: Yahoo固有エラーの日本語表示を整える
- [ ] M6-07: Dashboard/BI/ADK contextへYahoo実データを接続する
- [ ] M6-08: token refresh/error handling/security testsを追加する

Exit Criteria:

- [ ] Yahoo read-only OAuth works
- [ ] Yahoo metrics sync works
- [ ] Google / Meta / Yahooの3媒体が横断表示される

## 9. M7 Limited Production Deploy

Tasks:

- [ ] M7-01: deploy targetを確定する
  - Candidate: Web/API Cloud Run, ADK Cloud Run, Supabase
  - Output: deployment diagram

- [ ] M7-02: staging/prod env inventoryを作る
  - Include: Supabase URL/anon key, service key location, OAuth client IDs/secrets, token encryption key, ADK URL

- [ ] M7-03: Web/API deploy pipelineを作る
  - Verify: staging URLでWebが表示される

- [ ] M7-04: OAuth redirect URIをstaging/prod URLに設定する
  - Verify: provider consoleとenvが一致

- [ ] M7-05: CORS/CSRF/session cookie方針を実装する
  - Verify: unauthorized cross-origin access is blocked

- [ ] M7-06: staging smoke testを作る
  - Steps: login -> workspace -> Google OAuth -> sync -> dashboard -> AI chat

- [ ] M7-07: operational loggingを整える
  - Constraint: no token, no service role, no customer secret in logs

- [ ] M7-08: rollback手順を書く
  - Include: deploy rollback, migration rollback notes, OAuth disable

- [ ] M7-09: internal beta checklistを作る
  - Include: tester account, allowed data, support contact, incident stop condition

Exit Criteria:

- [ ] staging URLでloginからAI相談まで完了
- [ ] Google Ads実データでE2E完了
- [ ] logsにsecretなし
- [ ] rollback手順あり

## 10. M8 Cloudflare Migration Ready

Tasks:

- [ ] M8-01: Web static buildをCloudflare Pagesへ載せられる形にする
- [ ] M8-02: APIをBFF/lightweight APIとheavy processingに分ける
- [ ] M8-03: OAuth callbackをWorkersへ移せるroute contractにする
- [ ] M8-04: Workers -> Cloud Run ADK proxyの認証設計を決める
- [ ] M8-05: Supabase Auth sessionをPages/Workersで扱う方針を決める
- [ ] M8-06: environment/secrets mappingをCloudflare用に作る
- [ ] M8-07: current deployとCloudflare deployの差分表を作る
- [ ] M8-08: migration runbookを作る

Exit Criteria:

- [ ] Cloudflare移行時の変更対象がWeb/BFF/OAuth callbackに限定されている
- [ ] ADK heavy処理はCloud Run継続で問題ない
- [ ] Supabase/DB schemaは移行不要
- [ ] migration runbookだけで作業に入れる

## 11. Cross-Cutting Security Tasks

- [ ] S-01: secret redaction utilityをTypeScript/Pythonで揃える
- [ ] S-02: token/API key/service roleのlog出力禁止テストを作る
- [ ] S-03: LLM prompt payload snapshot testを作り、secret/tokenがないことを確認する
- [ ] S-04: OAuth state replay testを作る
- [ ] S-05: workspace scope bypass testを作る
- [ ] S-06: no media write tool contract testを作る
- [ ] S-07: service role keyの使用箇所をallowlist化する
- [ ] S-08: production envでdebug stack traceを返さない

## 12. Cross-Cutting Product Tasks

- [ ] P-01: onboarding copyを実OAuth前提へ更新する
- [ ] P-02: connection statusを `not_connected`, `connecting`, `connected`, `expired`, `error`, `revoked` で表現する
- [ ] P-03: 初回Google Ads接続後の「最初にAIへ聞く」CTAを作る
- [ ] P-04: AI回答内human taskをDB保存し、UIで完了/却下できる
- [ ] P-05: operator feedbackを次回AI contextへ反映する
- [ ] P-06: root_agent / setup_advisor_agent / performance_analyst_agent / action_plan_agent / qa_agentの責務をdocsと実装で一致させる
- [ ] P-07: 根拠不足時の回答テンプレートを固定する
- [ ] P-08: 代表質問セットを作り、Google/Meta/Yahooで回答品質を確認する

## 13. Suggested First Sprint

Sprint goal:

Google Ads実連携に入る前に、auth/workspace/securityの足場を作る。

Candidate tasks:

1. M0-01 Python 3.11検証
2. M0-03 API secret guard
3. M0-04 no-write policy統一
4. M1-01 Supabase env整理
5. M1-02 Web Auth client
6. M1-03 API JWT middleware
7. M1-04 workspace bootstrap
8. M1-05 workspace membership検証

Sprint exit:

- loginできる
- workspaceが作れる
- APIがJWTとmembershipを見る
- dummy secret/no-writeがAPI入口で止まる
- mock Dashboard/AIは引き続き動く

## 14. Open Decisions

- [ ] Web/API初回deploy先をCloud Runにするか、Webだけ先にCloudflare Pagesへ置くか
- [ ] OAuth callbackを初期からWorkersに置くか、まずNode APIで実装して後で移すか
- [ ] token encryption keyをMVPでenv base64 secretにするか、最初からCloud KMS/Secret Managerにするか
- [ ] metrics syncをrequest-time取得にするか、明示sync jobにするか
- [ ] Google Ads developer tokenの運用主体と申請状態
- [ ] Meta/Yahooの審査・権限申請をいつ始めるか
- [ ] stagingに実広告アカウントを接続する社内ルール

## 15. Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Supabase Auth未接続のまま共有URLを出す | tenant漏洩 | M1完了まで共有URLテストしない |
| tokenがlog/LLMへ混入 | credential漏洩 | S-01からS-03をM3前に完了 |
| Google Ads developer token/審査で遅延 | 実API連携遅延 | M1/M2/M4を先行し、Google Ads待ちをブロックにしない |
| 実媒体APIのrate limit | data sync失敗 | 最初は短期間/少数accountでsync、retry/backoff |
| Cloudflare移行を早くやりすぎる | 実API実装が遅れる | M8までは境界設計だけに留める |
| AIがwrite実行したように見える | product trust低下 | no-write policy/evalをCI相当にする |
