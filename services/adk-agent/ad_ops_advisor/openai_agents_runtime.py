from __future__ import annotations

import asyncio
import importlib
import os
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from .gemini_runtime import _build_runtime_response, _build_user_prompt
from .instructions import ROOT_INSTRUCTION
from .policies.no_write_policy import looks_secret


DEFAULT_OPENAI_MODEL = "gpt-5.2"
PROMPT_DIR = Path(__file__).resolve().parent / "prompts"
PRODUCTION_OPENAI_ROOT_AGENT_NAME = "root_agent"
PRODUCTION_OPENAI_SPECIALIST_AGENT_NAMES = (
    "setup_advisor_agent",
    "performance_analyst_agent",
    "action_plan_agent",
    "qa_agent",
)
PRODUCTION_OPENAI_AGENT_NAMES = (
    PRODUCTION_OPENAI_ROOT_AGENT_NAME,
    *PRODUCTION_OPENAI_SPECIALIST_AGENT_NAMES,
)
PRODUCTION_OPENAI_TOOL_NAMES = (
    "setup_advisor",
    "performance_analyst",
    "action_plan",
    "qa_review",
)

OPENAI_AGENT_TOOL_CONTRACT = """
OpenAI Agents SDK tool contract:
- 各専門agentは、受け取ったscope済みcontextだけを根拠にする
- OAuth token、refresh token、developer token、Stripe secret、Authorization headerを要求・出力しない
- Google Ads writeはagent toolでは実行しない
- campaign status / budget の変更は、API layerで認証、workspace scope、confirmed=true、GOOGLE_ADS_WRITE_ENABLED=true、監査ログを満たす場合だけ実行される
- campaign作成は実行toolにせず、提案と人間向け管理画面手順に限る
- agentは変更候補、理由、戻し条件、観察計画、承認前チェックを作る
- 過去のrecommendation/task/feedbackと整合させ、未完了タスクを重複作成せず、失敗済み方針は代替案または再検証チェックポイントに変える
- 不足データがある場合は、仮説と不足データを分けて書く
"""


class OpenAIAgentsRuntimeError(RuntimeError):
    """Raised when OpenAI Agents SDK cannot produce a response."""


class WriteCandidate(BaseModel):
    operation: Literal["campaign_status", "campaign_budget"]
    customer_id: str
    campaign_id: str
    expected_current_value: str | float
    proposed_value: str | float
    approval_reason: str
    rollback_condition: str


class AdvisorStructuredOutput(BaseModel):
    conclusion: str
    evidence: list[str] = Field(min_length=1)
    hypotheses: list[str] = Field(min_length=1)
    recommended_actions: list[str] = Field(min_length=1)
    operator_steps: list[str] = Field(min_length=1)
    preflight_checks: list[str] = Field(min_length=1)
    risks: list[str] = Field(min_length=1)
    observation_plan: list[str] = Field(min_length=1)
    confidence: Literal["high", "medium", "low"]
    recommendation: dict[str, Any] | None = None
    human_task: dict[str, Any] | None = None
    write_candidate: WriteCandidate | None = None
    memory_candidates: list[dict[str, Any]] = Field(default_factory=list)


def is_openai_agents_configured() -> bool:
    status = openai_agents_configuration_status()
    return bool(status["openaiApiKeyConfigured"]) and bool(status["openaiAgentsSdkAvailable"])


def is_openai_agents_sdk_available() -> bool:
    return bool(openai_agents_configuration_status()["openaiAgentsSdkAvailable"])


def openai_agents_configuration_status() -> dict[str, Any]:
    required_symbols = ("Agent", "RunConfig", "Runner")
    try:
        agents_module = importlib.import_module("agents")
    except ImportError:
        return {
            "openaiApiKeyConfigured": bool(os.environ.get("OPENAI_API_KEY")),
            "openaiAgentsSdkImportable": False,
            "openaiAgentsSdkAvailable": False,
            "missingOpenaiAgentsSymbols": list(required_symbols),
        }
    missing_symbols = [name for name in required_symbols if not hasattr(agents_module, name)]
    return {
        "openaiApiKeyConfigured": bool(os.environ.get("OPENAI_API_KEY")),
        "openaiAgentsSdkImportable": True,
        "openaiAgentsSdkAvailable": not missing_symbols,
        "missingOpenaiAgentsSymbols": missing_symbols,
    }


