from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import re
import unicodedata


class IntentLabel(StrEnum):
    GREETING_CASUAL = "greeting_casual"
    STATUS_SUMMARY = "status_summary"
    DIAGNOSIS = "diagnosis"
    SETUP = "setup"
    BUDGET_DELIVERY_LEARNING = "budget_delivery_learning"
    MEDIA_SPEC = "media_spec"
    ACTION_PLAN = "action_plan"
    GENERAL_ADVICE = "general_advice"


@dataclass(frozen=True)
class IntentClassification:
    intent: IntentLabel
    requires_metrics_context: bool
    prefers_short_response: bool

    def as_dict(self) -> dict[str, bool | str]:
        return {
            "intent": self.intent.value,
            "requires_metrics_context": self.requires_metrics_context,
            "prefers_short_response": self.prefers_short_response,
        }


_GREETING_PATTERNS = (
    "こんにちは",
    "こんばんは",
    "おはよう",
    "はじめまして",
    "ありがとう",
    "ありがと",
    "助かった",
    "よろしく",
    "雑談",
    "使い方",
    "何ができる",
    "なにができる",
)

_STATUS_PATTERNS = (
    "うまくいって",
    "好調",
    "不調",
    "調子",
    "状況",
    "現状",
    "サマリー",
    "要約",
    "まとめ",
    "ざっくり",
    "ぱっと見",
    "どうですか",
    "どうかな",
    "順調",
)

_DIAGNOSIS_PATTERNS = (
    "なぜ",
    "なんで",
    "理由",
    "原因",
    "断定",
    "要因",
    "診断",
    "分析",
    "深掘り",
    "悪化",
    "低下",
    "上がった",
    "下がった",
    "落ちた",
    "成果が落ちた",
    "売上が落ちた",
    "伸びない",
    "取れない",
    "ボトルネック",
    "改善しない",
)

_SETUP_PATTERNS = (
    "始めたい",
    "開始したい",
    "これから広告",
    "初期設定",
    "初期設計",
    "設計",
    "セットアップ",
    "オンボーディング",
    "連携",
    "アカウント接続",
    "コンバージョン設定",
    "コンバージョンとして",
    "コンバージョン地点",
    "マイクロコンバージョン",
    "第一候補",
    "補完候補",
    "最終成果",
    "中間成果",
    "cv設定",
    "cv地点",
    "タグ設定",
    "計測設定",
    "媒体選定",
    "どの媒体",
    "ペルソナ",
    "ターゲット",
    "ターゲット整理",
    "訴求",
    "キャンペーン構成",
)

_BUDGET_DELIVERY_LEARNING_PATTERNS = (
    "予算",
    "日予算",
    "月予算",
    "消化",
    "使いきれ",
    "使い切れ",
    "使い過ぎ",
    "配信量",
    "配信が少ない",
    "配信されない",
    "インプレッションが少ない",
    "学習",
    "learning",
    "入札戦略",
    "機械学習",
    "配信制限",
    "limited by budget",
)

_MEDIA_SPEC_PATTERNS = (
    "入稿規定",
    "入稿仕様",
    "仕様",
    "文字数",
    "文字数制限",
    "上限",
    "見出し",
    "説明文",
    "アセット仕様",
    "アセット",
    "画像サイズ",
    "動画サイズ",
    "バナーサイズ",
    "アスペクト比",
    "解像度",
    "ファイル形式",
    "広告文",
    "レスポンシブ検索広告",
    "rsa",
)

_ACTION_PLAN_PATTERNS = (
    "アクションプラン",
    "作業手順",
    "手順",
    "チェックリスト",
    "タスク",
    "todo",
    "to do",
    "次にやる",
    "何をすれば",
    "どう進め",
    "優先順位",
    "改善案",
    "施策",
    "実施前",
    "観察",
)

_GENERAL_ADVICE_PATTERNS = (
    "教えて",
    "相談",
    "考え方",
    "基本",
    "おすすめ",
    "ベストプラクティス",
    "コツ",
    "違い",
)

