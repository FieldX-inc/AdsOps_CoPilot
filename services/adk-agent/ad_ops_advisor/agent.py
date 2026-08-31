from __future__ import annotations

try:
    from google.adk.agents import Agent
except ImportError:  # pragma: no cover - allows repository inspection before deps are installed
    Agent = None  # type: ignore[assignment]

from .sub_agents import SUB_AGENTS
from .instructions import ROOT_INSTRUCTION
from .tools.ad_account_tools import list_ad_accounts
from .tools.human_task_tools import create_human_task
from .tools.memory_tools import read_user_memory, write_user_memory
from .tools.metrics_tools import fetch_campaign_metrics, compare_period_metrics
from .tools.search_tools import google_search_latest_knowledge

if Agent is not None:
    root_agent = Agent(
        name="ad_ops_advisor",
        model="gemini-2.0-flash",
        description="read-only分析と人間向け作業手順を提供するAI広告コンサルタント。",
        instruction=ROOT_INSTRUCTION,
        tools=[
            list_ad_accounts,
            fetch_campaign_metrics,
            compare_period_metrics,
            read_user_memory,
            write_user_memory,
            google_search_latest_knowledge,
            create_human_task,
        ],
        sub_agents=SUB_AGENTS,
    )
else:
    root_agent = None
