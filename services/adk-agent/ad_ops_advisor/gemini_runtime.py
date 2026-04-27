from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from typing import Any

from .policies.no_write_policy import looks_secret
from .repositories import _sanitize


DEFAULT_MODEL = "gemini-flash-latest"
APP_NAME = "ad_ops_advisor"


class GeminiRuntimeError(RuntimeError):
    """Raised when the Gemini runtime cannot produce a response."""


def is_gemini_configured() -> bool:
    return bool(_api_key())


def generate_advisor_response(payload: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    api_key = _api_key()
    if not api_key:
        raise GeminiRuntimeError("Gemini API key is not configured")

    message = str(payload.get("message") or "")
    if looks_secret(message):
        raise GeminiRuntimeError("User message appears to contain a secret")

    runtime = os.environ.get("GEMINI_RUNTIME", "auto").lower()
    if runtime == "rest":
        return _generate_rest_response(api_key, payload, context or {})

    _mirror_api_key_for_adk()

    try:
        from google.adk.runners import Runner
        from google.adk.sessions import InMemorySessionService
        from google.genai import types

        from .agent import root_agent
    except ImportError as exc:  # pragma: no cover - depends on optional runtime deps
        if runtime != "adk":
            return _generate_rest_response(api_key, payload, context or {}, "google-adk is not installed")
        raise GeminiRuntimeError("google-adk is not installed") from exc

    if root_agent is None:
        if runtime != "adk":
            return _generate_rest_response(api_key, payload, context or {}, "ADK root_agent is not available")
        raise GeminiRuntimeError("ADK root_agent is not available")

    try:
        content = asyncio.run(
            _run_adk_agent(
                Runner=Runner,
                InMemorySessionService=InMemorySessionService,
                types=types,
                root_agent=root_agent,
                payload=payload,
                context=context or {},
            )
        )
    except Exception as exc:
        if runtime != "adk":
            return _generate_rest_response(api_key, payload, context or {}, "ADK/Gemini request failed")
        raise GeminiRuntimeError("ADK/Gemini request failed") from exc
    if not content.strip():
        raise GeminiRuntimeError("ADK/Gemini returned an empty response")

    return _build_runtime_response(content, "adk_gemini", os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL)


def _generate_rest_response(
    api_key: str,
    payload: dict[str, Any],
    context: dict[str, Any],
    fallback_reason: str | None = None,
) -> dict[str, Any]:
    from .agent import ROOT_INSTRUCTION

    model = os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL
    body = {
        "systemInstruction": {
            "parts": [{"text": ROOT_INSTRUCTION}],
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": _build_user_prompt(payload, context)}],
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "topP": 0.8,
            "maxOutputTokens": 4096,
        },
    }
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )
    request = urllib.request.Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=float(os.environ.get("GEMINI_TIMEOUT_SECONDS", "45"))) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise GeminiRuntimeError(f"Gemini REST API returned HTTP {exc.code}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise GeminiRuntimeError(f"Gemini REST API request failed: {exc}") from exc

    content = _extract_rest_text(data)
    if not content.strip():
        raise GeminiRuntimeError("Gemini REST API returned an empty response")

    result = _build_runtime_response(content, "gemini_rest" if fallback_reason is None else "gemini_rest_fallback", model)
    if fallback_reason:
        result["runtimeWarning"] = fallback_reason
    return result


def _api_key() -> str | None:
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def _mirror_api_key_for_adk() -> None:
    if os.environ.get("GOOGLE_API_KEY"):
        return
    gemini_api_key = os.environ.get("GEMINI_API_KEY")
    if gemini_api_key:
        os.environ["GOOGLE_API_KEY"] = gemini_api_key


async def _run_adk_agent(
    *,
    Runner: Any,
    InMemorySessionService: Any,
    types: Any,
    root_agent: Any,
    payload: dict[str, Any],
    context: dict[str, Any],
) -> str:
    session_service = InMemorySessionService()
    runner = Runner(
        agent=root_agent,
        app_name=APP_NAME,
        session_service=session_service,
    )
    user_id = str(payload["userId"])
    session_id = str(payload["threadId"])
    await session_service.create_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=session_id,
    )
    user_content = types.Content(
        role="user",
        parts=[types.Part(text=_build_user_prompt(payload, context))],
    )

    final_text = ""
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=user_content,
    ):
        text = _event_text(event)
        if text:
            final_text = text
        is_final_response = getattr(event, "is_final_response", None)
        if callable(is_final_response) and is_final_response() and text:
            final_text = text

    return final_text.strip()