_METRIC_PATTERNS = (
    "cpa",
    "cvr",
    "ctr",
    "cpc",
    "roas",
    "cv",
    "クリック",
    "表示回数",
    "imp",
    "インプレッション",
    "費用",
    "売上",
    "コンバージョン",
    "成果",
    "獲得",
    "広告費",
    "直近",
    "前週",
    "前月",
    "比較",
    "期間",
    "キャンペーン",
    "広告グループ",
    "広告セット",
)

_SHORT_RESPONSE_PATTERNS = (
    "短く",
    "一言",
    "ひとこと",
    "簡潔",
    "ざっくり",
    "要点",
    "サマリー",
    "summary",
    "tl;dr",
    "tldr",
)

_INTENT_PATTERN_MAP = {
    IntentLabel.MEDIA_SPEC: _MEDIA_SPEC_PATTERNS,
    IntentLabel.BUDGET_DELIVERY_LEARNING: _BUDGET_DELIVERY_LEARNING_PATTERNS,
    IntentLabel.ACTION_PLAN: _ACTION_PLAN_PATTERNS,
    IntentLabel.SETUP: _SETUP_PATTERNS,
    IntentLabel.DIAGNOSIS: _DIAGNOSIS_PATTERNS,
    IntentLabel.STATUS_SUMMARY: _STATUS_PATTERNS,
    IntentLabel.GENERAL_ADVICE: _GENERAL_ADVICE_PATTERNS,
}

_PRIORITY = (
    IntentLabel.MEDIA_SPEC,
    IntentLabel.BUDGET_DELIVERY_LEARNING,
    IntentLabel.ACTION_PLAN,
    IntentLabel.SETUP,
    IntentLabel.DIAGNOSIS,
    IntentLabel.STATUS_SUMMARY,
    IntentLabel.GENERAL_ADVICE,
)

_METRICS_REQUIRED_INTENTS = {
    IntentLabel.STATUS_SUMMARY,
    IntentLabel.DIAGNOSIS,
    IntentLabel.BUDGET_DELIVERY_LEARNING,
    IntentLabel.ACTION_PLAN,
}


def classify_intent(message: str) -> IntentClassification:
    normalized = _normalize(message)
    if not normalized:
        return IntentClassification(IntentLabel.GREETING_CASUAL, False, True)

    if _is_greeting_or_casual(normalized):
        return IntentClassification(IntentLabel.GREETING_CASUAL, False, True)

    scores = {
        intent: _score_patterns(normalized, patterns)
        for intent, patterns in _INTENT_PATTERN_MAP.items()
    }
    intent = _select_intent(scores)
    has_metric_terms = _score_patterns(normalized, _METRIC_PATTERNS) > 0

    requires_metrics_context = intent in _METRICS_REQUIRED_INTENTS or (
        has_metric_terms and intent not in {IntentLabel.MEDIA_SPEC, IntentLabel.SETUP}
    )
    prefers_short_response = intent in {
        IntentLabel.GREETING_CASUAL,
        IntentLabel.STATUS_SUMMARY,
        IntentLabel.MEDIA_SPEC,
    } or _score_patterns(normalized, _SHORT_RESPONSE_PATTERNS) > 0

    return IntentClassification(intent, requires_metrics_context, prefers_short_response)


def _normalize(message: str) -> str:
    normalized = unicodedata.normalize("NFKC", message).lower()
    return re.sub(r"\s+", " ", normalized).strip()


def _is_greeting_or_casual(message: str) -> bool:
    if _score_patterns(message, _GREETING_PATTERNS) == 0:
        return False
    return _score_patterns(message, _METRIC_PATTERNS + _DIAGNOSIS_PATTERNS + _ACTION_PLAN_PATTERNS) == 0


def _score_patterns(message: str, patterns: tuple[str, ...]) -> int:
    return sum(1 for pattern in patterns if pattern in message)


def _select_intent(scores: dict[IntentLabel, int]) -> IntentLabel:
    best_score = max(scores.values())
    if best_score == 0:
        return IntentLabel.GENERAL_ADVICE
    for intent in _PRIORITY:
        if scores[intent] == best_score:
            return intent
    return IntentLabel.GENERAL_ADVICE
