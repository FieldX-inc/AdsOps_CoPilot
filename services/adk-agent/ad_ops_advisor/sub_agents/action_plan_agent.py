from __future__ import annotations

from pathlib import Path

try:
    from google.adk.agents import Agent
except ImportError:  # pragma: no cover
    Agent = None  # type: ignore[assignment]

from ..tools.human_task_tools import create_human_task


def _prompt(name: str) -> str:
    return (Path(__file__).resolve().parents[1] / "prompts" / name).read_text(encoding="utf-8")


ACTION_PLAN_INSTRUCTION = f"""
{_prompt("action_plan.md")}

守ること:
- 提案は必ず人間が媒体管理画面で確認・実行する手順に変換する
- 変更候補、実施前チェック、戻し条件、観察指標を分けて書く
- human taskを作る場合も、AIが媒体設定を実行したとは扱わない
- 予算変更、入札変更、キャンペーン停止、広告作成のtoolを仮定しない
"""


if Agent is not None:
    action_plan_agent = Agent(
        name="action_plan_agent",
        model="gemini-2.0-flash",
        description="分析結果を人間向け作業手順、実施前チェック、リスク、観察計画、human task案へ変換する。",
        instruction=ACTION_PLAN_INSTRUCTION,
        tools=[create_human_task],
    )
else:
    action_plan_agent = None
