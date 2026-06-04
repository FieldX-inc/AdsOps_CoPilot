from __future__ import annotations

from pathlib import Path

try:
    from google.adk.agents import Agent
except ImportError:  # pragma: no cover
    Agent = None  # type: ignore[assignment]


def _prompt(name: str) -> str:
    return (Path(__file__).resolve().parents[1] / "prompts" / name).read_text(encoding="utf-8")


SETUP_INTAKE_INSTRUCTION = _prompt("setup_intake.md")


if Agent is not None:
    setup_intake_agent = Agent(
        name="setup_intake_agent",
        model="gemini-2.0-flash",
        description="広告開始前の準備情報を深掘りし、準備スコアと出稿前ステップを構造化する。",
        instruction=SETUP_INTAKE_INSTRUCTION,
        tools=[],
    )
else:
    setup_intake_agent = None
