from __future__ import annotations

from unittest.mock import patch

from ad_ops_advisor.policies.no_write_policy import has_platform_write_intent, is_forbidden_tool_name
from ad_ops_advisor.tools import human_task_tools, memory_tools


class FakeRepository:
    def __init__(self) -> None:
        self.memory_call = None
        self.task_call = None

    def write_user_memory(self, workspace_id: str, user_id: str, memory_type: str, content: str) -> dict:
        self.memory_call = (workspace_id, user_id, memory_type, content)
        return {"id": "memory-1", "memory_type": memory_type, "content": content}

    def create_human_task(
        self,
        workspace_id: str,
        user_id: str,
        title: str,
        description: str,
        priority: str = "medium",
        recommendation_id: str | None = None,
        ad_account_id: str | None = None,
    ) -> dict:
        self.task_call = (
            workspace_id,
            user_id,
            title,
            description,
            priority,
            recommendation_id,
            ad_account_id,
        )
        return {"id": "task-1", "title": title, "priority": priority}


def test_write_user_memory_uses_workspace_user_scope() -> None:
    repository = FakeRepository()

    with (
        patch.object(memory_tools, "is_database_configured", return_value=True),
        patch.object(memory_tools, "get_repository", return_value=repository),
    ):
        result = memory_tools.write_user_memory("workspace-1", "user-1", "preference", "週次で確認したい")

    assert result["status"] == "persisted"
    assert repository.memory_call == ("workspace-1", "user-1", "preference", "週次で確認したい")


def test_write_user_memory_rejects_secret_like_content_before_repository() -> None:
    with (
        patch.object(memory_tools, "is_database_configured", return_value=True),
        patch.object(memory_tools, "get_repository", side_effect=AssertionError("repository should not be used")),
    ):
        result = memory_tools.write_user_memory(
            "workspace-1",
            "user-1",
            "preference",
            "refresh_token=should-not-be-stored",
        )

    assert result["status"] == "rejected"
    assert "refresh_token=should-not-be-stored" not in str(result)


def test_create_human_task_uses_workspace_user_scope() -> None:
    repository = FakeRepository()

    with (
        patch.object(human_task_tools, "is_database_configured", return_value=True),
        patch.object(human_task_tools, "get_repository", return_value=repository),
    ):
        result = human_task_tools.create_human_task(
            "workspace-1",
            "user-1",
            "CPA悪化を確認する",
            "管理画面でCPA/CVR/CPCを確認する",
            "high",
            "recommendation-1",
            "account-1",
        )

    assert result["status"] == "persisted"
    assert repository.task_call == (
        "workspace-1",
        "user-1",
        "CPA悪化を確認する",
        "管理画面でCPA/CVR/CPCを確認する",
        "high",
        "recommendation-1",
        "account-1",
    )


def test_no_write_policy_detects_forbidden_tools_and_messages() -> None:
    assert is_forbidden_tool_name("update_campaign_budget")
    assert is_forbidden_tool_name("pause_campaign")
    assert has_platform_write_intent("CPAが悪いキャンペーンを停止して")
    assert has_platform_write_intent("Please change the budget to 10000")
    assert not has_platform_write_intent("CPAが悪い理由を分析して")
