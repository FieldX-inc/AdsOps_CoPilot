from __future__ import annotations

from typing import Any

from .intent import IntentLabel
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
    intent = _intent_name(payload)
    if intent == IntentLabel.GREETING_CASUAL.value:
        return _build_light_response(
            content="""こんにちは。広告運用の状況整理、CPA/CVR/ROASの読み解き、初期設計、改善作業の手順化を一緒にできます。

今すぐなら、たとえば「今の配信状況をまとめて」「問い合わせが取れない原因を見たい」「CV地点をどう置くべきか相談したい」のように聞いてください。""",
            title="相談テーマを選ぶ",
        )

    if intent == IntentLabel.SETUP.value:
        return _build_setup_response(payload)

    if intent == IntentLabel.MEDIA_SPEC.value:
        return _build_media_spec_response(payload)

    if intent == IntentLabel.BUDGET_DELIVERY_LEARNING.value and not isinstance(payload.get("latestAdData"), dict):
        return _build_budget_delivery_response(payload)

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


def _build_light_response(content: str, title: str) -> dict[str, Any]:
    return {
        "message": {
            "role": "assistant",
            "content": content,
        },
        "recommendation": {
            "title": title,
            "confidence": "medium",
            "operatorSteps": ["相談したいテーマを1つ選ぶ", "広告アカウントや期間があれば添えて質問する"],
        },
        "humanTaskDraft": {
            "title": title,
            "priority": "low",
            "status": "suggested",
        },
    }


def _build_setup_response(payload: dict[str, Any]) -> dict[str, Any]:
    message = str(payload.get("message") or "")
    is_cv_question = any(keyword in message.lower() for keyword in ("cv", "コンバージョン", "conversion"))
    focus = "CV地点" if is_cv_question else "広告初期設計"
    content = f"""結論:
{focus}は、広告媒体の都合ではなく「営業・購入に近い行動」と「学習に必要なCV数」のバランスで決めるのがよいです。最初から最終成果だけに寄せすぎると、CV数が不足して学習や判断が不安定になります。

判断軸:
- 事業成果に近いか
- 月30〜50件程度のCVが見込めるか
- 広告改善に使える粒度か
- 営業や購入の質とズレすぎていないか
- 計測タグ、CRM、フォーム完了などで安定して取得できるか

推奨:
MVPでは、最終CVと中間CVを分けて設計してください。問い合わせ完了、資料請求、購入などの最終成果を主KPIにしつつ、フォーム到達、カート投入、重要ページ閲覧などは補助指標として見ます。

確認したいこと:
1. 商材はBtoB、EC、店舗集客のどれに近いか
2. 月の広告予算と想定CV数はどれくらいか
3. 最終成果までのリードタイムは即日か、数日〜数週間か

リスク:
CV地点を浅くしすぎると質の低い行動に最適化されます。一方で深くしすぎるとCV数が足りず、媒体の学習もAIの分析も不安定になります。

次の一手:
上の3点が分かれば、Google / Meta / Yahoo それぞれで主CVと補助CVの置き方を具体化できます。"""
    return {
        "message": {"role": "assistant", "content": content},
        "recommendation": {
            "title": f"{focus}の判断軸を整理する",
            "confidence": "medium",
            "operatorSteps": [
                "商材カテゴリと最終成果を整理する",
                "月間予算と想定CV数を確認する",
                "主CVと補助CVを分けて設計する",
            ],
        },
        "humanTaskDraft": {
            "title": f"{focus}の前提情報を整理する",
            "priority": "medium",
            "status": "suggested",
        },
    }


def _build_media_spec_response(payload: dict[str, Any]) -> dict[str, Any]:
    content = """結論:
媒体仕様や管理画面の挙動は、最新仕様を確認してから判断するのが安全です。ここでは断定せず、確認場所と設計判断の順番を整理します。

確認順:
1. 対象媒体を特定する（Google Ads / Meta Ads / Yahoo Ads）
2. キャンペーン種別を確認する（検索、P-MAX、ディスプレイ、動画、Meta配信など）
3. 管理画面のヘルプ、媒体公式ドキュメント、実際の入稿画面で制約を確認する
4. 仕様上見えないデータと、設定ミスで見えていないデータを分ける

判断軸:
- 仕様として非表示・集約されるものか
- 権限、期間、フィルタ、しきい値で見えていないだけか
- 改善判断に必要な粒度が別レポートで取得できるか

リスク:
媒体仕様を思い込みで判断すると、存在しない改善余地を追ったり、逆に見るべきデータを見落とす可能性があります。

次の一手:
媒体名、キャンペーン種別、見たい項目を教えてください。必要なら最新仕様確認を前提に、確認手順まで落とします。"""
    return {
        "message": {"role": "assistant", "content": content},
        "recommendation": {
            "title": "媒体仕様の確認観点を整理する",
            "confidence": "medium",
            "operatorSteps": [
                "対象媒体とキャンペーン種別を特定する",
                "公式ヘルプまたは管理画面で仕様を確認する",
                "仕様制約と設定ミスの可能性を分けて見る",
            ],
        },
        "humanTaskDraft": {
            "title": "媒体仕様の確認に必要な前提を整理する",
            "priority": "medium",
            "status": "suggested",
        },
    }


