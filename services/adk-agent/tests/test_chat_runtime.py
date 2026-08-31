from __future__ import annotations

import pytest
from unittest.mock import patch

from ad_ops_advisor.chat_runtime import handle_chat
from ad_ops_advisor.runtime import AgentRuntimeError

REQUIRED_ANSWER_SECTIONS = (
    "結論",
    "根拠",
    "原因仮説",
    "推奨アクション",
    "人間向け作業手順",
    "実施前チェック",
    "リスク",
    "実施後の観察",
    "自信度",
)

WORKSPACE_ID = "11111111-1111-4111-8111-111111111111"
USER_ID = "22222222-2222-4222-8222-222222222222"
THREAD_ID = "33333333-3333-4333-8333-333333333333"


class FakeRepository:
    def __init__(self) -> None:
        self.appended_messages: list[tuple] = []
        self.tool_calls: list[tuple] = []
        self.compare_call: tuple | None = None

    def append_agent_message(
        self,
        workspace_id: str,
        thread_id: str,
        role: str,
        content: str,
        user_id: str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        self.appended_messages.append((workspace_id, thread_id, role, content, user_id, metadata))
        return {"id": f"message-{len(self.appended_messages)}", "role": role}

    def ensure_agent_thread(self, workspace_id: str, user_id: str, thread_id: str, title: str) -> dict:
        return {"id": thread_id, "workspace_id": workspace_id, "user_id": user_id, "title": title}

    def record_tool_call(
        self,
        workspace_id: str,
        user_id: str | None,
        thread_id: str | None,
        tool_name: str,
        status: str,
        input_summary: dict | None = None,
        output_summary: dict | None = None,
        error_message: str | None = None,
    ) -> dict:
        self.tool_calls.append(
            (workspace_id, user_id, thread_id, tool_name, status, input_summary, output_summary, error_message)
        )
        return {"id": f"tool-call-{len(self.tool_calls)}", "status": status}

    def list_ad_accounts(self, workspace_id: str) -> list[dict]:
        return [
            {
                "id": "account-from-repository",
                "platform": "google",
                "name": "Google Ads",
                "status": "active",
                "currency": "JPY",
                "timezone": "Asia/Tokyo",
            }
        ]

    def compare_period_metrics(
        self,
        workspace_id: str,
        ad_account_id: str,
        current_range: str,
        comparison_range: str,
    ) -> dict:
        self.compare_call = (workspace_id, ad_account_id, current_range, comparison_range)
        return {
            "current": {
                "date_range": current_range,
                "totals": {
                    "impressions": 1000,
                    "clicks": 100,
                    "cost": 12000,
                    "conversions": 4,
                    "revenue": 40000,
                    "ctr": 0.1,
                    "cvr": 0.04,
                    "cpc": 120,
                    "cpa": 3000,
                    "roas": 3.33,
                },
                "campaigns": [
                    {
                        "campaign_name": "Brand Search",
                        "impressions": 1000,
                        "clicks": 100,
                        "cost": 12000,
                        "conversions": 4,
                        "revenue": 40000,
                        "cpa": 3000,
                    }
                ],
            },
            "comparison": {
                "date_range": comparison_range,
                "totals": {
                    "impressions": 900,
                    "clicks": 120,
                    "cost": 9000,
                    "conversions": 6,
                    "revenue": 54000,
                    "ctr": 0.133,
                    "cvr": 0.05,
                    "cpc": 75,
                    "cpa": 1500,
                    "roas": 6.0,
                },
                "campaigns": [],
            },
            "changes": {
                "impressions": 0.11,
                "clicks": -0.16,
                "cost": 0.33,
                "conversions": -0.33,
                "revenue": -0.25,
                "ctr": -0.25,
                "cvr": -0.2,
                "cpc": 0.6,
                "cpa": 1.0,
                "roas": -0.44,
            },
        }


def test_handle_chat_db_backed_route_uses_scoped_context_and_selected_account() -> None:
    repository = FakeRepository()

    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.get_repository", return_value=repository),
    ):
        result = handle_chat(
            {
                "workspaceId": WORKSPACE_ID,
                "userId": USER_ID,
                "threadId": THREAD_ID,
                "adAccountId": "selected-account",
                "dateRange": "last_30_days",
                "message": "CPAが悪化している理由を教えて",
            }
        )

    assert result["message"]["role"] == "assistant"
    assert "Brand Search" in result["message"]["content"]
    assert repository.compare_call == (WORKSPACE_ID, "selected-account", "last_30_days", "previous_7_days")
    assert repository.appended_messages[0][:5] == (
        WORKSPACE_ID,
        THREAD_ID,
        "user",
        "CPAが悪化している理由を教えて",
        USER_ID,
    )
    assert repository.appended_messages[-1][2] == "assistant"
    assert repository.appended_messages[-1][5] == {"mode": "db_backed_fallback"}
    assert [(call[3], call[4]) for call in repository.tool_calls] == [
        ("list_ad_accounts", "started"),
        ("list_ad_accounts", "succeeded"),
        ("compare_period_metrics", "started"),
        ("compare_period_metrics", "succeeded"),
    ]


