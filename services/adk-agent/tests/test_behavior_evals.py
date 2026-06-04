from __future__ import annotations

import json
from pathlib import Path
import sys
import types as pytypes
from typing import Any
from unittest.mock import patch

import pytest

from ad_ops_advisor.chat_runtime import handle_chat
from ad_ops_advisor.analysis import build_mock_chat_response
from ad_ops_advisor.conversation_router import build_route_plan
from ad_ops_advisor.gemini_runtime import _build_user_prompt
from ad_ops_advisor.openai_agents_runtime import generate_openai_agents_response
from ad_ops_advisor.qa_gate import apply_qa_gate


SERVICE_ROOT = Path(__file__).resolve().parents[1]
EVAL_DIR = SERVICE_ROOT / "ad_ops_advisor/evals"
SUPPORTED_RUNNERS = {
    "route_plan",
    "qa_gate",
    "prompt_context",
    "handle_chat",
    "mock_analysis",
    "openai_orchestration",
}


def _load_executable_scenarios() -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    cases: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
    for eval_file in sorted(EVAL_DIR.glob("*.test.json")):
        suite = json.loads(eval_file.read_text(encoding="utf-8"))
        if not suite.get("executable"):
            continue
        for scenario in suite.get("scenarios", []):
            cases.append((f"{suite['name']}::{scenario['id']}", suite, scenario))
    return cases


def test_executable_eval_json_schema_is_stable() -> None:
    seen_ids: set[str] = set()
    executable_suites = 0

    for eval_file in sorted(EVAL_DIR.glob("*.test.json")):
        suite = json.loads(eval_file.read_text(encoding="utf-8"))
        if not suite.get("executable"):
            continue
        executable_suites += 1
        assert suite["status"] == "executable"
        assert suite["runner"] in SUPPORTED_RUNNERS
        assert isinstance(suite.get("scenarios"), list) and suite["scenarios"]
        for scenario in suite["scenarios"]:
            assert scenario["id"] not in seen_ids
            seen_ids.add(scenario["id"])
            assert scenario["user_message"].strip()
            expected = scenario["expected"]
            assert isinstance(expected.get("must_include", []), list)
            assert isinstance(expected.get("must_not_include", []), list)

    assert executable_suites >= 4


@pytest.mark.parametrize(("case_id", "suite", "scenario"), _load_executable_scenarios())
def test_executable_agent_behavior_eval(
    monkeypatch: pytest.MonkeyPatch,
    case_id: str,
    suite: dict[str, Any],
    scenario: dict[str, Any],
) -> None:
    runner = suite["runner"]
    if runner == "route_plan":
        output = _run_route_plan_eval(scenario)
    elif runner == "qa_gate":
        output = _run_qa_gate_eval(scenario)
    elif runner == "prompt_context":
        output = _run_prompt_context_eval(scenario)
    elif runner == "handle_chat":
        output = _run_handle_chat_eval(scenario)
    elif runner == "mock_analysis":
        output = _run_mock_analysis_eval(scenario)
    elif runner == "openai_orchestration":
        output = _run_openai_orchestration_eval(monkeypatch, scenario)
    else:  # pragma: no cover - schema test should catch this first
        raise AssertionError(f"Unsupported eval runner: {runner}")

    expected = scenario["expected"]
    _assert_contains(case_id, output["text"], expected.get("must_include", []))
    _assert_excludes(case_id, output["text"], expected.get("must_not_include", []))

    if "policy_name" in expected:
        assert output.get("policy_name") == expected["policy_name"]
    if "mode" in expected:
        assert output.get("mode") == expected["mode"]
    if "trace_include_sensitive_data" in expected:
        assert output.get("trace_include_sensitive_data") is expected["trace_include_sensitive_data"]
    if "tools" in expected:
        assert output.get("tools") == expected["tools"]
    for policy_check in expected.get("policy_checks", []):
        assert policy_check in output.get("policy_checks", [])

    if runner == "route_plan":
        for key in ("route", "requires_metrics_context", "prefers_short_response", "response_contract"):
            if key in expected:
                assert output[key] == expected[key]
        if "target_agents" in expected:
            assert output["target_agents"] == expected["target_agents"]
        for field in expected.get("context_contract_includes", []):
            assert field in output["context_contract"]


