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
        patch("ad_ops_advisor.chat_runtime.is_gemini_configured", return_value=False),
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
        patch("ad_ops_advisor.chat_runtime.is_gemini_configured", return_value=False),
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
    assert "直接変更・停止・作成することはできません" in content
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
        patch("ad_ops_advisor.chat_runtime.is_gemini_configured", return_value=False),
    ):
        Handler.do_GET(handler)

    assert sent["status"] == 200
    payload = sent["payload"]
    assert payload["message"]["role"] == "assistant"
    assert "結論:" in payload["message"]["content"]
