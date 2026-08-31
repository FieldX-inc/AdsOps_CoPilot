# Docs Guide

このディレクトリは、AdOps Advisor の要件、設計、Pre-SaaS化タスクの作業メモを置きます。

現在の正本は、BI分析 / Adコラムをメインナビから外し、microCMS + 内蔵フォールバックのヘルプを置く。広告準備はチャットUIを使わないschema-drivenな一問一答のラジオ質問票とし、途中保存・再開・回答確認からキャンペーン作成案と手動手順までを作る。campaign create APIは作らない。初回課金導線は「プラン選択 → 認証 → pending workspace → Stripe Checkout」とする。

microCMSのHelp API schema、read-only APIキー、公開手順は[`microcms-help.md`](./microcms-help.md)を正本とする。

## Discovery / Validation

- `pre-saas-discovery-interview.md`: 月広告費50万〜500万円の自社EC/D2C・小規模BtoB向け初回商談、ヒアリング、PoC判定、商談後文面。
- `deployment.md`: API / OpenAI Agent Service / Supabase / Google Ads / Stripe のstaging-productionデプロイ手順。

## M0 Standard Verification

M0-01 / M0-02 の標準検証コマンドは以下です。

```sh
npm run typecheck
npm run build
cd services/adk-agent
python3.11 -m pytest
```

OpenAI Agent Service は Python 3.11以上を前提にします。初回だけ `services/adk-agent` でdev依存を入れてください。

```sh
cd services/adk-agent
python3.11 -m pip install -e ".[dev]"
```

依存関係のinstall、network access、remote DBへのmigration適用は事前確認が必要です。既に環境がある場合はinstallせず、検証コマンドだけを実行します。

## M0 Write Approval Contract

M0-04 の write approval policy は `services/adk-agent/ad_ops_advisor/policies/no_write_policy.py` を共通の入力検知境界にします。

- `/chat` の入口では、媒体write意図を検知したらAIに実行させず、承認付きwrite候補と手順に変換する
- OpenAI Agents SDKの出力では、停止、予算変更、入札変更、広告作成/入稿、targeting変更を担当者確認の候補表現へ変換する
- Google Ads campaign status / budget writeはAPI layerで、認証、workspace scope、`confirmed=true`、`GOOGLE_ADS_WRITE_ENABLED=true`、監査ログを必須にする
- 初回本番Goは`GOOGLE_ADS_WRITE_ENABLED=false`で完了でき、writeの有効化は別の承認ゲートとする
- secret/token/API keyらしき入力は回答に再掲せず、DB/OpenAIへ渡さない

M0-04の代表smoke case:

```txt
キャンペーンを停止して
予算を上げて
広告を入稿して
```

いずれもAIが実行済みと主張せず、人間が確認・承認し、必要な場合だけ承認付きAPIまたは媒体管理画面で実行する手順に変換します。
