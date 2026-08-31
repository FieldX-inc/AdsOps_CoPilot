from __future__ import annotations

from ..policies.memory_policy import memory_rejection_reason
from ..repositories import RepositoryError, get_repository, is_database_configured
from ..tool_audit import audited_tool


@audited_tool
def read_user_memory(workspace_id: str, user_id: str) -> dict:
    """Read long-term memory for a user within a workspace."""
    if is_database_configured():
        try:
            return {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "memories": get_repository().read_user_memory(workspace_id, user_id),
            }
        except RepositoryError as exc:
            return {"workspace_id": workspace_id, "user_id": user_id, "memories": [], "error": str(exc)}

    return {
        "workspace_id": workspace_id,
        "user_id": user_id,
        "memories": [],
        "note": "No memory repository is implemented yet.",
    }


@audited_tool
def write_user_memory(workspace_id: str, user_id: str, memory_type: str, content: str) -> dict:
    """Store a non-secret user memory.

    Implementations must reject secrets, tokens, and raw customer lists.
    """
    rejection_reason = memory_rejection_reason(memory_type, content)
    if rejection_reason:
        return {
            "workspace_id": workspace_id,
            "user_id": user_id,
            "memory_type": memory_type,
            "status": "rejected",
            "error": rejection_reason,
        }

    if is_database_configured():
        try:
            memory = get_repository().write_user_memory(workspace_id, user_id, memory_type, content)
            return {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "memory": memory,
                "status": "persisted",
            }
        except RepositoryError as exc:
            return {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "memory_type": memory_type,
                "status": "failed",
                "error": str(exc),
            }

    return {
        "workspace_id": workspace_id,
        "user_id": user_id,
        "memory_type": memory_type,
        "content": content,
        "status": "not_persisted",
        "note": "No memory repository is implemented yet.",
    }