def _build_budget_delivery_response(payload: dict[str, Any]) -> dict[str, Any]:
    content = """結論:
予算消化、配信量、学習、入札戦略の問題は、まず「配信機会が足りない」のか「目標が厳しすぎる」のか「計測・学習条件が足りない」のかを分けると整理しやすいです。

見る順番:
1. 月予算、日予算、実消化額の差
2. インプレッション、クリック、CPC、CV数
3. 目標CPA/ROASと実績の乖離
4. 学習に必要なCV数が確保できているか
5. ターゲット、地域、キーワード、配信面が狭すぎないか

原因仮説:
予算を使いきれない場合は、配信対象が狭い、入札目標が厳しい、広告品質や検索需要が足りない可能性があります。逆に想定以上に使う場合は、日予算仕様、配信ペース、キャンペーン間の予算配分を確認する必要があります。

推奨アクション:
まず変更せず、予算差分とCV数を確認してください。CV数が少ない状態で入札や予算を動かすと、学習がさらに不安定になることがあります。

人間向け作業手順:
1. 対象キャンペーンの予算、実消化、CV数を確認する
2. 直近7日と前7日のCPC、CVR、CPAを比較する
3. 配信制限、学習状態、目標CPA/ROASを確認する
4. 変更候補を1つだけ作り、担当者が承認してから手動で試す

自信度:
Medium。具体的な媒体データがないため、現時点では診断順の提示に留めます。"""
    return {
        "message": {"role": "assistant", "content": content},
        "recommendation": {
            "title": "予算消化と学習状態を分けて確認する",
            "confidence": "medium",
            "operatorSteps": [
                "予算と実消化の差を確認する",
                "CV数と学習状態を確認する",
                "配信制限と入札目標を分けて見る",
            ],
        },
        "humanTaskDraft": {
            "title": "予算消化と学習状態の確認項目を並べる",
            "priority": "medium",
            "status": "suggested",
        },
    }


