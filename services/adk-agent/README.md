# ADK Agent Service

Google ADKベースのAI広告コンサルタントサービスです。

初期目標:

1. app/API layer から workspace/user scope 済みcontextを受け取る
2. `root_agent` でユーザー質問を受ける
3. read-only toolで広告アカウント、指標、memory、human taskを扱う
4. 根拠つきの提案と人間向け作業手順を返す

MVPでは広告媒体を直接変更するtoolを作りません。

## Runtime

`GEMINI_API_KEY` または `GOOGLE_API_KEY` が設定され、`google-adk` が利用できる環境では `/chat` はADK `root_agent` をGeminiで実行します。ADK/Gemini実行に失敗した場合は、既存のmock分析レスポンスへfallbackします。

## Local Test Setup

このserviceは Python 3.11以上を前提にしています。M0の標準テストコマンドは `services/adk-agent` で実行する `python3.11 -m pytest` です。

初回だけ、Python 3.11環境を有効にしてからdev依存を入れます。

```sh
cd services/adk-agent
python3.11 -m pip install -e ".[dev]"
```

テスト実行:

```sh
cd services/adk-agent
python3.11 -m pytest
```

`python3.11` コマンドが見つからない場合は、先にローカルのPython 3.11以上を用意してください。`python3` が3.11以上でも、標準検証ではバージョンを固定して確認できる `python3.11` を使います。

## No-Write Policy Contract

`/chat` は媒体write意図を検知した場合、DB/ADK/Geminiへ渡す前に拒否し、人間向け作業手順へ変換します。代表ケースは「キャンペーンを停止して」「予算を上げて」「広告を入稿して」です。

ADK/Geminiからの回答にwrite実行表現が混ざった場合も、停止、予算変更、入札変更、広告作成/入稿、targeting変更は担当者確認の候補表現へ変換します。root agent のtool registryには read-only tool と human task tool だけを置き、媒体mutation toolは追加しません。
