# microCMS Help 運用

## 方針

`ヘルプ`の公開コンテンツ正本はmicroCMSとする。WebブラウザからmicroCMSを直接呼ばず、Cloud Run APIの`/help/articles`だけを呼ぶ。microCMSのAPIキーはCloud Runだけに保存し、Vite環境変数やブラウザレスポンスへ含めない。

microCMSが未設定、timeout、4xx/5xx、空レスポンス、schema不整合の場合は、リポジトリ内の基本ヘルプへ自動で切り替える。画面には`基本ヘルプを表示中`と表示する。

## microCMS側の作成

1. microCMSでサービスを作成する
2. リスト形式APIを作成する
3. API名を`ヘルプ`、エンドポイントを`help`にする
4. 次のschemaを設定する

| 表示名 | フィールドID | 種類 | 必須 | 用途 |
| --- | --- | --- | --- | --- |
| タイトル | `title` | テキストフィールド | 必須 | 一覧と詳細の見出し |
| 要約 | `summary` | テキストエリア | 必須 | 一覧に表示する120文字程度の説明 |
| カテゴリ | `category` | セレクト | 必須 | `はじめ方 / 指標の見方 / Google Ads / 承認付き変更 / トラブル対応` |
| 難易度 | `difficulty` | セレクト | 必須 | `基本 / 初級 / 中級` |
| 本文 | `body` | テキストエリア | 必須 | Markdown記法の本文 |
| タグ | `tags` | セレクト・複数選択 | 任意 | `google / cpa / cvr / oauth / billing`など |
| 表示順 | `sortOrder` | 数値 | 必須 | 小さい値から表示。10刻みを推奨 |

`body`はリッチエディタではなくテキストエリアを使う。現在のWebは安全なMarkdownサブセット（見出し、段落、番号・箇条書き、太字、インラインコード、HTTPSリンク）をReact要素として描画し、生HTMLを実行しない。

セレクトフィールドは、単一選択でもContent APIでは配列で返る。API adapterが先頭の値へ正規化する。

既存のmicroCMSブログテンプレートを使う場合は、リッチエディタの`content`も本文として利用できる。API側で生HTMLを安全なMarkdownへ変換し、カテゴリがオブジェクトの場合は`name`を表示する。`summary / difficulty / tags / sortOrder`が未作成でも、それぞれ本文からの要約、`基本`、空配列、`100`を補うため、段階的に推奨schemaへ移行できる。

## APIキー

microCMSでHelp APIのGETだけを許可したAPIキーを作成する。POST / PUT / PATCH / DELETE権限は付けない。

Cloud Run APIにだけ次を設定する。

```env
MICROCMS_SERVICE_DOMAIN=your-service-domain
MICROCMS_API_KEY=server-side-read-only-key
MICROCMS_TIMEOUT_MS=4000
```

`MICROCMS_SERVICE_DOMAIN`には`https://`や`.microcms.io`を含めず、サービスドメイン部分だけを入れる。

## 公開フロー

1. microCMSで記事を下書きする
2. プレビューでタイトル、要約、本文、タグを確認する
3. 公開する
4. アプリのヘルプで`基本ヘルプを表示中`が消え、公開記事が表示されることを確認する
5. 問題がある場合はmicroCMS側を非公開に戻す。アプリのdeployは不要

## 確認

APIのhealthレスポンスでは、値を露出せず設定有無だけ確認できる。

```json
{
  "helpContentConfigured": true
}
```

一覧は`GET /help/articles`、詳細は`GET /help/articles/:id`で確認する。レスポンスの`source`が`microcms`なら公開コンテンツ、`fallback`なら内蔵コンテンツを使用している。

## 最初に用意する記事

1. Google Adsを接続する
2. CPA悪化をCVRとCPCに分ける
3. 検索語句レポートを確認する
4. 予算変更を承認する前の確認
5. OAuth接続が切れたときの再接続

媒体設定の変更手順では、AI単独実行と誤解される表現を使わない。対象、現在値、変更理由、戻し条件、人間の承認が必要なことを明記する。