def test_handle_chat_write_intent_short_circuits_before_database_routing() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.get_repository", side_effect=AssertionError("database should not be used")),
    ):
        result = handle_chat(
            {
                "workspaceId": WORKSPACE_ID,
                "userId": USER_ID,
                "threadId": THREAD_ID,
                "message": "CPAが悪いキャンペーンの予算を下げて",
            }
        )

    assert result["policy"] == {"name": "no_media_write", "enforced": True}
    assert "AIチャット単体では広告媒体の設定を直接変更・停止・作成しません" in result["message"]["content"]
    assert "承認付きwrite候補" in result["message"]["content"]
    assert "CPAが悪いキャンペーンの予算を下げて" not in result["message"]["content"]
    assert_no_media_write_execution_claims(result)
    assert_response_contract(result)


def test_handle_chat_ad_submission_request_is_no_write_policy() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.get_repository", side_effect=AssertionError("database should not be used")),
    ):
        result = handle_chat(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "反応が良さそうな広告を入稿して",
            }
        )

    assert result["policy"] == {"name": "no_media_write", "enforced": True}
    assert "反応が良さそうな広告を入稿して" not in result["message"]["content"]
    assert_no_media_write_execution_claims(result)
    assert_response_contract(result)


def test_handle_chat_secret_input_short_circuits_before_database_routing() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.get_repository", side_effect=AssertionError("database should not be used")),
    ):
        result = handle_chat(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "このapi_key=sk-test-dummy-not-a-real-secretで分析して",
            }
        )

    assert result["policy"] == {"name": "secret_exclusion", "enforced": True}
    assert "secret、OAuth token、API key" in result["message"]["content"]
    assert "sk-test-dummy-not-a-real-secret" not in result["message"]["content"]
    assert_response_contract(result)


def test_handle_chat_bare_secret_value_short_circuits_before_database_routing() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.get_repository", side_effect=AssertionError("database should not be used")),
    ):
        result = handle_chat(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "このキーで分析して sk-test-dummy-not-a-real-secret",
            }
        )

    assert result["policy"] == {"name": "secret_exclusion", "enforced": True}
    assert "sk-test-dummy-not-a-real-secret" not in result["message"]["content"]
    assert_response_contract(result)


def test_handle_chat_secret_in_context_short_circuits_before_database_or_llm_routing() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.get_repository", side_effect=AssertionError("database should not be used")),
        patch("ad_ops_advisor.chat_runtime.generate_agent_response", side_effect=AssertionError("LLM should not be used")),
    ):
        result = handle_chat(
            {
                "workspaceId": "workspace-1",
                "userId": "user-1",
                "threadId": "thread-1",
                "message": "CPA悪化を見て",
                "context": {
                    "refresh_token": "raw-refresh-token-value",
                },
            }
        )

    assert result["policy"] == {"name": "secret_exclusion", "enforced": True}
    assert "raw-refresh-token-value" not in result["message"]["content"]
    assert_response_contract(result)


def test_handle_chat_uses_openai_agent_runtime_without_database_when_configured() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=True),
        patch(
            "ad_ops_advisor.chat_runtime.generate_agent_response",
            return_value={
                "message": {"role": "assistant", "content": "結論:\nOpenAI Agentからの回答です。"},
                "mode": "openai_agents",
            },
        ) as generate,
    ):
        result = handle_chat(
            {
                "workspaceId": WORKSPACE_ID,
                "userId": USER_ID,
                "threadId": THREAD_ID,
                "message": "CPAが悪化している理由を教えて",
            }
        )

    assert result["mode"] == "openai_agents"
    assert "OpenAI Agent" in result["message"]["content"]
    generate.assert_called_once()


