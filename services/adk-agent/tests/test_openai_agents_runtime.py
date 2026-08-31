from __future__ import annotations

import sys
import types as pytypes

import pytest

from ad_ops_advisor.openai_agents_runtime import (
    PRODUCTION_OPENAI_AGENT_NAMES,
    PRODUCTION_OPENAI_TOOL_NAMES,
    generate_openai_agents_response,
    openai_agents_configuration_status,
)
from ad_ops_advisor.runtime import AgentRuntimeError, generate_agent_response, is_agent_runtime_configured


class FakeToolAgent:
    instances = {}

    def __init__(self, name, model=None, instructions="", tools=None, output_type=None):  # noqa: ANN001
        self.name = name
        self.model = model
        self.instructions = instructions
        self.tools = tools or []
        self.output_type = output_type
        FakeToolAgent.instances[name] = self

    def as_tool(self, tool_name: str, tool_description: str) -> dict:
        return {
            "tool_name": tool_name,
            "tool_description": tool_description,
            "agent": self.name,
            "agent_instructions": self.instructions,
        }


class FakeRunConfig:
    def __init__(self, **kwargs):  # noqa: ANN003
        self.kwargs = kwargs


class FakeResult:
    final_output = (
        "結論:\nOpenAI Agents SDKで生成した回答です。\n"
        "人間向け作業手順:\n1. 予算を下げる\n"
        "自信度:\nMedium"
    )
    last_agent = pytypes.SimpleNamespace(name="root_agent")


class FakeRunner:
    captured = {}

    @staticmethod
    async def run(agent, input, run_config):  # noqa: ANN001, A002
        FakeRunner.captured = {"agent": agent, "input": input, "run_config": run_config}
        return FakeResult()


def test_generate_openai_agents_response_builds_manager_style_orchestrator(monkeypatch) -> None:
    FakeToolAgent.instances = {}
    fake_agents_module = pytypes.ModuleType("agents")
    fake_agents_module.Agent = FakeToolAgent
    fake_agents_module.RunConfig = FakeRunConfig
    fake_agents_module.Runner = FakeRunner
    monkeypatch.setitem(sys.modules, "agents", fake_agents_module)
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OPENAI_AGENTS_MODEL", "gpt-test")

    result = generate_openai_agents_response(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "threadId": "thread-1",
            "message": "CPAが悪化している原因を分析して",
            "context": {
                "routePlan": {
                    "route": "diagnosis",
                    "advisorMode": "experienced",
                    "entryAgent": "performance_analyst_experienced",
                    "requiresMetricsContext": True,
                    "responseContract": "diagnosis_with_evidence",
                    "modeContract": "実務者向け。KPI分解を優先する。",
                }
            },
        },
        {},
    )

    assert result["mode"] == "openai_agents"
    assert result["model"] == "gpt-test"
    assert result["orchestration"]["runtime"] == "openai_agents"
    assert FakeRunner.captured["agent"].name == "root_agent"
    assert tuple(FakeToolAgent.instances) == PRODUCTION_OPENAI_AGENT_NAMES[1:] + ("root_agent",)
    assert set(FakeToolAgent.instances) == set(PRODUCTION_OPENAI_AGENT_NAMES)
    assert "setup_intake_agent" not in FakeToolAgent.instances
    assert "ad_ops_advisor" not in FakeToolAgent.instances
    assert tuple(tool["tool_name"] for tool in FakeRunner.captured["agent"].tools) == PRODUCTION_OPENAI_TOOL_NAMES
    assert FakeRunner.captured["agent"].output_type.__name__ == "AdvisorStructuredOutput"
    assert FakeRunner.captured["run_config"].kwargs["trace_include_sensitive_data"] is False
    assert "予算を下げる" not in result["message"]["content"]
    assert "予算引き下げ候補" in result["message"]["content"]

    setup = FakeToolAgent.instances["setup_advisor_agent"].instructions
    performance = FakeToolAgent.instances["performance_analyst_agent"].instructions
    action_plan = FakeToolAgent.instances["action_plan_agent"].instructions
    qa = FakeToolAgent.instances["qa_agent"].instructions
    root = FakeToolAgent.instances["root_agent"].instructions
    descriptions = "\n".join(tool["tool_description"] for tool in FakeRunner.captured["agent"].tools)

    assert "商材、顧客、ペルソナ" in setup
    assert "対象期間、比較期間、見た指標" in performance
    assert "confirmed=true" in action_plan
    assert "承認付きAPI候補" in action_plan
    assert "Stripe secret" in qa
    assert "GOOGLE_ADS_WRITE_ENABLED=true" in qa
    assert "Google Ads writeの実行はAPI layerの承認付きrouteに限定" in root
    assert "advisorMode: experienced" in root
    assert "entryAgent: performance_analyst_experienced" in root
    assert "experiencedではKPI分解" in root
    assert "承認付きAPI候補" in descriptions
    assert "campaign作成は提案と人間向け手順に限る" in descriptions
    assert "重複のない作業候補" in descriptions
    assert "OAuth token" not in descriptions


def test_openai_agents_configuration_status_names_missing_sdk_symbols(monkeypatch) -> None:
    fake_agents_module = pytypes.ModuleType("agents")
    fake_agents_module.Agent = FakeToolAgent
    fake_agents_module.RunConfig = FakeRunConfig
    monkeypatch.setitem(sys.modules, "agents", fake_agents_module)
    monkeypatch.setenv("ADOPS_AGENT_RUNTIME", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")

    status = openai_agents_configuration_status()

    assert status == {
        "openaiApiKeyConfigured": True,
        "openaiAgentsSdkImportable": True,
        "openaiAgentsSdkAvailable": False,
        "missingOpenaiAgentsSymbols": ["Runner"],
    }

    with pytest.raises(AgentRuntimeError, match="openai-agents is not installed or is missing required SDK symbols"):
        generate_agent_response(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "CPAを見て",
            }
        )


def test_production_agent_runtime_rejects_non_openai_runtime(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ADOPS_AGENT_RUNTIME", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")

    assert is_agent_runtime_configured() is False
    with pytest.raises(AgentRuntimeError, match="ADOPS_AGENT_RUNTIME=openai"):
        generate_agent_response(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "CPAを見て",
            }
        )
