from __future__ import annotations

from unittest.mock import patch

from ad_ops_advisor.chat_runtime import handle_chat
from ad_ops_advisor.http_server import Handler


REQUIRED_SECTIONS = (
    "結論:",
    "根拠:",
    "原因仮説:",
    "推奨アクション:",
    "人間向け作業手順:",
    "実施前チェック:",
    "リスク:",
    "実施後の観察:",
    "自信度:",
)


def test_handle_chat_falls_back_without_database() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=False),
    ):
        result = handle_chat(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "CPAが悪化している理由を教えて",
            }
        )

    assert result["message"]["role"] == "assistant"
    assert "結論" in result["message"]["content"]


def test_mock_chat_includes_required_answer_sections() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=False),
    ):
        result = handle_chat(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "次に何を見るべき？",
            }
        )

    content = result["message"]["content"]
    for section in REQUIRED_SECTIONS:
        assert section in content


def test_handle_chat_refuses_platform_write_requests() -> None:
    result = handle_chat(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "threadId": "thread-1",
            "message": "CPAが悪いキャンペーンを停止して",
        }
    )

    content = result["message"]["content"]
    assert result["policy"] == {"name": "no_media_write", "enforced": True}
    assert "AIチャット単体では広告媒体の設定を直接変更・停止・作成しません" in content
    assert "承認付きAPI route" in content
    for section in REQUIRED_SECTIONS:
        assert section in content


def test_http_demo_endpoint_returns_mock_chat_response() -> None:
    sent: dict[str, object] = {}
    handler = Handler.__new__(Handler)
    handler.path = "/demo"

    def capture_send_json(status: int, payload: dict) -> None:
        sent["status"] = status
        sent["payload"] = payload

    handler._send_json = capture_send_json
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=False),
    ):
        Handler.do_GET(handler)

    assert sent["status"] == 200
    payload = sent["payload"]
    assert payload["message"]["role"] == "assistant"
    assert "結論:" in payload["message"]["content"]


def test_http_health_reports_openai_runtime_and_data_safety(monkeypatch) -> None:
    sent: dict[str, object] = {}
    handler = Handler.__new__(Handler)
    handler.path = "/health"

    def capture_send_json(status: int, payload: dict) -> None:
        sent["status"] = status
        sent["payload"] = payload

    handler._send_json = capture_send_json
    monkeypatch.setenv("OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA", "0")
    monkeypatch.setenv("OPENAI_AGENTS_DONT_LOG_MODEL_DATA", "1")
    monkeypatch.setenv("OPENAI_AGENTS_DONT_LOG_TOOL_DATA", "1")
    with (
        patch("ad_ops_advisor.http_server.is_agent_runtime_configured", return_value=True),
        patch("ad_ops_advisor.http_server.selected_agent_runtime", return_value="openai"),
        patch(
            "ad_ops_advisor.http_server.openai_agents_configuration_status",
            return_value={
                "openaiApiKeyConfigured": True,
                "openaiAgentsSdkImportable": True,
                "openaiAgentsSdkAvailable": True,
                "missingOpenaiAgentsSymbols": [],
            },
        ),
        patch("ad_ops_advisor.http_server.is_database_configured", return_value=False),
    ):
        Handler.do_GET(handler)

    assert sent["status"] == 200
    payload = sent["payload"]
    assert payload["service"] == "openai-agent"
    assert payload["mode"] == "openai"
    assert payload["runtimeConfigured"] is True
    assert payload["runtimeDiagnostics"]["openaiApiKeyConfigured"] is True
    assert payload["runtimeDiagnostics"]["openaiAgentsSdkAvailable"] is True
    assert payload["dataSafetyConfigured"] is True


