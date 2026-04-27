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
