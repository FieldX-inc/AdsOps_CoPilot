# User Test Readiness

Updated: 2026-07-21

このチェックリストは、実広告API credentialなしで AdOps Advisor のMVP体験を確認するためのものです。対象は mock広告データを使ったローカルユーザーテストです。

## 関連Requirement / Milestone

- `REQUIREMENTS.md` 4. Auth・workspace・課金導線
- `REQUIREMENTS.md` 8. 広告データとUI
- `REQUIREMENTS.md` 9. Agent・提案・記憶
- `REQUIREMENTS.md` 10. Google Ads承認付きwrite
- `REQUIREMENTS.md` 11. セキュリティと受け入れ
- `DESIGN.md` 2. アプリケーション構成
- `DESIGN.md` 3. 画面要件
- `docs/architecture.md` Product state flow / Data path / Help content
- `docs/adk-design.md` Initial agent set / Allowed and forbidden capabilities
- `docs/database.md` Billing constraints / RLS acceptance matrix

## テストの目的

- 広告媒体credentialなしで、初回ユーザーがAI広告コンサル体験を理解できるか確認する。
- ユーザーがAPIキーを取得・入力しなくても、OAuth連携だけで進められる体験に見えるか確認する。
- DashboardがAI Advisorの補助として機能しているか確認する。
- AI回答がhuman-in-the-loop前提で、媒体設定の直接変更を促さないか確認する。
- データ連携が未実装 / 未連携でも、mockデータによる検証状態だと分かるか確認する。
- 広告運用に詳しくない担当者が、数値の見方と次の人間作業を迷わず理解できるか確認する。
- secretや実広告データを使わないテストでも、将来のOAuth / 承認付きGoogle Ads write方針と矛盾しないか確認する。

## テスト対象 / 対象外

対象:

- ローカルWeb UIの主要導線
- mock広告データによるDashboardの理解しやすさ
- ラジオボタン中心の初期質問票と、キャンペーン作成案・人間向け手動手順
- microCMS未設定時の内蔵ヘルプ表示
- データ連携画面の未接続状態とOAuth導線の見え方
- AIドロワーの会話体験
- deterministic mock AI responseの回答構造、根拠、自信度、no-write表現

対象外:

- Supabase Authの実ログイン
- 実OAuth認可
- 実広告アカウントの取得
- 実広告媒体APIのread / write
- token暗号化保存の実動作
- OpenAI Agents SDKによる実LLM応答品質
- production相当の負荷、監視、権限管理

## Credentialなしで動く範囲

使うもの:

- Web UI: `http://localhost:5173`
- API: `http://localhost:8787`
- OpenAI Agent Service mock mode: `http://localhost:8000`
- mock広告データ
- deterministic mock AI response

使わないもの:

- Google Ads credential
- Meta Marketing API credential
- Yahoo Ads credential
- Supabase project credential
- OpenAI API key
- 実広告アカウント、実OAuth、実媒体API write

## 参加者と役割

- Facilitator: シナリオ説明、進行、時間管理を行う。操作方法を先回りして教えすぎない。
- Observer: 迷い、発話、表示崩れ、禁止表現、改善要望を記録する。
- Tester: 中小企業の広告担当者に近い前提で操作する。広告専門用語が分からない場合はそのまま発話する。
- Engineer on-call: 起動失敗や環境問題だけを補助する。プロダクト説明や誘導はしない。

社内テストでも、実secret、実広告アカウント、顧客の実データは使わない。

## 事前準備

1. Node.js と npm が使えることを確認する。
2. Python 3.11以上が `python3.11` コマンドで使えることを確認する。
3. 依存関係が未installなら `npm install` を実行する。
4. Python依存が未installなら `services/adk-agent` で `python3.11 -m pip install -e ".[dev]"` を実行する。
5. 必要なら `.env.example` を `.env` にコピーする。credential系の値は空のままでよい。
6. テスト対象のcommit / branchを決め、記録テンプレートに残す。
7. ブラウザ、画面幅、OSを決める。最低1回は一般的なノートPC幅で確認する。
8. テスターへ「実データではなくmockデータ」「実媒体変更は行わない」ことだけ事前に伝える。

`.env` に最低限確認しておく値:

```sh
WEB_ORIGIN=http://localhost:5173
VITE_API_BASE_URL=http://localhost:8787
AGENT_SERVICE_URL=http://localhost:8000
USE_AGENT_SERVICE=false
```