def test_handle_chat_raises_when_openai_agent_runtime_fails() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=True),
        patch(
            "ad_ops_advisor.chat_runtime.generate_agent_response",
            side_effect=AgentRuntimeError("OpenAI Agent request failed"),
        ),
    ):
        with pytest.raises(AgentRuntimeError, match="OpenAI Agent request failed"):
            handle_chat(
                {
                    "workspaceId": WORKSPACE_ID,
                    "userId": USER_ID,
                    "threadId": THREAD_ID,
                    "message": "CPAが悪化している理由を教えて",
                }
            )


def test_handle_chat_records_openai_agent_mode_for_db_backed_response() -> None:
    repository = FakeRepository()

    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.get_repository", return_value=repository),
        patch(
            "ad_ops_advisor.chat_runtime.generate_agent_response",
            return_value={
                "message": {"role": "assistant", "content": "結論:\nDB文脈つきOpenAI Agent回答です。"},
                "mode": "openai_agents",
            },
        ),
    ):
        result = handle_chat(
            {
                "workspaceId": WORKSPACE_ID,
                "userId": USER_ID,
                "threadId": THREAD_ID,
                "message": "CPAが悪化している理由を教えて",
            }
        )

    assert result["mode"] == "openai_agents"
    assert repository.appended_messages[-1][5] == {"mode": "openai_agents"}


def test_handle_chat_skips_metric_prefetch_for_greeting() -> None:
    repository = FakeRepository()

    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.get_repository", return_value=repository),
        patch(
            "ad_ops_advisor.chat_runtime.generate_agent_response",
            return_value={
                "message": {"role": "assistant", "content": "こんにちは。広告運用について相談できます。"},
                "mode": "openai_agents",
            },
        ) as generate,
    ):
        result = handle_chat(
            {
                "workspaceId": WORKSPACE_ID,
                "userId": USER_ID,
                "threadId": THREAD_ID,
                "message": "こんにちは",
            }
        )

    assert result["mode"] == "openai_agents"
    assert repository.compare_call is None
    assert repository.tool_calls == []
    sent_payload = generate.call_args.args[0]
    sent_context = generate.call_args.args[1]
    assert sent_payload["context"]["intent"]["intent"] == "greeting_casual"
    assert sent_payload["context"]["routePlan"]["route"] == "greeting_casual"
    assert sent_payload["context"]["routePlan"]["targetAgents"] == ["root_agent"]
    assert sent_context["intent"]["requires_metrics_context"] is False
    assert sent_context["routePlan"]["requires_metrics_context"] is False


def test_handle_chat_passes_experienced_mode_into_route_plan() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=True),
        patch(
            "ad_ops_advisor.chat_runtime.generate_agent_response",
            return_value={
                "message": {"role": "assistant", "content": "結論:\n玄人モードで分析します。"},
                "mode": "openai_agents",
            },
        ) as generate,
    ):
        result = handle_chat(
            {
                "workspaceId": WORKSPACE_ID,
                "userId": USER_ID,
                "threadId": THREAD_ID,
                "message": "CPAが悪化している理由を教えて",
                "context": {
                    "advisorMode": "experienced",
                    "agentEntry": "performance_analyst_experienced",
                },
            }
        )

    assert result["mode"] == "openai_agents"
    sent_payload = generate.call_args.args[0]
    route_plan = sent_payload["context"]["routePlan"]
    assert route_plan["advisorMode"] == "experienced"
    assert route_plan["entryAgent"] == "performance_analyst_experienced"
    assert "実務者向け" in route_plan["modeContract"]


def test_handle_chat_mock_greeting_does_not_analyze_metrics() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=False),
    ):
        result = handle_chat(
            {
                "workspaceId": "demo-workspace",
                "userId": "demo-user",
                "threadId": "demo-thread",
                "message": "こんにちは",
            }
        )

    content = result["message"]["content"]
    assert "広告運用の状況整理" in content
    assert "CPAは前期間比で悪化" not in content
    assert "原因仮説:" not in content
    assert result["humanTaskDraft"]["priority"] == "low"


