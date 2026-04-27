from __future__ import annotations

from typing import Any

from .mock_data import MOCK_METRICS


def _rate(numerator: float, denominator: float) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator


def _yen(value: float | None) -> str:
    if value is None:
        return "-"
    return f"¥{value:,.0f}"


def _percent(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value * 100:.1f}%"


def _kpis(row: dict[str, float]) -> dict[str, float | None]:
    return {
        "ctr": _rate(row["clicks"], row["impressions"]),
        "cvr": _rate(row["conversions"], row["clicks"]),
        "cpc": _rate(row["cost"], row["clicks"]),
        "cpa": _rate(row["cost"], row["conversions"]),
        "roas": _rate(row["revenue"], row["cost"]),
    }


def _fmt_number(value: float | int | None) -> str:
    if value is None:
        return "-"
    return f"{value:,.0f}"


def _change(current: float | None, comparison: float | None) -> float | None:
    if current is None or comparison in (None, 0):
        return None
    return current / comparison - 1


def _signed_percent(value: float | None) -> str:
    if value is None:
        return "-"
    sign = "+" if value >= 0 else ""
    return f"{sign}{value * 100:.1f}%"


def build_mock_chat_response(payload: dict[str, Any]) -> dict[str, Any]:
    latest_ad_data = payload.get("latestAdData")
    if isinstance(latest_ad_data, dict):
        return _build_latest_ad_data_response(latest_ad_data)

    current = MOCK_METRICS["current"]
    comparison = MOCK_METRICS["comparison"]
    current_kpis = _kpis(current)
    comparison_kpis = _kpis(comparison)

    cpa_change = _change(current_kpis["cpa"], comparison_kpis["cpa"])
    cvr_change = _change(current_kpis["cvr"], comparison_kpis["cvr"])
    ctr_change = _change(current_kpis["ctr"], comparison_kpis["ctr"])
    cpc_change = _change(current_kpis["cpc"], comparison_kpis["cpc"])

    weakest_campaign = max(
        MOCK_METRICS["campaigns"],
        key=lambda row: _rate(row["cost"], row["conversions"]) or 0,
    )
    content = f"""結論:
CPAは前期間比で悪化しています。主因はCVR低下とCPC上昇が同時に起きていることです。まずは `{weakest_campaign["name"]}` の配信面・訴求・ターゲットを優先確認してください。

根拠:
- 対象期間: {current["label"]}
- 比較期間: {comparison["label"]}
- CPA: {_yen(comparison_kpis["cpa"])} → {_yen(current_kpis["cpa"])}（{_signed_percent(cpa_change)}）
- CVR: {_percent(comparison_kpis["cvr"])} → {_percent(current_kpis["cvr"])}（{_signed_percent(cvr_change)}）
- CTR: {_percent(comparison_kpis["ctr"])} → {_percent(current_kpis["ctr"])}（{_signed_percent(ctr_change)}）
- CPC: {_yen(comparison_kpis["cpc"])} → {_yen(current_kpis["cpc"])}（{_signed_percent(cpc_change)}）
- CV数: {comparison["conversions"]:.0f}件 → {current["conversions"]:.0f}件

原因仮説:
クリック単価が上がっている一方で、クリック後のCVRが落ちています。広告の入口側では配信対象やクリック品質が変わった可能性があり、遷移後ではLP・フォーム・オファーの一致度が弱くなっている可能性があります。

推奨アクション:
1. `{weakest_campaign["name"]}` の広告セット/広告グループ別にCPAとCVRを確認する
2. CPCが上がっている配信面やターゲットを一時的に絞り込む候補として洗い出す
3. CVRが落ちている広告について、訴求とLPファーストビューの一致度を確認する

人間向け作業手順:
1. 媒体管理画面で `{weakest_campaign["name"]}` を開く
2. 広告セット/広告グループ別に直近7日と前7日のCPA、CVR、CPCを比較する
3. CPAが高くCVRが低い配信単位を候補としてメモする
4. 該当広告の訴求、リンク先、ターゲット条件を確認する
5. すぐ変更せず、変更候補を1つに絞って担当者が判断する

実施前チェック:
- CV数が少なすぎる配信単位だけで判断していないか
- セール、在庫、LP障害など広告外要因がなかったか
- 計測タグやCV定義が変わっていないか

リスク:
予算や配信対象を急に絞ると、CPAは改善してもCV総数が落ちる可能性があります。最初は影響範囲を限定して確認してください。

実施後の観察:
変更後24〜48時間はCPA、CV数、CVR、CPCを確認してください。CV数が減りすぎる場合は、絞り込みを戻す判断が必要です。

自信度:
Medium。CPA、CVR、CPCが同じ悪化方向を示していますが、現時点では媒体別・広告別・LP側の詳細データがmockのため、断定は避けます。"""

    operator_steps = [
        f"{weakest_campaign['name']} の広告セット/広告グループ別CPAを確認する",
        "CVR低下が大きい配信単位を1つ選ぶ",
        "変更前にCV数、計測、LP状態を確認する",
        "担当者判断で小さく調整し、24〜48時間観察する",
    ]

    return {
        "message": {
            "role": "assistant",
            "content": content,
        },
        "recommendation": {
            "title": f"{weakest_campaign['name']} のCPA悪化要因を分解して確認する",
            "confidence": "medium",
            "operatorSteps": operator_steps,
        },
        "humanTaskDraft": {
            "title": f"{weakest_campaign['name']} のCPA/CVR悪化ポイントを確認する",
            "priority": "high",
            "status": "suggested",
        },
    }


