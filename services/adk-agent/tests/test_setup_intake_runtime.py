from __future__ import annotations

from ad_ops_advisor.setup_intake_runtime import handle_setup_intake


def test_setup_intake_runtime_scores_dimensions_and_gates_steps() -> None:
    result = handle_setup_intake(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "message": (
                "目的は賃貸管理会社からの問い合わせ獲得です。商材はAIの賃貸管理支援SaaSで、"
                "月額10万円、強みは督促と問い合わせ対応の省力化です。ターゲットは中小の管理会社の"
                "経営者と現場責任者で、初月予算は30万円、Google検索とMetaを使いたいです。"
                "計測はGTMとGA4で資料請求フォームのサンクスページをCVにします。"
            ),
            "facts": {},
        }
    )

    assert result["score"] == min(10, round(sum(result["dimensionScores"].values()) / 10))
    assert result["score"] >= 8
    assert result["readyForSetupSteps"] is True
    assert result["missingFields"] == []
    assert result["setupSteps"]


def test_setup_intake_runtime_asks_three_or_fewer_questions_when_not_ready() -> None:
    result = handle_setup_intake(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "message": "広告をそろそろ始めたいです。",
            "facts": {},
        }
    )

    assert result["score"] < 8
    assert result["readyForSetupSteps"] is False
    assert result["setupSteps"] == []
    assert result["assistantMessage"].count("\n1.") <= 1
    assert sum(1 for line in result["assistantMessage"].splitlines() if line[:3] in {"1. ", "2. ", "3. "}) <= 3


def test_setup_intake_runtime_carries_forward_previous_facts() -> None:
    result = handle_setup_intake(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "message": "計測はGTMとGA4で資料請求フォームをCVにします。",
            "facts": {"goal": "問い合わせ獲得", "platforms": ["google"]},
        }
    )

    assert result["extractedFacts"]["goal"] == "問い合わせ獲得"
    assert result["extractedFacts"]["platforms"] == ["google"]
    assert "measurement" in result["extractedFacts"]


def test_setup_intake_runtime_maps_numbered_answers_to_previous_questions() -> None:
    result = handle_setup_intake(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "message": (
                "1.資料請求のお問い合わせ獲得\n"
                "2.賃貸管理会社特化のAIエージェント\n"
                "3.従業員数30名以上、管理戸数3000戸以上、自社物の管理ではなくオーナー様の物件を管理している会社"
            ),
            "facts": {
                "_intakeState": {
                    "lastAskedFields": ["goal", "product", "audience"],
                    "activeField": "goal",
                }
            },
        }
    )

    assert result["extractedFacts"]["goal"] == "資料請求のお問い合わせ獲得"
    assert result["extractedFacts"]["product"] == "賃貸管理会社特化のAIエージェント"
    assert "管理戸数3000戸以上" in result["extractedFacts"]["audience"]
    assert result["dimensionScores"]["audience"] >= 14
    assert result["extractedFacts"]["_intakeState"]["activeField"] != "audience"


def test_setup_intake_runtime_uses_active_field_for_short_answers() -> None:
    budget_result = handle_setup_intake(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "message": "200000くらい",
            "facts": {"_intakeState": {"activeField": "budget", "lastAskedFields": ["budget"]}},
        }
    )
    platform_result = handle_setup_intake(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "message": "google",
            "facts": {"_intakeState": {"activeField": "platforms", "lastAskedFields": ["platforms"]}},
        }
    )

    assert budget_result["extractedFacts"]["budget"] == "200000くらい"
    assert budget_result["dimensionScores"]["budget"] >= 10
    assert platform_result["extractedFacts"]["platforms"] == ["google"]
    assert platform_result["dimensionScores"]["platforms"] == 10


def test_setup_intake_runtime_normalizes_conversational_measurement_in_setup_steps() -> None:
    result = handle_setup_intake(
        {
            "workspaceId": "workspace-1",
            "userId": "user-1",
            "message": "フォーム完了だね",
            "facts": {
                "goal": "資料請求のお問い合わせ獲得",
                "product": "賃貸管理会社特化のAIエージェント",
                "audience": "従業員数30名以上、管理戸数3000戸以上の賃貸管理会社の決裁権者。自社物件のみの会社は追わない",
                "budget": "200000くらい",
                "platforms": ["Google"],
                "_intakeState": {"activeField": "measurement", "lastAskedFields": ["measurement"]},
            },
        }
    )
    joined = "\n".join(step for row in result["setupSteps"] for step in row["steps"])

    assert result["readyForSetupSteps"] is True
    assert any(label in joined for label in ["フォーム送信完了", "資料請求完了", "問い合わせ完了"])
    assert "だね" not in joined
    assert "名前に「フォーム完了だね」" not in joined
    assert "Metaなら" not in joined
    assert "Yahooなら" not in joined
    assert "Google/Yahoo検索広告" not in joined
    assert "Meta広告マネージャ" not in joined
    assert "Yahoo広告 管理画面" not in joined
