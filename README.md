# AdOps Advisor

自社で広告運用を行う中小企業向けのAI広告コンサルタント。

このリポジトリは、旧Google Sheets取り込みMVPから、広告媒体API連携 + OpenAI Agents SDK構成へリブートしています。

## 方針

- Supabase Auth
- Google Ads からread/write API連携を開始し、Meta Ads / Yahoo Ads は後続
- 最低限のダッシュボード
- OpenAI Agents SDKベースのAI Advisor
- human-in-the-loop の改善提案
- 媒体writeはAIが単独実行せず、認証済みユーザーの明示承認つきAPI routeだけで実行する
- ログイン後のStripe Checkout / Billing Portal / Webhook によるSaaS課金
- ユーザーに広告媒体のAPIキー取得やsecret入力を求めず、OAuth許可で連携する

## ローカル開発

初期のローカル構成:

```txt
localhost:5173  apps/web
localhost:8787  apps/api
localhost:8000  services/adk-agent
```

依存をinstallした後、以下で3サービスを起動します。

```sh
npm run dev
```

個別起動:

```sh
npm run dev:web
npm run dev:api
npm run dev:agent
```

最初のローカルAI体験は、secretなしでもmock広告データで動きます。Google Ads OAuth / read / sync / 承認付きcampaign status・budget write、OpenAI Agent Service、Stripe billing は実装済みで、実データ連携やwrite E2Eには各staging/production secretとOAuth設定が必要です。

## 環境変数

M1-01 の環境変数 inventory は `docs/environment.md` にあります。local / staging / production は別Supabase projectとして扱い、browserに出す値は `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` に限定します。

mockユーザーテストでは `.env.example` を `.env` にコピーし、Supabase / Google / Meta / Yahoo / OpenAI / Stripe のsecretは空のままで構いません。実OAuthやSupabase Authへ進む場合も、service role key、OAuth client secret、developer token、token encryption key、Stripe secret keyを `VITE_` 付きの環境変数に入れないでください。

## 標準検証コマンド

production candidate の標準検証は以下です。

```sh
npm run verify
npm run audit:production-candidate
npm run audit:completion
npm run audit:completion-note
npm run deploy:preflight
npm run deploy:preflight -- --json
npm run deploy:prereq-note
npm run deploy:next
npm run deploy:commands -- --target=staging
npm run deploy:commands -- --target=production
```

`npm run verify` は env / migration / Dockerfile / deploy config / production goal audit / smoke / staging-E2E contract / release-evidence contract / web contract / typecheck / build / API tests / Agent tests を通します。`npm run audit:production-candidate` は repository goal contract、full verify、deploy preflight、残operator prerequisite、次コマンド、必要な証跡コマンド列を短く表示します。`-- --json` は同じ内容を非secret JSONで出し、`-- --with-verify` を付けると監査コマンド自体が `npm run verify` を実行してから判定します。

`npm run audit:completion` は、元のゴールを OpenAI Agents SDK / Google Ads read-write / Stripe billing / local verify / operator preflight / staging-provider evidence / final production smoke に分け、各項目を `proven` または `missing` で出します。missing項目には `nextActions` として次に実行する非secretコマンドやoperator remediationを表示します。このコマンドは、外部provider証跡、`PRODUCTION_SMOKE_PASSED_AT`、`RELEASE_EVIDENCE_COLLECTED_AT`、`RELEASE_EVIDENCE_NOTE_PATH` で指す記入済みrelease evidence noteまで揃うまでは意図的に non-zero で終了します。

`npm run audit:completion-note` は `audit:completion -- --json` から、release evidence note冒頭に貼れる非secret Markdownを生成します。missing要件、next action、後で貼るべきpreflight/release evidence出力、最終audit前に設定する `RELEASE_EVIDENCE_NOTE_PATH` を一覧化します。`-- --with-verify` を付けると、note生成前にlocal verifyを実行します。

`npm run deploy:preflight` は Docker daemon、Google Cloud CLI、Wrangler、Supabase CLI、Stripe CLI、GitHub CLI auth など operator machine 側の前提を確認します。`npm run deploy:preflight -- --json` はリリース証跡用の非secret JSONを出します。`npm run deploy:prereq-note` はpreflight結果から、足りないoperator tool、remediation、確認コマンドをMarkdown化します。`npm run deploy:next` はpreflightが通るまで次手順を出さず、通過後に staging env check、Supabase、provider E2E、production env、final smoke、release evidence の順序を表示します。

`npm run deploy:commands -- --target=staging|production` は、Cloud Run API / private Agent Service / Cloudflare Pages / provider evidence / final smoke の非secretコマンドテンプレートを出します。Cloud Run API / Agent には operator-owned env file を `--env-vars-file` で渡し、Web は browser-safe env をbuild時に読み込みます。placeholderを埋め、secretはhosting provider、operator-owned env file、またはsecret managerで管理してください。

Agent Service は Python 3.11以上を前提にしています。初回のみ、`services/adk-agent` で Python 3.11環境を有効にしてから依存関係を入れてください。

```sh
cd services/adk-agent
python3.11 -m pip install -e ".[dev]"
python3.11 -m pytest
```

依存関係のinstallは事前確認が必要な作業です。既に環境がある場合はinstallせず、上記の検証コマンドだけを実行してください。

## ローカルユーザーテスト

実広告APIのcredentialなしで、mock広告データを使ったユーザーテストを実施できます。

1. 依存関係をinstallする。
2. 必要なら `.env.example` を `.env` にコピーする。Google / Meta / Yahoo / Supabase / OpenAI / Stripe のsecretは空で構いません。
3. `npm run dev` で web / api / agent を起動する。
4. ブラウザで `http://localhost:5173` を開く。
5. `データ連携` で、APIキー入力ではなくOAuth連携ボタンとして見えることを確認する。
6. `ダッシュボード` と `BI分析` でKPI、チャート、異常、上位キャンペーンを確認する。
7. 右下のAI Advisorから「CPAが悪化している理由を教えて。次に何をすればいい？」を送る。
8. AI回答に、結論、根拠、原因仮説、推奨アクション、人間向け作業手順、実施前チェック、リスク、実施後の観察、自信度が含まれるか確認する。

詳しい観点と記録テンプレートは `docs/user-test-readiness.md` を参照してください。

詳しくは `REQUIREMENTS.md` を参照してください。