def _build_user_prompt(payload: dict[str, Any], context: dict[str, Any]) -> str:
    safe_payload = _sanitize(
        {
            "workspaceId": payload.get("workspaceId"),
            "userId": payload.get("userId"),
            "threadId": payload.get("threadId"),
            "message": payload.get("message"),
            "context": payload.get("context", {}),
            "latestAdData": payload.get("latestAdData"),
            "dbContext": context,
        }
    )
    return (
        "以下のworkspace/user scope済みコンテキストだけを根拠に、"
        "AdOps Advisorとして日本語で回答してください。"
        "媒体設定の直接変更は行わず、人間向け作業手順に変換してください。\n"
        "禁止表現: 「停止する」「予算を下げる」「入札を上げる」「除外する」「適用する」など、"
        "AIまたはユーザーがそのまま媒体writeを実行する命令形。"
        "必ず「停止候補として担当者が確認する」「予算調整案として担当者が判断する」"
        "「除外候補としてレビューする」のように、候補・担当者判断・手動実行前チェックへ変換してください。\n\n"
        f"{json.dumps(safe_payload, ensure_ascii=False, indent=2)}"
    )


def _event_text(event: Any) -> str:
    content = getattr(event, "content", None)
    event_parts = getattr(content, "parts", None)
    if not event_parts:
        return ""

    texts: list[str] = []
    for part in event_parts:
        text = getattr(part, "text", None)
        if text:
            texts.append(str(text))
    return "".join(texts)


def _extract_rest_text(data: dict[str, Any]) -> str:
    parts: list[str] = []
    for candidate in data.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            text = part.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "\n".join(parts)


def _first_content_line(content: str) -> str:
    for line in content.splitlines():
        cleaned = line.strip().strip("#").strip()
        if cleaned and not cleaned.endswith(":"):
            return cleaned[:120]
    return "AI Advisorの推奨アクション"


def _build_runtime_response(content: str, mode: str, model: str) -> dict[str, Any]:
    guarded_content, guard_applied = _apply_human_in_loop_guard(content)
    result = {
        "message": {
            "role": "assistant",
            "content": guarded_content,
        },
        "recommendation": {
            "title": _first_content_line(guarded_content),
            "confidence": _extract_confidence(guarded_content),
            "operatorSteps": _extract_operator_steps(guarded_content),
        },
        "humanTaskDraft": {
            "title": _first_content_line(guarded_content),
            "priority": "high" if "High" in guarded_content or "高" in guarded_content else "medium",
            "status": "suggested",
        },
        "mode": mode,
        "model": model,
    }
    if guard_applied:
        result["policy"] = {"name": "human_in_the_loop_rewrite", "enforced": True}
    return result


