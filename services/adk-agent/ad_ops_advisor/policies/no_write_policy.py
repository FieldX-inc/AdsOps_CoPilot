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
    "予算",
    "入札",
    "キャンペーン",
    "停止",
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
    "apply",
    "mutate",
    "set ",
    "変更して",
    "停止して",
    "作成して",
    "適用して",
    "実行して",
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
    return any(marker in lowered for marker in SECRET_VALUE_MARKERS)
