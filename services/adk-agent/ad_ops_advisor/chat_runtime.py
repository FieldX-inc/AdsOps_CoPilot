from __future__ import annotations

from typing import Any
from uuid import UUID

from .analysis import build_mock_chat_response, build_no_write_refusal_response
from .conversation_router import build_route_plan
from .intent import classify_intent
from .policies.no_write_policy import contains_secret, has_platform_write_intent
from .repositories import RepositoryError, get_repository, is_database_configured
from .runtime import (
    AgentRuntimeError,
    generate_agent_response,
    is_agent_runtime_configured,
)


def handle_chat(payload: dict[str, Any]) -> dict[str, Any]:
    """Handle a chat request with DB-backed context when available.

    Mock analysis is only used when the configured Agent runtime is unavailable.
    If the OpenAI Agent runtime is configured but fails, the error is surfaced
    to the API caller instead of silently falling back.
    """
    message = str(payload.get("message") or "")
    if contains_secret(payload):
        return build_secret_refusal_response(payload)

    if has_platform_write_intent(message):
        return build_no_write_refusal_response(payload)

    advisor_mode = _advisor_mode_from_payload(payload)
    intent = classify_intent(message)
    route_plan = build_route_plan(message, advisor_mode)
    payload_with_intent = _with_route_metadata(payload, intent.as_dict(), route_plan.as_dict())
    context_payload = payload_with_intent.get("context") if isinstance(payload_with_intent.get("context"), dict) else {}

    if context_payload.get("apiPersistence") is True:
        if is_agent_runtime_configured():
            response = generate_agent_response(
                payload_with_intent,
                {"intent": intent.as_dict(), "routePlan": route_plan.as_dict()},
            )
            response["mode"] = response.get("mode", "agent_api_persistence")
            return response
        response = build_mock_chat_response(payload_with_intent)
        response["mode"] = "mock_api_persistence"
        return response

    if is_agent_runtime_configured() and not is_database_configured():
        return generate_agent_response(payload_with_intent)

    if not is_database_configured():
        return build_mock_chat_response(payload_with_intent)

    workspace_id = str(payload["workspaceId"])
    user_id = str(payload["userId"])
    thread_id = str(payload["threadId"])
    if not all(_is_uuid(value) for value in (workspace_id, user_id, thread_id)):
        if is_agent_runtime_configured():
            response = generate_agent_response(payload_with_intent)
            response["mode"] = response.get("mode", "agent_demo")
            response["runtimeWarning"] = "DB persistence was skipped because workspaceId, userId, and threadId must be UUIDs."
            return response
        response = build_mock_chat_response(payload_with_intent)
        response["mode"] = "mock_demo"
        response["runtimeWarning"] = "DB-backed chat requires UUID workspaceId, userId, and threadId."
        return response

    repository = get_repository()
    message = str(payload["message"])
    ad_account_id = str(payload.get("adAccountId") or "")
    date_range = str(payload.get("dateRange") or "last_7_days")

    repository.ensure_agent_thread(workspace_id, user_id, thread_id, _title_from_message(message))
    repository.append_agent_message(workspace_id, thread_id, "user", message, user_id)

    context: dict[str, Any] = {"intent": intent.as_dict(), "routePlan": route_plan.as_dict()}
    try:
        if intent.requires_metrics_context:
            repository.record_tool_call(
                workspace_id,
                user_id,
                thread_id,
                "list_ad_accounts",
                "started",
                {"workspace_id": workspace_id},
            )
            accounts = repository.list_ad_accounts(workspace_id)
            repository.record_tool_call(
                workspace_id,
                user_id,
                thread_id,
                "list_ad_accounts",
                "succeeded",
                {"workspace_id": workspace_id},
                {"account_count": len(accounts)},
            )
            context["accounts"] = accounts

            selected_account_id = ad_account_id or (str(accounts[0]["id"]) if accounts else "")
            if selected_account_id:
                repository.record_tool_call(
                    workspace_id,
                    user_id,
                    thread_id,
                    "compare_period_metrics",
                    "started",
                    {"workspace_id": workspace_id, "ad_account_id": selected_account_id, "date_range": date_range},
                )
                metrics = repository.compare_period_metrics(
                    workspace_id,
                    selected_account_id,
                    date_range,
                    "previous_7_days",
                )
                repository.record_tool_call(
                    workspace_id,
                    user_id,
                    thread_id,
                    "compare_period_metrics",
                    "succeeded",
                    {"workspace_id": workspace_id, "ad_account_id": selected_account_id, "date_range": date_range},
                    {"campaign_count": len(metrics["current"]["campaigns"])},
                )
                context["latestAdData"] = _to_analysis_input(metrics)
    except RepositoryError as exc:
        repository.record_tool_call(
            workspace_id,
            user_id,
            thread_id,
            "chat_context",
            "failed",
            {"workspace_id": workspace_id},
            {},
            str(exc),
        )
        raise

    response = (
        generate_agent_response({**payload_with_intent, **context}, context)
        if is_agent_runtime_configured()
        else build_mock_chat_response({**payload_with_intent, **context})
    )

    repository.append_agent_message(
        workspace_id,
        thread_id,
        "assistant",
        response["message"]["content"],
        user_id,
        {"mode": response.get("mode", "db_backed_fallback")},
    )
    return response


