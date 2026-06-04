from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .intent import IntentClassification, IntentLabel, classify_intent


@dataclass(frozen=True)
class RoutePlan:
    route: IntentLabel
    advisor_mode: str
    entry_agent: str
    requires_metrics_context: bool
    prefers_short_response: bool
    target_agents: tuple[str, ...]
    runtime_agents: tuple[str, ...]
    response_contract: str
    mode_contract: str
    context_contract: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "route": self.route.value,
            "advisorMode": self.advisor_mode,
            "entryAgent": self.entry_agent,
            "requires_metrics_context": self.requires_metrics_context,
            "prefers_short_response": self.prefers_short_response,
            "targetAgents": list(self.target_agents),
            "runtimeAgents": list(self.runtime_agents),
            "responseContract": self.response_contract,
            "modeContract": self.mode_contract,
            "contextContract": list(self.context_contract),
        }


_AGENTS_BY_INTENT: dict[IntentLabel, tuple[str, ...]] = {
    IntentLabel.GREETING_CASUAL: ("router_agent",),
    IntentLabel.STATUS_SUMMARY: ("context_agent", "performance_analyst_agent", "qa_agent"),
    IntentLabel.DIAGNOSIS: ("context_agent", "performance_analyst_agent", "action_plan_agent", "qa_agent"),
    IntentLabel.SETUP: ("setup_advisor_agent", "qa_agent"),
    IntentLabel.BUDGET_DELIVERY_LEARNING: ("context_agent", "budget_learning_agent", "action_plan_agent", "qa_agent"),
    IntentLabel.MEDIA_SPEC: ("media_spec_agent", "qa_agent"),
    IntentLabel.ACTION_PLAN: ("context_agent", "performance_analyst_agent", "action_plan_agent", "qa_agent"),
    IntentLabel.GENERAL_ADVICE: ("router_agent", "qa_agent"),
}

_RUNTIME_AGENTS_BY_INTENT: dict[IntentLabel, tuple[str, ...]] = {
    IntentLabel.GREETING_CASUAL: (),
    IntentLabel.STATUS_SUMMARY: ("performance_analyst_agent", "qa_agent"),
    IntentLabel.DIAGNOSIS: ("performance_analyst_agent", "action_plan_agent", "qa_agent"),
    IntentLabel.SETUP: ("setup_advisor_agent", "qa_agent"),
    IntentLabel.BUDGET_DELIVERY_LEARNING: ("performance_analyst_agent", "action_plan_agent", "qa_agent"),
    IntentLabel.MEDIA_SPEC: ("setup_advisor_agent", "qa_agent"),
    IntentLabel.ACTION_PLAN: ("performance_analyst_agent", "action_plan_agent", "qa_agent"),
    IntentLabel.GENERAL_ADVICE: ("qa_agent",),
}

_CONTRACT_BY_INTENT: dict[IntentLabel, str] = {
    IntentLabel.GREETING_CASUAL: "light_assistant_response",
    IntentLabel.STATUS_SUMMARY: "metrics_status_summary",
    IntentLabel.DIAGNOSIS: "diagnosis_with_evidence",
    IntentLabel.SETUP: "setup_guidance",
    IntentLabel.BUDGET_DELIVERY_LEARNING: "budget_delivery_learning_diagnosis",
    IntentLabel.MEDIA_SPEC: "media_spec_confirmation",
    IntentLabel.ACTION_PLAN: "human_task_action_plan",
    IntentLabel.GENERAL_ADVICE: "general_ad_ops_guidance",
}

_METRICS_CONTEXT_FIELDS = (
    "workspaceProfile",
    "selectedAdAccount",
    "dateRange",
    "campaignAdGroupMetricsSummary",
    "anomalies",
    "recentRecommendations",
    "recentTasks",
    "operatorFeedbackSummary",
)

_LIGHT_CONTEXT_FIELDS = (
    "workspaceProfile",
    "selectedAdAccount",
    "recentRecommendations",
    "recentTasks",
    "operatorFeedbackSummary",
)

_ENTRY_AGENT_BY_MODE = {
    "beginner": "setup_advisor_beginner",
    "experienced": "performance_analyst_experienced",
}

_MODE_CONTRACT_BY_MODE = {
    "beginner": (
        "初心者向け。専門用語をほどき、見る順番、判断軸、確認場所を短いステップで説明する。"
        "数値分析が必要な場合も、まず意味と注意点を説明してから結論を出す。"
    ),
    "experienced": (
        "実務者向け。KPI分解、仮説、優先順位、承認付きwrite候補、戻し条件を簡潔に深掘りする。"
        "基礎用語の説明は最小限にし、判断材料と次アクションを優先する。"
    ),
}


def build_route_plan(message: str, advisor_mode: str = "beginner") -> RoutePlan:
    classification = classify_intent(message)
    return route_plan_from_intent(classification, advisor_mode)


def route_plan_from_intent(classification: IntentClassification, advisor_mode: str = "beginner") -> RoutePlan:
    normalized_mode = "experienced" if advisor_mode == "experienced" else "beginner"
    context_contract = _METRICS_CONTEXT_FIELDS if classification.requires_metrics_context else _LIGHT_CONTEXT_FIELDS
    return RoutePlan(
        route=classification.intent,
        advisor_mode=normalized_mode,
        entry_agent=_ENTRY_AGENT_BY_MODE[normalized_mode],
        requires_metrics_context=classification.requires_metrics_context,
        prefers_short_response=classification.prefers_short_response,
        target_agents=_AGENTS_BY_INTENT[classification.intent],
        runtime_agents=_RUNTIME_AGENTS_BY_INTENT[classification.intent],
        response_contract=_CONTRACT_BY_INTENT[classification.intent],
        mode_contract=_MODE_CONTRACT_BY_MODE[normalized_mode],
        context_contract=context_contract,
    )
