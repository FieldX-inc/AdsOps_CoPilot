from __future__ import annotations

import re
from typing import Any

from .conversation_router import RoutePlan
from .policies.no_write_policy import looks_secret


ADVICE_SECTIONS = (
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

_OVERCONFIDENT_PATTERNS = (
    "必ず改善",
    "100%改善",
    "絶対に改善",
    "絶対に成果が出ます",
    "確実に改善",
    "確実にCVが増えます",
    "原因はこれだけ",
    "原因はこれです",
    "これが唯一の原因です",
    "原因を断定できます",
    "断定できます",
    "リスクはありません",
    "間違いなく",
)

_SECRETISH_PATTERN = re.compile(
    r"(?i)("
    r"(sk|pk|rk)-[a-z0-9_-]{8,}|"
    r"aiza[a-z0-9_-]{20,}|"
    r"ya29\.[a-z0-9_-]+|"
    r"bearer\s+[a-z0-9_\-.]{16,}|"
    r"eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}|"
    r"(refresh[_-]?token|access[_-]?token|oauth[_-]?token|api[_-]?key|client[_-]?secret|developer[_-]?token|service[_-]?role)\s*[:=]\s*[^\s]+"
    r")"
)


def apply_qa_gate(content: str, route_plan: RoutePlan | dict[str, Any] | None = None) -> tuple[str, dict[str, Any] | None]:
    guarded = _redact_secret_like_text(content)
    checks: list[str] = []

    overconfident_hits = [pattern for pattern in _OVERCONFIDENT_PATTERNS if pattern in guarded]
    if overconfident_hits:
        for pattern in overconfident_hits:
            guarded = guarded.replace(pattern, "現時点のデータでは断定せず、改善候補として扱う")
        checks.append("overconfident_claim_tempered")

    if _requires_advice_sections(route_plan):
        missing = [section for section in ADVICE_SECTIONS if section not in guarded]
        if missing:
            guarded = guarded.rstrip() + _missing_section_appendix(missing)
            checks.append("required_sections_completed")

    if guarded != content and not checks:
        checks.append("secret_like_output_redacted")
    elif guarded != content and "secret_like_output_redacted" not in checks and _SECRETISH_PATTERN.search(content):
        checks.append("secret_like_output_redacted")

    if not checks:
        return guarded, None
    return guarded, {"name": "qa_gate", "enforced": True, "checks": checks}


def _requires_advice_sections(route_plan: RoutePlan | dict[str, Any] | None) -> bool:
    if route_plan is None:
        return False
    response_contract = (
        route_plan.response_contract
        if isinstance(route_plan, RoutePlan)
        else str(route_plan.get("responseContract") or route_plan.get("response_contract") or "")
    )
    return response_contract in {
        "metrics_status_summary",
        "diagnosis_with_evidence",
        "budget_delivery_learning_diagnosis",
        "human_task_action_plan",
    }


def _redact_secret_like_text(content: str) -> str:
    redacted = _SECRETISH_PATTERN.sub("[REDACTED]", content)
    if looks_secret(redacted):
        return redacted.replace("Bearer ", "[REDACTED] ")
    return redacted


def _missing_section_appendix(missing: list[str]) -> str:
    lines = ["", "", "QA補足:"]
    for section in missing:
        if section == "根拠":
            lines.append("根拠:\n現時点で利用できるworkspace scope済みデータと会話文脈に限定しています。")
        elif section == "原因仮説":
            lines.append("原因仮説:\n追加データが不足しているため、断定ではなく確認候補として扱ってください。")
        elif section == "推奨アクション":
            lines.append("推奨アクション:\n媒体設定の直接変更ではなく、担当者が確認する候補として整理してください。")
        elif section == "人間向け作業手順":
            lines.append("人間向け作業手順:\n1. 対象期間とKPIを確認する\n2. 変更候補を1つに絞る\n3. 担当者が承認後に手動で実施可否を判断する")
        elif section == "実施前チェック":
            lines.append("実施前チェック:\nCV数、計測変更、LP障害、外部要因がないか確認してください。")
        elif section == "リスク":
            lines.append("リスク:\n根拠が薄いまま変更すると、CV数や学習状態が悪化する可能性があります。")
        elif section == "実施後の観察":
            lines.append("実施後の観察:\n24〜48時間はCPA、CV数、CVR、CPCを確認してください。")
        elif section == "自信度":
            lines.append("自信度:\nMedium。追加の広告グループ/検索語句/LPデータで精度が上がります。")
        else:
            lines.append(f"{section}:\n追加確認が必要です。")
    return "\n".join(lines)
