from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from typing import Any

from ..policies.no_write_policy import looks_secret


def google_search_latest_knowledge(workspace_id: str, query: str, max_results: int = 5) -> dict[str, Any]:
    """Search the web for latest advertising knowledge without exposing secrets.

    This is read-only. It uses Google Custom Search JSON API only when both
    GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID are configured.
    """
    if not str(workspace_id or "").strip():
        return {"status": "error", "reason": "workspace_id is required", "results": []}
    if not str(query or "").strip():
        return {"status": "error", "reason": "query is required", "results": []}
    if looks_secret(query):
        return {"status": "error", "reason": "query appears to contain a secret", "results": []}

    api_key = os.environ.get("GOOGLE_SEARCH_API_KEY")
    engine_id = os.environ.get("GOOGLE_SEARCH_ENGINE_ID")
    if not api_key or not engine_id:
        return {
            "status": "not_configured",
            "source": "google_search",
            "weight": "lowest",
            "note": "Google検索は未設定です。回答では検索結果を根拠に使わないでください。",
            "results": [],
        }

    params = urllib.parse.urlencode(
        {
            "key": api_key,
            "cx": engine_id,
            "q": query,
            "num": min(max(int(max_results), 1), 10),
            "safe": "active",
            "lr": "lang_ja",
        }
    )
    request = urllib.request.Request(
        f"https://www.googleapis.com/customsearch/v1?{params}",
        headers={"Accept": "application/json"},
        method="GET",
    )

    with urllib.request.urlopen(request, timeout=float(os.environ.get("GOOGLE_SEARCH_TIMEOUT_SECONDS", "8"))) as response:
        data = json.loads(response.read().decode("utf-8"))

    return {
        "status": "ok",
        "source": "google_search",
        "weight": "lowest",
        "results": [
            {
                "title": item.get("title"),
                "url": item.get("link"),
                "snippet": item.get("snippet"),
                "displayLink": item.get("displayLink"),
            }
            for item in data.get("items", [])
            if item.get("link")
        ],
    }