def _apply_human_in_loop_guard(content: str) -> tuple[str, bool]:
    guarded = content
    replacements = (
        ("キャンペーンを停止してください", "キャンペーンの停止候補を担当者が確認してください"),
        ("広告グループを停止してください", "広告グループの停止候補を担当者が確認してください"),
        ("広告セットを停止してください", "広告セットの停止候補を担当者が確認してください"),
        ("広告を停止してください", "広告の停止候補を担当者が確認してください"),
        ("キャンペーンを停止します", "キャンペーンの停止候補として整理します"),
        ("広告グループを停止します", "広告グループの停止候補として整理します"),
        ("広告セットを停止します", "広告セットの停止候補として整理します"),
        ("広告を停止します", "広告の停止候補として整理します"),
        ("キャンペーンを停止する", "キャンペーンを停止候補として担当者が確認する"),
        ("広告グループを停止する", "広告グループを停止候補として担当者が確認する"),
        ("広告セットを停止する", "広告セットを停止候補として担当者が確認する"),
        ("広告を停止する", "広告を停止候補として担当者が確認する"),
        ("予算を下げてください", "予算引き下げ候補を担当者が確認してください"),
        ("予算を上げてください", "予算引き上げ候補を担当者が確認してください"),
        ("予算を減らしてください", "予算調整候補を担当者が確認してください"),
        ("予算を増やしてください", "予算調整候補を担当者が確認してください"),
        ("予算を下げます", "予算引き下げ候補として整理します"),
        ("予算を上げます", "予算引き上げ候補として整理します"),
        ("予算を減らします", "予算調整候補として整理します"),
        ("予算を増やします", "予算調整候補として整理します"),
        ("予算を下げる", "予算引き下げ候補として担当者が判断する"),
        ("予算を上げる", "予算引き上げ候補として担当者が判断する"),
        ("予算を減らす", "予算調整候補として担当者が判断する"),
        ("予算を増やす", "予算調整候補として担当者が判断する"),
        ("入札単価を下げる", "入札単価の調整候補として担当者が判断する"),
        ("入札単価を上げる", "入札単価の調整候補として担当者が判断する"),
        ("入札を下げる", "入札調整候補として担当者が判断する"),
        ("入札を上げる", "入札調整候補として担当者が判断する"),
        ("ターゲティングを変更する", "ターゲティング変更候補として担当者が確認する"),
        ("設定を変更する", "設定変更候補として担当者が確認する"),
        ("広告を作成する", "広告作成案として担当者が確認する"),
        ("広告を追加する", "広告追加案として担当者が確認する"),
        ("広告を入稿してください", "広告入稿案を担当者が確認してください"),
        ("広告を入稿します", "広告入稿案として整理します"),
        ("広告を入稿する", "広告入稿案として担当者が確認する"),
        ("除外キーワードを追加する", "除外キーワード候補として担当者がレビューする"),
        ("検索語句を除外する", "検索語句を除外候補として担当者がレビューする"),
        ("プレースメントを除外する", "プレースメントを除外候補として担当者がレビューする"),
        ("変更を適用する", "変更案を担当者が確認し、承認後に手動適用する"),
        ("設定を適用する", "設定案を担当者が確認し、承認後に手動適用する"),
    )
    for unsafe, safe in replacements:
        guarded = guarded.replace(unsafe, safe)

    guard_applied = guarded != content
    if guard_applied and "担当者" not in guarded:
        guarded += "\n\n注記:\n上記は媒体write実行ではなく、担当者が管理画面で確認・判断する変更候補です。"
    return guarded, guard_applied


def _extract_confidence(content: str) -> str:
    confidence_text = content.split("自信度", 1)[1] if "自信度" in content else content
    confidence_text = confidence_text[:160]
    lowered = confidence_text.lower()
    if "high" in lowered or "高" in confidence_text:
        return "high"
    if "low" in lowered or "低" in confidence_text:
        return "low"
    return "medium"


def _extract_operator_steps(content: str) -> list[str]:
    lines = []
    capture = False
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("人間向け作業手順"):
            capture = True
            continue
        if capture and stripped.endswith(":"):
            break
        if capture and stripped:
            lines.append(stripped.lstrip("-0123456789. "))
        if len(lines) >= 5:
            break
    return lines or ["媒体管理画面で対象指標を確認する", "担当者が変更可否を判断する", "実施後24〜48時間の指標を観察する"]