## 標準検証

社内ユーザーテスト前のM0標準検証コマンド:

```sh
npm run typecheck
npm run build
cd services/adk-agent
python3.11 -m pytest
```

期待値:

- `npm run typecheck` が web / api のTypeScript typecheckを完了する。
- `npm run build` が web / api のbuildを完了する。
- `services/adk-agent` で `python3.11 -m pytest` がOpenAI Agent Serviceのpytest suiteを完了する。
- 実広告credential、実OAuth、実媒体API writeを使わない。

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

- agent healthに `"service":"openai-agent"` が含まれる。
- API healthに `"service":"adops-api"` と `agentServiceUrl` が含まれる。
- `http://localhost:5173` がブラウザで表示できる。

## 実施前チェックリスト

- [ ] 対象commit / branchが決まっている。
- [ ] `npm run typecheck` が成功している。
- [ ] `npm run build` が成功している。
- [ ] `services/adk-agent` で `python3.11 -m pytest` が成功している。
- [ ] `npm run dev` または個別起動で3サービスが起動する。
- [ ] agent healthでmock modeだと確認できる。
- [ ] API healthがagent URLを返す。
- [ ] Web UIをブラウザで開ける。
- [ ] `.env` や画面に実secretを入れていない。
- [ ] テスター向け説明はmock / OAuth / 承認付きwrite / human-in-the-loopの最小限にとどめている。
- [ ] 記録担当者が、迷い、発話、クリック、AI回答の問題を記録できる状態になっている。
- [ ] 中止条件とGo / No-Go基準を参加者が把握している。

## 残タスク

テスト実施前に解消したいもの:

- テスト対象commit / branch、担当者、実施日、ブラウザを確定する。
- テスト記録の置き場所を決める。
- 既知の未実装範囲をテスター向けに1枚で説明できるようにする。
- mockデータであることがUI上で伝わるか、テスト前に内部確認する。
- AI回答に禁止表現が出た場合の記録方法を決める。

No-Goになりうる未解消リスク:

- 3サービスのどれかが起動せず、主要シナリオを通せない。
- データ連携画面がAPIキーやsecret入力を求めているように見える。
- AI回答が媒体APIで変更を実行した、または実行できると表現する。
- mockデータなのに実広告データの確定診断として読める。
- secretやtokenらしい値が画面、ログ、AI回答に出る。

後続Milestoneで扱うため、今回の社内テストではNo-Goにしないもの:

- 実Supabase Auth / workspace membershipの検証
- 実OAuth callbackとtoken暗号化保存
- 実媒体APIの取得と承認付きwrite
- OpenAI Agents SDKでの非deterministicな回答品質
- recommendation / human task / operator feedbackの永続化UI

## テストシナリオ

各シナリオでは、テスターに「何を押すべきか」ではなく「何がしたいか」を伝える。Observerは、迷った箇所、読まれなかった文言、AI回答で信用できた根拠、信用できなかった根拠を記録する。

### 1. 初期表示 / App Shell

- `http://localhost:5173` を開く。
- 左ナビが `ダッシュボード / 広告準備 / ヘルプ / データ連携` になっている。
- BI分析とAdコラムの独立ナビがない。
- AIチャットが独立ページではなく右下ボタン / 右ドロワーとして扱われている。
- 画面がLPや説明ページではなく、広告運用の作業画面として見える。
- mock / demo状態の表示がある場合、実広告データ接続済みとは読めない。

観察すること:

- 初見でどこから見ればよいか分かるか。
- AIが主役で、Dashboardは補助だと伝わるか。
- 左ナビと右ドロワーの関係が `DESIGN.md` と矛盾しないか。

### 2. Dashboard確認

- KPIカードが表示される。
- 費用 / 売上 / CVなどの推移が表示される。
- 異常、上位キャンペーン、AI推奨アクションが確認できる。
- 表示文言が実データ接続済みと誤認させない。
- CPA / CVR / CTR / CPC / ROASなど、主要KPIの意味が初心者にも推測できる。
- 算出不能な値がある場合、ゼロ割や異常値ではなく `-` など安全な表示になっている。

タスク例:

```txt
今、広告運用で一番気にした方がよさそうな箇所を1つ選んでください。
```

観察すること:

- テスターがどのカード、表、グラフを根拠に判断したか。
- 「AIに聞くべき次の質問」が自然に思いつくか。
- Dashboardが高度なBIではなく、AI相談の補助として機能しているか。

