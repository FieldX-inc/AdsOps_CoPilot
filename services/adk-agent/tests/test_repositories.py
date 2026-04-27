from __future__ import annotations

from ad_ops_advisor import repositories


def test_kpis_do_not_divide_by_zero() -> None:
    row = repositories._with_kpis(
        {
            "impressions": 0,
            "clicks": 0,
            "cost": 0,
            "conversions": 0,
            "revenue": 0,
        }
    )

    assert row["ctr"] is None
    assert row["cvr"] is None
    assert row["cpc"] is None
    assert row["cpa"] is None
    assert row["roas"] is None


def test_sanitize_removes_secret_keys() -> None:
    value = repositories._sanitize(
        {
            "workspace_id": "workspace-1",
            "access_token_encrypted": "hidden",
            "nested": {"refresh_token": "hidden", "safe": "ok"},
            "items": [{"api_key": "hidden", "count": 1}],
        }
    )

    assert value == {
        "workspace_id": "workspace-1",
        "nested": {"safe": "ok"},
        "items": [{"count": 1}],
    }


def test_sanitize_redacts_secret_like_values() -> None:
    value = repositories._sanitize(
        {
            "workspace_id": "workspace-1",
            "note": "Bearer should-not-leak",
            "items": ["client_secret=hidden", "safe"],
        }
    )

    assert value == {
        "workspace_id": "workspace-1",
        "note": "[REDACTED]",
        "items": ["[REDACTED]", "safe"],
    }


def test_require_scope_rejects_missing_workspace() -> None:
    try:
        repositories.require_scope("")
    except repositories.ScopeError as exc:
        assert "workspace_id" in str(exc)
    else:
        raise AssertionError("ScopeError was not raised")
