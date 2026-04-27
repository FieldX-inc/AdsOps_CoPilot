from __future__ import annotations

from unittest.mock import patch

from ad_ops_advisor.chat_runtime import handle_chat
from ad_ops_advisor.gemini_runtime import GeminiRuntimeError


class FakeRepository:
    def __init__(self) -> None:
        self.appended_messages: list[tuple] = []
        self.tool_calls: list[tuple] = []
        self.compare_call: tuple | None = None

    def append_agent_message(
        self,
        workspace_id: str,
        thread_id: str,
        role: str,
        content: str,
        user_id: str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        self.appended_messages.append((workspace_id, thread_id, role, content, user_id, metadata))
        return {"id": f"message-{len(self.appended_messages)}", "role": role}

    def record_tool_call(
        self,
        workspace_id: str,
        user_id: str | None,
        thread_id: str | None,
        tool_name: str,
        status: str,
        input_summary: dict | None = None,
        output_summary: dict | None = None,
        error_message: str | None = None,
    ) -> dict:
        self.tool_calls.append(
            (workspace_id, user_id, thread_id, tool_name, status, input_summary, output_summary, error_message)
        )
        return {"id": f"tool-call-{len(self.tool_calls)}", "status": status}

    def list_ad_accounts(self, workspace_id: str) -> list[dict]:
        return [
            {
                "id": "account-from-repository",
                "platform": "google",
                "name": "Google Ads",
                "status": "active",
                "currency": "JPY",
                "timezone": "Asia/Tokyo",
            }
        ]

    def compare_period_metrics(
        self,
        workspace_id: str,
        ad_account_id: str,
        current_range: str,
        comparison_range: str,
    ) -> dict:
        self.compare_call = (workspace_id, ad_account_id, current_range, comparison_range)
        return {
            "current": {
                "date_range": current_range,
                "totals": {
                    "impressions": 1000,
                    "clicks": 100,
                    "cost": 12000,
                    "conversions": 4,
                    "revenue": 40000,
                    "ctr": 0.1,
                    "cvr": 0.04,
                    "cpc": 120,
                    "cpa": 3000,
                    "roas": 3.33,
                },
                "campaigns": [
                    {
                        "campaign_name": "Brand Search",
                        "impressions": 1000,
                        "clicks": 100,
                        "cost": 12000,
                        "conversions": 4,
                        "revenue": 40000,
                        "cpa": 3000,
                    }
                ],
            },
            "comparison": {
                "date_range": comparison_range,
                "totals": {
                    "impressions": 900,
                    "clicks": 120,
                    "cost": 9000,
                    "conversions": 6,
                    "revenue": 54000,
                    "ctr": 0.133,
                    "cvr": 0.05,
                    "cpc": 75,
                    "cpa": 1500,
                    "roas": 6.0,
                },
                "campaigns": [],
            },
            "changes": {
                "impressions": 0.11,
                "clicks": -0.16,
                "cost": 0.33,
                "conversions": -0.33,
                "revenue": -0.25,
                "ctr": -0.25,
                "cvr": -0.2,
                "cpc": 0.6,
                "cpa": 1.0,
                "roas": -0.44,
            },
        }


def test_handle_chat_db_backed_route_uses_scoped_context_and_selected_account() -> None:
    repository = FakeRepository()

    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.is_gemini_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.get_repository", return_value=repository),
    ):
        result = handle_chat(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "adAccountId": "selected-account",
                "dateRange": "last_30_days",
                "message": "CPAが悪化している理由を教えて",
            }
        )

    assert result["message"]["role"] == "assistant"
    assert "Brand Search" in result["message"]["content"]
    assert repository.compare_call == ("workspace-1", "selected-account", "last_30_days", "previous_7_days")
    assert repository.appended_messages[0][:5] == (
        "workspace-1",
        "thread-1",
        "user",
        "CPAが悪化している理由を教えて",
        "user-1",
    )
    assert repository.appended_messages[-1][2] == "assistant"
    assert repository.appended_messages[-1][5] == {"mode": "db_backed_fallback"}
    assert [(call[3], call[4]) for call in repository.tool_calls] == [
        ("list_ad_accounts", "started"),
        ("list_ad_accounts", "succeeded"),
        ("compare_period_metrics", "started"),
        ("compare_period_metrics", "succeeded"),
    ]


def test_handle_chat_write_intent_short_circuits_before_database_routing() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.get_repository", side_effect=AssertionError("database should not be used")),
    ):
        result = handle_chat(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "CPAが悪いキャンペーンの予算を下げて",
            }
        )

    assert result["policy"] == {"name": "no_media_write", "enforced": True}
    assert "直接変更・停止・作成することはできません" in result["message"]["content"]


def test_handle_chat_uses_adk_gemini_runtime_without_database_when_configured() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.is_gemini_configured", return_value=True),
        patch(
            "ad_ops_advisor.chat_runtime.generate_advisor_response",
            return_value={
                "message": {"role": "assistant", "content": "結論:\nADK/Geminiからの回答です。"},
                "mode": "adk_gemini",
            },
        ) as generate,
    ):
        result = handle_chat(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "CPAが悪化している理由を教えて",
            }
        )

    assert result["mode"] == "adk_gemini"
    assert "ADK/Gemini" in result["message"]["content"]
    generate.assert_called_once()


def test_handle_chat_falls_back_to_mock_when_adk_gemini_runtime_fails() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.is_gemini_configured", return_value=True),
        patch(
            "ad_ops_advisor.chat_runtime.generate_advisor_response",
            side_effect=GeminiRuntimeError("ADK/Gemini request failed"),
        ),
    ):
        result = handle_chat(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "CPAが悪化している理由を教えて",
            }
        )

    assert result["mode"] == "mock_fallback"
    assert "結論:" in result["message"]["content"]


def test_handle_chat_records_adk_gemini_mode_for_db_backed_response() -> None:
    repository = FakeRepository()

    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.is_gemini_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.get_repository", return_value=repository),
        patch(
            "ad_ops_advisor.chat_runtime.generate_advisor_response",
            return_value={
                "message": {"role": "assistant", "content": "結論:\nDB文脈つきADK/Gemini回答です。"},
                "mode": "adk_gemini",
            },
        ),
    ):
        result = handle_chat(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "CPAが悪化している理由を教えて",
            }
        )

    assert result["mode"] == "adk_gemini"
    assert repository.appended_messages[-1][5] == {"mode": "adk_gemini"}
