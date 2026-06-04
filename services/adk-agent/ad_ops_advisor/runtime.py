from __future__ import annotations

import os
from typing import Any

from .analysis import build_mock_chat_response
from .gemini_runtime import GeminiRuntimeError, generate_advisor_response, is_gemini_configured
from .openai_agents_runtime import (
    OpenAIAgentsRuntimeError,
    generate_openai_agents_response,
    is_openai_agents_configured,
)


class AgentRuntimeError(RuntimeError):
    """Raised when the selected agent runtime cannot produce a response."""


def selected_agent_runtime() -> str:
    return os.environ.get("ADOPS_AGENT_RUNTIME", "openai").strip().lower() or "openai"


def is_production_env() -> bool:
    return os.environ.get("APP_ENV", "").strip().lower() == "production"


def is_agent_runtime_configured() -> bool:
    runtime = selected_agent_runtime()
    if runtime in {"mock", "none"}:
        return False
    if is_production_env() and runtime not in {"openai", "openai_agents"}:
        return False
    if runtime in {"openai", "openai_agents"}:
        return is_openai_agents_configured()
    return is_gemini_configured()


def generate_agent_response(payload: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = selected_agent_runtime()
    if runtime in {"mock", "none"}:
        response = build_mock_chat_response(payload)
        response["mode"] = "mock_runtime"
        return response
    if runtime in {"openai", "openai_agents"}:
        try:
            return generate_openai_agents_response(payload, context)
        except OpenAIAgentsRuntimeError as exc:
            raise AgentRuntimeError(str(exc)) from exc
    if is_production_env():
        raise AgentRuntimeError("Production Agent Service requires ADOPS_AGENT_RUNTIME=openai")
    try:
        return generate_advisor_response(payload, context)
    except GeminiRuntimeError as exc:
        raise AgentRuntimeError(str(exc)) from exc
