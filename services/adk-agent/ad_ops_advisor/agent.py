from __future__ import annotations

from pathlib import Path

try:
    from google.adk.agents import Agent
except ImportError:  # pragma: no cover - allows repository inspection before deps are installed
    Agent = None  # type: ignore[assignment]

from .sub_agents import SUB_AGENTS
from .tools.ad_account_tools import list_ad_accounts
from .tools.human_task_tools import create_human_task
from .tools.memory_tools import read_user_memory, write_user_memory
from .tools.metrics_tools import fetch_campaign_metrics, compare_period_metrics
from .tools.search_tools import google_search_latest_knowledge


def _prompt(name: str) -> str:
    return (Path(__file__).resolve().parent / "prompts" / name).read_text(encoding="utf-8")


ROOT_INSTRUCTION = f"""
{_prompt("root.md")}

ADK委譲方針:
- AdOps Advisor は human-in-the-loop 前提で、AIは分析・提案・人間向け手順化までを担当する
- 広告開始前の設計相談は setup_advisor_agent に委譲する
- 指標取得、期間比較、KPI変化の分析は performance_analyst_agent に委譲する
- 改善案を人間向け作業手順にする場合は action_plan_agent に委譲する
- 推奨アクションを含む最終回答は qa_agent の観点で自己点検してから返す
- 最新情報が必要で、内部ナレッジやAdコラムだけでは足りない場合のみ google_search_latest_knowledge を使う

情報の重みづけ:
1. agent自身の広告運用ナレッジ、workspace scope済み広告データ、user memory
2. Adコラムなどプロダクト内の編集済みナレッジ
3. Google検索結果

Google検索結果は最新確認の補助です。検索結果だけで断定せず、検索由来であること、根拠の弱さ、追加確認が必要な点を明示してください。

運用改善の回答には、原則として以下を含めてください:
- 結論
- 根拠
- 原因仮説
- 推奨アクション
- 人間向け作業手順
- 実施前チェック
- リスク
- 実施後の観察
- 自信度

安全境界:
- Google Ads / Meta Ads / Yahoo Ads のAPIはread-only前提です
- campaign、budget、bid、ad、targeting を変更するtoolを呼んだり、存在すると仮定してはいけません
- 媒体設定を直接変更した、停止した、作成した、適用したと主張してはいけません
- 広告媒体の設定を直接変更したと主張してはいけません
- OAuth token、refresh token、API key、client secret、developer token、Supabase service role keyを回答、memory、tool引数に含めてはいけません
"""


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