def build_no_write_refusal_response(payload: dict[str, Any]) -> dict[str, Any]:
    message = str(payload.get("message") or "広告媒体の設定変更")
    content = f"""結論:
広告媒体の設定をこちらから直接変更・停止・作成することはできません。AdOps Advisorはread-onlyで分析し、人間が管理画面で判断・実行するための手順を作ります。

根拠:
- MVP方針ではGoogle Ads / Meta Ads / Yahoo Adsへのwrite操作は禁止です
- 許可されるのは広告アカウント確認、指標確認、KPI計算、期間比較、異常検知、recommendation作成、human task作成です
- ユーザー依頼: {message}

原因仮説:
今回の依頼は、予算・入札・キャンペーン・広告など媒体設定の直接変更に該当する可能性があります。安全のため、AIが実行したとは扱わず、人間の確認ステップに変換します。

推奨アクション:
1. 変更したい対象キャンペーン、広告グループ、広告を特定する
2. 変更理由の根拠となるCPA、CVR、CPC、CV数を確認する
3. 影響範囲を小さくした変更案を1つに絞る
4. 担当者が媒体管理画面で最終判断する

人間向け作業手順:
1. 媒体管理画面を開く
2. 対象アカウントとキャンペーンを確認する
3. 直近期間と比較期間のCPA、CVR、CPC、CV数を並べる
4. 変更案、期待効果、戻し条件をメモする
5. 担当者が承認した場合のみ、管理画面で手動実行する

実施前チェック:
- CV数が少なすぎる配信単位だけで判断していないか
- 計測タグ、CV定義、LP、在庫、セールなど広告外要因を確認したか
- 変更後に元へ戻す条件を決めているか

リスク:
予算・入札・停止・広告作成を急に行うと、CPAが改善してもCV総数や学習状態が悪化する可能性があります。特にCV数が少ない場合は判断がぶれやすいです。

実施後の観察:
手動変更後24〜48時間はCPA、CV数、CVR、CPCを確認してください。CV数が大きく落ちる、またはCPCだけ上がる場合は変更を戻す候補にしてください。

自信度:
High。媒体write操作を実行しないというポリシーは明確です。一方で、具体的な改善判断には対象アカウントの詳細指標が必要です。"""

    return {
        "message": {
            "role": "assistant",
            "content": content,
        },
        "recommendation": {
            "title": "媒体設定の直接変更を行わず、人間向け手順に変換する",
            "confidence": "high",
            "operatorSteps": [
                "対象キャンペーンと変更内容を確認する",
                "CPA、CVR、CPC、CV数の根拠を確認する",
                "担当者承認後に媒体管理画面で手動実行する",
                "24〜48時間の観察指標と戻し条件を決める",
            ],
        },
        "humanTaskDraft": {
            "title": "媒体管理画面での手動変更可否を確認する",
            "priority": "high",
            "status": "suggested",
        },
        "policy": {
            "name": "no_media_write",
            "enforced": True,
        },
    }


