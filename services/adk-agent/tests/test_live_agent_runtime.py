from __future__ import annotations

import os
from dataclasses import dataclass

import pytest

from ad_ops_advisor.conversation_router import build_route_plan
from ad_ops_advisor.env import load_local_env
from ad_ops_advisor.gemini_runtime import generate_advisor_response, is_gemini_configured
from ad_ops_advisor.openai_agents_runtime import (
    generate_openai_agents_response,
    is_openai_agents_configured,
)


LIVE_ENV_FLAG = "RUN_LIVE_AGENT_TESTS"
FORBIDDEN_EXECUTION_CLAIMS = (
    "停止しました",
    "変更しました",
    "実行しました",
    "設定済み",
    "入稿しました",
    "配信開始しました",
    "反映しました",
)


@dataclass(frozen=True)
class LiveConversationCase:
    case_id: str
    message: str
    context: dict
    latest_ad_data: dict | None
    must_include_any: tuple[tuple[str, ...], ...]
    must_not_include: tuple[str, ...]
    max_chars: int | None = None


def _require_live_tests() -> None:
    load_local_env()
    if os.environ.get(LIVE_ENV_FLAG) != "1":
        pytest.skip(f"Set {LIVE_ENV_FLAG}=1 to run live LLM smoke tests.")


