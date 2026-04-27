from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import Any, TypeVar

from .policies.no_write_policy import is_forbidden_tool_name
from .repositories import _sanitize, get_repository, is_database_configured


F = TypeVar("F", bound=Callable[..., dict[str, Any]])


def audited_tool(tool: F) -> F:
    """Audit ADK tool calls when repository context is available.

    The wrapper keeps local/demo mode lightweight, but production DB-backed
    calls get a sanitized started/succeeded/failed trail.
    """

    if is_forbidden_tool_name(tool.__name__):
        raise RuntimeError(f"Forbidden media-write tool cannot be registered: {tool.__name__}")

    @wraps(tool)
    def wrapper(*args: Any, **kwargs: Any) -> dict[str, Any]:
        workspace_id = _first_scope_value("workspace_id", args, kwargs)
        user_id = _first_scope_value("user_id", args, kwargs)
        thread_id = _first_scope_value("thread_id", args, kwargs)
        should_audit = bool(workspace_id) and is_database_configured()
        repository = get_repository() if should_audit else None
        input_summary = _summarize_call(tool, args, kwargs)

        if repository is not None:
            repository.record_tool_call(workspace_id, user_id, thread_id, tool.__name__, "started", input_summary)

        try:
            result = tool(*args, **kwargs)
        except Exception as exc:
            if repository is not None:
                repository.record_tool_call(
                    workspace_id,
                    user_id,
                    thread_id,
                    tool.__name__,
                    "failed",
                    input_summary,
                    {},
                    str(exc),
                )
            raise

        if repository is not None:
            repository.record_tool_call(
                workspace_id,
                user_id,
                thread_id,
                tool.__name__,
                "succeeded",
                input_summary,
                _summarize_result(result),
            )
        return result

    return wrapper  # type: ignore[return-value]


def _first_scope_value(name: str, args: tuple[Any, ...], kwargs: dict[str, Any]) -> str | None:
    if name in kwargs:
        return str(kwargs[name])
    if name == "workspace_id" and args:
        return str(args[0])
    if name == "user_id" and len(args) > 1:
        return str(args[1])
    return None


def _summarize_call(tool: Callable[..., Any], args: tuple[Any, ...], kwargs: dict[str, Any]) -> dict[str, Any]:
    summary = {f"arg_{index}": value for index, value in enumerate(args)}
    summary.update(kwargs)
    summary["tool"] = tool.__name__
    return _sanitize(summary)


def _summarize_result(result: dict[str, Any]) -> dict[str, Any]:
    sanitized = _sanitize(result)
    if "accounts" in sanitized and isinstance(sanitized["accounts"], list):
        return {"account_count": len(sanitized["accounts"])}
    if "campaigns" in sanitized and isinstance(sanitized["campaigns"], list):
        return {"campaign_count": len(sanitized["campaigns"])}
    if "memories" in sanitized and isinstance(sanitized["memories"], list):
        return {"memory_count": len(sanitized["memories"])}
    if "task" in sanitized and isinstance(sanitized["task"], dict):
        return {"task_id": sanitized["task"].get("id"), "status": sanitized.get("status")}
    return sanitized