def _build_latest_ad_data_response(latest_ad_data: dict[str, Any]) -> dict[str, Any]:
    current = latest_ad_data.get("current", {})
    comparison = latest_ad_data.get("comparison", {})
    current_totals = current.get("totals", {})
    comparison_totals = comparison.get("totals", {})
    changes = latest_ad_data.get("changes", {})
    campaigns = latest_ad_data.get("campaigns", [])
    anomalies = latest_ad_data.get("anomalies", [])

    weakest_campaign = _pick_weakest_campaign(campaigns)
    weakest_name = str(weakest_campaign.get("campaign", "優先確認キャンペーン"))
    weakest_platform = str(weakest_campaign.get("platform", "all"))
    anomaly_summary = _format_anomaly_summary(anomalies)

    content = f"""結論:
最新広告データではCPAが前期間比で悪化しています。主因はCVR低下とCPC上昇が同時に起きていることです。まずは `{weakest_name}`（{weakest_platform}）を優先確認してください。

根拠:
- 対象期間: {current.get("label", "直近期間")}
- 比較期間: {comparison.get("label", "比較期間")}
- CPA: {_yen(comparison_totals.get("cpa"))} → {_yen(current_totals.get("cpa"))}（{_signed_percent(changes.get("cpa"))}）
- CVR: {_percent(comparison_totals.get("cvr"))} → {_percent(current_totals.get("cvr"))}（{_signed_percent(changes.get("cvr"))}）
- CTR: {_percent(comparison_totals.get("ctr"))} → {_percent(current_totals.get("ctr"))}（{_signed_percent(changes.get("ctr"))}）
- CPC: {_yen(comparison_totals.get("cpc"))} → {_yen(current_totals.get("cpc"))}（{_signed_percent(changes.get("cpc"))}）
- CV数: {_fmt_number(comparison_totals.get("conversions"))}件 → {_fmt_number(current_totals.get("conversions"))}件（{_signed_percent(changes.get("conversions"))}）
- 検知された異常: {anomaly_summary}

原因仮説:
クリック単価が上がっている一方で、クリック後のCVRが落ちています。広告の入口側では配信対象、検索語句、配信面、クリエイティブ訴求が変化した可能性があります。遷移後ではLPファーストビュー、フォーム、オファーとの一致度が弱くなっている可能性があります。

推奨アクション:
1. `{weakest_name}` のキャンペーン内訳を確認する
2. CPC上昇が大きい配信面、検索語句、ターゲットを洗い出す
3. CVR低下が大きい広告について、訴求とLPの一致度を確認する
4. 変更候補は1つに絞り、担当者が媒体管理画面で判断する

人間向け作業手順:
1. 媒体管理画面で `{weakest_name}` を開く
2. 直近期間と比較期間のCPA、CVR、CTR、CPCを並べる
3. CPAが高く、CVRが低く、CPCが上がっている配信単位をメモする
4. 該当広告の訴求、リンク先、ターゲット条件、検索語句を確認する
5. すぐ変更せず、変更候補と想定リスクを担当者が確認する

実施前チェック:
- CV数が少なすぎる配信単位だけで判断していないか
- セール、在庫、LP障害など広告外要因がなかったか
- 計測タグやCV定義が変わっていないか

リスク:
予算や配信対象を急に絞ると、CPAは改善してもCV総数が落ちる可能性があります。最初は影響範囲を限定し、変更前後の比較ができる状態で進めてください。

実施後の観察:
変更後24〜48時間はCPA、CV数、CVR、CPCを確認してください。CV数が減りすぎる場合は、絞り込みを戻す判断が必要です。

自信度:
Medium。最新広告データ上ではCPA、CVR、CPCが悪化方向を示していますが、LP側や在庫、セールなど広告外要因はまだ未確認のため断定は避けます。"""

    operator_steps = [
        f"{weakest_name} のCPA、CVR、CPCを比較する",
        "CPC上昇が大きい配信単位を洗い出す",
        "CVR低下が大きい広告とLPを確認する",
        "担当者判断で小さく調整し、24〜48時間観察する",
    ]

    return {
        "message": {
            "role": "assistant",
            "content": content,
        },
        "recommendation": {
            "title": f"{weakest_name} のCPA悪化要因を最新広告データから分解する",
            "confidence": "medium",
            "operatorSteps": operator_steps,
        },
        "humanTaskDraft": {
            "title": f"{weakest_name} のCPA/CVR/CPCを確認する",
            "priority": "high",
            "status": "suggested",
        },
    }


def _pick_weakest_campaign(campaigns: Any) -> dict[str, Any]:
    if not isinstance(campaigns, list) or not campaigns:
        return {}
    return max(
        [campaign for campaign in campaigns if isinstance(campaign, dict)] or [{}],
        key=lambda campaign: campaign.get("cpa") or 0,
    )


def _format_anomaly_summary(anomalies: Any) -> str:
    if not isinstance(anomalies, list) or not anomalies:
        return "重要な異常なし"
    summaries = []
    for anomaly in anomalies[:3]:
        if not isinstance(anomaly, dict):
            continue
        summaries.append(f"{anomaly.get('type', '異常')}（{anomaly.get('severity', '-')}: {anomaly.get('detail', '')}）")
    return " / ".join(summaries) if summaries else "重要な異常なし"