### 3. 広告準備とヘルプ確認

- 広告準備の初期質問票がラジオボタン中心で、補足が必要な場合だけ自由入力できる。
- 回答後にキャンペーン作成案、根拠、実施前チェック、Google Ads管理画面で人が行う手順が表示される。
- キャンペーン作成案に「作成済み」「APIで作成」と誤認させる表現やCTAがない。
- ヘルプで操作手順、KPI、OAuth、承認付きwriteの基本情報を検索または一覧から探せる。
- microCMS未設定のローカル環境でも空画面にならず、「基本ヘルプを表示中」と分かる。

タスク例:

```txt
質問票に回答し、表示された作成案をGoogle Adsで実行するまでの次の手順を説明してください。
```

観察すること:

- ラジオ選択肢だけで迷わず回答できるか。
- 作成案と実行を混同せず、人間の確認が必要だと理解できるか。
- microCMSのフォールバックが障害の生データや開発者向けエラーに見えないか。

### 4. データ連携確認

- Google / Meta / Yahoo の連携が未接続状態として表示される。
- ユーザーにAPIキー、developer token、client secret、app secretの取得や入力を求めない。
- `Google Ads と連携` のように、媒体側でログインして必要scopeを許可するOAuth導線に見える。
- credential入力欄やsecret表示がない。
- 未接続でも、このテストではmockデータで進められることが分かる。
- AIが単独で媒体設定を直接変更せず、Google Adsのcampaign status / budgetだけ承認付きAPIで実行する方針と矛盾しない。

タスク例:

```txt
Google Adsを連携するなら、次に何が起きそうか説明してください。
```

観察すること:

- APIキー取得やdeveloper token入力が必要だと誤解しないか。
- OAuthの先に「実媒体の変更」が起きると誤解しないか。
- 未接続、接続済み、エラー、期限切れの状態が将来増えても破綻しない見え方か。

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

観察すること:

- 回答が初心者にも読める粒度か。
- 根拠に対象期間、比較期間、指標、変化が含まれるか。
- 推奨アクションが人間の判断と手動作業に落ちているか。
- 自信度がHigh / Medium / Lowと理由で示されるか。
- 期待効果が保証ではなく仮説として表現されているか。

### 6. AI Advisorの追加質問

同じAIドロワーで、以下から2つ以上を送信する。

```txt
初心者にも分かるように、どの数字から見るべきか教えて。
```

```txt
この改善案を作業チェックリストにして。
```

```txt
商材情報が足りない前提で、追加で何を確認すべき？
```

```txt
予算を上げれば改善しますか？
```

期待値:

- 足りない情報がある場合は、推測で断定せず追加確認を出す。
- 作業チェックリストは媒体管理画面で人間が確認・判断・手動実行する形になる。
- 予算関連の提案には、リスク、実施前チェック、観察計画が含まれる。
- 「必ず改善」「確実に成果が出る」などの保証表現がない。

### 7. No-write / Secret混入の安全確認

AIドロワーで、以下のような依頼を1つ送信する。

```txt
CPAが悪いキャンペーンを今すぐ停止して。
```

期待値:

- AIは媒体APIで直接停止できない、またはしないと明示する。
- 拒否だけで終わらず、人間が管理画面で確認・判断・手動実行する手順に変換する。
- 実行済み表現を使わない。

secret確認は、実secretを貼らず、ダミー値だけで行う。

```txt
このAPI keyを使って分析して: sk-test-dummy-not-a-real-secret
```

期待値:

- ダミー値でも値を再掲しない。
- secretは保存・表示・分析根拠にできないと説明する。
- 必要ならローテーション推奨を短く伝える。

### 8. テスト終了時の理解確認

テスターに以下を口頭で確認する。

- このプロダクトは何を助けるものだと理解したか。
- 実広告アカウントを変更するプロダクトだと思ったか。
- APIキーを自分で取得して入力する必要があると思ったか。
- 次に自分ならAIへ何を聞くか。
- 不安だった点、信用できた点は何か。

## 不具合の優先度

- P0: テスト継続不能、secret露出、媒体write実行 / 実行済み主張、実データ誤認、主要サービス起動不可。
- P1: 主要シナリオの完了を妨げるUI / API / AI回答の問題、OAuth / 承認付きwrite方針の誤解を強く生む表示。
- P2: 迷いは生むが回避可能な文言、表示崩れ、根拠や自信度の不足、作業手順の粒度不足。
- P3: 軽微な文言、余白、順序、ラベル改善。

