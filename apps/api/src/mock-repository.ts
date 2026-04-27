type Platform = "google" | "meta" | "yahoo";
type PlatformFilter = Platform | "all";
type Confidence = "high" | "medium" | "low";

import {
  campaignProfiles,
  dailyMetrics,
  generatedAt,
  latestMetricDate,
  type MockDailyMetricRow,
} from "./mock-ad-fixtures.js";

export type ChatRequest = {
  workspaceId: string;
  userId: string;
  threadId: string;
  message: string;
  context?: {
    dateRange?: string;
    comparisonRange?: string;
    range?: number;
    platform?: PlatformFilter;
  };
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ChatThread = {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export type ChatResponse = {
  message: {
    role: "assistant";
    content: string;
  };
  recommendation: {
    title: string;
    confidence: Confidence;
    operatorSteps: string[];
  };
  humanTaskDraft: {
    title: string;
    priority: "high" | "medium" | "low";
    status: "suggested";
  };
};

export type ChatThreadsResponse = {
  threads: Array<Omit<ChatThread, "messages"> & { messageCount: number; lastMessagePreview: string }>;
};

export type ChatThreadResponse = {
  thread: Omit<ChatThread, "messages">;
  messages: ChatMessage[];
};

export type ConnectionStatusResponse = {
  workspaceId: string;
  mode: "mock";
  policy: {
    access: "read-only";
    mediaWriteEnabled: false;
    note: string;
  };
  accounts: DashboardResponse["adAccounts"];
  nextConnectors: Array<{
    platform: Platform;
    label: string;
    status: "planned";
    oauthPath: string;
  }>;
};

export type MetricTotals = {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  revenue: number;
  ctr: number | null;
  cvr: number | null;
  cpc: number | null;
  cpa: number | null;
  roas: number | null;
};

type DailyMetricRow = MockDailyMetricRow;

export type DashboardResponse = {
  workspaceId: string;
  range: number;
  platform: PlatformFilter;
  summary: MetricTotals;
  comparison: MetricTotals;
  changes: Record<"ctr" | "cvr" | "cpc" | "cpa" | "roas" | "cost" | "conversions", number | null>;
  series: Array<{ date: string; cost: number; revenue: number; conversions: number }>;
  campaigns: Array<
    MetricTotals & {
      campaignId: string;
      campaign: string;
      platform: Platform;
      priority: "High" | "Medium" | "Low";
    }
  >;
  anomalies: Array<{
    date: string;
    type: "CPA悪化" | "CV減少" | "CTR低下" | "検知スキップ";
    platform: PlatformFilter;
    severity: "High" | "Medium" | "Low";
    detail: string;
    tags: string[];
  }>;
  severityCounts: Record<"High" | "Medium" | "Low", number>;
  relatedTags: string[];
  adAccounts: Array<{
    id: string;
    platform: Platform;
    name: string;
    status: "connected" | "pending";
    lastFetchedAt: string;
  }>;
};

export type LatestAdData = {
  workspaceId: string;
  generatedAt: string;
  range: number;
  platform: PlatformFilter;
  current: {
    label: string;
    totals: MetricTotals;
  };
  comparison: {
    label: string;
    totals: MetricTotals;
  };
  changes: DashboardResponse["changes"];
  campaigns: DashboardResponse["campaigns"];
  anomalies: DashboardResponse["anomalies"];
  relatedTags: string[];
};

export type HelpArticle = {
  id: string;
  title: string;
  difficulty: string;
  body: string;
  tags: string[];
};

const adAccounts: DashboardResponse["adAccounts"] = [
  {
    id: "acct-google-001",
    platform: "google",
    name: "Google Ads / Brand & Search",
    status: "connected",
    lastFetchedAt: "2026-04-26T08:20:00+09:00",
  },
  {
    id: "acct-meta-001",
    platform: "meta",
    name: "Meta Ads / Prospecting",
    status: "connected",
    lastFetchedAt: "2026-04-26T08:18:00+09:00",
  },
  {
    id: "acct-yahoo-001",
    platform: "yahoo",
    name: "Yahoo Ads / Retargeting",
    status: "connected",
    lastFetchedAt: "2026-04-26T08:15:00+09:00",
  },
];

const helpArticles: HelpArticle[] = [
  {
    id: "cpa-cvr-cpc",
    title: "CPA悪化をCVRとCPCに分解して見る",
    difficulty: "初級",
    tags: ["cpa", "cvr", "cpc"],
    body:
      "CPAが悪化したときは、まず費用とCV数だけで判断せず、CVRとCPCに分解します。CVRが下がっているならLPや検索意図、クリエイティブ訴求を確認します。CPCが上がっているなら競合強度、入札、配信面、キーワードの広がりを確認します。両方が悪化している場合は、予算変更より前に流入品質と訴求のズレを優先して見ます。",
  },
  {
    id: "kpi-tree",
    title: "KPIツリーで原因箇所を切り分ける",
    difficulty: "初級",
    tags: ["kpi", "cpa", "roas"],
    body:
      "広告の異常を見るときは、最終KPIから逆算して分解します。ROASなら売上、費用、CV数、客単価、CPAに分け、CPAならCPCとCVRに分けます。最初に一番大きく動いた枝を見つけると、媒体画面で見るべきレポートが絞れます。",
  },
  {
    id: "budget-pacing",
    title: "月末着地から予算配分を考える",
    difficulty: "中級",
    tags: ["budget", "pacing", "roas"],
    body:
      "予算を見るときは、今日時点の消化率だけでなく、月末着地予測と成果の安定性を合わせて確認します。CPAが良いキャンペーンでもCV数が少ない場合は急な増額を避け、段階的に増やします。逆にCPAが悪いキャンペーンでも、ブランドや指名検索のように役割が明確なものは停止ではなく予算抑制や観察を優先します。",
  },
  {
    id: "google-search-query-review",
    title: "Google検索語句レポートで無駄クリックを見つける",
    difficulty: "初級",
    tags: ["google", "yahoo", "keyword", "cpa"],
    body:
      "Google検索広告でCPAが悪化したときは、検索語句レポートを確認します。CVがないのに費用が大きい語句、意図がずれている語句、情報収集色が強い語句を見つけ、除外キーワード候補として整理します。除外は一気に広く入れすぎず、CVにつながる可能性がある語句を消さないように注意します。",
  },
  {
    id: "yahoo-search-query-review",
    title: "Yahoo検索広告の検索語句を見る観点",
    difficulty: "初級",
    tags: ["yahoo", "keyword", "search-query", "cpa"],
    body:
      "Yahoo検索広告でも、まず検索語句を意図別に分けます。購入意欲が高い語句、比較検討の語句、情報収集の語句、明らかに対象外の語句に分類し、費用とCVの偏りを見ます。Googleと同じ除外をそのまま移すのではなく、Yahoo側の実績を確認してから人間が反映します。",
  },
  {
    id: "keyword-match-type",
    title: "マッチタイプ拡張時の確認ポイント",
    difficulty: "中級",
    tags: ["google", "yahoo", "keyword", "search-query"],
    body:
      "部分一致やインテントの広い配信を使うと、CV機会が増える一方で検索語句の幅も広がります。拡張後はCPC、CVR、CVなし費用、検索語句の意味のズレを毎日短く確認します。成果が出る前に止めすぎないことと、明確な対象外語句を放置しないことのバランスが大切です。",
  },
  {
    id: "negative-keyword-safety",
    title: "除外キーワードを入れる前の安全確認",
    difficulty: "初級",
    tags: ["google", "yahoo", "negative-keyword", "human-review"],
    body:
      "除外キーワードは無駄クリック削減に有効ですが、広く入れすぎると将来CVする語句まで止めることがあります。候補語句は完全一致、フレーズ一致、語幹のどれで除外するかを分けて確認します。MVPではAIは候補整理まで行い、媒体管理画面での反映は担当者が判断します。",
  },
  {
    id: "brand-vs-nonbrand",
    title: "指名検索と非指名検索を分けて評価する",
    difficulty: "初級",
    tags: ["google", "yahoo", "brand", "roas"],
    body:
      "指名検索はCPAやROASが良く見えやすく、非指名検索は新規獲得の役割を持ちます。合算で見ると非指名の悪化や指名依存に気づきにくくなります。広告費の意思決定では、指名と非指名を分けてCV数、CPA、売上、検索語句の質を確認します。",
  },
  {
    id: "pmax-asset-insight",
    title: "P-MAXはアセットと検索カテゴリを合わせて見る",
    difficulty: "中級",
    tags: ["google", "pmax", "creative", "search-query"],
    body:
      "P-MAXは配信面が広いため、キャンペーン全体のCPAだけでは原因が見えにくいことがあります。アセット別の評価、検索カテゴリ、商品やLP別の成果を並べ、どの訴求や流入が伸びているか確認します。変更する場合は一度に多く触らず、差し替え内容を記録します。",
  },
  {
    id: "meta-creative-fatigue",
    title: "Meta広告のCTR低下からクリエイティブ疲弊を疑う",
    difficulty: "初級",
    tags: ["ctr", "creative", "meta"],
    body:
      "Meta広告でCTRが継続的に低下している場合、同じユーザーに同じ訴求が当たり続けている可能性があります。広告別のCTR、フリークエンシー、CVR、CPAを並べ、クリック率だけでなく獲得効率まで確認します。差し替え時は、訴求軸、ファーストビュー、オファー、フォーマットのどれを変えたか記録します。",
  },
  {
    id: "meta-audience-overlap",
    title: "Metaの広告セット同士の重複を疑う",
    difficulty: "中級",
    tags: ["meta", "audience", "cpc", "cpa"],
    body:
      "複数の広告セットで似たターゲットを使っていると、配信が競合してCPCやCPAが上がることがあります。広告セット別にリーチ、フリークエンシー、CPM、CPAを確認し、同じ訴求が同じ層に当たりすぎていないかを見ます。統合や停止は学習状態への影響があるため、実施前に人間がレビューします。",
  },
  {
    id: "creative-brief-variation",
    title: "クリエイティブ差し替えは仮説単位で作る",
    difficulty: "初級",
    tags: ["creative", "meta", "yahoo", "lp"],
    body:
      "広告画像や動画を増やすときは、なんとなく複数案を出すより、仮説ごとに差を作ります。価格訴求、実績訴求、不安解消、利用シーン、限定性など、どの軸を検証するかを明記します。結果を見るときにCTRだけでなくCVRとCPAまで追うと、刺さった訴求が分かりやすくなります。",
  },
  {
    id: "yahoo-retargeting-frequency",
    title: "Yahooリターゲティングは頻度と鮮度を見る",
    difficulty: "初級",
    tags: ["yahoo", "retargeting", "frequency", "creative"],
    body:
      "YahooのリターゲティングでCTRが落ちる場合、接触頻度の上昇やバナーの見慣れが原因かもしれません。期間別、リスト別、広告別にCTR、CVR、CPAを確認します。成果が悪い広告をすぐ止める前に、リストの期間や訴求の鮮度も合わせて見ます。",
  },
  {
    id: "lp-message-match",
    title: "広告文とLPファーストビューの一致を確認する",
    difficulty: "初級",
    tags: ["lp", "cvr", "creative"],
    body:
      "クリック後のCVRが下がっている場合、広告で約束した内容とLPの最初に見える内容がずれていることがあります。検索語句や広告見出しで期待された情報が、LPのファーストビューにあるか確認します。価格、対象者、導入メリット、フォーム導線がすぐ分かるかも重要です。",
  },
  {
    id: "lp-speed-check",
    title: "LP表示速度がCVRに与える影響を見る",
    difficulty: "初級",
    tags: ["lp", "cvr", "measurement"],
    body:
      "LPの表示が遅いと、クリックは発生してもフォーム到達前に離脱しやすくなります。媒体別、デバイス別にCVRが落ちていないかを確認し、スマートフォンで実際にページを開いて体感も見ます。画像の重さ、タグの多さ、外部スクリプトの影響は優先的に点検します。",
  },
  {
    id: "form-dropoff",
    title: "フォーム離脱は広告成果の一部として見る",
    difficulty: "中級",
    tags: ["lp", "form", "cvr", "measurement"],
    body:
      "広告管理画面のCVR低下は、広告だけでなくフォームの入力負荷やエラーでも起きます。フォーム到達数、入力開始数、完了数が見られる場合は段階別に落ちている箇所を確認します。項目数の増加、必須項目、スマートフォンでの入力しやすさをチェックします。",
  },
  {
    id: "conversion-tracking-health",
    title: "CV計測の欠損を疑うべきサイン",
    difficulty: "初級",
    tags: ["measurement", "conversion", "cpa"],
    body:
      "急にCV数が減ったのにクリックやLP到達が大きく変わらない場合、計測欠損の可能性があります。タグ発火、サンクスページ、GTM変更、フォーム改修、Cookie同意バナーの変更日を確認します。媒体の最適化にも影響するため、運用変更より先に計測状態を点検します。",
  },
  {
    id: "attribution-window",
    title: "媒体ごとの成果計上タイミングを理解する",
    difficulty: "中級",
    tags: ["measurement", "attribution", "google", "meta", "yahoo"],
    body:
      "Google、Meta、Yahooでは成果の計上タイミングやアトリビューションの考え方が異なります。同じCVでも媒体管理画面とGA4、CRMで日付や件数がずれることがあります。日次判断では速報値の揺れを前提にし、重要な判断は数日分の確定傾向を見ます。",
  },
  {
    id: "data-delay",
    title: "当日データは遅延を前提に扱う",
    difficulty: "初級",
    tags: ["monitoring", "measurement", "dashboard"],
    body:
      "広告媒体APIのデータは当日分が遅れて反映されることがあります。午前中のCVが少ないからといって、すぐに広告の問題と決めつけないようにします。ダッシュボードでは最終取得時刻、媒体別の遅延、前日までの確定傾向を合わせて確認します。",
  },
  {
    id: "oauth-read-only",
    title: "OAuth連携はread-only権限から始める",
    difficulty: "初級",
    tags: ["oauth", "read-only", "security"],
    body:
      "広告データ連携では、まずread-only権限で費用、クリック、CV、キャンペーン情報を取得できる状態を作ります。MVPでは予算変更や停止などの媒体変更はAPIから実行せず、AIは分析と人間向け手順の作成に絞ります。権限範囲を小さく保つことで、導入時の心理的安全性も高まります。",
  },
  {
    id: "token-secret-handling",
    title: "トークンやAPIキーをAI文脈に入れない",
    difficulty: "初級",
    tags: ["oauth", "security", "llm"],
    body:
      "OAuthのアクセストークン、リフレッシュトークン、APIキーはLLMに渡さない前提で設計します。AIに渡すのは集計済みの広告指標、キャンペーン名、異常内容、担当者が判断するための文脈に限定します。ログやエラーにもシークレットが出ないよう、保存と表示の境界を分けます。",
  },
  {
    id: "daily-anomaly-check",
    title: "毎朝の異常検知で見る順番",
    difficulty: "初級",
    tags: ["monitoring", "cpa", "ctr", "cvr"],
    body:
      "毎朝の確認では、まずCV数の急減、CPAの急騰、費用の急増を見ます。次にCTR、CPC、CVRに分解して、流入前の問題かLP後の問題かを切り分けます。異常が出ても即変更せず、計測欠損、セール、在庫、LP変更など外部要因を確認します。",
  },
  {
    id: "seasonality-promotion",
    title: "季節性とキャンペーン影響をメモする",
    difficulty: "初級",
    tags: ["seasonality", "promotion", "reporting"],
    body:
      "広告成果は曜日、給料日、連休、セール、在庫状況で大きく変わります。数値だけを見て媒体の良し悪しを判断する前に、事業側の出来事をメモしておきます。AIに渡す文脈にも、キャンペーン期間やLP変更日があると原因仮説の精度が上がります。",
  },
  {
    id: "small-budget-testing",
    title: "少額予算ではテストの粒度を絞る",
    difficulty: "初級",
    tags: ["budget", "testing", "creative"],
    body:
      "中小企業の広告運用では、同時に多くの広告セットや訴求を試すと学習も判断も薄くなります。少額予算では、媒体、ターゲット、訴求、LPのうち一度に検証する変数を絞ります。勝ち負けは1日だけで決めず、最低限のクリック数とCV傾向を見て判断します。",
  },
  {
    id: "cross-platform-role",
    title: "Google、Meta、Yahooの役割を分けて考える",
    difficulty: "初級",
    tags: ["google", "meta", "yahoo", "budget"],
    body:
      "媒体を横並びのCPAだけで比較すると、役割の違いを見落とします。Google検索は顕在層、Metaは潜在層への接触、Yahooは検索とリターゲティングの補完など、目的を分けて評価します。予算配分はCPAだけでなく、CV数、売上、見込み顧客の質、再現性も合わせて判断します。",
  },
  {
    id: "query-intent-classification",
    title: "検索語句を意図で分類して改善する",
    difficulty: "初級",
    tags: ["search-query", "keyword", "google", "yahoo"],
    body:
      "検索語句は単語単位ではなく、ユーザーの意図で分類します。今すぐ購入、比較検討、使い方調査、競合名、採用や無料情報などに分けると、除外候補とLP改善候補が見えます。CVが少ない語句でも、比較検討として重要なら別のLPや訴求を検討します。",
  },
  {
    id: "management-reporting",
    title: "経営向け報告は判断事項を先に書く",
    difficulty: "初級",
    tags: ["reporting", "kpi", "budget"],
    body:
      "経営向けの広告報告では、細かい指標の羅列よりも、今判断したいことを先に置きます。今月着地、目標との差分、原因仮説、担当者が実施したい作業、リスクを短くまとめます。CPAやROASの変化は、CV数や売上規模とセットで示すと意思決定しやすくなります。",
  },
  {
    id: "human-task-change-log",
    title: "人間が実施した変更を必ず記録する",
    difficulty: "初級",
    tags: ["human-task", "monitoring", "reporting"],
    body:
      "AIが提案した作業を人間が実施したら、日付、対象、変更内容、理由、期待する変化を記録します。翌日以降のCPA、CVR、CPC、CV数を見るときに、どの変更が効いたのかを追いやすくなります。記録がないと、成功も失敗も再現しにくくなります。",
  },
  {
    id: "read-only-action-plan",
    title: "read-only運用でのAI提案の使い方",
    difficulty: "初級",
    tags: ["read-only", "human-review", "action-plan"],
    body:
      "read-only運用では、AIは媒体を直接変更せず、原因仮説と作業手順を整理します。担当者は管理画面で対象を確認し、必要なら除外、予算調整、広告差し替えを人間の判断で実施します。AIの価値は自動実行ではなく、見る順番と判断材料を短時間で揃えることにあります。",
  },
  {
    id: "ga4-crm-reconciliation",
    title: "媒体CVとGA4・CRMの差分を確認する",
    difficulty: "中級",
    tags: ["measurement", "ga4", "crm", "conversion"],
    body:
      "媒体管理画面のCV、GA4のキーイベント、CRMの商談数は一致しないことがあります。計測地点、重複排除、電話CV、オフラインCV、日付の持ち方が違うためです。広告運用では差分の理由を把握し、どの指標を最終判断に使うかを事前に決めます。",
  },
];

const chatThreads = new Map<string, ChatThread>();

export function getRequestContext(req: Request) {
  const url = new URL(req.url);
  return {
    workspaceId: url.searchParams.get("workspaceId") || "demo-workspace",
    userId: req.headers.get("x-demo-user-id") || "demo-user",
  };
}

export function parseRange(value: string | null | undefined) {
  const parsed = Number(value ?? "7");
  return [7, 14, 30].includes(parsed) ? parsed : 7;
}

export function parsePlatform(value: string | null | undefined): PlatformFilter {
  return value === "google" || value === "meta" || value === "yahoo" ? value : "all";
}

export function getDashboardData(workspaceId: string, range: number, platform: PlatformFilter): DashboardResponse {
  const latest = getLatestAdData(workspaceId, range, platform);
  const currentDates = getCurrentDates(range);
  const series = currentDates.map((date) => {
    const rows = filterRows(dailyMetrics, [date], platform);
    const totals = calculateTotals(rows);
    return {
      date: date.slice(5).replace("-", "/"),
      cost: totals.cost,
      revenue: totals.revenue,
      conversions: totals.conversions,
    };
  });

  const severityCounts = latest.anomalies.reduce(
    (acc, anomaly) => {
      acc[anomaly.severity] += 1;
      return acc;
    },
    { High: 0, Medium: 0, Low: 0 },
  );

  return {
    workspaceId,
    range,
    platform,
    summary: latest.current.totals,
    comparison: latest.comparison.totals,
    changes: latest.changes,
    series,
    campaigns: latest.campaigns,
    anomalies: latest.anomalies,
    severityCounts,
    relatedTags: latest.relatedTags,
    adAccounts: platform === "all" ? adAccounts : adAccounts.filter((account) => account.platform === platform),
  };
}

export function getConnectionStatus(
  workspaceId: string,
  platform: PlatformFilter = "all",
): ConnectionStatusResponse {
  const accounts = (platform === "all" ? adAccounts : adAccounts.filter((account) => account.platform === platform)).map(
    (account) => ({
      ...account,
      status: "pending" as const,
      lastFetchedAt: "",
    }),
  );

  return {
    workspaceId,
    mode: "mock",
    policy: {
      access: "read-only",
      mediaWriteEnabled: false,
      note: "MVPでは広告媒体APIへの変更操作は行わず、人間が管理画面で実行する手順だけを返します。",
    },
    accounts,
    nextConnectors: [
      { platform: "google", label: "Google Ads OAuth", status: "planned", oauthPath: "/oauth/google/start" },
      { platform: "meta", label: "Meta Ads OAuth", status: "planned", oauthPath: "/oauth/meta/start" },
      { platform: "yahoo", label: "Yahoo Ads OAuth", status: "planned", oauthPath: "/oauth/yahoo/start" },
    ],
  };
}

export function getLatestAdData(workspaceId: string, range: number, platform: PlatformFilter): LatestAdData {
  const currentDates = getCurrentDates(range);
  const previousDates = getComparisonDates(range);
  const currentRows = filterRows(dailyMetrics, currentDates, platform);
  const comparisonRows = filterRows(dailyMetrics, previousDates, platform);
  const currentTotals = calculateTotals(currentRows);
  const comparisonTotals = calculateTotals(comparisonRows);
  const campaigns = campaignProfiles
    .filter((campaign) => platform === "all" || campaign.platform === platform)
    .map((campaign) => {
      const current = calculateTotals(filterRows(currentRows, currentDates, campaign.platform, campaign.campaignId));
      return {
        campaignId: campaign.campaignId,
        campaign: campaign.campaignName,
        platform: campaign.platform,
        priority: priorityFor(current.cpa),
        ...current,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  const changes = {
    ctr: change(currentTotals.ctr, comparisonTotals.ctr),
    cvr: change(currentTotals.cvr, comparisonTotals.cvr),
    cpc: change(currentTotals.cpc, comparisonTotals.cpc),
    cpa: change(currentTotals.cpa, comparisonTotals.cpa),
    roas: change(currentTotals.roas, comparisonTotals.roas),
    cost: change(currentTotals.cost, comparisonTotals.cost),
    conversions: change(currentTotals.conversions, comparisonTotals.conversions),
  };
  const anomalies = buildAnomalies(platform, changes);
  const relatedTags = [...new Set(anomalies.flatMap((anomaly) => anomaly.tags))];

  return {
    workspaceId,
    generatedAt,
    range,
    platform,
    current: {
      label: `直近${range}日`,
      totals: currentTotals,
    },
    comparison: {
      label: `前${range}日`,
      totals: comparisonTotals,
    },
    changes,
    campaigns,
    anomalies,
    relatedTags,
  };
}

export function createMockChatResponse(request: ChatRequest, latestAdData: LatestAdData): ChatResponse {
  const primaryCampaign = latestAdData.campaigns[0];
  const cpaChange = signedPercent(latestAdData.changes.cpa);
  const cvrChange = signedPercent(latestAdData.changes.cvr);
  const cpcChange = signedPercent(latestAdData.changes.cpc);
  const platformLabel = latestAdData.platform === "all" ? "全媒体" : latestAdData.platform;
  const targetCampaign = primaryCampaign?.campaign ?? "主要キャンペーン";
  const confidence: Confidence = latestAdData.anomalies.some((anomaly) => anomaly.severity === "High") ? "high" : "medium";

  return {
    message: {
      role: "assistant",
      content: [
        `結論: ${platformLabel}の直近${latestAdData.range}日は、${targetCampaign}を優先確認してください。CPAは前期間比 ${cpaChange} です。`,
        "",
        `根拠: CVRは ${cvrChange}、CPCは ${cpcChange}。費用は¥${latestAdData.current.totals.cost.toLocaleString("ja-JP")}、CVは${latestAdData.current.totals.conversions}件です。`,
        "",
        "原因仮説: 流入品質の低下、検索語句や配信面の広がり、Meta系では訴求疲弊が同時に起きている可能性があります。",
        "",
        "推奨アクション: まず管理画面でレポートを確認し、悪化要因を切り分けてから除外キーワード候補、配信面、クリエイティブ差し替え案を人間が判断してください。",
        "",
        "人間向け作業手順:",
        "1. 対象キャンペーンを開き、直近期間と前期間のCPA/CVR/CPC/CTRを比較する。",
        "2. CVなしで費用が大きい検索語句、広告、配信面を抽出する。",
        "3. 除外・停止・予算変更はこのAPIから実行せず、管理画面でレビュー後に担当者が操作する。",
        "4. 実施内容と理由をメモし、翌日から3日間はCPAとCV数を観察する。",
        "",
        "実施前チェック: CV計測の欠損、LP変更、セールや在庫影響、媒体側の学習状態を確認してください。",
        "",
        "リスク: 除外や停止を急ぐと、将来CVする可能性がある流入まで止める恐れがあります。",
        "",
        `実施後の観察: CPA、CVR、CPC、CV数を同じ期間幅で比較します。自信度: ${confidence}`,
      ].join("\n"),
    },
    recommendation: {
      title: `${targetCampaign}のCPA悪化要因を人間が確認する`,
      confidence,
      operatorSteps: [
        "媒体管理画面で対象キャンペーンの期間比較を開く",
        "CVなし高コストの検索語句・広告・配信面を候補として整理する",
        "変更前に計測欠損とLP変更の有無を確認する",
        "担当者レビュー後に管理画面で必要な操作を行う",
      ],
    },
    humanTaskDraft: {
      title: `${targetCampaign}のCPA/CVR/CPCを確認する`,
      priority: confidence === "high" ? "high" : "medium",
      status: "suggested",
    },
  };
}

export function listChatThreads(workspaceId: string, userId: string): ChatThreadsResponse {
  const threads = [...chatThreads.values()]
    .filter((thread) => thread.workspaceId === workspaceId && thread.userId === userId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((thread) => {
      const lastMessage = thread.messages.at(-1);
      return {
        id: thread.id,
        workspaceId: thread.workspaceId,
        userId: thread.userId,
        title: thread.title,
        updatedAt: thread.updatedAt,
        messageCount: thread.messages.length,
        lastMessagePreview: lastMessage ? truncate(lastMessage.content, 72) : "",
      };
    });

  return { threads };
}

export function getChatThread(workspaceId: string, userId: string, threadId: string): ChatThreadResponse {
  const thread = ensureChatThread(workspaceId, userId, threadId);
  return {
    thread: {
      id: thread.id,
      workspaceId: thread.workspaceId,
      userId: thread.userId,
      title: thread.title,
      updatedAt: thread.updatedAt,
    },
    messages: thread.messages,
  };
}

export function appendChatExchange(request: ChatRequest, response: ChatResponse): ChatThreadResponse {
  const thread = ensureChatThread(request.workspaceId, request.userId, request.threadId, request.message);
  const now = new Date().toISOString();
  thread.messages.push(
    {
      id: `msg-${thread.id}-${thread.messages.length + 1}`,
      role: "user",
      content: request.message,
      createdAt: now,
    },
    {
      id: `msg-${thread.id}-${thread.messages.length + 2}`,
      role: "assistant",
      content: response.message.content,
      createdAt: new Date().toISOString(),
    },
  );
  thread.updatedAt = new Date().toISOString();
  return getChatThread(request.workspaceId, request.userId, request.threadId);
}

export function ensureChatThread(workspaceId: string, userId: string, threadId: string, seedMessage = ""): ChatThread {
  const key = chatThreadKey(workspaceId, userId, threadId);
  const existing = chatThreads.get(key);
  if (existing) return existing;

  const now = new Date().toISOString();
  const thread: ChatThread = {
    id: threadId,
    workspaceId,
    userId,
    title: titleFromMessage(seedMessage) || "新しい相談",
    updatedAt: now,
    messages: [
      {
        id: `msg-${threadId}-welcome`,
        role: "assistant",
        content:
          "こんにちは。最新広告データ、保存済みナレッジ、必要に応じた外部検索を分けて扱いながら、原因分析と人間向け作業手順まで整理します。",
        createdAt: now,
      },
    ],
  };
  chatThreads.set(key, thread);
  return thread;
}

export function getColumns(tags: string[] = []) {
  if (tags.length === 0) return helpArticles;
  const normalizedTags = tags.map((tag) => tag.toLowerCase());
  return helpArticles.filter((article) => article.tags.some((tag) => normalizedTags.includes(tag.toLowerCase())));
}

export function getColumnById(id: string) {
  const article = helpArticles.find((item) => item.id === id);
  if (!article) return null;
  const related = getColumns(article.tags).filter((item) => item.id !== id).slice(0, 3);
  return { article, related };
}

function filterRows(rows: DailyMetricRow[], dates: string[], platform: PlatformFilter, campaignId?: string) {
  return rows.filter(
    (row) =>
      dates.includes(row.date) &&
      (platform === "all" || row.platform === platform) &&
      (!campaignId || row.campaignId === campaignId),
  );
}

function getCurrentDates(range: number) {
  return getDateWindow(latestMetricDate, range);
}

function getComparisonDates(range: number) {
  return getDateWindow(addDays(latestMetricDate, -range), range);
}

function getDateWindow(endDate: string, range: number) {
  const dates: string[] = [];
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let offset = range - 1; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - offset);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function calculateTotals(rows: DailyMetricRow[]): MetricTotals {
  const base = rows.reduce(
    (acc, row) => ({
      impressions: acc.impressions + row.impressions,
      clicks: acc.clicks + row.clicks,
      cost: acc.cost + row.cost,
      conversions: acc.conversions + row.conversions,
      revenue: acc.revenue + row.revenue,
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 },
  );
  return {
    ...base,
    ctr: rate(base.clicks, base.impressions),
    cvr: rate(base.conversions, base.clicks),
    cpc: rate(base.cost, base.clicks),
    cpa: rate(base.cost, base.conversions),
    roas: rate(base.revenue, base.cost),
  };
}

function buildAnomalies(platform: PlatformFilter, changes: DashboardResponse["changes"]): DashboardResponse["anomalies"] {
  const anomalies: DashboardResponse["anomalies"] = [];
  if ((changes.cpa ?? 0) > 0.25) {
    anomalies.push({
      date: "2026-04-26",
      type: "CPA悪化",
      platform,
      severity: "High",
      detail: `CPAが前期間比 ${signedPercent(changes.cpa)}。CVR低下とCPC上昇が同時に発生。`,
      tags: ["cpa", "cvr", "cpc"],
    });
  }
  if ((changes.ctr ?? 0) < -0.1) {
    anomalies.push({
      date: "2026-04-26",
      type: "CTR低下",
      platform: platform === "all" ? "meta" : platform,
      severity: "Medium",
      detail: `CTRが前期間比 ${signedPercent(changes.ctr)}。訴求疲弊または配信面変化の可能性。`,
      tags: ["ctr", "creative", "meta"],
    });
  }
  if (anomalies.length === 0) {
    anomalies.push({
      date: "2026-04-26",
      type: "検知スキップ",
      platform,
      severity: "Low",
      detail: "重要な異常は検知されていません。",
      tags: ["monitoring"],
    });
  }
  return anomalies;
}

function priorityFor(cpa: number | null): "High" | "Medium" | "Low" {
  if (cpa === null) return "Low";
  if (cpa >= 12000) return "High";
  if (cpa >= 9000) return "Medium";
  return "Low";
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

function change(current: number | null, comparison: number | null) {
  if (current === null || comparison === null || comparison === 0) return null;
  return current / comparison - 1;
}

function signedPercent(value: number | null) {
  if (value === null) return "-";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function chatThreadKey(workspaceId: string, userId: string, threadId: string) {
  return `${workspaceId}:${userId}:${threadId}`;
}

function titleFromMessage(message: string) {
  return truncate(message.replace(/\s+/g, " ").trim(), 28);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
