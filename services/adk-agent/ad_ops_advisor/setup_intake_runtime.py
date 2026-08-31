from __future__ import annotations

import re
from typing import Any

DIMENSION_MAX = {
    "goal": 15,
    "product": 20,
    "audience": 20,
    "budget": 15,
    "platforms": 10,
    "measurement": 20,
}

FIELD_ORDER = ["goal", "product", "audience", "budget", "platforms", "measurement"]

QUESTION_TEXT = {
    "goal": "今回の広告で一番増やしたい成果は何ですか？問い合わせ、資料請求、購入、予約などで教えてください。",
    "product": "売りたい商材の内容、価格帯、選ばれる理由を教えてください。",
    "audience": "最初に届けたい顧客像を、会社規模・業種・役職などで教えてください。追わない層があればそれも添えてください。",
    "budget": "初月の広告予算、またはこれ以上は使いたくない上限を教えてください。",
    "platforms": "Google、Meta、Yahooのうち、使いたい媒体や迷っている媒体はありますか？",
    "measurement": "成果地点と計測方法は決まっていますか？例: フォーム完了、サンクスページ、GA4/GTM、CRMなど。",
}


def handle_setup_intake(payload: dict[str, Any]) -> dict[str, Any]:
    message = str(payload.get("message") or "").strip()
    previous = payload.get("facts") if isinstance(payload.get("facts"), dict) else {}
    messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
    extracted = _extract_facts(message, previous, messages)
    dimension_scores = _score_facts(extracted)
    score = max(0, min(10, round(sum(dimension_scores.values()) / 10)))
    missing_fields = _missing_fields(dimension_scores)
    ready = score >= 8
    next_field = None if ready else _next_field(missing_fields, extracted)
    extracted["_intakeState"] = _state_for(extracted, dimension_scores, next_field)
    return {
        "assistantMessage": _assistant_message(extracted, score, missing_fields, ready, next_field),
        "extractedFacts": extracted,
        "dimensionScores": dimension_scores,
        "score": score,
        "missingFields": missing_fields,
        "readyForSetupSteps": ready,
        "setupSteps": _setup_steps(extracted) if ready else [],
    }


def _extract_facts(message: str, previous: dict[str, Any], messages: list[Any]) -> dict[str, Any]:
    facts = dict(previous)
    state = _normalize_state(facts)
    facts.pop("_intakeState", None)
    assignments = _numbered_assignments(message, state, messages)
    if not assignments and state.get("activeField") in FIELD_ORDER and message:
        assignments[str(state["activeField"])] = message

    for field, value in assignments.items():
        _set_fact(facts, field, value, force=True)

    if message:
        _extract_by_patterns(facts, message)
        facts["lastNote"] = message
    facts["_intakeState"] = state
    return facts


def _normalize_state(facts: dict[str, Any]) -> dict[str, Any]:
    raw = facts.get("_intakeState") if isinstance(facts.get("_intakeState"), dict) else {}
    answered = set(raw.get("answeredFields") if isinstance(raw.get("answeredFields"), list) else [])
    for field in FIELD_ORDER:
        if _has_fact(facts, field):
            answered.add(field)
    return {
        "activeField": raw.get("activeField") if raw.get("activeField") in FIELD_ORDER else None,
        "lastAskedFields": [field for field in raw.get("lastAskedFields", []) if field in FIELD_ORDER]
        if isinstance(raw.get("lastAskedFields"), list)
        else [],
        "answeredFields": sorted(answered, key=FIELD_ORDER.index),
        "fieldConfidence": raw.get("fieldConfidence") if isinstance(raw.get("fieldConfidence"), dict) else {},
    }


def _numbered_assignments(message: str, state: dict[str, Any], messages: list[Any]) -> dict[str, str]:
    asked = state.get("lastAskedFields") if isinstance(state.get("lastAskedFields"), list) else []
    if len(asked) <= 1:
        asked = _asked_fields_from_messages(messages)
    if len(asked) <= 1:
        return {}
    pairs = re.findall(r"(?:^|\n)\s*(\d+)[\.\)．、]?\s*([^\n]+)", message)
    result: dict[str, str] = {}
    for number, value in pairs:
        index = int(number) - 1
        if 0 <= index < len(asked) and value.strip():
            result[str(asked[index])] = value.strip()
    return result


