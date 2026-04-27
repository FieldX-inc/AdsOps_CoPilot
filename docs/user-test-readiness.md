# User Test Readiness

このチェックリストは、実広告API credentialなしで AdOps Advisor のMVP体験を確認するためのものです。対象は mock広告データを使ったローカルユーザーテストです。

## 関連Requirement / Milestone

- `REQUIREMENTS.md` 4. MVPスコープ
- `REQUIREMENTS.md` 10. AI回答要件
- `DESIGN.md` 2. ナビゲーション
- `docs/architecture.md` 7. 最初に作りたい価値ある体験

## テストの目的

- 広告媒体credentialなしで、初回ユーザーがAI広告コンサル体験を理解できるか確認する。
- ユーザーがAPIキーを取得・入力しなくても、OAuth連携だけで進められる体験に見えるか確認する。
- DashboardがAI Advisorの補助として機能しているか確認する。
- AI回答がhuman-in-the-loop前提で、媒体設定の直接変更を促さないか確認する。
- データ連携が未実装 / 未連携でも、mockデータによる検証状態だと分かるか確認する。

## Credentialなしで動く範囲

使うもの:

- Web UI: `http://localhost:5173`
- API: `http://localhost:8787`
- ADK Agent Service mock mode: `http://localhost:8000`
- mock広告データ
- deterministic mock AI response

使わないもの:

- Google Ads credential
- Meta Marketing API credential
- Yahoo Ads credential
- Supabase project credential
- Gemini / Vertex AI credential
- 実広告アカウント、実OAuth、実媒体API write

## 事前準備

1. Node.js と npm が使えることを確認する。
2. Python 3.11以上が使えることを確認する。
3. 依存関係が未installなら `npm install` を実行する。
4. Python依存が未installなら `services/adk-agent` で `python3 -m pip install -e .` を実行する。
5. 必要なら `.env.example` を `.env` にコピーする。credential系の値は空のままでよい。

`.env` に最低限確認しておく値:

```sh
WEB_ORIGIN=http://localhost:5173
VITE_API_BASE_URL=http://localhost:8787
ADK_AGENT_URL=http://localhost:8000
```

## 起動手順

```sh
npm run dev
```

個別に起動する場合:

```sh
npm run dev:agent
npm run dev:api
npm run dev:web
```

起動後のhealth check:

```sh
curl http://localhost:8000/health
curl http://localhost:8787/health
```

期待値:

- agent healthに `"service":"adk-agent"` と `"mode":"mock"` が含まれる。
- API healthに `"service":"adops-api"` と `adkAgentUrl` が含まれる。
- `http://localhost:5173` がブラウザで表示できる。

## テストシナリオ

### 1. 初期表示

- `http://localhost:5173` を開く。
- 左ナビが `ダッシュボード / BI分析 / Adコラム / データ連携` になっている。
- AIチャットが独立ページではなく右下ボタン / 右ドロワーとして扱われている。

### 2. Dashboard確認

- KPIカードが表示される。
- 費用 / 売上 / CVなどの推移が表示される。
- 異常、上位キャンペーン、AI推奨アクションが確認できる。
- 表示文言が実データ接続済みと誤認させない。

### 3. BI分析確認

- 期間や媒体フィルタを切り替えられる。
- チャートやキャンペーン比較が崩れない。
- mockデータでも「どの数字を見ればよいか」が分かる。

### 4. データ連携確認

- Google / Meta / Yahoo の連携が未接続状態として表示される。
- ユーザーにAPIキー、developer token、client secret、app secretの取得や入力を求めない。
- `Google Ads と連携` のように、媒体側でログインしてread-only権限を許可するOAuth導線に見える。
- credential入力欄やsecret表示がない。

### 5. AI Advisor確認

AIドロワーを開き、以下を送信する。

```txt
CPAが悪化している理由を教えて。次に何をすればいい？
```

回答に以下が含まれることを確認する。

- 結論
- 根拠
- 原因仮説
- 推奨アクション
- 人間向け作業手順
- 実施前チェック
- リスク
- 実施後の観察
- 自信度

禁止事項:

- 予算変更、入札変更、キャンペーン停止、広告作成をAPIで直接実行すると説明しない。
- OAuth token、API key、Supabase service role keyなどのsecretを表示しない。
- ユーザーに広告媒体のAPIキー取得を指示しない。
- 根拠がmockデータなのに、実媒体で確定した原因のように断定しない。

## 合格基準

- 3サービスがローカルで起動する。
- 実広告API credentialなしで主要画面を確認できる。
- AI Advisorがmockデータを根拠に、human-in-the-loopの改善提案を返す。
- データ連携未実装部分が、テスターにとって「未接続 / 次フェーズ」だと分かる。
- UIが `DESIGN.md` のナビゲーションとAIドロワー方針から外れていない。

## 記録テンプレート

```txt
Date:
Tester:
Browser:
Commit / branch:

起動:
- npm run dev:
- agent health:
- api health:

シナリオ結果:
- 初期表示:
- Dashboard:
- BI分析:
- データ連携:
- AI Advisor:

AIに送った質問:

良かった点:

迷った点:

バグ / 表示崩れ:

human-in-the-loop制約の懸念:

次回までに直すこと:
```

## よくある詰まり

- `ADK Agent Serviceに接続できません` が出る場合は `npm run dev:agent` が起動しているか確認する。
- WebからAPIに接続できない場合は `VITE_API_BASE_URL=http://localhost:8787` を確認する。
- APIからagentに接続できない場合は `ADK_AGENT_URL=http://localhost:8000` を確認する。
- credential系envは空でよい。テスト中に実secretを貼り付けない。
