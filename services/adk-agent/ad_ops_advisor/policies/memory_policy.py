from __future__ import annotations

import re

from .no_write_policy import looks_secret


ALLOWED_MEMORY_TYPES = frozenset(
    {
        "preference",
        "communication_preference",
        "business_context",
        "ongoing_policy",
    }
)

_EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?81[-\s]?)?0?\d{1,4}[-\s]\d{1,4}[-\s]\d{3,4}(?!\d)")
_DATE_PATTERN = re.compile(r"\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b")
_KPI_SNAPSHOT_PATTERN = re.compile(
    r"(?i)(?:CPA|CVR|CTR|CPC|ROAS|CV数|コンバージョン数|広告費|費用|売上)"
    r"[^\n]{0,24}(?:\d[\d,.]*\s*(?:%|円|件)?|[+-▲▼]\s*\d)"
)
_TRANSIENT_MARKERS = (
    "今日",
    "昨日",
    "今週",
    "先週",
    "今月",
    "先月",
    "直近",
    "今回だけ",
    "一時的",
    "現在の数値",
)
_STABLE_POLICY_MARKERS = (
    "基準",
    "上限",
    "下限",
    "目標",
    "超えたら",
    "下回ったら",
    "今後も",
    "継続的",
)
_CUSTOMER_LIST_MARKERS = (
    "顧客一覧",
    "顧客リスト",
    "取引先一覧",
    "連絡先一覧",
    "customer list",
)


def memory_rejection_reason(memory_type: str, content: str) -> str | None:
    """Return a safe rejection reason when content is not durable memory."""
    normalized_type = str(memory_type or "").strip().lower()
    normalized_content = str(content or "").strip()

    if normalized_type not in ALLOWED_MEMORY_TYPES:
        return "memory type is not an allowed stable category"
    if not normalized_content:
        return "memory content must not be empty"
    if looks_secret(normalized_content):
        return "memory content must not contain secrets"
    if _EMAIL_PATTERN.search(normalized_content) or _PHONE_PATTERN.search(normalized_content):
        return "memory content must not contain personal contact information"
    if any(marker in normalized_content.lower() for marker in _CUSTOMER_LIST_MARKERS):
        return "memory content must not contain customer lists"

    has_stable_policy = normalized_type == "ongoing_policy" and any(
        marker in normalized_content for marker in _STABLE_POLICY_MARKERS
    )
    if _DATE_PATTERN.search(normalized_content) and not has_stable_policy:
        return "memory content must not contain a temporary dated snapshot"
    if any(marker in normalized_content for marker in _TRANSIENT_MARKERS) and not has_stable_policy:
        return "memory content must not contain temporary context"
    if _KPI_SNAPSHOT_PATTERN.search(normalized_content) and not has_stable_policy:
        return "memory content must not contain a transient KPI snapshot"
    return None