def generate_openai_agents_response(payload: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    status = openai_agents_configuration_status()
    if not status["openaiApiKeyConfigured"]:
        raise OpenAIAgentsRuntimeError("OPENAI_API_KEY is not configured")
    if not status["openaiAgentsSdkAvailable"]:
        raise OpenAIAgentsRuntimeError("openai-agents is not installed or is missing required SDK symbols")
    message = str(payload.get("message") or "")
    if looks_secret(message):
        raise OpenAIAgentsRuntimeError("User message appears to contain a secret")

    try:
        from agents import Agent, RunConfig, Runner
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise OpenAIAgentsRuntimeError("openai-agents is not installed") from exc

    model = os.environ.get("OPENAI_AGENTS_MODEL") or DEFAULT_OPENAI_MODEL
    timeout_seconds = float(os.environ.get("OPENAI_AGENTS_TIMEOUT_SECONDS", "45"))
    prompt = _build_user_prompt(payload, context or {})
    route_plan = _route_plan(payload, context or {})

    root_agent = _build_openai_orchestrator(Agent, model, route_plan)
    run_config = RunConfig(
        trace_include_sensitive_data=False,
        workflow_name="adops_advisor_chat",
    )

    try:
        result = asyncio.run(
            asyncio.wait_for(
                Runner.run(root_agent, input=prompt, run_config=run_config),
                timeout=timeout_seconds,
            )
        )
    except Exception as exc:  # pragma: no cover - network/SDK dependent
        raise OpenAIAgentsRuntimeError("OpenAI Agents SDK request failed") from exc

    final_output = getattr(result, "final_output", None)
    structured_output = _coerce_structured_output(final_output)
    content = _structured_output_text(structured_output) if structured_output else str(final_output or "").strip()
    if not content:
        raise OpenAIAgentsRuntimeError("OpenAI Agents SDK returned an empty response")

    response = _build_runtime_response(content, "openai_agents", model, route_plan=route_plan)
    last_agent = getattr(getattr(result, "last_agent", None), "name", None)
    response["orchestration"] = {
        "runtime": "openai_agents",
        "routePlan": route_plan,
        "lastAgent": last_agent,
        "agentNames": list(PRODUCTION_OPENAI_AGENT_NAMES),
    }
    if structured_output:
        response["structuredOutput"] = structured_output.model_dump(mode="json")
    response["_internalUsage"] = _serialize_usage(result, model)
    return response


def _serialize_usage(result: Any, model: str) -> dict[str, Any]:
    """Return billing-safe usage totals without exposing prompts or provider payloads."""
    context_wrapper = getattr(result, "context_wrapper", None)
    usage = getattr(context_wrapper, "usage", None)
    input_details = getattr(usage, "input_tokens_details", None)
    output_details = getattr(usage, "output_tokens_details", None)

    def integer(value: Any) -> int:
        try:
            return max(0, int(value or 0))
        except (TypeError, ValueError):
            return 0

    input_tokens = integer(getattr(usage, "input_tokens", 0))
    output_tokens = integer(getattr(usage, "output_tokens", 0))
    return {
        "model": model,
        "requests": integer(getattr(usage, "requests", 0)),
        "inputTokens": input_tokens,
        "cachedInputTokens": integer(getattr(input_details, "cached_tokens", 0)),
        "outputTokens": output_tokens,
        "reasoningTokens": integer(getattr(output_details, "reasoning_tokens", 0)),
        "totalTokens": integer(getattr(usage, "total_tokens", input_tokens + output_tokens)),
    }


def _build_openai_orchestrator(Agent: Any, model: str, route_plan: dict[str, Any]) -> Any:
    setup_agent = Agent(
        name="setup_advisor_agent",
        model=model,
        instructions=_specialist_instructions(
            "setup_advisor.md",
            role=(
                "広告開始前の設計、CV地点、媒体選定、訴求、計測設計を担当する。"
                "広告指標の原因分析や媒体write実行は担当しない。"
            ),
            required_output=(
                "判断軸、確認項目、選択肢、推奨、リスク、次に聞くべき質問を返す。"
                "質問が必要な場合は3つ以内に絞る。"
            ),
        ),
    )
    performance_agent = Agent(
        name="performance_analyst_agent",
        model=model,
        instructions=_specialist_instructions(
            "performance_analyst.md",
            role="workspace scope済みの広告指標だけを根拠に、KPI変化、原因仮説、不足データを分析する。",
            required_output=(
                "対象期間、比較期間、見た指標、変化、原因仮説、不足データ、次に確認する順番を返す。"
                "変更実行ではなく承認付きwrite候補または確認候補として表現する。"
            ),
        ),
    )
    action_plan_agent = Agent(
        name="action_plan_agent",
        model=model,
        instructions=_specialist_instructions(
            "action_plan.md",
            role="分析や方針を、人間が承認して実行できる作業手順、実施前チェック、リスク、観察計画へ変換する。",
            required_output=(
                "推奨アクション、どこを確認するか、承認前チェック、リスク、期待効果、観察計画、戻し条件、自信度を返す。"
                "Google Ads campaign status / budget は承認付きAPI routeで実行可能な候補として書いてよいが、実行済みとは書かない。"
                "campaign作成は提案と人間向け管理画面手順のみとし、実行候補にしない。"
                "過去履歴がある場合は、未完了タスクの重複を避け、失敗済み方針を代替案または再検証チェックポイントに変える。"
            ),
        ),
    )
    qa_agent = Agent(
        name="qa_agent",
        model=model,
        instructions=_qa_instructions(),
    )

    specialist_agents = (
        setup_agent,
        performance_agent,
        action_plan_agent,
        qa_agent,
    )
    specialist_tools = [
        setup_agent.as_tool(
            tool_name="setup_advisor",
            tool_description=(
                "広告開始前の設計相談用。商材、CV地点、KPI、媒体選定、訴求、計測設計、"
                "不足質問を整理する。媒体write実行や実績診断は担当しない。"
            ),
        ),
        performance_agent.as_tool(
            tool_name="performance_analyst",
            tool_description=(
                "workspace scope済み広告指標から対象期間、比較期間、KPI変化、原因仮説、"
                "不足データ、次に見る順番を分析する。"
            ),
        ),
        action_plan_agent.as_tool(
            tool_name="action_plan",
            tool_description=(
                "分析結果と過去のrecommendation/task/feedbackを、重複のない作業候補、"
                "承認前チェック、リスク、観察計画、戻し条件へ変換する。"
                "Google Ads campaign status/budgetは実行済みにせず承認付きAPI候補にする。"
                "campaign作成は提案と人間向け手順に限る。"
            ),
        ),
        qa_agent.as_tool(
            tool_name="qa_review",
            tool_description=(
                "最終回答の根拠、必須セクション、履歴との矛盾・タスク重複、secret除外、保証表現、"
                "承認付きwrite境界、実行済み表現の有無を点検して修正方針を返す。"
            ),
        ),
    ]

    root_agent = Agent(
        name=PRODUCTION_OPENAI_ROOT_AGENT_NAME,
        model=model,
        output_type=AdvisorStructuredOutput,
        instructions=(
            f"{ROOT_INSTRUCTION}\n\n"
            "OpenAI Agents SDK orchestration contract:\n"
            f"- routePlan: {route_plan}\n"
            f"- advisorMode: {route_plan.get('advisorMode', 'beginner')}\n"
            f"- entryAgent: {route_plan.get('entryAgent', 'setup_advisor_beginner')}\n"
            f"- modeContract: {route_plan.get('modeContract', '')}\n"
            "- root/orchestratorが最終回答を保持する\n"
            "- 必要な専門agentをtoolとして呼び、最後にqa_agentの観点で自己点検する\n"
            "- setup/performance/action/qa のtoolを質問意図に応じて使い分ける\n"
            "- 過去履歴がある場合は既存タスクと失敗済み方針に整合させ、重複タスクではなく代替案または再検証チェックポイントを出す\n"
            "- 最終出力はAdvisorStructuredOutputの全必須フィールドを満たす\n"
            "- beginnerでは専門用語をほどき、確認順と判断軸を丁寧に説明する\n"
            "- experiencedではKPI分解、仮説、優先順位、承認付きwrite候補、戻し条件を簡潔に深掘りする\n"
            "- Google Ads writeの実行はAPI layerの承認付きrouteに限定し、agentは実行済みと書かない\n"
            "- campaign作成は提案と人間向け管理画面手順に限り、mutation toolや承認付きAPI候補にしない\n"
            "- secret、OAuth token、raw customer list、authorization headerを出力しない\n"
        ),
        tools=specialist_tools,
    )
    _assert_production_openai_agent_topology(root_agent, specialist_agents, specialist_tools)
    return root_agent


def _assert_production_openai_agent_topology(
    root_agent: Any,
    specialist_agents: tuple[Any, ...],
    specialist_tools: list[Any],
) -> None:
    names = (str(getattr(root_agent, "name", "")),) + tuple(
        str(getattr(agent, "name", "")) for agent in specialist_agents
    )
    tool_names = tuple(
        str(tool.get("tool_name", "")) if isinstance(tool, dict) else str(getattr(tool, "name", ""))
        for tool in specialist_tools
    )
    if names != PRODUCTION_OPENAI_AGENT_NAMES or tool_names != PRODUCTION_OPENAI_TOOL_NAMES:
        raise OpenAIAgentsRuntimeError(
            "Production OpenAI runtime must contain exactly root_agent, setup_advisor_agent, "
            "performance_analyst_agent, action_plan_agent, and qa_agent with the four approved specialist tools"
        )


def _coerce_structured_output(value: Any) -> AdvisorStructuredOutput | None:
    if isinstance(value, AdvisorStructuredOutput):
        return value
    if isinstance(value, dict):
        try:
            return AdvisorStructuredOutput.model_validate(value)
        except ValueError:
            return None
    return None


def _structured_output_text(output: AdvisorStructuredOutput) -> str:
    confidence = {"high": "High", "medium": "Medium", "low": "Low"}[output.confidence]

    def section(label: str, values: list[str]) -> str:
        return f"{label}:\n" + "\n".join(f"- {value}" for value in values)

    return "\n\n".join(
        [
            f"結論:\n{output.conclusion}",
            section("根拠", output.evidence),
            section("原因仮説", output.hypotheses),
            section("推奨アクション", output.recommended_actions),
            section("人間向け作業手順", output.operator_steps),
            section("実施前チェック", output.preflight_checks),
            section("リスク", output.risks),
            section("実施後の観察", output.observation_plan),
            f"自信度:\n{confidence}",
        ]
    )


def _route_plan(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    for source in (payload.get("context"), context):
        if isinstance(source, dict) and isinstance(source.get("routePlan"), dict):
            return source["routePlan"]
    return {}


def _prompt(name: str) -> str:
    return (PROMPT_DIR / name).read_text(encoding="utf-8")


def _specialist_instructions(prompt_name: str, *, role: str, required_output: str) -> str:
    return (
        f"役割:\n{role}\n\n"
        f"{_prompt(prompt_name)}\n\n"
        f"必須アウトプット:\n{required_output}\n\n"
        f"{OPENAI_AGENT_TOOL_CONTRACT}"
    )


def _qa_instructions() -> str:
    return (
        "最終回答の品質保証を担当する。\n\n"
        "点検項目:\n"
        "- 結論、根拠、原因仮説、推奨アクション、人間向け作業手順、実施前チェック、リスク、実施後の観察、自信度が必要な場面で揃っているか\n"
        "- 対象期間、比較期間、見た指標、不足データが明示されているか\n"
        "- Google Ads writeを実行済み、またはAIが単独実行できるように書いていないか\n"
        "- campaign status / budget は承認付きAPI候補として、confirmed=true、承認前チェック、戻し条件、監査ログ前提が書かれているか\n"
        "- bid、ad作成、targeting変更は承認付きAPI対象外として人間レビュー候補に留めているか\n"
        "- campaign作成は提案と人間向け管理画面手順に限定し、実行toolやwrite candidateにしていないか\n"
        "- recentRecommendations/recentTasks/operatorFeedbackSummaryがある場合、未完了タスクの重複や失敗済み方針の無条件な再提案がないか\n"
        "- OAuth token、refresh token、developer token、Stripe secret、Authorization header、raw customer listを出力していないか\n"
        "- 成果改善を保証していないか\n\n"
        "問題があれば、最終回答に反映すべき修正済み表現を返す。\n\n"
        f"{OPENAI_AGENT_TOOL_CONTRACT}"
    )
