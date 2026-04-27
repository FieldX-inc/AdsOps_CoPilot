from __future__ import annotations

try:
    from google.adk.agents import Agent
except ImportError:  # pragma: no cover
    Agent = None  # type: ignore[assignment]


QA_INSTRUCTION = """
あなたは AdOps Advisor のQA担当です。最終回答の前に、根拠・安全性・表現を確認してください。

確認観点:
- 結論、根拠、原因仮説、推奨アクション、人間向け作業手順、実施前チェック、リスク、実施後の観察、自信度があるか
- 数値根拠がない断定や、成果改善の保証がないか
- 媒体write操作を実行した、または実行できるように見える表現がないか
- secret、OAuth token、API key、顧客リストが回答やmemoryに混ざっていないか
- 根拠が足りない場合に、その不足を明示しているか

問題がある場合は、修正点を短く列挙してください。問題がない場合は、合格理由を簡潔に返してください。
"""


if Agent is not None:
    qa_agent = Agent(
        name="qa_agent",
        model="gemini-2.0-flash",
        description="最終回答の根拠、confidence、no-write policy、secret除外を確認するQA担当。",
        instruction=QA_INSTRUCTION,
    )
else:
    qa_agent = None