def _asked_fields_from_messages(messages: list[Any]) -> list[str]:
    for item in reversed(messages):
        if not isinstance(item, dict) or item.get("role") != "assistant":
            continue
        content = str(item.get("content") or "")
        fields = [field for field, question in QUESTION_TEXT.items() if question[:15] in content]
        if fields:
            return fields
    return []


def _extract_by_patterns(facts: dict[str, Any], text: str) -> None:
    if re.search(r"問い合わせ|購入|予約|来店|資料請求|リード|売上|認知|CV|コンバージョン", text, re.I):
        _set_fact(facts, "goal", text)
    if re.search(r"サービス|商品|商材|LP|価格|月額|店舗|SaaS|AI|エージェント|広告運用|不動産|管理", text, re.I):
        _set_fact(facts, "product", text)
    if re.search(r"向け|ターゲット|顧客|企業|個人|担当者|経営者|決裁|従業員|管理戸数|オーナー|会社|法人|地域|業界|層|追わない|除外", text, re.I):
        _set_fact(facts, "audience", text)
    if _budget_amount(text) or re.search(r"予算|円|万円|月|初月|CPA|CPL|単価|上限", text, re.I):
        _set_fact(facts, "budget", text)
    if re.search(r"計測|GA4|GTM|タグ|thanks|サンクス|フォーム完了|問い合わせ完了|電話|CRM|HubSpot|コンバージョン", text, re.I):
        _set_fact(facts, "measurement", text)

    platforms = set(facts.get("platforms") if isinstance(facts.get("platforms"), list) else [])
    if re.search(r"google|グーグル|検索", text, re.I):
        platforms.add("google")
    if re.search(r"meta|facebook|instagram|インスタ|fb", text, re.I):
        platforms.add("meta")
    if re.search(r"yahoo|ヤフー", text, re.I):
        platforms.add("yahoo")
    if platforms:
        facts["platforms"] = sorted(platforms)


def _set_fact(facts: dict[str, Any], field: str, value: str, force: bool = False) -> None:
    text = str(value or "").strip()
    if not text or field not in FIELD_ORDER:
        return
    if field == "platforms":
        platforms = set(facts.get("platforms") if isinstance(facts.get("platforms"), list) else [])
        _extract_platforms_from_text(text, platforms)
        if platforms:
            facts["platforms"] = sorted(platforms)
        return
    existing = str(facts.get(field) or "").strip()
    if force or not existing:
        facts[field] = text


def _extract_platforms_from_text(text: str, platforms: set[str]) -> None:
    if re.search(r"google|グーグル|検索", text, re.I):
        platforms.add("google")
    if re.search(r"meta|facebook|instagram|インスタ|fb", text, re.I):
        platforms.add("meta")
    if re.search(r"yahoo|ヤフー", text, re.I):
        platforms.add("yahoo")


def _score_facts(facts: dict[str, Any]) -> dict[str, int]:
    return {
        "goal": _score_goal(facts.get("goal")),
        "product": _score_product(facts.get("product")),
        "audience": _score_audience(facts.get("audience")),
        "budget": _score_budget(facts.get("budget")),
        "platforms": 10 if isinstance(facts.get("platforms"), list) and facts["platforms"] else 0,
        "measurement": _score_measurement(facts.get("measurement")),
    }


def _score_goal(value: Any) -> int:
    text = str(value or "").strip()
    if not text:
        return 0
    return 15 if re.search(r"問い合わせ|資料請求|購入|予約|来店|リード|売上|CV|コンバージョン", text, re.I) else 8


def _score_product(value: Any) -> int:
    text = str(value or "").strip()
    if not text:
        return 0
    score = 10
    if re.search(r"AI|SaaS|サービス|商品|商材|エージェント|不動産|管理", text, re.I):
        score += 4
    if re.search(r"価格|月額|万円|円", text, re.I):
        score += 3
    if len(text) >= 35:
        score += 3
    return min(score, 20)


def _score_audience(value: Any) -> int:
    text = str(value or "").strip()
    if not text:
        return 0
    score = 8
    if re.search(r"ターゲット|顧客|届けたい|狙う|向け", text):
        score += 3
    if re.search(r"従業員|管理戸数|売上|規模|名以上|戸以上|以上", text):
        score += 5
    if re.search(r"決裁|経営者|担当者|責任者|会社|法人|企業|業界|中小|管理会社", text):
        score += 5
    if re.search(r"追わない|除外|ではなく|以外|自社物", text):
        score += 2
    return min(score, 20)


