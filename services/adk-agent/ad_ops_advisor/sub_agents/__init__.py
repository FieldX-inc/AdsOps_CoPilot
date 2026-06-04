from __future__ import annotations

from .action_plan_agent import action_plan_agent
from .performance_analyst_agent import performance_analyst_agent
from .qa_agent import qa_agent
from .setup_advisor_agent import setup_advisor_agent
from .setup_intake_agent import setup_intake_agent


SUB_AGENTS = [
    agent
    for agent in (
        setup_advisor_agent,
        setup_intake_agent,
        performance_analyst_agent,
        action_plan_agent,
        qa_agent,
    )
    if agent is not None
]

__all__ = [
    "SUB_AGENTS",
    "action_plan_agent",
    "performance_analyst_agent",
    "qa_agent",
    "setup_advisor_agent",
    "setup_intake_agent",
]
