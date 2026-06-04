from __future__ import annotations

from ad_ops_advisor.conversation_router import build_route_plan
from ad_ops_advisor.qa_gate import apply_qa_gate


def test_qa_gate_tempers_overconfident_claims() -> None:
    content, policy = apply_qa_gate(
        "結論:\n必ず改善します。原因はこれだけです。",
        build_route_plan("CPAが悪化している原因を分析して"),
    )

    assert "必ず改善します" not in content
    assert "原因はこれだけです" not in content
    assert "断定せず" in content
    assert policy == {
        "name": "qa_gate",
        "enforced": True,
        "checks": ["overconfident_claim_tempered", "required_sections_completed"],
    }


def test_qa_gate_tempers_live_conversation_overconfidence_variants() -> None:
    content, policy = apply_qa_gate(
        "結論:\n100%改善します。これが唯一の原因です。リスクはありません。",
        build_route_plan("売上が落ちた原因を断定して"),
    )

    assert "100%改善します" not in content
    assert "これが唯一の原因です" not in content
    assert "リスクはありません" not in content
    assert "断定せず" in content
    assert policy is not None
    assert "overconfident_claim_tempered" in policy["checks"]


def test_qa_gate_completes_required_sections_for_advice_routes() -> None:
    content, policy = apply_qa_gate(
        "結論:\nCPA悪化の可能性があります。",
        build_route_plan("CPAが悪化している原因を分析して"),
    )

    assert "QA補足" in content
    assert "人間向け作業手順" in content
    assert policy is not None
    assert "required_sections_completed" in policy["checks"]


def test_qa_gate_redacts_secret_like_model_output() -> None:
    content, policy = apply_qa_gate(
        "根拠:\napi_key=sk-test-dummy-not-a-real-secret を確認しました。",
        build_route_plan("CPAが悪化している原因を分析して"),
    )

    assert "sk-test-dummy" not in content
    assert "[REDACTED]" in content
    assert policy is not None
    assert "secret_like_output_redacted" in policy["checks"]


def test_qa_gate_redacts_public_and_google_api_key_like_model_output() -> None:
    content, policy = apply_qa_gate(
        "根拠:\npk-test-dummy-not-a-real-secret と AIzaSyDummyDummyDummyDummyDummyDummy を参照しました。",
        build_route_plan("CPAが悪化している原因を分析して"),
    )

    assert "pk-test-dummy" not in content
    assert "AIzaSyDummy" not in content
    assert content.count("[REDACTED]") >= 2
    assert policy is not None
    assert "secret_like_output_redacted" in policy["checks"]