def _score_budget(value: Any) -> int:
    text = str(value or "").strip()
    if not text:
        return 0
    if _budget_amount(text):
        return 15 if re.search(r"月|初月|上限|予算", text) else 12
    return 7


def _score_measurement(value: Any) -> int:
    text = str(value or "").strip()
    if not text:
        return 0
    score = 8
    if re.search(r"フォーム完了|問い合わせ完了|サンクス|thanks|電話|資料請求", text, re.I):
        score += 6
    if re.search(r"GA4|GTM|タグ|CRM|HubSpot|媒体", text, re.I):
        score += 6
    return min(score, 20)


def _budget_amount(text: str) -> bool:
    return bool(re.search(r"(?:\d{2,}(?:,\d{3})*|\d+(?:\.\d+)?\s*万)\s*(?:円|くらい|程度|前後)?", text))


def _missing_fields(scores: dict[str, int]) -> list[str]:
    return [key for key, max_score in DIMENSION_MAX.items() if scores.get(key, 0) < round(max_score * 0.7)]


def _next_field(missing_fields: list[str], facts: dict[str, Any]) -> str | None:
    state = _normalize_state(facts)
    active = state.get("activeField")
    for field in missing_fields:
        if field != active:
            return field
    return missing_fields[0] if missing_fields else None


def _state_for(facts: dict[str, Any], scores: dict[str, int], next_field: str | None) -> dict[str, Any]:
    answered = [field for field in FIELD_ORDER if _has_fact(facts, field)]
    return {
        "activeField": next_field,
        "lastAskedFields": [next_field] if next_field else [],
        "answeredFields": answered,
        "fieldConfidence": scores,
    }


def _has_fact(facts: dict[str, Any], field: str) -> bool:
    value = facts.get(field)
    if field == "platforms":
        return isinstance(value, list) and bool(value)
    return bool(str(value or "").strip())


def _assistant_message(facts: dict[str, Any], score: int, missing_fields: list[str], ready: bool, next_field: str | None) -> str:
    if ready:
        return f"準備スコアは {score}/10 です。出稿ステップを確認できる状態になりました。画面のステップを確認し、必要な文言を編集してください。"
    captured = _captured_summary(facts)
    question = QUESTION_TEXT.get(next_field or "", "不足している前提をもう少し教えてください。")
    return "\n".join(
        [
            f"準備スコアは {score}/10 です。ここまでの内容は保存しました。",
            captured,
            "",
            f"次に1つだけ確認します。{question}",
            "媒体設定の直接変更は行わず、準備が整ったら人間向けの確認手順に変換します。",
        ]
    )


def _captured_summary(facts: dict[str, Any]) -> str:
    labels = {
        "goal": "目的",
        "product": "商材",
        "audience": "ターゲット",
        "budget": "予算",
        "platforms": "媒体",
        "measurement": "計測",
    }
    parts = []
    for field in FIELD_ORDER:
        if _has_fact(facts, field):
            value = facts[field]
            text = " / ".join(value) if isinstance(value, list) else str(value)
            parts.append(f"{labels[field]}: {text[:48]}")
    return "保存済み: " + "、".join(parts) if parts else "保存済み: まだ主要項目は未確定です。"


def _setup_steps(facts: dict[str, Any]) -> list[dict[str, Any]]:
    config = _instruction_config(facts)
    return [
        {
            "id": "measurement",
            "title": "1. CV計測を設定",
            "steps": _measurement_steps(config),
        },
        {
            "id": "campaign",
            "title": "2. キャンペーンを作成",
            "steps": _campaign_steps(config),
        },
        {
            "id": "targeting",
            "title": "3. 配信対象を設定",
            "steps": _targeting_steps(config),
        },
        {
            "id": "keywords",
            "title": "4. キーワード/訴求を入力",
            "steps": _creative_steps(config),
        },
        {
            "id": "platform",
            "title": "5. 媒体別の最終確認",
            "steps": [step for platform in config["platforms"] for step in _platform_steps(str(platform), config)],
        },
        {
            "id": "observation",
            "title": "6. 初回7日間を観察",
            "steps": [
                "毎日、費用・クリック・CV・CPA/CPL・CV計測漏れを確認する。",
                "検索語句/配信面/広告文ごとの反応を見て、明らかにズレた語句や面を除外候補にする。",
                "停止・予算変更・除外は担当者が根拠を確認してから手動反映する。",
            ],
        },
    ]


