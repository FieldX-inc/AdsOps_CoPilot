from __future__ import annotations

from typing import Optional

from ..repositories import RepositoryError, get_repository, is_database_configured
from ..tool_audit import audited_tool


@audited_tool
def create_human_task(
    workspace_id: str,
    user_id: str,
    title: str,
    description: str,
    priority: str = "medium",
    recommendation_id: Optional[str] = None,
    ad_account_id: Optional[str] = None,
) -> dict:
    """Create a human-executable task from an AI recommendation."""
    if is_database_configured():
        try:
            task = get_repository().create_human_task(
                workspace_id,
                user_id,
                title,
                description,
                priority,
                recommendation_id,
                ad_account_id,
            )
            return {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "task": task,
                "status": "persisted",
            }
        except RepositoryError as exc:
            return {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "title": title,
                "status": "failed",
                "error": str(exc),
            }

    return {
        "workspace_id": workspace_id,
        "user_id": user_id,
        "title": title,
        "description": description,
        "priority": priority,
        "status": "not_persisted",
        "note": "No human task repository is implemented yet.",
    }
