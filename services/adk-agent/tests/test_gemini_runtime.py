from __future__ import annotations

import os
import json
import sys
import types as pytypes
from unittest.mock import patch

from ad_ops_advisor.gemini_runtime import _build_user_prompt, generate_advisor_response


class FakePart:
    def __init__(self, text: str) -> None:
        self.text = text


class FakeContent:
    def __init__(self, role: str, parts: list[FakePart]) -> None:
        self.role = role
        self.parts = parts


class FakeEvent:
    def __init__(self, text: str) -> None:
        self.content = FakeContent("model", [FakePart(text)])

    def is_final_response(self) -> bool:
        return True


class FakeRunner:
    def __init__(self, agent: object, app_name: str, session_service: object) -> None:
        self.agent = agent
        self.app_name = app_name
        self.session_service = session_service

    async def run_async(self, user_id: str, session_id: str, new_message: FakeContent):
        assert user_id == "user-1"
        assert session_id == "thread-1"
        assert "workspace-1" in new_message.parts[0].text
        assert "禁止表現" in new_message.parts[0].text
        yield FakeEvent(
            "結論:\nCPA悪化への対応としてキャンペーンを停止する案があります。\n"
            "人間向け作業手順:\n1. キャンペーンを停止する\n2. 予算を下げる\n3. 広告を入稿する\n"
            "自信度:\nMedium"
        )


class FakeSessionService:
    async def create_session(self, app_name: str, user_id: str, session_id: str) -> object:
        assert app_name == "ad_ops_advisor"
        assert user_id == "user-1"
        assert session_id == "thread-1"
        return object()


def test_generate_advisor_response_runs_adk_runner_with_gemini_key(monkeypatch) -> None:
    google_module = pytypes.ModuleType("google")
    adk_module = pytypes.ModuleType("google.adk")
    runners_module = pytypes.ModuleType("google.adk.runners")
    sessions_module = pytypes.ModuleType("google.adk.sessions")
    genai_module = pytypes.ModuleType("google.genai")
    runners_module.Runner = FakeRunner
    sessions_module.InMemorySessionService = FakeSessionService
    genai_module.types = pytypes.SimpleNamespace(Content=FakeContent, Part=FakePart)

    monkeypatch.setitem(sys.modules, "google", google_module)
    monkeypatch.setitem(sys.modules, "google.adk", adk_module)
    monkeypatch.setitem(sys.modules, "google.adk.runners", runners_module)
    monkeypatch.setitem(sys.modules, "google.adk.sessions", sessions_module)
    monkeypatch.setitem(sys.modules, "google.genai", genai_module)
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    with patch("ad_ops_advisor.agent.root_agent", object()):
        result = generate_advisor_response(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "CPAが悪化している理由を教えて",
            }
        )

    assert result["mode"] == "adk_gemini"
    assert result["message"]["content"].startswith("結論:")
    assert "キャンペーンを停止する" not in result["message"]["content"]
    assert "予算を下げる" not in result["message"]["content"]
    assert "広告を入稿する" not in result["message"]["content"]
    assert "停止候補" in result["message"]["content"]
    assert "広告入稿案" in result["message"]["content"]
    assert "担当者" in result["message"]["content"]
    assert result["policy"] == {"name": "human_in_the_loop_rewrite", "enforced": True}
    assert result["recommendation"]["confidence"] == "medium"
    assert all("停止する" not in step and "予算を下げる" not in step for step in result["recommendation"]["operatorSteps"])
    assert result["model"] == "gemini-flash-latest"
    assert os.environ["GOOGLE_API_KEY"] == "test-gemini-key"


class FakeRestResponse:
    def __enter__(self) -> "FakeRestResponse":
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": (
                                        "結論:\nGemini RESTで生成した回答です。\n"
                                        "人間向け作業手順:\n1. 予算を下げる\n2. 検索語句を除外する\n"
                                        "自信度:\nMedium"
                                    )
                                }
                            ]
                        }
                    }
                ]
            }
        ).encode("utf-8")


def test_generate_advisor_response_can_use_rest_runtime(monkeypatch) -> None:
    captured = {}

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeRestResponse()

    monkeypatch.setenv("GEMINI_API_KEY", "test-rest-key")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-test")
    monkeypatch.setenv("GEMINI_RUNTIME", "rest")

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        result = generate_advisor_response(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "CPAが悪化している理由を教えて",
            }
        )

    assert result["mode"] == "gemini_rest"
    assert result["model"] == "gemini-test"
    assert result["message"]["content"].startswith("結論:")
    assert "予算を下げる" not in result["message"]["content"]
    assert "検索語句を除外する" not in result["message"]["content"]
    assert "予算引き下げ候補" in result["message"]["content"]
    assert "除外候補" in result["message"]["content"]
    assert result["policy"] == {"name": "human_in_the_loop_rewrite", "enforced": True}
    assert "test-rest-key" in captured["url"]
    assert "禁止表現" in json.dumps(captured["body"], ensure_ascii=False)
    assert "test-rest-key" not in json.dumps(captured["body"], ensure_ascii=False)


def test_build_user_prompt_excludes_secret_keys_and_values_from_payload_and_context() -> None:
    prompt = _build_user_prompt(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "threadId": "thread-1",
            "message": "CPA悪化の原因を分析して",
            "context": {
                "access_token_encrypted": "encrypted-token-value",
                "safeMemo": "週次で確認したい",
            },
            "latestAdData": {
                "refresh_token": "raw-refresh-token",
                "current": {"totals": {"cpa": 3000}},
            },
        },
        {
            "accounts": [
                {
                    "id": "account-1",
                    "name": "Google Ads",
                    "client_secret": "client-secret-value",
                    "status": "active",
                }
            ],
            "audit": "Bearer should-not-leak",
        },
    )

    assert "workspace-1" in prompt
    assert "週次で確認したい" in prompt
    assert "Google Ads" in prompt
    assert "encrypted-token-value" not in prompt
    assert "raw-refresh-token" not in prompt
    assert "client-secret-value" not in prompt
    assert "should-not-leak" not in prompt
    assert "access_token_encrypted" not in prompt
    assert "refresh_token" not in prompt
    assert "client_secret" not in prompt
    assert "[REDACTED]" in prompt