def _instruction_config(facts: dict[str, Any]) -> dict[str, Any]:
    platforms = _normalize_platforms(facts.get("platforms"))
    goal = _goal_label(facts)
    product = _compact_fact(facts.get("product"), "訴求する商材")
    audience = _compact_fact(facts.get("audience"), "最初に届けたい顧客像")
    budget = _compact_fact(facts.get("budget"), "初月予算")
    measurement = _conversion_name(facts)
    keywords = _keyword_ideas(facts)
    exclusions = _exclusion_ideas(facts)
    area = _area_idea(facts)
    daily_budget = _daily_budget(budget)
    campaign_name = f"{product[:18]}_{goal[:10]}_初期配信"
    return {
        "platforms": platforms,
        "goal": goal,
        "product": product,
        "audience": audience,
        "budget": budget,
        "measurement": measurement,
        "conversion_event": _conversion_event(facts),
        "keywords": keywords,
        "exclusions": exclusions,
        "area": area,
        "daily_budget": daily_budget,
        "campaign_name": campaign_name,
        "ad_copy": _ad_copy_ideas(product, goal, audience),
    }


def _normalize_platforms(value: Any) -> list[str]:
    raw = value if isinstance(value, list) and value else ["google"]
    platforms: list[str] = []
    for item in raw:
        text = str(item).lower()
        if "meta" in text or "facebook" in text or "instagram" in text:
            platforms.append("meta")
        elif "yahoo" in text:
            platforms.append("yahoo")
        elif "google" in text:
            platforms.append("google")
    return list(dict.fromkeys(platforms)) or ["google"]


def _platform_steps(platform: str, config: dict[str, Any]) -> list[str]:
    if platform == "meta":
        return [f"Meta広告マネージャで「作成 > キャンペーン目的」を開き、「リード」または「コンバージョン」を選択する。キャンペーン名は「{config['campaign_name']}」。", f"「広告セット > コンバージョンの場所」でWebサイトまたはインスタントフォームを選び、成果地点を「{config['measurement']}」に合わせる。", f"「広告セット > 予算と掲載期間」の日予算に「{config['daily_budget']}」を入力し、地域は「{config['area']}」を指定する。", f"「広告 > メインテキスト/見出し」に「{config['ad_copy']['headlines'][0]}」「{config['ad_copy']['descriptions'][0]}」を入力する。"]
    if platform == "yahoo":
        return [f"Yahoo広告 管理画面で「検索広告 > キャンペーン作成」を開き、キャンペーン名に「{config['campaign_name']}」を入力する。", f"「キャンペーン設定 > 1日の予算」に「{config['daily_budget']}」を入力し、地域ターゲティングに「{config['area']}」を設定する。", f"「広告グループ > キーワード」に「{'」「'.join(config['keywords'])}」を入力し、除外キーワードに「{'」「'.join(config['exclusions'])}」を入れる。", f"「広告作成 > タイトル/説明文」に「{config['ad_copy']['headlines'][0]}」「{config['ad_copy']['descriptions'][0]}」を入力する。"]
    return [f"Google広告で「新しいキャンペーン > 見込み顧客 > 検索」を選び、キャンペーン名に「{config['campaign_name']}」を入力する。", f"「単価設定」ではCV計測「{config['measurement']}」を使う前提で、初期はコンバージョン数の最大化または手動CPCを選ぶ。", f"「予算」欄に日予算「{config['daily_budget']}」を入力し、「地域」欄に「{config['area']}」を設定する。", f"「キーワード」欄に「{'」「'.join(config['keywords'])}」を入力し、「除外キーワード」に「{'」「'.join(config['exclusions'])}」を入れる。", f"「広告」欄の見出し/説明文に「{'」「'.join(config['ad_copy']['headlines'])}」「{'」「'.join(config['ad_copy']['descriptions'])}」を入力する。"]


def _measurement_steps(config: dict[str, Any]) -> list[str]:
    steps: list[str] = []
    if "google" in config["platforms"]:
        steps.append(f"Google広告の「目標 > コンバージョン > 新しいコンバージョンアクション」を開き、コンバージョン名に「{config['measurement']}」を入力する。カテゴリは「リード」または「お問い合わせ」を選ぶ。")
    if "meta" in config["platforms"]:
        steps.append(f"Metaイベントマネージャの「データソース > イベント」を開き、標準イベント「{config['conversion_event']}」またはカスタムCV「{config['measurement']}」を作成して、送信完了条件に紐付ける。")
    if "yahoo" in config["platforms"]:
        steps.append(f"Yahoo広告 管理画面の「ツール > コンバージョン測定」を開き、コンバージョン名に「{config['measurement']}」を入力して、サイトジェネラルタグ/コンバージョン測定タグの設置先を確認する。")
    steps.append(f"GTM/GA4では、フォーム送信完了ページまたは送信完了イベントを発火条件にし、テスト送信で「{config['measurement']}」が記録されるか確認する。")
    return steps