def test_handle_chat_skips_metric_prefetch_for_setup_question() -> None:
    repository = FakeRepository()

    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.get_repository", return_value=repository),
        patch(
            "ad_ops_advisor.chat_runtime.generate_agent_response",
            return_value={
                "message": {"role": "assistant", "content": "CV地点の設計軸を整理します。"},
                "mode": "openai_agents",
            },
        ) as generate,
    ):
        result = handle_chat(
            {
                "workspaceId": WORKSPACE_ID,
                "userId": USER_ID,
                "threadId": THREAD_ID,
                "message": "どこをコンバージョンとして設定したらいいか",
            }
        )

    assert result["mode"] == "openai_agents"
    assert repository.compare_call is None
    assert repository.tool_calls == []
    assert generate.call_args.args[0]["context"]["intent"]["intent"] == "setup"


def test_handle_chat_mock_setup_question_returns_design_guidance() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=False),
    ):
        result = handle_chat(
            {
                "workspaceId": "demo-workspace",
                "userId": "demo-user",
                "threadId": "demo-thread",
                "message": "どこをコンバージョンとして設定したらいいか",
            }
        )

    content = result["message"]["content"]
    assert "CV地点" in content
    assert "主CVと補助CV" in content
    assert "CPAは前期間比で悪化" not in content
    assert result["recommendation"]["title"] == "CV地点の判断軸を整理する"


def test_handle_chat_mock_budget_question_returns_delivery_diagnosis_order() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=False),
    ):
        result = handle_chat(
            {
                "workspaceId": "demo-workspace",
                "userId": "demo-user",
                "threadId": "demo-thread",
                "message": "予算が使いきれないときは何を見ればいい？",
            }
        )

    content = result["message"]["content"]
    assert "配信機会が足りない" in content
    assert "目標が厳しすぎる" in content
    assert "CPAは前期間比で悪化" not in content
    assert result["recommendation"]["title"] == "予算消化と学習状態を分けて確認する"


def test_handle_chat_api_persistence_mode_skips_agent_database_writes() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=False),
        patch("ad_ops_advisor.chat_runtime.get_repository", side_effect=AssertionError("Agent runtime should not persist API-managed chat")),
    ):
        result = handle_chat(
            {
                "workspaceId": WORKSPACE_ID,
                "userId": USER_ID,
                "threadId": THREAD_ID,
                "message": "CPAが悪化している理由を教えて",
                "context": {"apiPersistence": True},
            }
        )

    assert result["mode"] == "mock_api_persistence"
    assert result["message"]["role"] == "assistant"


def test_handle_chat_uses_openai_agent_for_non_uuid_demo_context_without_db_persistence() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=True),
        patch(
            "ad_ops_advisor.chat_runtime.generate_agent_response",
            return_value={
                "message": {"role": "assistant", "content": "結論:\nデモ文脈でもOpenAI Agent回答です。"},
                "mode": "openai_agents",
            },
        ) as generate,
    ):
        result = handle_chat(
            {
                "workspaceId": "demo-workspace",
                "userId": "demo-user",
                "threadId": "demo-thread",
                "message": "ROASについて見て",
            }
        )

    generate.assert_called_once()
    assert result["mode"] == "openai_agents"
    assert "DB persistence was skipped" in result["runtimeWarning"]


def test_handle_chat_raises_for_non_uuid_demo_context_when_openai_agent_fails() -> None:
    with (
        patch("ad_ops_advisor.chat_runtime.is_database_configured", return_value=True),
        patch("ad_ops_advisor.chat_runtime.is_agent_runtime_configured", return_value=True),
        patch(
            "ad_ops_advisor.chat_runtime.generate_agent_response",
            side_effect=AgentRuntimeError("OpenAI Agent request failed"),
        ),
    ):
        with pytest.raises(AgentRuntimeError, match="OpenAI Agent request failed"):
            handle_chat(
                {
                    "workspaceId": "demo-workspace",
                    "userId": "demo-user",
                    "threadId": "demo-thread",
                    "message": "ROASについて見て",
                }
            )


def assert_response_contract(result: dict) -> None:
    content = result["message"]["content"]

    assert result["message"]["role"] == "assistant"
    for section in REQUIRED_ANSWER_SECTIONS:
        assert f"{section}:" in content
    assert result["recommendation"]["operatorSteps"]
    assert result["humanTaskDraft"]["status"] == "suggested"


def assert_no_media_write_execution_claims(result: dict) -> None:
    content = result["message"]["content"]

    forbidden_claims = (
        "変更しました",
        "停止しました",
        "作成しました",
        "適用しました",
        "予算を下げました",
        "入札を上げました",
    )
    for claim in forbidden_claims:
        assert claim not in content
    assert "手動実行" in content or "管理画面" in content