def _run_route_plan_eval(scenario: dict[str, Any]) -> dict[str, Any]:
    route_plan = build_route_plan(scenario["user_message"])
    data = route_plan.as_dict()
    return {
        "text": json.dumps(data, ensure_ascii=False),
        "route": data["route"],
        "requires_metrics_context": data["requires_metrics_context"],
        "prefers_short_response": data["prefers_short_response"],
        "target_agents": data["targetAgents"],
        "response_contract": data["responseContract"],
        "context_contract": data["contextContract"],
    }


def _run_qa_gate_eval(scenario: dict[str, Any]) -> dict[str, Any]:
    route_plan = build_route_plan(scenario["user_message"])
    content, policy = apply_qa_gate(scenario["model_output"], route_plan)
    return {
        "text": content,
        "policy_name": policy["name"] if policy else None,
        "policy_checks": policy.get("checks", []) if policy else [],
    }


def _run_prompt_context_eval(scenario: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "workspaceId": "workspace-eval",
        "userId": "user-eval",
        "threadId": "thread-eval",
        "message": scenario["user_message"],
        "context": scenario.get("context", {}),
    }
    prompt = _build_user_prompt(payload, {"routePlan": build_route_plan(scenario["user_message"]).as_dict()})
    return {"text": prompt}


def _run_handle_chat_eval(scenario: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "workspaceId": "workspace-eval",
        "userId": "user-eval",
        "threadId": "thread-eval",
        "message": scenario["user_message"],
        "context": scenario.get("context", {}),
    }
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.get_repository", side_effect=AssertionError("DB should not be used")),
        patch(
            "ad_ops_advisor.chat_runtime.generate_agent_response",
            side_effect=AssertionError("LLM should not be used"),
        ),
    ):
        result = handle_chat(payload)
    return {
        "text": json.dumps(result, ensure_ascii=False),
        "policy_name": result.get("policy", {}).get("name"),
    }


def _run_mock_analysis_eval(scenario: dict[str, Any]) -> dict[str, Any]:
    result = build_mock_chat_response(
        {
            "workspaceId": "workspace-eval",
            "userId": "user-eval",
            "threadId": "thread-eval",
            "message": scenario["user_message"],
            "latestAdData": scenario.get("latestAdData"),
        }
    )
    return {"text": json.dumps(result, ensure_ascii=False)}


def _run_openai_orchestration_eval(monkeypatch: pytest.MonkeyPatch, scenario: dict[str, Any]) -> dict[str, Any]:
    fake_agents_module = pytypes.ModuleType("agents")

    class FakeToolAgent:
        def __init__(self, name, model=None, instructions="", tools=None):  # noqa: ANN001
            self.name = name
            self.model = model
            self.instructions = instructions
            self.tools = tools or []

        def as_tool(self, tool_name: str, tool_description: str) -> dict:
            return {"tool_name": tool_name, "tool_description": tool_description, "agent": self.name}

    class FakeRunConfig:
        def __init__(self, **kwargs):  # noqa: ANN003
            self.kwargs = kwargs

    class FakeResult:
        final_output = scenario["fake_model_output"]
        last_agent = pytypes.SimpleNamespace(name="ad_ops_advisor_orchestrator")

    class FakeRunner:
        captured = {}

        @staticmethod
        async def run(agent, input, run_config):  # noqa: ANN001, A002
            FakeRunner.captured = {"agent": agent, "input": input, "run_config": run_config}
            return FakeResult()

    fake_agents_module.Agent = FakeToolAgent
    fake_agents_module.RunConfig = FakeRunConfig
    fake_agents_module.Runner = FakeRunner
    monkeypatch.setitem(sys.modules, "agents", fake_agents_module)
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OPENAI_AGENTS_MODEL", "gpt-test")

    result = generate_openai_agents_response(
        {
            "workspaceId": "workspace-eval",
            "userId": "user-eval",
            "threadId": "thread-eval",
            "message": scenario["user_message"],
            "context": scenario.get("context", {}),
        },
        {},
    )
    return {
        "text": json.dumps(result, ensure_ascii=False),
        "mode": result["mode"],
        "trace_include_sensitive_data": FakeRunner.captured["run_config"].kwargs["trace_include_sensitive_data"],
        "tools": [tool["tool_name"] for tool in FakeRunner.captured["agent"].tools],
    }


def _assert_contains(case_id: str, text: str, values: list[str]) -> None:
    for value in values:
        assert value in text, f"{case_id} expected to include {value!r}\n{text}"


def _assert_excludes(case_id: str, text: str, values: list[str]) -> None:
    for value in values:
        assert value not in text, f"{case_id} expected to exclude {value!r}\n{text}"
