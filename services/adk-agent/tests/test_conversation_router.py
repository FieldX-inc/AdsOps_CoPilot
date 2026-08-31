from __future__ import annotations

from ad_ops_advisor.conversation_router import build_route_plan


def test_route_plan_maps_greeting_to_light_orchestrator_without_metrics() -> None:
    route = build_route_plan("こんにちは、何ができますか？")

    assert route.route == "greeting_casual"
    assert route.advisor_mode == "beginner"
    assert route.entry_agent == "setup_advisor_beginner"
    assert route.requires_metrics_context is False
    assert route.target_agents == ("root_agent",)
    assert route.runtime_agents == ()
    assert route.response_contract == "light_assistant_response"
    assert "初心者向け" in route.mode_contract


def test_route_plan_maps_diagnosis_to_context_analysis_action_and_qa() -> None:
    route = build_route_plan("CPAが悪化している原因を分析して")

    assert route.route == "diagnosis"
    assert route.requires_metrics_context is True
    assert route.target_agents == (
        "root_agent",
        "performance_analyst_agent",
        "action_plan_agent",
        "qa_agent",
    )
    assert route.runtime_agents == ("performance_analyst_agent", "action_plan_agent", "qa_agent")
    assert route.response_contract == "diagnosis_with_evidence"
    assert "campaignAdGroupMetricsSummary" in route.context_contract


def test_route_plan_keeps_media_spec_out_of_metrics_prefetch() -> None:
    route = build_route_plan("Google広告のレスポンシブ検索広告の見出し文字数を教えて")

    assert route.route == "media_spec"
    assert route.requires_metrics_context is False
    assert route.target_agents == ("root_agent", "setup_advisor_agent", "qa_agent")
    assert route.runtime_agents == ("setup_advisor_agent", "qa_agent")


def test_route_plan_uses_only_the_initial_five_agent_names() -> None:
    route = build_route_plan("予算が使いきれない理由と学習状態への影響を見て")

    assert route.target_agents == (
        "root_agent",
        "performance_analyst_agent",
        "action_plan_agent",
        "qa_agent",
    )
    assert route.runtime_agents == ("performance_analyst_agent", "action_plan_agent", "qa_agent")
    assert route.as_dict()["runtimeAgents"] == [
        "performance_analyst_agent",
        "action_plan_agent",
        "qa_agent",
    ]
    assert set(route.target_agents) <= {
        "root_agent",
        "setup_advisor_agent",
        "performance_analyst_agent",
        "action_plan_agent",
        "qa_agent",
    }


def test_route_plan_supports_experienced_mode_contract_and_entry_agent() -> None:
    route = build_route_plan("CPAが悪化している原因を分析して", advisor_mode="experienced")

    assert route.advisor_mode == "experienced"
    assert route.entry_agent == "performance_analyst_experienced"
    assert "実務者向け" in route.mode_contract
    assert route.as_dict()["advisorMode"] == "experienced"
    assert route.as_dict()["entryAgent"] == "performance_analyst_experienced"
