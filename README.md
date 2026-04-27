# AdOps Advisor

自社で広告運用を行う中小企業向けのAI広告コンサルタント。

このリポジトリは、旧Google Sheets取り込みMVPから、広告媒体API連携 + ADK agent構成へリブートしています。

## 方針

- Supabase Auth
- Google Ads / Meta Ads / Yahoo Ads のread-only API連携
- 最低限のダッシュボード
- Google ADKベースのAI Advisor
- human-in-the-loop の改善提案
- MVPでは媒体設定の直接変更を行わない
- ユーザーに広告媒体のAPIキー取得やsecret入力を求めず、OAuthのread-only許可で連携する

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

最初のAI体験はmock広告データで動きます。媒体OAuthと実データ連携は後続フェーズです。

## 環境変数

M1-01 の環境変数 inventory は `docs/environment.md` にあります。local / staging / production は別Supabase projectとして扱い、browserに出す値は `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` に限定します。

mockユーザーテストでは `.env.example` を `.env` にコピーし、Supabase / Google / Meta / Yahoo / Gemini のsecretは空のままで構いません。実OAuthやSupabase Authへ進む場合も、service role key、OAuth client secret、developer token、token encryption keyを `VITE_` 付きの環境変数に入れないでください。

## 標準検証コマンド

M0-01 / M0-02 の標準検証は以下です。

```sh
npm run typecheck
npm run build
cd services/adk-agent
python3.11 -m pytest
```

ADK Agent Service は Python 3.11以上を前提にしています。初回のみ、`services/adk-agent` で Python 3.11環境を有効にしてから依存関係を入れてください。

```sh
cd services/adk-agent
python3.11 -m pip install -e ".[dev]"
python3.11 -m pytest
```

依存関係のinstallは事前確認が必要な作業です。既に環境がある場合はinstallせず、上記の検証コマンドだけを実行してください。

## ローカルユーザーテスト

実広告APIのcredentialなしで、mock広告データを使ったユーザーテストを実施できます。

1. 依存関係をinstallする。
2. 必要なら `.env.example` を `.env` にコピーする。Google / Meta / Yahoo / Supabase / Gemini のsecretは空で構いません。
3. `npm run dev` で web / api / agent を起動する。
4. ブラウザで `http://localhost:5173` を開く。
5. `データ連携` で、APIキー入力ではなくOAuth連携ボタンとして見えることを確認する。
6. `ダッシュボード` と `BI分析` でKPI、チャート、異常、上位キャンペーンを確認する。
7. 右下のAI Advisorから「CPAが悪化している理由を教えて。次に何をすればいい？」を送る。
8. AI回答に、結論、根拠、原因仮説、推奨アクション、人間向け作業手順、実施前チェック、リスク、実施後の観察、自信度が含まれるか確認する。

詳しい観点と記録テンプレートは `docs/user-test-readiness.md` を参照してください。

詳しくは `REQUIREMENTS.md` を参照してください。
