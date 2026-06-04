from __future__ import annotations

import pytest

from ad_ops_advisor.intent import IntentLabel, classify_intent


@pytest.mark.parametrize(
    ("message", "expected_intent", "requires_metrics_context", "prefers_short_response"),
    [
        ("こんにちは、何ができますか？", IntentLabel.GREETING_CASUAL, False, True),
        ("今の広告運用、うまくいってる？ざっくり教えて", IntentLabel.STATUS_SUMMARY, True, True),
        ("CPAが悪化している原因を分析して", IntentLabel.DIAGNOSIS, True, False),
        ("これから広告を始めたい。媒体選定と初期設計を相談したい", IntentLabel.SETUP, False, False),
        ("どこをコンバージョンとして設定したらいいか", IntentLabel.SETUP, False, False),
        ("誰をターゲットにすべき？", IntentLabel.SETUP, False, False),
        ("予算が使いきれない理由と学習への影響を見て", IntentLabel.BUDGET_DELIVERY_LEARNING, True, False),
        ("Google広告のレスポンシブ検索広告の見出し文字数を教えて", IntentLabel.MEDIA_SPEC, False, True),
        ("RSAの説明文の上限とアセット仕様を確認したい", IntentLabel.MEDIA_SPEC, False, True),
        ("CPA改善のための作業手順と実施前チェックを作って", IntentLabel.ACTION_PLAN, True, False),
        ("指名検索と一般検索の考え方を教えて", IntentLabel.GENERAL_ADVICE, False, False),
        ("売上が落ちた原因を断定して", IntentLabel.DIAGNOSIS, True, False),
        ("CV地点の第一候補と補完候補を整理したい", IntentLabel.SETUP, False, False),
    ],
)
def test_classify_intent_for_japanese_ad_ops_questions(
    message: str,
    expected_intent: IntentLabel,
    requires_metrics_context: bool,
    prefers_short_response: bool,
) -> None:
    result = classify_intent(message)

    assert result.intent == expected_intent
    assert result.requires_metrics_context is requires_metrics_context
    assert result.prefers_short_response is prefers_short_response


def test_classify_intent_returns_serializable_dict_with_stable_keys() -> None:
    result = classify_intent("CPAが悪化している原因を短く教えて")

    assert result.as_dict() == {
        "intent": "diagnosis",
        "requires_metrics_context": True,
        "prefers_short_response": True,
    }


def test_classify_intent_does_not_treat_polite_metric_request_as_casual() -> None:
    result = classify_intent("CPA低下の原因分析をお願いします")

    assert result.intent == IntentLabel.DIAGNOSIS
    assert result.requires_metrics_context is True
    assert result.prefers_short_response is False


def test_classify_intent_prefers_media_spec_over_general_metric_words() -> None:
    result = classify_intent("Meta広告の動画サイズとアスペクト比の仕様を知りたい")

    assert result.intent == IntentLabel.MEDIA_SPEC
    assert result.requires_metrics_context is False
    assert result.prefers_short_response is True


def test_classify_intent_prefers_setup_for_pre_launch_campaign_structure() -> None:
    result = classify_intent("新商品のキャンペーン構成とターゲット整理を手伝って")

    assert result.intent == IntentLabel.SETUP
    assert result.requires_metrics_context is False


def test_classify_intent_keeps_cv_setup_terms_out_of_metrics_prefetch() -> None:
    result = classify_intent("マイクロコンバージョンと最終成果の使い分けを教えて")

    assert result.intent == IntentLabel.SETUP
    assert result.requires_metrics_context is False


def test_classify_intent_handles_empty_message_as_short_casual() -> None:
    result = classify_intent("   ")

    assert result.intent == IntentLabel.GREETING_CASUAL
    assert result.requires_metrics_context is False
    assert result.prefers_short_response is True
