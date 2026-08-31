from __future__ import annotations

from unittest.mock import patch

from ad_ops_advisor import tool_audit
from ad_ops_advisor.policies.memory_policy import memory_rejection_reason
from ad_ops_advisor.policies.no_write_policy import contains_secret, has_platform_write_intent, is_forbidden_tool_name
from ad_ops_advisor.tools import human_task_tools, memory_tools


class FakeRepository:
    def __init__(self) -> None:
        self.memory_call = None
        self.task_call = None
        self.tool_calls = []

    def record_tool_call(self, *args, **kwargs) -> None:
        self.tool_calls.append((args, kwargs))

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
        patch.object(tool_audit, "is_database_configured", return_value=True),
        patch.object(tool_audit, "get_repository", return_value=repository),
        patch.object(memory_tools, "is_database_configured", return_value=True),
        patch.object(memory_tools, "get_repository", return_value=repository),
    ):
        result = memory_tools.write_user_memory("workspace-1", "user-1", "preference", "週次で確認したい")

    assert result["status"] == "persisted"
    assert repository.memory_call == ("workspace-1", "user-1", "preference", "週次で確認したい")


def test_write_user_memory_rejects_secret_like_content_before_repository() -> None:
    with (
        patch.object(tool_audit, "is_database_configured", return_value=False),
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


def test_write_user_memory_rejects_transient_kpi_before_repository() -> None:
    with (
        patch.object(tool_audit, "is_database_configured", return_value=False),
        patch.object(memory_tools, "is_database_configured", return_value=True),
        patch.object(memory_tools, "get_repository", side_effect=AssertionError("repository should not be used")),
    ):
        result = memory_tools.write_user_memory(
            "workspace-1",
            "user-1",
            "business_context",
            "今週のCPAは12,000円でCVRは2.4%",
        )

    assert result["status"] == "rejected"
    assert "temporary" in result["error"] or "transient KPI" in result["error"]


def test_write_user_memory_rejects_personal_contact_information_before_repository() -> None:
    with (
        patch.object(tool_audit, "is_database_configured", return_value=False),
        patch.object(memory_tools, "is_database_configured", return_value=True),
        patch.object(memory_tools, "get_repository", side_effect=AssertionError("repository should not be used")),
    ):
        result = memory_tools.write_user_memory(
            "workspace-1",
            "user-1",
            "business_context",
            "担当者の連絡先は sales@example.com",
        )

    assert result["status"] == "rejected"
    assert "personal contact information" in result["error"]
    assert "sales@example.com" not in str(result)


def test_memory_policy_accepts_stable_preferences_and_rejects_unknown_types() -> None:
    assert memory_rejection_reason("preference", "毎週月曜日に確認順を短く出してほしい") is None
    assert memory_rejection_reason("kpi_snapshot", "CPAは12,000円") == "memory type is not an allowed stable category"


def test_create_human_task_uses_workspace_user_scope() -> None:
    repository = FakeRepository()

    with (
        patch.object(tool_audit, "is_database_configured", return_value=True),
        patch.object(tool_audit, "get_repository", return_value=repository),
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
    assert is_forbidden_tool_name("create_campaign")
    assert is_forbidden_tool_name("google_campaign_creation")
    assert has_platform_write_intent("CPAが悪いキャンペーンを停止して")
    assert has_platform_write_intent("新しい広告を入稿して")
    assert has_platform_write_intent("Please change the budget to 10000")
    assert not has_platform_write_intent("CPAが悪い理由を分析して")


def test_secret_policy_detects_labeled_and_bare_secret_values_in_payloads() -> None:
    assert contains_secret("api_key=sk-test-dummy-not-a-real-secret")
    assert contains_secret("このキーで分析して sk-test-dummy-not-a-real-secret")
    assert contains_secret({"context": {"refresh_token": "raw-refresh-token-value"}})
    assert not contains_secret({"workspaceId": "workspace-1", "message": "CPAが悪い理由を分析して"})