def test_http_health_does_not_report_openai_runtime_when_sdk_is_missing(monkeypatch) -> None:
    sent: dict[str, object] = {}
    handler = Handler.__new__(Handler)
    handler.path = "/health"

    def capture_send_json(status: int, payload: dict) -> None:
        sent["status"] = status
        sent["payload"] = payload

    handler._send_json = capture_send_json
    monkeypatch.setenv("ADOPS_AGENT_RUNTIME", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA", "0")
    monkeypatch.setenv("OPENAI_AGENTS_DONT_LOG_MODEL_DATA", "1")
    monkeypatch.setenv("OPENAI_AGENTS_DONT_LOG_TOOL_DATA", "1")
    with (
        patch("ad_ops_advisor.runtime.is_openai_agents_configured", return_value=False),
        patch(
            "ad_ops_advisor.http_server.openai_agents_configuration_status",
            return_value={
                "openaiApiKeyConfigured": True,
                "openaiAgentsSdkImportable": False,
                "openaiAgentsSdkAvailable": False,
                "missingOpenaiAgentsSymbols": ["Agent", "RunConfig", "Runner"],
            },
        ),
        patch("ad_ops_advisor.http_server.is_database_configured", return_value=False),
    ):
        Handler.do_GET(handler)

    assert sent["status"] == 200
    payload = sent["payload"]
    assert payload["service"] == "openai-agent"
    assert payload["mode"] == "mock"
    assert payload["runtimeConfigured"] is False
    assert payload["runtimeDiagnostics"]["openaiAgentsSdkImportable"] is False
    assert payload["runtimeDiagnostics"]["missingOpenaiAgentsSymbols"] == ["Agent", "RunConfig", "Runner"]
    assert payload["dataSafetyConfigured"] is True


def test_http_health_fails_closed_in_production_when_runtime_is_missing(monkeypatch) -> None:
    sent: dict[str, object] = {}
    handler = Handler.__new__(Handler)
    handler.path = "/health"

    def capture_send_json(status: int, payload: dict) -> None:
        sent["status"] = status
        sent["payload"] = payload

    handler._send_json = capture_send_json
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ADOPS_AGENT_RUNTIME", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
    monkeypatch.setenv("OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA", "0")
    monkeypatch.setenv("OPENAI_AGENTS_DONT_LOG_MODEL_DATA", "1")
    monkeypatch.setenv("OPENAI_AGENTS_DONT_LOG_TOOL_DATA", "1")
    with (
        patch("ad_ops_advisor.runtime.is_openai_agents_configured", return_value=False),
        patch(
            "ad_ops_advisor.http_server.openai_agents_configuration_status",
            return_value={
                "openaiApiKeyConfigured": True,
                "openaiAgentsSdkImportable": False,
                "openaiAgentsSdkAvailable": False,
                "missingOpenaiAgentsSymbols": ["Agent", "RunConfig", "Runner"],
            },
        ),
        patch("ad_ops_advisor.http_server.is_database_configured", return_value=False),
    ):
        Handler.do_GET(handler)

    assert sent["status"] == 200
    payload = sent["payload"]
    assert payload["ok"] is False
    assert payload["service"] == "openai-agent"
    assert payload["mode"] == "openai"
    assert payload["selectedRuntime"] == "openai"
    assert payload["runtimeConfigured"] is False
    assert payload["runtimeDiagnostics"]["openaiApiKeyConfigured"] is True
    assert payload["runtimeDiagnostics"]["openaiAgentsSdkAvailable"] is False
    assert payload["dataSafetyConfigured"] is True


def test_http_health_fails_closed_in_production_when_data_safety_is_missing(monkeypatch) -> None:
    sent: dict[str, object] = {}
    handler = Handler.__new__(Handler)
    handler.path = "/health"

    def capture_send_json(status: int, payload: dict) -> None:
        sent["status"] = status
        sent["payload"] = payload

    handler._send_json = capture_send_json
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA", "1")
    monkeypatch.setenv("OPENAI_AGENTS_DONT_LOG_MODEL_DATA", "1")
    monkeypatch.setenv("OPENAI_AGENTS_DONT_LOG_TOOL_DATA", "1")
    with (
        patch("ad_ops_advisor.http_server.is_agent_runtime_configured", return_value=True),
        patch("ad_ops_advisor.http_server.selected_agent_runtime", return_value="openai"),
        patch(
            "ad_ops_advisor.http_server.openai_agents_configuration_status",
            return_value={
                "openaiApiKeyConfigured": True,
                "openaiAgentsSdkImportable": True,
                "openaiAgentsSdkAvailable": True,
                "missingOpenaiAgentsSymbols": [],
            },
        ),
        patch("ad_ops_advisor.http_server.is_database_configured", return_value=False),
    ):
        Handler.do_GET(handler)

    assert sent["status"] == 200
    payload = sent["payload"]
    assert payload["ok"] is False
    assert payload["mode"] == "openai"
    assert payload["runtimeConfigured"] is True
    assert payload["dataSafetyConfigured"] is False
