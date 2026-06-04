from __future__ import annotations

import asyncio
import importlib
import os
from pathlib import Path
from typing import Any

from .agent import ROOT_INSTRUCTION
from .gemini_runtime import _build_runtime_response, _build_user_prompt
from .policies.no_write_policy import looks_secret


DEFAULT_OPENAI_MODEL = "gpt-5.2"
PROMPT_DIR = Path(__file__).resolve().parent / "prompts"

OPENAI_AGENT_TOOL_CONTRACT = """
OpenAI Agents SDK tool contract:
- 各専門agentは、受け取ったscope済みcontextだけを根拠にする
- OAuth token、refresh token、developer token、Stripe secret、Authorization headerを要求・出力しない
- Google Ads writeはagent toolでは実行しない
- campaign status / budget の変更は、API layerで認証、workspace scope、confirmed=true、GOOGLE_ADS_WRITE_ENABLED=true、監査ログを満たす場合だけ実行される
- agentは変更候補、理由、戻し条件、観察計画、承認前チェックを作る
- 不足データがある場合は、仮説と不足データを分けて書く
"""


class OpenAIAgentsRuntimeError(RuntimeError):
    """Raised when OpenAI Agents SDK cannot produce a response."""


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

    content = str(getattr(result, "final_output", "") or "").strip()
    if not content:
        raise OpenAIAgentsRuntimeError("OpenAI Agents SDK returned an empty response")

    response = _build_runtime_response(content, "openai_agents", model, route_plan=route_plan)
    last_agent = getattr(getattr(result, "last_agent", None), "name", None)
    response["orchestration"] = {
        "runtime": "openai_agents",
        "routePlan": route_plan,
        "lastAgent": last_agent,
    }
    return response


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
    budget_agent = Agent(
        name="budget_learning_agent",
        model=model,
        instructions=_specialist_instructions(
            "performance_analyst.md",
            role="予算消化、配信量、入札戦略、学習状態を分けて診断する。",
            required_output=(
                "予算不足、配信制約、学習不足、入札戦略、CV母数不足を分ける。"
                "Google Ads予算変更は承認付きAPI候補、入札変更は人間レビュー候補として扱う。"
            ),
        ),
    )
    media_spec_agent = Agent(
        name="media_spec_agent",
        model=model,
        instructions=_specialist_instructions(
            "setup_advisor.md",
            role="媒体仕様、入稿規定、文字数、サイズ、計測仕様、管理画面上の確認箇所を担当する。",
            required_output=(
                "仕様として起きうること、確認場所、確認手順、判断軸を返す。"
                "最新性が必要な仕様は断定せず、公式確認が必要だと明示する。"
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
            ),
        ),
    )
    qa_agent = Agent(
        name="qa_agent",
        model=model,
        instructions=_qa_instructions(),
    )

    return Agent(
        name="ad_ops_advisor_orchestrator",
        model=model,
        instructions=(
            f"{ROOT_INSTRUCTION}\n\n"
            "OpenAI Agents SDK orchestration contract:\n"
            f"- routePlan: {route_plan}\n"
            f"- advisorMode: {route_plan.get('advisorMode', 'beginner')}\n"
            f"- entryAgent: {route_plan.get('entryAgent', 'setup_advisor_beginner')}\n"
            f"- modeContract: {route_plan.get('modeContract', '')}\n"
            "- root/orchestratorが最終回答を保持する\n"
            "- 必要な専門agentをtoolとして呼び、最後にqa_agentの観点で自己点検する\n"
            "- setup/performance/budget/media/action/qa のtoolを質問意図に応じて使い分ける\n"
            "- beginnerでは専門用語をほどき、確認順と判断軸を丁寧に説明する\n"
            "- experiencedではKPI分解、仮説、優先順位、承認付きwrite候補、戻し条件を簡潔に深掘りする\n"
            "- Google Ads writeの実行はAPI layerの承認付きrouteに限定し、agentは実行済みと書かない\n"
            "- secret、OAuth token、raw customer list、authorization headerを出力しない\n"
        ),
        tools=[
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
            budget_agent.as_tool(
                tool_name="budget_learning",
                tool_description=(
                    "予算消化、配信量、学習状態、入札戦略、CV母数を診断する。"
                    "Google Ads予算変更は承認付きAPI候補、入札変更はレビュー候補として扱う。"
                ),
            ),
            media_spec_agent.as_tool(
                tool_name="media_spec",
                tool_description=(
                    "媒体仕様、入稿規定、文字数、サイズ、計測仕様、管理画面の確認場所を整理する。"
                    "最新仕様は断定せず公式確認手順を示す。"
                ),
            ),
            action_plan_agent.as_tool(
                tool_name="action_plan",
                tool_description=(
                    "分析結果を承認前チェック、実行手順、リスク、期待効果、観察計画、戻し条件へ変換する。"
                    "Google Ads campaign status/budgetは実行済みにせず承認付きwrite候補にする。"
                ),
            ),
            qa_agent.as_tool(
                tool_name="qa_review",
                tool_description=(
                    "最終回答の根拠、必須セクション、secret除外、保証表現、"
                    "承認付きwrite境界、実行済み表現の有無を点検して修正方針を返す。"
                ),
            ),
        ],
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
        "- OAuth token、refresh token、developer token、Stripe secret、Authorization header、raw customer listを出力していないか\n"
        "- 成果改善を保証していないか\n\n"
        "問題があれば、最終回答に反映すべき修正済み表現を返す。\n\n"
        f"{OPENAI_AGENT_TOOL_CONTRACT}"
    )
