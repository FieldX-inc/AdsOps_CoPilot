import re
from typing import Any

FORBIDDEN_TOOL_PREFIXES = (
    "update_",
    "pause_",
    "enable_",
    "create_ad",
    "apply_",
    "mutate_",
)

FORBIDDEN_TOOL_MARKERS = (
    "_budget",
    "_bid",
    "_campaign_status",
    "_ad_status",
    "_targeting",
)

FORBIDDEN_MESSAGE_MARKERS = (
    "budget",
    "bid",
    "campaign",
    "ad ",
    "広告",
    "広告セット",
    "広告グループ",
    "検索語句",
    "除外キーワード",
    "予算",
    "入札",
    "入札戦略",
    "キャンペーン",
    "停止",
    "オフ",
    "変更",
    "作成",
    "配信停止",
    "増額",
    "減額",
)

WRITE_INTENT_MARKERS = (
    "change",
    "update",
    "pause",
    "enable",
    "create",
    "submit",
    "apply",
    "mutate",
    "set ",
    "変更して",
    "停止して",
    "作成して",
    "入稿して",
    "適用して",
    "実行して",
    "反映して",
    "切り替えて",
    "除外して",
    "止めて",
    "止めといて",
    "オフにして",
    "上げて",
    "下げて",
    "増やして",
    "減らして",
)

SECRET_VALUE_MARKERS = (
    "access_token",
    "refresh_token",
    "api_key",
    "service_role",
    "secret=",
    "bearer ",
    "client_secret",
    "developer_token",
)

SECRET_VALUE_PATTERNS = (
    re.compile(r"\b(api[_-]?key|developer[_-]?token|client[_-]?secret)\b[^\n]{0,80}[:=]\s*['\"]?[A-Za-z0-9_\-.]{12,}", re.IGNORECASE),
    re.compile(r"\b(?:sk|pk|rk)-(?:test|live|proj|dummy)?-?[A-Za-z0-9_-]{10,}\b", re.IGNORECASE),
    re.compile(r"\bAIza[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\b(access[_-]?token|refresh[_-]?token|oauth[_-]?token)\b[^\n]{0,80}[:=]\s*['\"]?[A-Za-z0-9_\-.]{12,}", re.IGNORECASE),
    re.compile(r"\bbearer\s+[A-Za-z0-9_\-.]{20,}", re.IGNORECASE),
    re.compile(r"\b(service[_-]?role|supabase[_-]?service[_-]?role[_-]?key)\b[^\n]{0,80}[:=]\s*['\"]?[A-Za-z0-9_\-.]{12,}", re.IGNORECASE),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
)


def is_forbidden_tool_name(tool_name: str) -> bool:
    lowered = tool_name.lower()
    return lowered.startswith(FORBIDDEN_TOOL_PREFIXES) or any(marker in lowered for marker in FORBIDDEN_TOOL_MARKERS)


def has_platform_write_intent(message: str) -> bool:
    """Detect requests that ask the agent to mutate ad platform settings."""
    lowered = f" {message.lower()} "
    has_object = any(marker in lowered for marker in FORBIDDEN_MESSAGE_MARKERS)
    has_action = any(marker in lowered for marker in WRITE_INTENT_MARKERS)
    return has_object and has_action


def looks_secret(value: str) -> bool:
    """Return True when text appears to contain credentials or platform tokens."""
    lowered = value.lower()
    return any(marker in lowered for marker in SECRET_VALUE_MARKERS) or any(
        pattern.search(value) for pattern in SECRET_VALUE_PATTERNS
    )


def contains_secret(value: Any) -> bool:
    """Recursively detect secrets in payloads before DB, tool, or LLM routing."""
    if isinstance(value, str):
        return looks_secret(value)
    if isinstance(value, dict):
        return any(
            looks_secret(str(key)) or contains_secret(item)
            for key, item in value.items()
            if key not in {"workspaceId", "userId", "threadId"}
        )
    if isinstance(value, (list, tuple)):
        return any(contains_secret(item) for item in value)
    return False
