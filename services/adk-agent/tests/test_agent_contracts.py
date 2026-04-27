from __future__ import annotations

import ast
import inspect
from pathlib import Path

from ad_ops_advisor import agent
from ad_ops_advisor.policies.no_write_policy import is_forbidden_tool_name
from ad_ops_advisor.tools import ad_account_tools, human_task_tools, memory_tools, metrics_tools, search_tools


SERVICE_ROOT = Path(__file__).resolve().parents[1]
REQUIRED_ANSWER_SECTIONS = (
    "結論",
    "根拠",
    "原因仮説",
    "推奨アクション",
    "人間向け作業手順",
    "実施前チェック",
    "リスク",
    "実施後の観察",
    "自信度",
)
EXPECTED_ROOT_TOOLS = {
    "list_ad_accounts",
    "fetch_campaign_metrics",
    "compare_period_metrics",
    "read_user_memory",
    "write_user_memory",
    "google_search_latest_knowledge",
    "create_human_task",
}
SECRET_PARAM_MARKERS = ("token", "secret", "password", "api_key", "service_role")


def test_root_agent_composes_only_allowed_read_only_and_human_loop_tools() -> None:
    tool_names = _root_agent_tool_names_from_source()

    assert tool_names == EXPECTED_ROOT_TOOLS
    assert all(not is_forbidden_tool_name(tool_name) for tool_name in tool_names)
    assert not any(
        marker in tool_name
        for tool_name in tool_names
        for marker in ("budget", "bid", "pause", "enable", "mutate", "update_campaign", "create_ad")
    )


def test_root_instruction_keeps_no_write_and_answer_shape_contract() -> None:
    instruction = agent.ROOT_INSTRUCTION

    assert "human-in-the-loop" in instruction
    assert "広告媒体の設定を直接変更したと主張してはいけません" in instruction
    assert "変更するtoolを呼んだり、存在すると仮定してはいけません" in instruction
    for section in REQUIRED_ANSWER_SECTIONS:
        assert section in instruction


def test_prompt_files_preserve_policy_and_evidence_contracts() -> None:
    root_prompt = (SERVICE_ROOT / "ad_ops_advisor/prompts/root.md").read_text(encoding="utf-8")
    performance_prompt = (SERVICE_ROOT / "ad_ops_advisor/prompts/performance_analyst.md").read_text(
        encoding="utf-8"
    )
    action_plan_prompt = (SERVICE_ROOT / "ad_ops_advisor/prompts/action_plan.md").read_text(encoding="utf-8")

    assert "媒体設定を直接変更する" in root_prompt
    assert "根拠のない数値を作る" in root_prompt
    assert "秘密情報を出力する" in root_prompt
    for expected in ("対象期間", "比較期間", "見た指標", "まだ分からないこと"):
        assert expected in performance_prompt
    for expected in ("人間が媒体管理画面で実行", "実施前チェック", "リスク", "実施後の観察計画", "自信度"):
        assert expected in action_plan_prompt


def test_tool_signatures_require_scope_and_do_not_accept_secrets() -> None:
    scoped_tools = (
        ad_account_tools.list_ad_accounts,
        metrics_tools.fetch_campaign_metrics,
        metrics_tools.compare_period_metrics,
        memory_tools.read_user_memory,
        memory_tools.write_user_memory,
        search_tools.google_search_latest_knowledge,
        human_task_tools.create_human_task,
    )
    user_scoped_tools = (
        memory_tools.read_user_memory,
        memory_tools.write_user_memory,
        human_task_tools.create_human_task,
    )

    for tool in scoped_tools:
        parameters = inspect.signature(tool).parameters
        assert next(iter(parameters)) == "workspace_id"
        assert not any(
            marker in parameter_name.lower()
            for parameter_name in parameters
            for marker in SECRET_PARAM_MARKERS
        )

    for tool in user_scoped_tools:
        assert "user_id" in inspect.signature(tool).parameters


def _root_agent_tool_names_from_source() -> set[str]:
    source = (SERVICE_ROOT / "ad_ops_advisor/agent.py").read_text(encoding="utf-8")
    tree = ast.parse(source)

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not isinstance(node.func, ast.Name) or node.func.id != "Agent":
            continue
        for keyword in node.keywords:
            if keyword.arg == "tools" and isinstance(keyword.value, ast.List):
                return {item.id for item in keyword.value.elts if isinstance(item, ast.Name)}

    raise AssertionError("root Agent tools list was not found")