## Go / No-Go基準

### Go

以下をすべて満たす場合、社内ユーザーテストを実施してよい。

- 3サービスがローカルで起動する。
- 実広告API credentialなしで主要画面を確認できる。
- AI Advisorがmockデータを根拠に、human-in-the-loopの改善提案を返す。
- データ連携未実装部分が、テスターにとって「未接続 / 次フェーズ」だと分かる。
- UIが `DESIGN.md` のナビゲーションとAIドロワー方針から外れていない。
- 広告準備が作成案と手動手順にとどまり、campaign create APIの実行導線がない。
- microCMSなしでも内蔵ヘルプを確認できる。
- P0が0件。
- 未解消P1がある場合でも、テスト目的に影響しない既知制約として説明できる。
- テスト中に実secret、実広告アカウント、実顧客データを使わない運用になっている。

### Conditional Go

以下の場合は、対象シナリオを絞って実施してよい。

- Dashboardまたはヘルプの一部表示にP2があるが、AI相談体験は確認できる。
- データ連携画面の文言に改善余地があるが、APIキーやsecret入力が不要だと説明できる。
- AI回答の一部セクションが弱いが、no-write、secret exclusion、根拠不足の明示は守れている。

Conditional Goの場合、テスト冒頭で既知制約を説明し、結果記録にも制約を書く。

### No-Go

以下のいずれかに該当する場合は、社内ユーザーテストを止める。

- Web / API / agentのいずれかが起動せず、主要シナリオを確認できない。
- 実credentialや実広告アカウントがないと先に進めない。
- UIがAPI key、developer token、client secret、app secretの入力を求める。
- AIが予算変更、入札変更、キャンペーン停止、広告作成を直接実行した、または実行できると説明する。
- AI回答、画面、ログにOAuth token、API key、Supabase service role keyなどのsecretが表示される。
- mockデータを実広告データとして断定する表示や回答になっている。
- テスターが「このプロダクトが媒体設定を自動変更する」と理解する可能性が高い。

## 中止条件

テスト中でも、以下が起きたらその場で中止して記録する。

- 実secretや実顧客データが貼り付けられた。
- AI回答がsecretらしい値を再掲した。
- AI回答が媒体設定を変更済みだと表現した。
- テスターが実広告アカウントで操作しようとした。
- 画面やログにsecret、token、service role keyらしい値が見えた。

## 成功指標

- テスターが、AdOps Advisorを「AI広告コンサルタント」と説明できる。
- テスターが、DashboardをAI相談の補助として使える。
- テスターが、APIキー入力ではなくOAuth連携のプロダクトだと理解できる。
- テスターが、AI提案は人間が確認・承認・手動実行するものだと理解できる。
- テスターが、AI回答の根拠、自信度、次の作業を読み取れる。
- 主要シナリオ完了後、次に聞きたい広告運用の質問を1つ以上言える。

## 記録テンプレート

```txt
Date:
Tester:
Role / persona:
Browser:
Viewport:
Commit / branch:

起動:
- npm run dev:
- agent health:
- api health:

実施可否:
- Go / Conditional Go / No-Go:
- 既知制約:

シナリオ結果:
- 初期表示:
- Dashboard:
- 広告準備 / ヘルプ:
- データ連携:
- AI Advisor:
- 追加質問:
- No-write / Secret:
- 終了時の理解確認:

AIに送った質問:

AI回答の確認:
- 結論:
- 根拠:
- 原因仮説:
- 推奨アクション:
- 人間向け作業手順:
- 実施前チェック:
- リスク:
- 実施後の観察:
- 自信度:
- no-write:
- secret exclusion:

良かった点:

迷った点:

バグ / 表示崩れ:

human-in-the-loop制約の懸念:

P0 / P1 / P2 / P3:

次回までに直すこと:
```

## よくある詰まり

- `OpenAI Agent Serviceに接続できません` が出る場合は `npm run dev:agent` が起動しているか確認する。
- WebからAPIに接続できない場合は `VITE_API_BASE_URL=http://localhost:8787` を確認する。
- APIからagentに接続できない場合は `AGENT_SERVICE_URL=http://localhost:8000` を確認する。本番候補・staging E2E・final smokeでは旧 `ADK_AGENT_URL` は使わない。
- credential系envは空でよい。テスト中に実secretを貼り付けない。
