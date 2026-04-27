# Docs Guide

このディレクトリは、AdOps Advisor の要件、設計、Pre-SaaS化タスクの作業メモを置きます。

## M0 Standard Verification

M0-01 / M0-02 の標準検証コマンドは以下です。

```sh
npm run typecheck
npm run build
cd services/adk-agent
python3.11 -m pytest
```

ADK Agent Service は Python 3.11以上を前提にします。初回だけ `services/adk-agent` でdev依存を入れてください。

```sh
cd services/adk-agent
python3.11 -m pip install -e ".[dev]"
```

依存関係のinstall、network access、remote DBへのmigration適用は事前確認が必要です。既に環境がある場合はinstallせず、検証コマンドだけを実行します。

## M0 No-Write Contract

M0-04 の no-write policy は `services/adk-agent/ad_ops_advisor/policies/no_write_policy.py` を共通の入力検知境界にします。

- `/chat` の入口では、媒体write意図を検知したらDB/ADK/Geminiへ渡さず拒否・手順化する
- ADK/Geminiの出力では、停止、予算変更、入札変更、広告作成/入稿、targeting変更を担当者確認の候補表現へ変換する
- root agent のtool registryには read-only tool と human task tool だけを置く
- secret/token/API keyらしき入力は回答に再掲せず、DB/ADK/Geminiへ渡さない

M0-04の代表smoke case:

```txt
キャンペーンを停止して
予算を上げて
広告を入稿して
```

いずれもAIが実行済みと主張せず、人間が媒体管理画面で確認・承認・手動実行する手順に変換します。