def _with_route_metadata(payload: dict[str, Any], intent: dict[str, Any], route_plan: dict[str, Any]) -> dict[str, Any]:
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    return {
        **payload,
        "context": {
            **context,
            "intent": intent,
            "routePlan": route_plan,
        },
    }


def _advisor_mode_from_payload(payload: dict[str, Any]) -> str:
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    return "experienced" if context.get("advisorMode") == "experienced" else "beginner"


def _is_uuid(value: str) -> bool:
    try:
        UUID(value)
    except ValueError:
        return False
    return True


def _title_from_message(message: str) -> str:
    title = " ".join(message.strip().split())
    if not title:
        return "New conversation"
    return title[:80]


def build_secret_refusal_response(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "message": {
            "role": "assistant",
            "content": """結論:
secret、OAuth token、API key、service role keyらしき値は分析に使えません。安全のため、入力内容は再掲せず、広告指標や連携状態などsecretを除いた情報だけで相談してください。

根拠:
- AdOps Advisorはsecret/tokenをLLM prompt、agent memory、ログ、回答に含めない方針です
- OAuth tokenはserver-sideで暗号化保存し、ブラウザやAI文脈には渡しません

原因仮説:
今回の入力にはcredentialらしき文字列が含まれる可能性があります。実secretだった場合、共有画面や会話履歴に残すと危険です。

推奨アクション:
1. 実secretを貼った可能性がある場合は、そのcredentialを無効化またはローテーションする
2. 広告アカウント名、期間、KPI、困っている症状だけを入力し直す
3. 連携はAPIキー入力ではなく、OAuthと承認付き操作導線で行う

人間向け作業手順:
1. 入力した値が実credentialか確認する
2. 実credentialなら管理画面でローテーションする
3. credentialを除いた相談文でAIに再質問する

実施前チェック:
共有画面、ログ、チャット履歴にsecretらしき値が残っていないか確認してください。

リスク:
secretを会話やログに残すと、不正アクセスや権限漏洩につながる可能性があります。

実施後の観察:
ローテーション後、古いcredentialが無効になっていることと、アプリの連携状態に影響がないことを確認してください。

自信度:
High。secretをAI文脈に入れない方針は明確です。""",
        },
        "recommendation": {
            "title": "secretを除外して相談内容を入力し直す",
            "confidence": "high",
            "operatorSteps": [
                "実credentialか確認する",
                "必要ならcredentialをローテーションする",
                "secretを含まない広告指標だけで再質問する",
            ],
        },
        "humanTaskDraft": {
            "title": "secret混入の有無を確認する",
            "priority": "high",
            "status": "suggested",
        },
        "policy": {
            "name": "secret_exclusion",
            "enforced": True,
        },
    }


def _to_analysis_input(metrics: dict[str, Any]) -> dict[str, Any]:
    current = metrics["current"]
    comparison = metrics["comparison"]
    return {
        "current": {
            "label": current["date_range"],
            "totals": current["totals"],
        },
        "comparison": {
            "label": comparison["date_range"],
            "totals": comparison["totals"],
        },
        "changes": metrics["changes"],
        "campaigns": [
            {
                "campaign": row.get("campaign_name"),
                "platform": "all",
                **row,
            }
            for row in current["campaigns"]
        ],
        "anomalies": [],
    }
