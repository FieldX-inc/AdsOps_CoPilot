from __future__ import annotations

import asyncio
import os
import json
import sys
import types as pytypes
from unittest.mock import patch

from ad_ops_advisor.gemini_runtime import _build_user_prompt, _run_adk_agent, generate_advisor_response


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


def test_run_adk_agent_breaks_after_final_response() -> None:
    class FinalThenUnexpectedRunner(FakeRunner):
        async def run_async(self, user_id: str, session_id: str, new_message: FakeContent):
            yield FakeEvent("最終回答です")
            raise AssertionError("runner continued after final response")

    content = asyncio.run(
        _run_adk_agent(
            Runner=FinalThenUnexpectedRunner,
            InMemorySessionService=FakeSessionService,
            types=pytypes.SimpleNamespace(Content=FakeContent, Part=FakePart),
            root_agent=object(),
            payload={
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "CPAが悪化している理由を教えて",
            },
            context={},
        )
    )

    assert content == "最終回答です"


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
    assert captured["body"]["generationConfig"]["maxOutputTokens"] == 4096


def test_generate_rest_runtime_uses_smaller_tokens_for_short_intent(monkeypatch) -> None:
    captured = {}

    def fake_urlopen(request, timeout):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeRestResponse()

    monkeypatch.setenv("GEMINI_API_KEY", "test-rest-key")
    monkeypatch.setenv("GEMINI_RUNTIME", "rest")

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        generate_advisor_response(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "こんにちは",
                "context": {"intentMetadata": {"responseLength": "short"}},
            }
        )

    assert captured["body"]["generationConfig"]["maxOutputTokens"] == 768


def test_auto_runtime_skips_adk_for_short_intent(monkeypatch) -> None:
    captured = {}

    def fake_urlopen(request, timeout):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeRestResponse()

    monkeypatch.setenv("GEMINI_API_KEY", "test-rest-key")
    monkeypatch.setenv("GEMINI_RUNTIME", "auto")

    with (
        patch("urllib.request.urlopen", side_effect=fake_urlopen),
        patch("ad_ops_advisor.gemini_runtime._run_adk_agent", side_effect=AssertionError("ADK should be skipped")),
    ):
        result = generate_advisor_response(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "こんにちは",
                "context": {
                    "intent": {
                        "intent": "greeting_casual",
                        "requires_metrics_context": False,
                        "prefers_short_response": True,
                    }
                },
            }
        )

    assert result["mode"] == "gemini_rest"
    assert captured["body"]["generationConfig"]["maxOutputTokens"] == 768


def test_auto_runtime_skips_adk_when_metrics_context_is_not_required(monkeypatch) -> None:
    captured = {}

    def fake_urlopen(request, timeout):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeRestResponse()

    monkeypatch.setenv("GEMINI_API_KEY", "test-rest-key")
    monkeypatch.setenv("GEMINI_RUNTIME", "auto")

    with (
        patch("urllib.request.urlopen", side_effect=fake_urlopen),
        patch("ad_ops_advisor.gemini_runtime._run_adk_agent", side_effect=AssertionError("ADK should be skipped")),
    ):
        result = generate_advisor_response(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "どこをコンバージョンとして設定したらいいか",
                "context": {
                    "intent": {
                        "intent": "setup",
                        "requires_metrics_context": False,
                        "prefers_short_response": False,
                    }
                },
            }
        )

    assert result["mode"] == "gemini_rest"
    assert captured["body"]["generationConfig"]["maxOutputTokens"] == 768


def test_auto_runtime_fallback_warning_explains_adk_then_rest(monkeypatch) -> None:
    captured = {}

    def fake_urlopen(request, timeout):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeRestResponse()

    monkeypatch.setenv("GEMINI_API_KEY", "test-rest-key")
    monkeypatch.setenv("GEMINI_RUNTIME", "auto")
    monkeypatch.setitem(sys.modules, "google.adk.runners", None)

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        result = generate_advisor_response(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "CPAが悪化している理由を教えて",
            }
        )

    assert result["mode"] == "gemini_rest_fallback"
    assert result["runtimeWarning"] == (
        "GEMINI_RUNTIME=auto tried ADK first, then used REST fallback because google-adk is not installed."
    )
    assert captured["body"]["generationConfig"]["maxOutputTokens"] == 4096


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


def test_build_user_prompt_does_not_duplicate_latest_ad_data_from_context() -> None:
    prompt = _build_user_prompt(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "threadId": "thread-1",
            "message": "CPA悪化の原因を分析して",
        },
        {
            "accounts": [{"id": "account-1", "name": "Google Ads"}],
            "latestAdData": {"current": {"totals": {"cpa": 3000}}},
        },
    )
    prompt_json = json.loads(prompt.split("\n\n", 1)[1])

    assert prompt.count('"latestAdData"') == 1
    assert prompt_json["latestAdData"] == {"current": {"totals": {"cpa": 3000}}}
    assert "latestAdData" not in prompt_json["dbContext"]


def test_build_user_prompt_warns_when_conversion_evidence_is_missing() -> None:
    prompt = _build_user_prompt(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "threadId": "thread-1",
            "message": "売上が落ちた原因を断定して",
            "latestAdData": {
                "current": {"totals": {"impressions": 12000, "clicks": 420, "cost": 126000}},
                "comparison": {"totals": {"impressions": 11000, "clicks": 500, "cost": 100000}},
            },
        },
        {},
    )

    assert "データ品質注意" in prompt
    assert "売上減少" in prompt
    assert "断定禁止" in prompt
    assert "根拠が足りない" in prompt
    assert "自信度: Low" in prompt


def test_build_user_prompt_tells_model_not_to_analyze_for_greetings() -> None:
    prompt = _build_user_prompt(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "threadId": "thread-1",
            "message": "こんにちは",
            "latestAdData": {"current": {"totals": {"cpa": 3000}}},
        },
        {},
    )

    assert "挨拶" in prompt
    assert "数値分析" in prompt
    assert "推奨アクションを始めない" in prompt


def test_build_user_prompt_prioritizes_budget_question_for_setup_context() -> None:
    prompt = _build_user_prompt(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "threadId": "thread-1",
            "message": "誰をターゲットにすべき？",
        },
        {},
    )

    assert "ターゲット" in prompt
    assert "質問を3つ以内" in prompt
    assert "商材" in prompt
    assert "月予算" in prompt
    assert "検証予算" in prompt


def test_build_user_prompt_requires_explicit_no_write_refusal_for_direct_mutation_requests() -> None:
    prompt = _build_user_prompt(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "threadId": "thread-1",
            "message": "キャンペーンを止めて予算を2万円に変更して",
        },
        {},
    )

    assert "媒体設定の直接変更はできません" in prompt
    assert "直接write" in prompt
    assert "確認・承認・手動実行" in prompt