def _campaign_steps(config: dict[str, Any]) -> list[str]:
    steps: list[str] = []
    for platform in config["platforms"]:
        if platform == "meta":
            steps.extend([
                f"Meta広告マネージャで「作成」を押し、キャンペーン目的は「リード」または「コンバージョン」を選ぶ。成果目的は「{config['goal']}」。",
                f"キャンペーン名に「{config['campaign_name']}」を入力し、広告セットの「予算と掲載期間」で日予算「{config['daily_budget']}」を設定する。",
            ])
        elif platform == "yahoo":
            steps.extend([
                f"Yahoo広告 管理画面で「検索広告 > キャンペーン作成」を開き、キャンペーン名に「{config['campaign_name']}」を入力する。",
                f"キャンペーン目的は「サイト誘導/コンバージョン」前提で、1日の予算に「{config['daily_budget']}」を設定する。",
            ])
        else:
            steps.extend([
                f"Google広告で「新しいキャンペーン > 見込み顧客 > 検索」を選び、キャンペーン名に「{config['campaign_name']}」を入力する。",
                f"「予算」欄に日予算「{config['daily_budget']}」を入力し、月額上限メモとして「{config['budget']}」を控える。",
            ])
    return steps


def _targeting_steps(config: dict[str, Any]) -> list[str]:
    steps: list[str] = []
    for platform in config["platforms"]:
        if platform == "meta":
            steps.extend([
                f"Metaの「広告セット > オーディエンス > 地域」に「{config['area']}」を設定する。",
                f"詳細ターゲット設定や運用メモには「{config['audience']}」を残し、追わない層は除外条件または配信後の除外判断メモにする。",
            ])
        elif platform == "yahoo":
            steps.extend([
                f"Yahoo広告の「キャンペーン設定 > 地域ターゲティング」に「{config['area']}」を設定する。",
                f"「広告グループ > 除外キーワード」に「{'」「'.join(config['exclusions'])}」を候補として入力する。",
            ])
        else:
            steps.extend([
                f"Google広告の「キャンペーン > 設定 > 地域」で「{config['area']}」を入力し、所在地オプションは「所在地: ターゲット地域にいるユーザー」を選ぶ。",
                f"「除外キーワード」に「{'」「'.join(config['exclusions'])}」を候補として入力する。オーディエンス条件のメモには「{config['audience']}」を残す。",
            ])
    return steps


def _creative_steps(config: dict[str, Any]) -> list[str]:
    search_platforms = [platform for platform in config["platforms"] if platform in {"google", "yahoo"}]
    steps: list[str] = []
    if search_platforms:
        label = " / ".join(_platform_label(platform) for platform in search_platforms)
        steps.append(f"{label}の「キーワード」画面で、初期キーワードに「{'」「'.join(config['keywords'])}」をフレーズ一致または完全一致で入力する。")
        steps.append(f"{label}の広告作成画面で、見出しに「{'」「'.join(config['ad_copy']['headlines'])}」を入力する。")
    if "meta" in config["platforms"]:
        steps.append(f"Metaの「広告 > メインテキスト」に「{config['ad_copy']['descriptions'][0]}」を、見出しに「{config['ad_copy']['headlines'][0]}」を入力する。CTAは「お問い合わせ」または「詳しくはこちら」を選ぶ。")
    else:
        steps.append(f"説明文欄には「{'」「'.join(config['ad_copy']['descriptions'])}」を入力する。")
    return steps


def _platform_label(platform: str) -> str:
    if platform == "meta":
        return "Meta"
    if platform == "yahoo":
        return "Yahoo広告"
    return "Google広告"


def _compact_fact(value: Any, fallback: str) -> str:
    text = _clean_text(str(value or ""))
    return text[:80] if text else fallback


def _clean_text(value: str) -> str:
    text = re.sub(r"\s+", " ", value)
    text = re.sub(r"^\s*\d+[.)．、]\s*", "", text)
    text = re.sub(r"[「」『』\"']", "", text)
    text = re.sub(r"[。.!！?？\s]*(だね|ですね|です|ます|かな|かも|くらい|程度|でお願いします|でいいです)$", "", text)
    return text.strip()


