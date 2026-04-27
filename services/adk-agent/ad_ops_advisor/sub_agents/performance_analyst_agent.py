from __future__ import annotations

from pathlib import Path

try:
    from google.adk.agents import Agent
except ImportError:  # pragma: no cover
    Agent = None  # type: ignore[assignment]

from ..tools.ad_account_tools import list_ad_accounts
from ..tools.metrics_tools import compare_period_metrics, fetch_campaign_metrics


def _prompt(name: str) -> str:
    return (Path(__file__).resolve().parents[1] / "prompts" / name).read_text(encoding="utf-8")


PERFORMANCE_ANALYST_INSTRUCTION = f"""
{_prompt("performance_analyst.md")}

守ること:
- 必ずworkspace_idとad_account_idでscopeされたread-only toolだけを使う
- 数値根拠が不足している場合は、不足していると明示する
- CPA/CVR/CTR/CPC/ROASの変化を、可能な範囲で分解する
- 媒体設定の変更、停止、作成、入札/予算変更は実行しない
"""


if Agent is not None:
    performance_analyst_agent = Agent(
        name="performance_analyst_agent",
        model="gemini-2.0-flash",
        description="広告指標の取得、期間比較、KPI変化、CPA/CVR/CTR/CPC悪化要因の分析を担当する。",
        instruction=PERFORMANCE_ANALYST_INSTRUCTION,
        tools=[list_ad_accounts, fetch_campaign_metrics, compare_period_metrics],
    )
else:
    performance_analyst_agent = None
