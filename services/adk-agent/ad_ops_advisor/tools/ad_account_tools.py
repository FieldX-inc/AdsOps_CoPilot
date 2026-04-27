from __future__ import annotations

from ..repositories import RepositoryError, get_repository, is_database_configured
from ..tool_audit import audited_tool


@audited_tool
def list_ad_accounts(workspace_id: str) -> dict:
    """List connected ad accounts for a workspace.

    Returns scoped account metadata only. OAuth tokens and raw connection
    payloads are never returned to the agent.
    """
    if is_database_configured():
        try:
            return {
                "workspace_id": workspace_id,
                "accounts": get_repository().list_ad_accounts(workspace_id),
            }
        except RepositoryError as exc:
            return {"workspace_id": workspace_id, "accounts": [], "error": str(exc)}

    return {
        "workspace_id": workspace_id,
        "accounts": [],
        "note": "No ad account repository is implemented yet.",
    }