def build_no_write_refusal_response(payload: dict[str, Any]) -> dict[str, Any]:
    content = f"""結論:
AIチャット単体では広告媒体の設定を直接変更・停止・作成しません。AdOps Advisorは分析と変更候補を作り、Google Adsのcampaign status / budgetだけは、認証済みユーザーが明示承認したAPI routeで実行できます。

根拠:
- Agent toolとしての媒体writeは登録せず、AIが実行済みと主張することも禁止です
- Google Adsのcampaign status / budget writeは、API layerでworkspace scope、confirmed=true、GOOGLE_ADS_WRITE_ENABLED=true、監査ログを満たした場合だけ実行します
- 入札変更、広告作成、targeting変更、Meta/Yahoo writeは未対応のため、人間向け手順に変換します

原因仮説:
今回の依頼は、予算・入札・キャンペーン・広告など媒体設定の変更に該当する可能性があります。安全のため、AIが実行したとは扱わず、承認付きwrite候補または人間の確認ステップに変換します。

推奨アクション:
1. 変更したい対象キャンペーン、広告グループ、広告を特定する
2. 変更理由の根拠となるCPA、CVR、CPC、CV数を確認する
3. 影響範囲を小さくした変更案を1つに絞る
4. Google Adsのcampaign status / budgetなら、担当者承認後に承認付きAPI routeで実行する
5. それ以外の変更は担当者が媒体管理画面で最終判断する

人間向け作業手順:
1. 媒体管理画面を開く
2. 対象アカウントとキャンペーンを確認する
3. 直近期間と比較期間のCPA、CVR、CPC、CV数を並べる
4. 変更案、期待効果、戻し条件をメモする
5. Google Adsのcampaign status / budgetは、担当者が承認した場合のみ承認付きAPI routeで実行する
6. 未対応writeは、担当者が承認した場合のみ管理画面で手動実行する

実施前チェック:
- CV数が少なすぎる配信単位だけで判断していないか
- 計測タグ、CV定義、LP、在庫、セールなど広告外要因を確認したか
- 変更後に元へ戻す条件を決めているか

リスク:
予算・入札・停止・広告作成を急に行うと、CPAが改善してもCV総数や学習状態が悪化する可能性があります。特にCV数が少ない場合は判断がぶれやすいです。

実施後の観察:
手動変更後24〜48時間はCPA、CV数、CVR、CPCを確認してください。CV数が大きく落ちる、またはCPCだけ上がる場合は変更を戻す候補にしてください。

自信度:
High。AIチャット単体で媒体writeを実行しない境界は明確です。一方で、具体的な変更可否には対象アカウントの詳細指標と担当者承認が必要です。"""

    return {
        "message": {
            "role": "assistant",
            "content": content,
        },
        "recommendation": {
            "title": "媒体設定の直接実行を避け、承認付き候補に変換する",
            "confidence": "high",
            "operatorSteps": [
                "対象キャンペーンと変更内容を確認する",
                "CPA、CVR、CPC、CV数の根拠を確認する",
                "Google Ads campaign status / budgetは担当者承認後に承認付きAPI routeで実行する",
                "未対応writeは担当者承認後に媒体管理画面で手動実行する",
                "24〜48時間の観察指標と戻し条件を決める",
            ],
        },
        "humanTaskDraft": {
            "title": "媒体変更候補の承認可否を確認する",
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

    if _has_insufficient_conversion_evidence(current_totals, comparison_totals):
        return _build_insufficient_latest_data_response(latest_ad_data)

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


def _has_insufficient_conversion_evidence(current_totals: dict[str, Any], comparison_totals: dict[str, Any]) -> bool:
    required = ("conversions", "cpa", "cvr")
    return any(current_totals.get(field) is None for field in required) or any(
        comparison_totals.get(field) is None for field in required
    )


def _build_insufficient_latest_data_response(latest_ad_data: dict[str, Any]) -> dict[str, Any]:
    current = latest_ad_data.get("current", {})
    comparison = latest_ad_data.get("comparison", {})
    current_totals = current.get("totals", {})
    comparison_totals = comparison.get("totals", {})
    content = f"""結論:
現時点の広告データだけでは、CPA悪化やCVR低下を断定できません。CV数、CPA、CVR、売上などの成果指標が不足しているため、まずは算出不能なKPIを補ってから診断してください。

根拠:
- 対象期間: {current.get("label", "直近期間")}
- 比較期間: {comparison.get("label", "比較期間")}
- 表示回数: {_fmt_number(current_totals.get("impressions"))}
- クリック数: {_fmt_number(current_totals.get("clicks"))}
- 費用: {_yen(current_totals.get("cost"))}
- CV数/CPA/CVR: 算出不能または不足

原因仮説:
成果指標が欠けている状態では、広告入口の問題なのか、LPやフォームの問題なのか、計測不備なのかを切り分けられません。まずはCV計測、CV定義、売上/問い合わせの反映状況を確認する必要があります。

推奨アクション:
1. CV数、CV定義、CV計測タグが対象期間で取得できているか確認する
2. 売上や問い合わせなど最終成果データが連携されているか確認する
3. CPA/CVR/ROASを算出できる状態にしてから、キャンペーン/広告グループ別に比較する

人間向け作業手順:
1. 媒体管理画面で対象期間のCV列を表示する
2. CV数が0または空欄なら、タグ・CV定義・集計期間を確認する
3. CRMやフォーム側の実問い合わせ数と媒体CV数を照合する
4. 成果指標が揃ってからCPA、CVR、CPCを比較する

実施前チェック:
- CV定義が途中で変わっていないか
- LPやフォームに障害がなかったか
- 比較期間の長さが揃っているか

リスク:
成果指標が不足したまま予算や配信対象を判断すると、実際には良い配信を止めたり、計測不備を広告問題として誤認する可能性があります。

実施後の観察:
CV計測を補正した後、24〜48時間のCV数、CPA、CVR、CPCを確認し、十分な件数が集まってから改善候補を判断してください。

自信度:
Low。現時点ではクリック・費用など入口側の一部指標しかなく、成果側の根拠が足りないためです。"""
    return {
        "message": {"role": "assistant", "content": content},
        "recommendation": {
            "title": "成果指標を補ってから広告診断する",
            "confidence": "low",
            "operatorSteps": [
                "CV数とCV定義を確認する",
                "CV計測タグとフォーム/CRMの実績を照合する",
                "CPA/CVRを算出できる状態にする",
            ],
        },
        "humanTaskDraft": {
            "title": "CV計測と成果指標の不足を確認する",
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


def _intent_name(payload: dict[str, Any]) -> str | None:
    context = payload.get("context")
    if not isinstance(context, dict):
        return None
    intent = context.get("intent")
    if isinstance(intent, dict):
        value = intent.get("intent")
        return str(value) if value else None
    if isinstance(intent, str):
        return intent
    return None
