from __future__ import annotations

from ..repositories import RepositoryError, get_repository, is_database_configured
from ..tool_audit import audited_tool


@audited_tool
def fetch_campaign_metrics(workspace_id: str, ad_account_id: str, date_range: str = "last_7_days") -> dict:
    """Fetch campaign-level metrics.

    Reads cached platform metrics by workspace/account scope. It never returns
    OAuth tokens or write credentials. Google Ads write operations are exposed
    only through API-layer approval routes, not agent tools.
    """
    if is_database_configured():
        try:
            return get_repository().fetch_campaign_metrics(workspace_id, ad_account_id, date_range)
        except RepositoryError as exc:
            return {
                "workspace_id": workspace_id,
                "ad_account_id": ad_account_id,
                "date_range": date_range,
                "campaigns": [],
                "error": str(exc),
            }

    return {
        "workspace_id": workspace_id,
        "ad_account_id": ad_account_id,
        "date_range": date_range,
        "campaigns": [],
        "note": "No metric repository is implemented yet.",
    }


@audited_tool
def compare_period_metrics(
    workspace_id: str,
    ad_account_id: str,
    current_range: str = "last_7_days",
    comparison_range: str = "previous_7_days",
) -> dict:
    """Compare metrics across two periods."""
    if is_database_configured():
        try:
            return get_repository().compare_period_metrics(
                workspace_id,
                ad_account_id,
                current_range,
                comparison_range,
            )
        except RepositoryError as exc:
            return {
                "workspace_id": workspace_id,
                "ad_account_id": ad_account_id,
                "current_range": current_range,
                "comparison_range": comparison_range,
                "comparison": {},
                "error": str(exc),
            }

    return {
        "workspace_id": workspace_id,
        "ad_account_id": ad_account_id,
        "current_range": current_range,
        "comparison_range": comparison_range,
        "comparison": {},
        "note": "No period comparison implementation exists yet.",
    }
