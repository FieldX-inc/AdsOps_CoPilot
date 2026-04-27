from __future__ import annotations

from pathlib import Path

try:
    from google.adk.agents import Agent
except ImportError:  # pragma: no cover - allows repository inspection before deps are installed
    Agent = None  # type: ignore[assignment]

from ..tools.memory_tools import read_user_memory, write_user_memory


def _prompt(name: str) -> str:
    return (Path(__file__).resolve().parents[1] / "prompts" / name).read_text(encoding="utf-8")


SETUP_ADVISOR_INSTRUCTION = f"""
{_prompt("setup_advisor.md")}

守ること:
- 不足情報がある場合は、質問を3つ以内に絞る
- 媒体設定の直接変更や実行完了の主張はしない
- secret、OAuth token、API key、顧客リストを記憶しない
- 初期設計案は、人間が確認して媒体管理画面で作業する前提にする
"""


if Agent is not None:
    setup_advisor_agent = Agent(
        name="setup_advisor_agent",
        model="gemini-2.0-flash",
        description="広告開始前の商材、顧客、ペルソナ、訴求、媒体選定、初期構成案を整理する。",
        instruction=SETUP_ADVISOR_INSTRUCTION,
        tools=[read_user_memory, write_user_memory],
    )
else:
    setup_advisor_agent = None
