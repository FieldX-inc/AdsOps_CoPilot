# Agent Service

OpenAI Agents SDKを正規runtimeとして使うAI広告コンサルタントサービスです。Gemini/ADK runtimeはlocal/dev互換fallbackとして残しますが、`APP_ENV=production` ではOpenAI以外のruntimeをfail-closedします。

初期目標:

1. app/API layer から workspace/user scope 済みcontextを受け取る
2. `root_agent` でユーザー質問を受ける
3. read toolで広告アカウント、指標、memory、human taskを扱う
4. 根拠つきの提案と人間向け作業手順を返す

Google Ads writeはAPI layerの承認付きrouteに限定し、agentが単独で媒体変更を実行するtoolは持ちません。

## Runtime

`ADOPS_AGENT_RUNTIME` でagent runtimeを選びます。

- `openai`: 既定runtime。OpenAI Agents SDKのorchestrator agentが専門agentをtoolとして呼び、最終回答を保持します。
- `gemini`: local/dev互換fallbackのADK/Gemini runtime。`GEMINI_RUNTIME=auto|adk|rest` はこの中の実行方式を選びます。productionでは拒否されます。
- `mock`: LLMを呼ばないローカル検証用runtime。

OpenAI Agents SDKを使う場合は、server-side envだけに `OPENAI_API_KEY` を設定します。

```sh
cd services/adk-agent
python3.11 -m pip install -e ".[dev]"
```

OpenAI runtimeでは tracing のsensitive data送信を抑えるため、`RunConfig(trace_include_sensitive_data=False)` を使います。envでも `OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA=0`、`OPENAI_AGENTS_DONT_LOG_MODEL_DATA=1`、`OPENAI_AGENTS_DONT_LOG_TOOL_DATA=1` を推奨します。

Gemini runtimeでは `GEMINI_API_KEY` または `GOOGLE_API_KEY` が設定され、`google-adk` が利用できる環境では `/chat` はADK `root_agent` をGeminiで実行します。ADK/Gemini実行に失敗した場合、`GEMINI_RUNTIME=auto` ではREST fallbackを試します。

## Orchestration Contract

`conversation_router.py` が user message から `routePlan` を作ります。`routePlan` は intent、metrics context要否、target agents、runtime agents、response contract、context contractを含みます。

- `targetAgents`: 会話上の論理agent名。`context_agent`, `budget_learning_agent`, `media_spec_agent` など、将来の分割候補も含みます。
- `runtimeAgents`: 現在の実装で実在するruntime sub-agent名。未実体化の論理agentは既存agentへ寄せます。

OpenAI runtimeの専門agent:

- `setup_advisor_agent`: 広告開始前の設計、CV地点、媒体選定、計測設計
- `performance_analyst_agent`: workspace scope済み指標からKPI変化と原因仮説を分析
- `budget_learning_agent`: 予算消化、配信量、学習状態、入札戦略を診断
- `media_spec_agent`: 媒体仕様、入稿規定、文字数、サイズ確認
- `action_plan_agent`: 人間向け作業手順、実施前チェック、リスク、観察計画へ変換
- `qa_agent`: 根拠、no-write境界、secret除外、過度な断定、必須セクションを点検

`qa_gate.py` はLLM出力後にも deterministic に human-in-the-loop表現、secret-like output、過度な断定、必須セクションを補正します。

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

実LLM smokeを走らせる場合は、正規runtimeでは `.env` に `OPENAI_API_KEY` を入れ、必要なときだけ明示的に有効化します。Gemini keyは互換fallback検証用です。通常のpytestではskipされるため、CIやlocal unit testで外部APIは呼びません。

```sh
cd services/adk-agent
RUN_LIVE_AGENT_TESTS=1 python3.11 -m pytest tests/test_live_agent_runtime.py
```

`python3.11` コマンドが見つからない場合は、先にローカルのPython 3.11以上を用意してください。`python3` が3.11以上でも、標準検証ではバージョンを固定して確認できる `python3.11` を使います。

## Write Approval Contract

`/chat` は媒体write意図を検知した場合、LLMが勝手に実行せず、承認付きwrite候補と人間向け作業手順へ変換します。代表ケースは「キャンペーンを停止して」「予算を上げて」「広告を入稿して」です。

Google Adsのcampaign status / budget writeはAPI layerの認証、workspace scope、`confirmed=true`、`GOOGLE_ADS_WRITE_ENABLED=true`、監査ログを通った場合だけ実行します。OpenAI/Geminiの回答にwrite実行表現が混ざった場合も、停止、予算変更、入札変更、広告作成/入稿、targeting変更は担当者確認の候補表現へ補正します。