def _goal_label(facts: dict[str, Any]) -> str:
    text = f"{facts.get('goal', '')} {facts.get('measurement', '')}"
    if "資料請求" in text and re.search(r"問い合わせ|問合せ", text):
        return "資料請求・問い合わせ獲得"
    if "資料請求" in text:
        return "資料請求獲得"
    if re.search(r"問い合わせ|問合せ", text):
        return "問い合わせ獲得"
    if "予約" in text:
        return "予約獲得"
    if re.search(r"購入|EC|売上", text):
        return "購入獲得"
    return _compact_fact(facts.get("goal"), "資料請求/問い合わせ獲得")


def _conversion_name(facts: dict[str, Any]) -> str:
    text = _clean_text(f"{facts.get('measurement', '')} {facts.get('goal', '')}")
    if "資料請求" in text:
        return "資料請求完了"
    if re.search(r"問い合わせ|問合せ", text):
        return "問い合わせ完了"
    if re.search(r"フォーム|form", text, re.I):
        return "フォーム送信完了"
    if "予約" in text:
        return "予約完了"
    if re.search(r"購入|決済|注文", text):
        return "購入完了"
    if "電話" in text:
        return "電話問い合わせ"
    return "フォーム送信完了"


def _conversion_event(facts: dict[str, Any]) -> str:
    text = f"{facts.get('measurement', '')} {facts.get('goal', '')}"
    if re.search(r"購入|決済|注文", text):
        return "Purchase"
    if "予約" in text:
        return "Schedule"
    if "電話" in text:
        return "Contact"
    return "Lead"


def _keyword_ideas(facts: dict[str, Any]) -> list[str]:
    text = f"{facts.get('product', '')} {facts.get('audience', '')}"
    ideas: list[str] = []
    if re.search(r"賃貸|管理会社|管理戸数|オーナー", text):
        ideas.extend(["賃貸管理 AI", "賃貸管理 問い合わせ 自動化", "管理会社 AIエージェント", "不動産管理 業務効率化"])
    if re.search(r"AI|エージェント", text):
        ideas.extend(["AIエージェント 導入", "業務自動化 AI"])
    deduped = list(dict.fromkeys(ideas))
    return deduped[:5] if deduped else ["商材名 問い合わせ", "商材カテゴリ 比較", "商材カテゴリ 導入"]


def _exclusion_ideas(facts: dict[str, Any]) -> list[str]:
    text = str(facts.get("audience") or "")
    ideas = ["無料", "求人", "個人"]
    if re.search(r"自社物|オーナー", text):
        ideas.append("自社物件")
    if re.search(r"30名以上|3000戸以上", text):
        ideas.extend(["小規模", "個人大家"])
    return list(dict.fromkeys(ideas))[:5]


def _area_idea(facts: dict[str, Any]) -> str:
    text = f"{facts.get('audience', '')} {facts.get('product', '')}"
    match = re.search(r"(北海道|東京都|大阪府|京都府|(神奈川|埼玉|千葉|兵庫|愛知|福岡|宮城|広島|静岡|茨城|栃木|群馬|長野|新潟|石川|岡山|熊本|鹿児島|沖縄)県)", text)
    return match.group(1) if match else "日本全国"


def _daily_budget(budget: str) -> str:
    normalized = budget.replace(",", "")
    man = re.search(r"(\d+(?:\.\d+)?)\s*万", normalized)
    yen = re.search(r"(\d{4,})", normalized)
    monthly = float(man.group(1)) * 10000 if man else int(yen.group(1)) if yen else 0
    return f"¥{max(1000, round(monthly / 30)):,}" if monthly else "月額予算 ÷ 30 の金額"


def _ad_copy_ideas(product: str, goal: str, audience: str) -> dict[str, list[str]]:
    audience_hint = "賃貸管理会社向け" if re.search(r"賃貸|管理会社", audience) else "法人向け"
    goal_short = re.sub(r"獲得|増加", "", goal)[:18]
    product_short = product[:24]
    return {
        "headlines": [f"{audience_hint}AI支援", f"{goal_short}を増やす", f"{product_short}を相談"],
        "descriptions": [f"{audience_hint}に、{product_short}で業務負担を減らす提案です。", f"{goal_short}につながる導入相談を受け付けています。"],
    }