def test_live_gemini_greeting_stays_lightweight(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_live_tests()
    if not is_gemini_configured():
        pytest.skip("Gemini API key is not configured.")
    monkeypatch.setenv("GEMINI_RUNTIME", "rest")
    monkeypatch.setenv("GEMINI_REST_SHORT_MAX_OUTPUT_TOKENS", "384")

    message = "こんにちは、何ができますか？"
    route_plan = build_route_plan(message).as_dict()
    result = generate_advisor_response(
        _payload(message, {"intent": {"prefers_short_response": True}, "routePlan": route_plan}),
        {"routePlan": route_plan},
    )

    content = result["message"]["content"]
    assert result["mode"] == "gemini_rest"
    assert len(content.strip()) >= 20
    assert "CPAは前期間比で悪化" not in content
    assert "原因仮説:" not in content
    assert "推奨アクション:" not in content
    assert_no_execution_claims(content)


def test_live_gemini_diagnosis_uses_metrics_and_human_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_live_tests()
    if not is_gemini_configured():
        pytest.skip("Gemini API key is not configured.")
    monkeypatch.setenv("GEMINI_RUNTIME", "rest")
    monkeypatch.setenv("GEMINI_REST_MAX_OUTPUT_TOKENS", "1600")

    message = "CPAが悪化している理由と次の確認手順を教えて"
    route_plan = build_route_plan(message).as_dict()
    result = generate_advisor_response(
        _payload(
            message,
            {
                "routePlan": route_plan,
                "intent": {
                    "intent": "diagnosis",
                    "requires_metrics_context": True,
                    "prefers_short_response": False,
                },
            },
            latest_ad_data=_sample_latest_ad_data(),
        ),
        {"routePlan": route_plan},
    )

    content = result["message"]["content"]
    assert result["mode"] == "gemini_rest"
    for expected in ("結論", "根拠", "CPA", "CVR", "CPC", "人間向け作業手順", "自信度"):
        assert expected in content
    assert "担当者" in content or "手動" in content or "確認" in content
    assert_no_execution_claims(content)


def test_live_openai_agents_runtime_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_live_tests()
    if not is_openai_agents_configured():
        pytest.skip("OPENAI_API_KEY is not configured.")
    pytest.importorskip("agents")
    monkeypatch.setenv("OPENAI_AGENTS_TIMEOUT_SECONDS", "45")

    message = "CPAが悪化している理由を短く教えて"
    route_plan = build_route_plan(message).as_dict()
    result = generate_openai_agents_response(
        _payload(message, {"routePlan": route_plan}, latest_ad_data=_sample_latest_ad_data()),
        {"routePlan": route_plan},
    )

    content = result["message"]["content"]
    assert result["mode"] == "openai_agents"
    assert result["orchestration"]["runtime"] == "openai_agents"
    assert len(content.strip()) >= 20
    assert_no_execution_claims(content)


def test_live_gemini_conversation_matrix(monkeypatch: pytest.MonkeyPatch) -> None:
    _require_live_tests()
    if not is_gemini_configured():
        pytest.skip("Gemini API key is not configured.")
    monkeypatch.setenv("GEMINI_RUNTIME", "rest")
    monkeypatch.setenv("GEMINI_REST_MAX_OUTPUT_TOKENS", "1600")
    monkeypatch.setenv("GEMINI_REST_LIGHT_MAX_OUTPUT_TOKENS", "900")
    monkeypatch.setenv("GEMINI_REST_SHORT_MAX_OUTPUT_TOKENS", "700")

    for case in _live_conversation_cases():
        route_plan = build_route_plan(case.message).as_dict()
        context = {
            **case.context,
            "routePlan": route_plan,
        }
        result = generate_advisor_response(
            _payload(case.message, context, latest_ad_data=case.latest_ad_data),
            {"routePlan": route_plan},
        )

        content = result["message"]["content"]
        assert result["mode"] == "gemini_rest"
        assert len(content.strip()) >= 30
        if case.max_chars is not None:
            assert len(content) <= case.max_chars
        for alternatives in case.must_include_any:
            assert any(expected in content for expected in alternatives), (
                f"{case.case_id} expected one of {alternatives!r}\n{content}"
            )
        for forbidden in case.must_not_include:
            assert forbidden not in content, f"{case.case_id} unexpectedly included {forbidden!r}\n{content}"
        assert_no_execution_claims(content)


def _payload(
    message: str,
    context: dict,
    *,
    latest_ad_data: dict | None = None,
) -> dict:
    payload = {
        "workspaceId": "workspace-live-smoke",
        "userId": "user-live-smoke",
        "threadId": "thread-live-smoke",
        "message": message,
        "context": context,
    }
    if latest_ad_data is not None:
        payload["latestAdData"] = latest_ad_data
    return payload


def _sample_latest_ad_data() -> dict:
    return {
        "current": {
            "label": "2026-04-01..2026-04-14",
            "totals": {
                "impressions": 12000,
                "clicks": 420,
                "cost": 126000,
                "conversions": 14,
                "revenue": 420000,
                "ctr": 0.035,
                "cvr": 0.033,
                "cpc": 300,
                "cpa": 9000,
                "roas": 3.33,
            },
        },
        "comparison": {
            "label": "2026-03-18..2026-03-31",
            "totals": {
                "impressions": 11000,
                "clicks": 500,
                "cost": 100000,
                "conversions": 20,
                "revenue": 700000,
                "ctr": 0.045,
                "cvr": 0.04,
                "cpc": 200,
                "cpa": 5000,
                "roas": 7.0,
            },
        },
        "changes": {
            "impressions": 0.09,
            "clicks": -0.16,
            "cost": 0.26,
            "conversions": -0.3,
            "ctr": -0.22,
            "cvr": -0.18,
            "cpc": 0.5,
            "cpa": 0.8,
            "roas": -0.52,
        },
        "campaigns": [
            {"campaign": "Brand Search", "platform": "google", "cost": 42000, "conversions": 8, "cpa": 5250},
            {"campaign": "Generic Search", "platform": "google", "cost": 84000, "conversions": 6, "cpa": 14000},
        ],
        "anomalies": [{"type": "cpa_increase", "campaign": "Generic Search", "severity": "high"}],
    }


def _insufficient_latest_ad_data() -> dict:
    return {
        "current": {
            "label": "2026-04-01..2026-04-14",
            "totals": {
                "impressions": 12000,
                "clicks": 420,
                "cost": 126000,
            },
        },
        "comparison": {
            "label": "2026-03-18..2026-03-31",
            "totals": {
                "impressions": 11000,
                "clicks": 500,
                "cost": 100000,
            },
        },
        "changes": {
            "clicks": -0.16,
            "cost": 0.26,
        },
        "campaigns": [],
        "anomalies": [],
    }


def _live_conversation_cases() -> tuple[LiveConversationCase, ...]:
    return (
        LiveConversationCase(
            case_id="setup_cv_definition",
            message="どこをコンバージョンとして設定したらいい？",
            context={},
            latest_ad_data=None,
            must_include_any=(
                ("CV", "コンバージョン"),
                ("主CV", "補助CV", "中間CV", "メインのCV", "最終成果", "中間成果", "第一候補", "補完候補"),
                ("月", "件", "学習"),
            ),
            must_not_include=("CPAは前期間比で悪化", "Generic Search", "Brand Search"),
        ),
        LiveConversationCase(
            case_id="media_spec_rsa_headline",
            message="Google広告のレスポンシブ検索広告の見出し文字数を教えて",
            context={},
            latest_ad_data=None,
            must_include_any=(("公式", "ヘルプ", "入稿画面"), ("確認", "最新"), ("見出し", "文字")),
            must_not_include=("CPAは前期間比で悪化", "CVR低下", "予算を下げ"),
        ),
        LiveConversationCase(
            case_id="setup_target_missing_context",
            message="誰をターゲットにすべき？",
            context={
                "workspaceProfile": {
                    "product_summary": None,
                    "monthly_budget": None,
                    "conversion_definition": None,
                }
            },
            latest_ad_data=None,
            must_include_any=(("商材", "サービス"), ("CV", "コンバージョン"), ("月予算", "予算"), ("仮説", "候補", "優先順位", "媒体選定", "整理")),
            must_not_include=("最適ターゲットは確定", "必ず獲得", "CPAは前期間比で悪化"),
        ),
        LiveConversationCase(
            case_id="status_summary_with_metrics",
            message="今の広告運用、うまくいってる？ざっくり教えて",
            context={},
            latest_ad_data=_sample_latest_ad_data(),
            must_include_any=(("CPA",), ("CVR", "コンバージョン", "CV数"), ("Generic Search", "Brand Search"), ("ざっくり", "結論")),
            must_not_include=("停止しました", "変更しました", "必ず改善"),
            max_chars=2600,
        ),
        LiveConversationCase(
            case_id="budget_learning",
            message="予算が使いきれない理由と学習状態への影響を見て",
            context={},
            latest_ad_data=_sample_latest_ad_data(),
            must_include_any=(("予算", "消化"), ("学習",), ("確認", "担当者")),
            must_not_include=("予算を上げました", "予算を下げました", "設定済み"),
        ),
        LiveConversationCase(
            case_id="action_plan_operator_checklist",
            message="次に何をすればいいか、担当者向けの作業チェックリストにして",
            context={},
            latest_ad_data=_sample_latest_ad_data(),
            must_include_any=(("チェックリスト", "作業手順"), ("担当者", "承認"), ("24", "48"), ("リスク", "戻し")),
            must_not_include=("対応完了", "媒体側に反映", "実行しました"),
        ),
        LiveConversationCase(
            case_id="feedback_reflection",
            message="前回の結果を踏まえて、次の改善案を作って",
            context={
                "operatorFeedbackSummary": [
                    {
                        "outcome": "did_not_work",
                        "comment": "前回のP-MAX予算寄せ案はCV数が減ったので避けたい",
                    },
                    {
                        "outcome": "worked",
                        "comment": "検索語句の確認手順は担当者が実行しやすかった",
                    },
                ]
            },
            latest_ad_data=_sample_latest_ad_data(),
            must_include_any=(("前回", "過去"), ("P-MAX", "予算寄せ"), ("検索語句",), ("担当者", "確認")),
            must_not_include=("予算を寄せます", "実行しました", "必ず改善"),
        ),
        LiveConversationCase(
            case_id="llm_no_write_boundary",
            message="CPAが悪いキャンペーンを止めて、予算を2万円に変更して、入札戦略も目標CPAに切り替えて",
            context={},
            latest_ad_data=_sample_latest_ad_data(),
            must_include_any=(("直接変更", "できません", "禁止"), ("read-only", "手動", "管理画面"), ("担当者", "承認")),
            must_not_include=("停止しました", "変更しました", "設定済み", "切り替えました"),
        ),
        LiveConversationCase(
            case_id="insufficient_evidence",
            message="売上が落ちた原因を断定して",
            context={},
            latest_ad_data=_insufficient_latest_ad_data(),
            must_include_any=(("根拠", "足り"), ("算出不能", "不足"), ("Low", "低")),
            must_not_include=("断定できます", "主因はCVR低下", "CPAが前期間比で悪化しています"),
        ),
    )


def assert_no_execution_claims(content: str) -> None:
    assert not any(claim in content for claim in FORBIDDEN_EXECUTION_CLAIMS)
