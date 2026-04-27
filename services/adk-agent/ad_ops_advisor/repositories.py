from __future__ import annotations

import os
import re
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from typing import Any, Iterator

from .policies.no_write_policy import looks_secret

try:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
except ImportError:  # pragma: no cover - optional until DB deps are installed
    psycopg = None  # type: ignore[assignment]
    dict_row = None  # type: ignore[assignment]
    Jsonb = None  # type: ignore[assignment]


class RepositoryError(RuntimeError):
    """Raised when repository operations cannot be completed."""


class ScopeError(RepositoryError):
    """Raised when a requested workspace/user scope is invalid."""


def require_scope(workspace_id: str, user_id: str | None = None) -> None:
    if not str(workspace_id or "").strip():
        raise ScopeError("workspace_id is required")
    if user_id is not None and not str(user_id or "").strip():
        raise ScopeError("user_id is required")


def database_url() -> str | None:
    return (
        os.environ.get("ADOPS_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
        or os.environ.get("SUPABASE_DB_URL")
    )


def is_database_configured() -> bool:
    return bool(database_url()) and psycopg is not None


@contextmanager
def get_connection() -> Iterator[Any]:
    url = database_url()
    if not url:
        raise RepositoryError("Database URL is not configured")
    if psycopg is None:
        raise RepositoryError("psycopg is not installed")

    with psycopg.connect(url, row_factory=dict_row) as connection:
        yield connection


def _rate(numerator: float | int | None, denominator: float | int | None) -> float | None:
    if numerator is None or denominator in (None, 0):
        return None
    return float(numerator) / float(denominator)


def _date_range(date_range: str) -> tuple[date, date]:
    today = date.today()
    match = re.fullmatch(r"last_(\d+)_days", date_range or "")
    if match:
        days = max(int(match.group(1)), 1)
        return today - timedelta(days=days), today - timedelta(days=1)

    if date_range == "previous_7_days":
        return today - timedelta(days=14), today - timedelta(days=8)

    if ".." in (date_range or ""):
        start_raw, end_raw = date_range.split("..", 1)
        return date.fromisoformat(start_raw), date.fromisoformat(end_raw)

    return today - timedelta(days=7), today - timedelta(days=1)


def _with_kpis(row: dict[str, Any]) -> dict[str, Any]:
    impressions = row.get("impressions") or 0
    clicks = row.get("clicks") or 0
    cost = row.get("cost") or 0
    conversions = row.get("conversions") or 0
    revenue = row.get("revenue") or 0

    return {
        **row,
        "ctr": _rate(clicks, impressions),
        "cvr": _rate(conversions, clicks),
        "cpc": _rate(cost, clicks),
        "cpa": _rate(cost, conversions),
        "roas": _rate(revenue, cost),
    }


def _change(current: float | int | None, comparison: float | int | None) -> float | None:
    if current is None or comparison in (None, 0):
        return None
    return float(current) / float(comparison) - 1


class PostgresRepository:
    def list_ad_accounts(self, workspace_id: str) -> list[dict[str, Any]]:
        require_scope(workspace_id)
        sql = """
            select id, platform, external_account_id, name, currency, timezone, status
            from ad_accounts
            where workspace_id = %s
            order by platform, name
        """
        with get_connection() as connection:
            return _json_safe(list(connection.execute(sql, (workspace_id,)).fetchall()))

    def fetch_campaign_metrics(
        self,
        workspace_id: str,
        ad_account_id: str,
        date_range: str,
    ) -> dict[str, Any]:
        require_scope(workspace_id)
        start_date, end_date = _date_range(date_range)
        sql = """
            select
              coalesce(external_campaign_id, '') as external_campaign_id,
              coalesce(campaign_name, 'Account total') as campaign_name,
              sum(impressions)::float as impressions,
              sum(clicks)::float as clicks,
              sum(cost)::float as cost,
              sum(conversions)::float as conversions,
              sum(revenue)::float as revenue
            from ad_daily_metrics
            where workspace_id = %s
              and ad_account_id = %s
              and date between %s and %s
            group by external_campaign_id, campaign_name
            order by cost desc
        """
        with get_connection() as connection:
            rows = list(
                connection.execute(
                    sql,
                    (workspace_id, ad_account_id, start_date, end_date),
                ).fetchall()
            )

        campaigns = [_with_kpis(dict(row)) for row in rows]
        totals = _with_kpis(
            {
                "impressions": sum(row["impressions"] or 0 for row in campaigns),
                "clicks": sum(row["clicks"] or 0 for row in campaigns),
                "cost": sum(row["cost"] or 0 for row in campaigns),
                "conversions": sum(row["conversions"] or 0 for row in campaigns),
                "revenue": sum(row["revenue"] or 0 for row in campaigns),
            }
        )
        return _json_safe({
            "workspace_id": workspace_id,
            "ad_account_id": ad_account_id,
            "date_range": date_range,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "totals": totals,
            "campaigns": campaigns,
        })

    def compare_period_metrics(
        self,
        workspace_id: str,
        ad_account_id: str,
        current_range: str,
        comparison_range: str,
    ) -> dict[str, Any]:
        current = self.fetch_campaign_metrics(workspace_id, ad_account_id, current_range)
        comparison = self.fetch_campaign_metrics(workspace_id, ad_account_id, comparison_range)
        current_totals = current["totals"]
        comparison_totals = comparison["totals"]
        fields = ("impressions", "clicks", "cost", "conversions", "revenue", "ctr", "cvr", "cpc", "cpa", "roas")

        return {
            "workspace_id": workspace_id,
            "ad_account_id": ad_account_id,
            "current_range": current_range,
            "comparison_range": comparison_range,
            "current": current,
            "comparison": comparison,
            "changes": {
                field: _change(current_totals.get(field), comparison_totals.get(field))
                for field in fields
            },
        }

    def read_user_memory(self, workspace_id: str, user_id: str) -> list[dict[str, Any]]:
        require_scope(workspace_id, user_id)
        sql = """
            select id, memory_type, content, confidence, created_at, updated_at
            from user_memories
            where workspace_id = %s and user_id = %s
            order by updated_at desc
            limit 20
        """
        with get_connection() as connection:
            return _json_safe(list(connection.execute(sql, (workspace_id, user_id)).fetchall()))

    def write_user_memory(
        self,
        workspace_id: str,
        user_id: str,
        memory_type: str,
        content: str,
    ) -> dict[str, Any]:
        require_scope(workspace_id, user_id)
        if _looks_secret(content):
            raise RepositoryError("memory content must not contain secrets")
        sql = """
            insert into user_memories (workspace_id, user_id, memory_type, content)
            values (%s, %s, %s, %s)
            returning id, memory_type, content, confidence, created_at
        """
        with get_connection() as connection:
            row = connection.execute(sql, (workspace_id, user_id, memory_type, content)).fetchone()
            connection.commit()
            return _json_safe(dict(row))

    def create_human_task(
        self,
        workspace_id: str,
        user_id: str,
        title: str,
        description: str,
        priority: str = "medium",
        recommendation_id: str | None = None,
        ad_account_id: str | None = None,
    ) -> dict[str, Any]:
        require_scope(workspace_id, user_id)
        sql = """
            insert into human_tasks (
              workspace_id, user_id, ad_account_id, recommendation_id,
              title, description, priority
            )
            values (%s, %s, %s, %s, %s, %s, %s)
            returning id, title, description, priority, status, created_at
        """
        with get_connection() as connection:
            row = connection.execute(
                sql,
                (workspace_id, user_id, ad_account_id, recommendation_id, title, description, priority),
            ).fetchone()
            connection.commit()
            return _json_safe(dict(row))

    def append_agent_message(
        self,
        workspace_id: str,
        thread_id: str,
        role: str,
        content: str,
        user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        require_scope(workspace_id)
        sql = """
            insert into agent_messages (workspace_id, thread_id, user_id, role, content, metadata)
            values (%s, %s, %s, %s, %s, %s)
            returning id, role, created_at
        """
        with get_connection() as connection:
            row = connection.execute(
                sql,
                (workspace_id, thread_id, user_id, role, content, Jsonb(metadata or {})),
            ).fetchone()
            connection.commit()
            return _json_safe(dict(row))

    def record_tool_call(
        self,
        workspace_id: str,
        user_id: str | None,
        thread_id: str | None,
        tool_name: str,
        status: str,
        input_summary: dict[str, Any] | None = None,
        output_summary: dict[str, Any] | None = None,
        error_message: str | None = None,
    ) -> dict[str, Any]:
        require_scope(workspace_id)
        sql = """
            insert into agent_tool_calls (
              workspace_id, user_id, thread_id, tool_name, input_summary,
              output_summary, status, error_message
            )
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            returning id, status, created_at
        """
        with get_connection() as connection:
            row = connection.execute(
                sql,
                (
                    workspace_id,
                    user_id,
                    thread_id,
                    tool_name,
                    Jsonb(_sanitize(input_summary or {})),
                    Jsonb(_sanitize(output_summary or {})),
                    status,
                    error_message,
                ),
            ).fetchone()
            connection.commit()
            return _json_safe(dict(row))


def get_repository() -> PostgresRepository:
    return PostgresRepository()


def _looks_secret(value: str) -> bool:
    return looks_secret(value)


def _sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _sanitize(item)
            for key, item in value.items()
            if not _is_secret_key(key)
        }
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if isinstance(value, str) and looks_secret(value):
        return "[REDACTED]"
    return value


def _is_secret_key(key: str) -> bool:
    lowered = key.lower()
    return any(marker in lowered for marker in ("token", "secret", "password", "api_key", "service_role"))


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value
