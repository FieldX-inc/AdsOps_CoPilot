import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./styles.css";

type View = "dashboard" | "bi" | "columns" | "connections";
type PlatformFilter = "all" | "google" | "meta" | "yahoo";
type Confidence = "high" | "medium" | "low";

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

type ChatResponse = {
  message: { role: "assistant"; content: string };
  thread?: {
    messages: ChatMessage[];
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

type ChatThreadSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string;
};

type ChatThreadResponse = {
  thread: {
    id: string;
    title: string;
    updatedAt: string;
  };
  messages: ChatMessage[];
};

type ReadinessResponse = {
  mode: "mock" | "adk-proxy";
  status: string;
  scopes?: {
    mock: ReadinessScope;
    production: ReadinessScope;
  };
  goNoGo: {
    decision: string;
    note: string;
  };
  checks: Array<{
    id: string;
    label: string;
    status: "pass" | "todo" | "risk";
    evidence: string[];
  }>;
  nextActions: string[];
};

type ReadinessScope = {
  label: string;
  decision: string;
  note: string;
  checks: Array<{
    id: string;
    label: string;
    status: "pass" | "todo" | "risk";
    evidence: string[];
  }>;
  nextActions?: string[];
};

type TodoItem = {
  id: string;
  text: string;
  done: boolean;
};

type MetricTotals = {
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

type Campaign = MetricTotals & {
  campaignId: string;
  campaign: string;
  platform: Exclude<PlatformFilter, "all">;
  priority: "High" | "Medium" | "Low";
};

type DashboardResponse = {
  workspaceId: string;
  range: number;
  platform: PlatformFilter;
  summary: MetricTotals;
  comparison: MetricTotals;
  changes: Record<"ctr" | "cvr" | "cpc" | "cpa" | "roas" | "cost" | "conversions", number | null>;
  series: Array<{ date: string; cost: number; revenue: number; conversions: number }>;
  campaigns: Campaign[];
  anomalies: Array<{
    date: string;
    type: string;
    platform: PlatformFilter;
    severity: "High" | "Medium" | "Low";
    detail: string;
    tags: string[];
  }>;
  severityCounts: Record<"High" | "Medium" | "Low", number>;
  relatedTags: string[];
  adAccounts: Array<{
    id: string;
    platform: Exclude<PlatformFilter, "all">;
    name: string;
    status: "connected" | "pending";
    lastFetchedAt: string;
  }>;
};

type ConnectionStatusResponse = {
  workspaceId: string;
  mode: "mock" | "production";
  policy: {
    access: "read-only";
    mediaWriteEnabled: false;
    note: string;
  };
  accounts: DashboardResponse["adAccounts"];
  connections?: Array<{
    id: string;
    platform: Exclude<PlatformFilter, "all">;
    status: "pending" | "connected" | "expired" | "revoked" | "error";
    provider_account_id?: string | null;
    expires_at?: string | null;
  }>;
  nextConnectors: Array<{
    platform: Exclude<PlatformFilter, "all">;
    label: string;
    status: "planned" | "ready";
    oauthPath: string;
  }>;
};

type HelpArticle = {
  id: string;
  title: string;
  difficulty: string;
  body: string;
  tags: string[];
};

type ColumnDetail = {
  article: HelpArticle;
  related: HelpArticle[];
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
const columnBookmarkStorageKey = "adops-advisor:column-bookmarks";
const demoPayload = {
  workspaceId: "demo-workspace",
  userId: "demo-user",
  threadId: "demo-thread",
};

type WorkspaceSession = {
  workspaceId: string;
  userId: string;
  threadId: string;
  workspaceName: string;
  userEmail: string;
};

const welcomeMessage: ChatMessage = {
  id: "local-welcome",
  role: "assistant",
  content:
    "こんにちは。最新広告データ、保存済みナレッジ、必要に応じた外部検索を分けて扱いながら、原因分析と人間向け作業手順まで整理します。",
};

const navItems: Array<{ key: View; label: string }> = [
  { key: "dashboard", label: "ダッシュボード" },
  { key: "bi", label: "BI分析" },
  { key: "columns", label: "Adコラム" },
  { key: "connections", label: "データ連携" },
];

const demoDashboardData: DashboardResponse = {
  workspaceId: "demo-workspace",
  range: 7,
  platform: "all",
  summary: {
    impressions: 284300,
    clicks: 8620,
    cost: 1268000,
    conversions: 214,
    revenue: 3120000,
    ctr: 0.0303,
    cvr: 0.0248,
    cpc: 147.1,
    cpa: 5925.2,
    roas: 2.46,
  },
  comparison: {
    impressions: 259100,
    clicks: 8430,
    cost: 1124000,
    conversions: 236,
    revenue: 3380000,
    ctr: 0.0325,
    cvr: 0.028,
    cpc: 133.3,
    cpa: 4762.7,
    roas: 3.01,
  },
  changes: {
    ctr: -0.068,
    cvr: -0.114,
    cpc: 0.104,
    cpa: 0.244,
    roas: -0.183,
    cost: 0.128,
    conversions: -0.093,
  },
  series: [
    { date: "04/20", cost: 156000, revenue: 486000, conversions: 39 },
    { date: "04/21", cost: 172000, revenue: 458000, conversions: 33 },
    { date: "04/22", cost: 181000, revenue: 432000, conversions: 31 },
    { date: "04/23", cost: 190000, revenue: 410000, conversions: 29 },
    { date: "04/24", cost: 198000, revenue: 397000, conversions: 27 },
    { date: "04/25", cost: 184000, revenue: 464000, conversions: 32 },
    { date: "04/26", cost: 187000, revenue: 473000, conversions: 23 },
  ],
  campaigns: [
    {
      campaignId: "g-search-brand",
      campaign: "Google検索_指名",
      platform: "google",
      priority: "Low",
      impressions: 38200,
      clicks: 3110,
      cost: 286000,
      conversions: 96,
      revenue: 1280000,
      ctr: 0.0814,
      cvr: 0.0309,
      cpc: 92,
      cpa: 2979,
      roas: 4.48,
    },
    {
      campaignId: "m-prospecting",
      campaign: "Meta_新規獲得_動画",
      platform: "meta",
      priority: "High",
      impressions: 146000,
      clicks: 3140,
      cost: 502000,
      conversions: 47,
      revenue: 621000,
      ctr: 0.0215,
      cvr: 0.015,
      cpc: 160,
      cpa: 10681,
      roas: 1.24,
    },
    {
      campaignId: "y-retarget",
      campaign: "Yahoo_リターゲティング",
      platform: "yahoo",
      priority: "Medium",
      impressions: 64100,
      clicks: 1570,
      cost: 254000,
      conversions: 42,
      revenue: 743000,
      ctr: 0.0245,
      cvr: 0.0268,
      cpc: 162,
      cpa: 6048,
      roas: 2.93,
    },
    {
      campaignId: "g-pmax",
      campaign: "Google_P-MAX_非指名",
      platform: "google",
      priority: "High",
      impressions: 36000,
      clicks: 800,
      cost: 226000,
      conversions: 29,
      revenue: 476000,
      ctr: 0.0222,
      cvr: 0.0363,
      cpc: 283,
      cpa: 7793,
      roas: 2.11,
    },
  ],
  anomalies: [
    {
      date: "2026-04-26",
      type: "CPA悪化",
      platform: "meta",
      severity: "High",
      detail: "Meta新規獲得のCPAが前期間比で42%上昇。CVR低下とCPC上昇が同時に発生しています。",
      tags: ["CPA", "CVR", "Meta"],
    },
    {
      date: "2026-04-25",
      type: "ROAS低下",
      platform: "google",
      severity: "High",
      detail: "Google P-MAXのROASが2.1まで低下。費用配分の確認が必要です。",
      tags: ["ROAS", "P-MAX"],
    },
    {
      date: "2026-04-24",
      type: "CTR低下",
      platform: "yahoo",
      severity: "Medium",
      detail: "YahooリターゲティングのCTRが3日連続で低下しています。",
      tags: ["CTR", "Yahoo"],
    },
  ],
  severityCounts: { High: 2, Medium: 1, Low: 0 },
  relatedTags: ["CPA", "CVR", "ROAS"],
  adAccounts: [
    { id: "act-google-1", platform: "google", name: "Google Ads / 自社EC", status: "connected", lastFetchedAt: "2026-04-26T08:30:00+09:00" },
    { id: "act-meta-1", platform: "meta", name: "Meta Ads / 新規獲得", status: "connected", lastFetchedAt: "2026-04-26T08:20:00+09:00" },
    { id: "act-yahoo-1", platform: "yahoo", name: "Yahoo Ads / 検索広告", status: "pending", lastFetchedAt: "2026-04-25T18:10:00+09:00" },
  ],
};

const demoArticles: HelpArticle[] = [
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
    difficulty: "中級",
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
    id: "workspace-scope",
    title: "広告アカウントはworkspace単位で確認する",
    difficulty: "中級",
    tags: ["workspace", "security", "oauth"],
    body:
      "1社に複数の広告アカウントがある場合、ユーザーが見てよいworkspaceの範囲だけを扱う必要があります。データ取得、ダッシュボード表示、AIへの文脈注入ではworkspace_idを必ず確認します。別会社のアカウント名や数値が混ざると、提案の品質だけでなく情報管理上の問題になります。",
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
    id: "recommendation-confidence",
    title: "提案の自信度を数値の量で変える",
    difficulty: "中級",
    tags: ["recommendation", "confidence", "kpi"],
    body:
      "CV数が少ないキャンペーンでは、CPAが大きく動いても偶然の影響が大きいことがあります。提案の自信度は、変化率だけでなくクリック数、CV数、期間、過去の再現性で調整します。根拠が足りないときは、すぐ変更するより追加観察や確認タスクを出します。",
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

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [range, setRange] = useState(7);
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [columnTags, setColumnTags] = useState<string[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [bookmarkedArticleIds, setBookmarkedArticleIds] = useState<string[]>(() => readColumnBookmarks());
  const [dashboardData, setDashboardData] = useState<DashboardResponse | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [usingDemoData, setUsingDemoData] = useState(false);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [input, setInput] = useState("");
  const [threadId, setThreadId] = useState(demoPayload.threadId);
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [threadTodos, setThreadTodos] = useState<Record<string, TodoItem[]>>({});
  const [latestRecommendation, setLatestRecommendation] = useState<ChatResponse["recommendation"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState("root_agent が会話内容を確認しています。");
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [workspaceSession, setWorkspaceSession] = useState<WorkspaceSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  const activePayload = workspaceSession ?? demoPayload;

  function authHeaders(extra?: HeadersInit): HeadersInit {
    return {
      ...(extra ?? {}),
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    };
  }

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      setAuthError("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定です。");
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setWorkspaceSession(null);
        setMessages([welcomeMessage]);
      }
    });
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setAuthError("");
    fetch(`${apiBaseUrl}/workspace/bootstrap`, {
      headers: authHeaders(),
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "workspaceの初期化に失敗しました。");
        const nextWorkspaceSession = {
          workspaceId: data.workspace.id as string,
          userId: data.user.id as string,
          threadId: data.workspace.id as string,
          workspaceName: data.workspace.name as string,
          userEmail: (data.user.email as string | undefined) ?? "",
        };
        setWorkspaceSession(nextWorkspaceSession);
        setThreadId(nextWorkspaceSession.threadId);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setAuthError(caught instanceof Error ? caught.message : "workspaceの初期化に失敗しました。");
      });
    return () => controller.abort();
  }, [session]);

  useEffect(() => {
    writeColumnBookmarks(bookmarkedArticleIds);
  }, [bookmarkedArticleIds]);

  useEffect(() => {
    if (!workspaceSession) return;
    const controller = new AbortController();
    setDashboardLoading(true);
    setDashboardError("");
    fetch(
      `${apiBaseUrl}/dashboard?workspaceId=${activePayload.workspaceId}&range=${range}&platform=${platform}`,
      { headers: authHeaders(), signal: controller.signal },
    )
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "ダッシュボードデータの取得に失敗しました。");
        setDashboardData(data as DashboardResponse);
        setUsingDemoData(false);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setDashboardData(filterDemoDashboardData(range, platform));
        setUsingDemoData(true);
        setDashboardError("");
      })
      .finally(() => setDashboardLoading(false));
    return () => controller.abort();
  }, [range, platform, workspaceSession?.workspaceId, session?.access_token]);

  useEffect(() => {
    if (!workspaceSession) return;
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/readiness?workspaceId=${activePayload.workspaceId}`, { headers: authHeaders(), signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "社内テスト準備状況の取得に失敗しました。");
        setReadiness(normalizeReadiness(data as ReadinessResponse));
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setReadiness(createDemoReadiness());
      });
    return () => controller.abort();
  }, [workspaceSession?.workspaceId, session?.access_token]);

  useEffect(() => {
    if (!workspaceSession) return;
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/agent/threads?workspaceId=${activePayload.workspaceId}`, { headers: authHeaders(), signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "チャットセッションの取得に失敗しました。");
        setThreads(data.threads as ChatThreadSummary[]);
      })
      .catch(() => {
        setThreads([
          {
            id: demoPayload.threadId,
            title: "デモ相談",
            updatedAt: new Date().toISOString(),
            messageCount: messages.length,
            lastMessagePreview: messages.at(-1)?.content ?? "",
          },
        ]);
      });
    return () => controller.abort();
  }, [workspaceSession?.workspaceId, session?.access_token]);

  useEffect(() => {
    if (!workspaceSession) return;
    const controller = new AbortController();
    setThreadLoading(true);
    fetch(`${apiBaseUrl}/agent/threads/${threadId}?workspaceId=${activePayload.workspaceId}`, { headers: authHeaders(), signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "チャット履歴の取得に失敗しました。");
        setMessages((data as ChatThreadResponse).messages);
      })
      .catch(() => {
        if (threadId === demoPayload.threadId) setMessages((prev) => (prev.length ? prev : [welcomeMessage]));
      })
      .finally(() => setThreadLoading(false));
    return () => controller.abort();
  }, [threadId, workspaceSession?.workspaceId, session?.access_token]);

  function refreshThreads() {
    fetch(`${apiBaseUrl}/agent/threads?workspaceId=${activePayload.workspaceId}`, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => setThreads((data.threads as ChatThreadSummary[]) ?? []))
      .catch(() => undefined);
  }

  function startNewThread() {
    const nextThreadId = `thread-${Date.now()}`;
    setThreadId(nextThreadId);
    setMessages([welcomeMessage]);
    setThreads((prev) => [
      {
        id: nextThreadId,
        title: "新しい相談",
        updatedAt: new Date().toISOString(),
        messageCount: 1,
        lastMessagePreview: welcomeMessage.content,
      },
      ...prev,
    ]);
  }

  function toggleArticleBookmark(articleId: string) {
    setBookmarkedArticleIds((current) =>
      current.includes(articleId)
        ? current.filter((id) => id !== articleId)
        : [...current, articleId],
    );
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError("");
    setLoading(true);
    setThinkingStatus("root_agent が会話内容を確認しています。");
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const res = await fetch(`${apiBaseUrl}/agent/chat/stream`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          ...activePayload,
          threadId,
          message: text,
          context: {
            range,
            platform,
            dateRange: `last_${range}_days`,
            comparisonRange: `previous_${range}_days`,
          },
        }),
      });
      if (!res.ok || !res.body) throw new Error("AI応答ストリームの開始に失敗しました。");

      const chat = await readChatStream(res, setThinkingStatus);
      if (!chat) throw new Error("AI応答を取得できませんでした。");
      setMessages(chat.thread?.messages ?? ((prev) => [...prev, chat.message]));
      setLatestRecommendation(chat.recommendation);
      refreshThreads();
    } catch (caught) {
      const chat = createDemoChatResponse(text, dashboardData);
      setMessages((prev) => [...prev, chat.message]);
      setLatestRecommendation(chat.recommendation);
      setError(caught instanceof Error ? `デモ応答を表示中: ${caught.message}` : "デモ応答を表示中です。");
    } finally {
      setLoading(false);
    }
  }

  if (authLoading) {
    return <AuthShell title="認証を確認しています" message="Supabase sessionを復元しています。" />;
  }

  if (!session || !workspaceSession) {
    return (
      <AuthPage
        error={authError}
        session={session}
        onMagicLink={async (email) => {
          if (!supabase) {
            setAuthError("Supabase Auth clientが未設定です。");
            return;
          }
          setAuthError("");
          const { error: signInError } = await supabase.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: window.location.origin },
          });
          if (signInError) setAuthError(signInError.message);
          else setAuthError("確認メールを送信しました。メール内リンクからログインしてください。");
        }}
        onPasswordLogin={async (email, password) => {
          if (!supabase) {
            setAuthError("Supabase Auth clientが未設定です。");
            return;
          }
          setAuthError("");
          const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError) setAuthError(signInError.message);
        }}
        onPasswordSignup={async (email, password) => {
          if (!supabase) {
            setAuthError("Supabase Auth clientが未設定です。");
            return;
          }
          setAuthError("");
          const { error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          });
          if (signUpError) setAuthError(signUpError.message);
          else setAuthError("ユーザーを作成しました。確認メールが必要な設定の場合はメール内リンクを開いてください。");
        }}
        onLogout={async () => {
          await supabase?.auth.signOut();
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar active={view} workspace={workspaceSession} onNavigate={setView} onLogout={() => supabase?.auth.signOut()} />
      <main id="main-content" className="main-content">
        {view === "dashboard" && (
          <DashboardPage
            data={dashboardData}
            loading={dashboardLoading}
            error={dashboardError}
            range={range}
            platform={platform}
            latestRecommendation={latestRecommendation}
            usingDemoData={isMockDataExperience(usingDemoData, readiness)}
            readiness={readiness}
            onRangeChange={setRange}
            onPlatformChange={setPlatform}
            onOpenAi={() => setAiOpen(true)}
            onOpenConnections={() => setView("connections")}
            onOpenColumns={(tags) => {
              setColumnTags(tags);
              setSelectedArticleId(null);
              setView("columns");
            }}
          />
        )}
        {view === "bi" && (
          <BiPage
            data={dashboardData}
            loading={dashboardLoading}
            error={dashboardError}
            range={range}
            platform={platform}
            usingDemoData={isMockDataExperience(usingDemoData, readiness)}
            onRangeChange={setRange}
            onPlatformChange={setPlatform}
          />
        )}
        {view === "columns" && (
          <AdColumnPage
            tags={columnTags}
            selectedArticleId={selectedArticleId}
            bookmarkedArticleIds={bookmarkedArticleIds}
            onToggleBookmark={toggleArticleBookmark}
            onSelectArticle={setSelectedArticleId}
          />
        )}
        {view === "connections" && (
          <ConnectionsPage
            session={session}
            workspace={workspaceSession}
            usingDemoData={isMockDataExperience(usingDemoData, readiness)}
            onOpenAi={() => setAiOpen(true)}
          />
        )}
      </main>

      <button type="button" className="ai-launcher" onClick={() => setAiOpen(true)}>
        AI分析を開く
      </button>

      {aiOpen && (
        <AiSidebar
          input={input}
          setInput={setInput}
          threadId={threadId}
          threads={threads}
            threadLoading={threadLoading}
            messages={messages}
            todos={threadTodos[threadId] ?? []}
            thinkingStatus={thinkingStatus}
            loading={loading}
          error={error}
          onThreadChange={setThreadId}
          onNewThread={startNewThread}
          onCreateTodos={(message) => {
            const items = extractTodosFromMessage(message.content);
            if (items.length === 0) return;
            setThreadTodos((prev) => ({
              ...prev,
              [threadId]: items.map((text, index) => ({
                id: `${message.id ?? "message"}-${index}`,
                text,
                done: false,
              })),
            }));
          }}
          onToggleTodo={(todoId) => {
            setThreadTodos((prev) => ({
              ...prev,
              [threadId]: (prev[threadId] ?? []).map((todo) =>
                todo.id === todoId ? { ...todo, done: !todo.done } : todo,
              ),
            }));
          }}
          onSend={sendMessage}
          onClose={() => setAiOpen(false)}
        />
      )}
    </div>
  );
}

function Sidebar({
  active,
  workspace,
  onNavigate,
  onLogout,
}: {
  active: View;
  workspace: WorkspaceSession;
  onNavigate: (view: View) => void;
  onLogout: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand-card">
        <p>{workspace.workspaceName}</p>
        <strong>AdOps Advisor</strong>
        <span>{workspace.userEmail}</span>
      </div>
      <nav aria-label="メインナビゲーション" className="nav">
        {navItems.map((item) => (
          <button
            key={item.key}
            className={active === item.key ? "active" : ""}
            onClick={() => onNavigate(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <form className="logout-box">
        <button type="button" onClick={onLogout}>ログアウト</button>
      </form>
    </aside>
  );
}

function normalizeLoginId(value: string) {
  const trimmed = value.trim();
  if (trimmed === "dev") return "dev@fieldx.site";
  return trimmed;
}

function AuthShell({ title, message }: { title: string; message: string }) {
  return (
    <div className="auth-shell">
      <section className="auth-panel">
        <p className="eyebrow">Supabase Auth</p>
        <h1>{title}</h1>
        <p>{message}</p>
      </section>
    </div>
  );
}

function AuthPage({
  error,
  session,
  onMagicLink,
  onPasswordLogin,
  onPasswordSignup,
  onLogout,
}: {
  error: string;
  session: Session | null;
  onMagicLink: (email: string) => Promise<void>;
  onPasswordLogin: (email: string, password: string) => Promise<void>;
  onPasswordSignup: (email: string, password: string) => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showMagicLink, setShowMagicLink] = useState(false);

  return (
    <div className="auth-shell">
      <section className="auth-panel">
        <p className="eyebrow">AdOps Advisor</p>
        <h1>ログイン</h1>
        <p>社内テスト用IDで入れます。ID: dev / PASS: dev1234</p>
        {!session ? (
          <div>
            <form
              className="auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                void onPasswordLogin(normalizeLoginId(email), password);
              }}
            >
              <label>
                メールアドレス または ID
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="text" autoComplete="username" required />
              </label>
              <label>
                パスワード
                <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" minLength={6} required />
              </label>
              <div className="auth-actions">
                <button type="submit">ログイン</button>
                <button type="button" className="secondary-button" onClick={() => void onPasswordSignup(normalizeLoginId(email), password)}>
                  アカウント作成
                </button>
              </div>
            </form>
            <button type="button" className="text-button auth-help" onClick={() => setShowMagicLink((current) => !current)}>
              メールリンクでログインする
            </button>
            {showMagicLink && (
              <div className="magic-link-box">
                <p>メール送信制限に当たる場合があります。通常は上のパスワードログインを使ってください。</p>
                <button type="button" className="secondary-button" onClick={() => void onMagicLink(normalizeLoginId(email))}>
                  Magic Linkを送る
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="auth-form">
            <p>ログイン済みです。workspaceを初期化しています。</p>
            <button type="button" onClick={() => void onLogout()}>ログアウト</button>
          </div>
        )}
        {error && <p className="form-message">{error}</p>}
      </section>
    </div>
  );
}

function OnboardingPanel({
  data,
  usingDemoData,
  readiness,
  onOpenAi,
  onOpenConnections,
}: {
  data: DashboardResponse | null;
  usingDemoData: boolean;
  readiness: ReadinessResponse | null;
  onOpenAi: () => void;
  onOpenConnections: () => void;
}) {
  const connected = usingDemoData ? 0 : data?.adAccounts.filter((account) => account.status === "connected").length ?? 0;
  const total = data?.adAccounts.length ?? 3;
  const mockScope = readiness?.scopes?.mock;
  const productionScope = readiness?.scopes?.production;
  const steps = [
    { label: "広告アカウントをread-only連携", done: connected > 0 },
    { label: "KPIと異常を確認", done: Boolean(data) },
    { label: "AIに原因と作業手順を相談", done: false },
  ];

  return (
    <section className="card onboarding-panel" aria-label="初回セットアップ">
      <div>
        <p className="eyebrow">オンボーディング</p>
        <h2>まずは連携状態を確認し、AIに次の一手を相談できます。</h2>
        <p>
          {usingDemoData
            ? "API未接続でもユーザーテストできるよう、デモデータで一連の画面を表示しています。"
            : `${connected}/${total}件の広告アカウントを読み込みました。`}
        </p>
      </div>
      <ol className="setup-list">
        {steps.map((step) => (
          <li key={step.label} className={step.done ? "done" : ""}>
            <span aria-hidden="true">{step.done ? "✓" : "•"}</span>
            {step.label}
          </li>
        ))}
      </ol>
      <div className="onboarding-actions">
        <button type="button" onClick={onOpenConnections}>連携状態を見る</button>
        <button type="button" className="secondary-button" onClick={onOpenAi}>AIに相談する</button>
      </div>
      {readiness && (
        <div className="readiness-summary">
          <ReadinessScopeCard scope={mockScope ?? createLegacyMockScope(readiness)} tone="go" />
          <ReadinessScopeCard scope={productionScope ?? createLegacyProductionScope(readiness)} tone="blocked" />
        </div>
      )}
    </section>
  );
}

function ReadinessScopeCard({ scope, tone }: { scope: ReadinessScope; tone: "go" | "blocked" }) {
  const passed = scope.checks.filter((check) => check.status === "pass").length;
  const remaining = scope.checks.filter((check) => check.status !== "pass");

  return (
    <article className={`readiness-scope ${tone}`}>
      <div>
        <p className="eyebrow">{scope.label}</p>
        <strong>{scope.decision}</strong>
        <span>{passed}/{scope.checks.length} checks OK - {scope.note}</span>
      </div>
      <ul>
        {(remaining.length ? remaining : scope.checks.slice(0, 2)).slice(0, 3).map((check) => (
          <li key={check.id}>
            <span>{check.status === "pass" ? "OK" : check.status === "risk" ? "要確認" : "未完了"}</span>
            {check.label}
          </li>
        ))}
      </ul>
    </article>
  );
}

function DashboardPage({
  data,
  loading,
  error,
  range,
  platform,
  latestRecommendation,
  usingDemoData,
  readiness,
  onRangeChange,
  onPlatformChange,
  onOpenAi,
  onOpenConnections,
  onOpenColumns,
}: {
  data: DashboardResponse | null;
  loading: boolean;
  error: string;
  range: number;
  platform: PlatformFilter;
  latestRecommendation: ChatResponse["recommendation"] | null;
  usingDemoData: boolean;
  readiness: ReadinessResponse | null;
  onRangeChange: (range: number) => void;
  onPlatformChange: (platform: PlatformFilter) => void;
  onOpenAi: () => void;
  onOpenConnections: () => void;
  onOpenColumns: (tags: string[]) => void;
}) {
  return (
    <div>
      <PageHeader title="ダッシュボード" description="APIが持つ最新広告データからKPI、異常、優先対応キャンペーンを表示します。">
        <FilterControls range={range} platform={platform} onRangeChange={onRangeChange} onPlatformChange={onPlatformChange} />
      </PageHeader>
      {usingDemoData && <MockDataBanner location="Dashboard" />}
      <OnboardingPanel
        data={data}
        usingDemoData={usingDemoData}
        readiness={readiness}
        onOpenAi={onOpenAi}
        onOpenConnections={onOpenConnections}
      />
      <StatusLine loading={loading} error={error} />
      {data ? (
        <>
          <KpiCards summary={data.summary} changes={data.changes} />

          <section className="dashboard-grid">
            <article className="card chart-card trend-card">
              <h2>費用と売上トレンド</h2>
              <ResponsiveContainer width="100%" height={288}>
                <LineChart data={data.series} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={72} tickFormatter={(value) => `¥${Math.round(Number(value) / 1000)}k`} />
                  <Tooltip formatter={(value, name) => [name === "conversions" ? numericValue(value) : formatMoney(numericValue(value)), name]} />
                  <Legend />
                  <Line type="monotone" dataKey="cost" stroke="#0b5fff" strokeWidth={2} name="費用" dot={false} />
                  <Line type="monotone" dataKey="revenue" stroke="#0f9d58" strokeWidth={2} name="売上" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </article>

            <article className="card chart-card severity-card">
              <h2>異常重要度サマリー</h2>
              <ResponsiveContainer width="100%" height={288}>
                <BarChart data={severityChartData(data)} margin={{ top: 12, right: 10, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="severity" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                    {severityChartData(data).map((entry) => (
                      <Cell key={entry.severity} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </article>
          </section>

          <section className="lower-grid">
            <article className="card campaign-card">
              <h2>上位キャンペーン（費用順）</h2>
              <CampaignTable rows={data.campaigns} compact={false} />
            </article>
            <article className="card help-card">
              <h2>{latestRecommendation ? "最近のAI提案" : "AI推奨アクション"}</h2>
              {latestRecommendation ? (
                <>
                  <p>{latestRecommendation.title}</p>
                  <p>confidence: {latestRecommendation.confidence}</p>
                </>
              ) : (
                <p>検知タグ: {data.relatedTags.join(", ") || "monitoring"}</p>
              )}
              <div className="help-actions">
                <button type="button" onClick={onOpenAi}>
                  AIに原因を聞く
                </button>
                <button type="button" className="secondary-button" onClick={() => onOpenColumns(data.relatedTags)}>
                  関連コラムを見る
                </button>
              </div>
            </article>
          </section>
          <AnomalyTable anomalies={data.anomalies} />
        </>
      ) : (
        !loading && <EmptyState message="表示できる広告データがありません。" />
      )}
    </div>
  );
}

function BiPage({
  data,
  loading,
  error,
  range,
  platform,
  usingDemoData,
  onRangeChange,
  onPlatformChange,
}: {
  data: DashboardResponse | null;
  loading: boolean;
  error: string;
  range: number;
  platform: PlatformFilter;
  usingDemoData: boolean;
  onRangeChange: (range: number) => void;
  onPlatformChange: (platform: PlatformFilter) => void;
}) {
  const [rankingMetric, setRankingMetric] = useState<"revenue" | "cost" | "roas">("revenue");
  const ranking = useMemo(
    () => [...(data?.campaigns ?? [])].sort((a, b) => numericValue(b[rankingMetric]) - numericValue(a[rankingMetric])),
    [data, rankingMetric],
  );
  const compositionData = useMemo(
    () =>
      (data?.campaigns ?? []).map((item) => ({
        platform: `${item.platform} / ${item.campaign}`,
        cost: item.cost,
        fill: platformColor(item.platform),
      })),
    [data],
  );

  return (
    <div>
      <PageHeader title="BI分析" description="時系列、構成比、キャンペーン比較をAPIデータから分析します。">
        <FilterControls range={range} platform={platform} onRangeChange={onRangeChange} onPlatformChange={onPlatformChange} />
      </PageHeader>
      {usingDemoData && <MockDataBanner location="BI分析" />}
      <StatusLine loading={loading} error={error} />
      {data ? (
        <>
          <section className="bi-summary">
            <SimpleMetric label="費用" value={formatMoney(data.summary.cost)} />
            <SimpleMetric label="売上" value={formatMoney(data.summary.revenue)} />
            <SimpleMetric label="ROAS" value={formatPercent(data.summary.roas)} />
            <SimpleMetric label="CPA" value={formatMoney(data.summary.cpa)} />
          </section>
          <section className="bi-grid">
            <article className="card chart-card">
              <h2>時系列（費用 / 売上 / CV）</h2>
              <ResponsiveContainer width="100%" height={288}>
                <LineChart data={data.series} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis yAxisId="money" tickLine={false} axisLine={false} width={72} tickFormatter={(value) => `¥${Math.round(Number(value) / 1000)}k`} />
                  <YAxis yAxisId="cv" orientation="right" allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="money" type="monotone" dataKey="cost" stroke="#0b5fff" strokeWidth={2} name="費用" dot={false} />
                  <Line yAxisId="money" type="monotone" dataKey="revenue" stroke="#0f9d58" strokeWidth={2} name="売上" dot={false} />
                  <Line yAxisId="cv" type="monotone" dataKey="conversions" stroke="#d97706" strokeWidth={2} name="CV" />
                </LineChart>
              </ResponsiveContainer>
            </article>
            <article className="card chart-card">
              <h2>構成比（キャンペーン別費用）</h2>
              <ResponsiveContainer width="100%" height={288}>
                <PieChart>
                  <Pie data={compositionData} dataKey="cost" nameKey="platform" outerRadius={92}>
                    {compositionData.map((entry) => (
                      <Cell key={entry.platform} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatMoney(numericValue(value))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </article>
          </section>
          <section className="card ranking-card">
            <div className="section-header">
              <h2>キャンペーンランキング</h2>
              <select value={rankingMetric} onChange={(event) => setRankingMetric(event.target.value as typeof rankingMetric)}>
                <option value="revenue">売上</option>
                <option value="cost">費用</option>
                <option value="roas">ROAS</option>
              </select>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={ranking} layout="vertical" margin={{ top: 8, right: 16, left: 24, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="campaign" tickLine={false} axisLine={false} width={132} />
                <Tooltip formatter={(value) => (rankingMetric === "roas" ? formatPercent(numericValue(value)) : formatMoney(numericValue(value)))} />
                <Bar dataKey={rankingMetric} fill="#0b5fff" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <CampaignTable rows={ranking} compact />
          </section>
        </>
      ) : (
        !loading && <EmptyState message="表示できるBIデータがありません。" />
      )}
    </div>
  );
}

function AdColumnPage({
  tags,
  selectedArticleId,
  bookmarkedArticleIds,
  onToggleBookmark,
  onSelectArticle,
}: {
  tags: string[];
  selectedArticleId: string | null;
  bookmarkedArticleIds: string[];
  onToggleBookmark: (articleId: string) => void;
  onSelectArticle: (id: string | null) => void;
}) {
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [detail, setDetail] = useState<ColumnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function isBookmarked(articleId: string) {
    return bookmarkedArticleIds.includes(articleId);
  }

  function toggleBookmark(articleId: string) {
    onToggleBookmark(articleId);
  }

  useEffect(() => {
    if (selectedArticleId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = tags.length ? `?tags=${encodeURIComponent(tags.join(","))}` : "";
    fetch(`${apiBaseUrl}/columns${query}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Adコラムの取得に失敗しました。");
        setArticles(data.articles as HelpArticle[]);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setArticles(filterDemoArticles(tags));
        setError(caught instanceof Error ? `デモ記事を表示中: ${caught.message}` : "デモ記事を表示中です。");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [tags, selectedArticleId]);

  useEffect(() => {
    if (!selectedArticleId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`${apiBaseUrl}/columns/${selectedArticleId}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "記事の取得に失敗しました。");
        setDetail(data as ColumnDetail);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        const article = demoArticles.find((item) => item.id === selectedArticleId);
        if (article) {
          setDetail({
            article,
            related: demoArticles.filter((item) => item.id !== selectedArticleId).slice(0, 2),
          });
        }
        setError(caught instanceof Error ? `デモ記事を表示中: ${caught.message}` : "デモ記事を表示中です。");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [selectedArticleId]);

  if (selectedArticleId) {
    return (
      <div>
        <button type="button" className="back-button" onClick={() => onSelectArticle(null)}>
          Adコラム一覧へ戻る
        </button>
        <StatusLine loading={loading} error={error} />
        {detail && (
          <>
            <article className="card article-detail">
              <div className="article-detail-header">
                <p className="muted">{detail.article.difficulty}</p>
                <BookmarkButton
                  bookmarked={isBookmarked(detail.article.id)}
                  onToggle={() => toggleBookmark(detail.article.id)}
                />
              </div>
              <h1>{detail.article.title}</h1>
              <p>{detail.article.body}</p>
              <TagList tags={detail.article.tags} />
            </article>
            {detail.related.length > 0 && (
              <section className="related-section">
                <h2>関連記事</h2>
                <div className="related-grid">
                  {detail.related.map((article) => (
                    <article className="card related-card" key={article.id}>
                      <button
                        type="button"
                        className="related-card-link"
                        onClick={() => onSelectArticle(article.id)}
                      >
                        <strong>{article.title}</strong>
                        <span>{article.tags.join(", ")}</span>
                      </button>
                      <BookmarkButton
                        bookmarked={isBookmarked(article.id)}
                        onToggle={() => toggleBookmark(article.id)}
                        compact
                      />
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Adコラム"
        description="異常タイプ別にすぐ読める運用ナレッジ記事です。AI提案からもここに遷移します。"
      >
        <div className="bookmark-summary">
          <span>{bookmarkedArticleIds.length}</span>
          ブックマーク
        </div>
      </PageHeader>
      {tags.length > 0 && <p className="muted column-filter">絞り込みタグ: {tags.join(", ")}</p>}
      <StatusLine loading={loading} error={error} />
      {articles.length > 0 ? (
        <section className="column-grid">
          {articles.map((article) => (
            <article key={article.id} className="card article-card">
              <div className="article-card-header">
                <p className="muted">{article.difficulty}</p>
              </div>
              <h2>{article.title}</h2>
              <p>{article.body}</p>
              <TagList tags={article.tags} />
              <div className="article-actions">
                <button type="button" onClick={() => onSelectArticle(article.id)}>
                  記事を読む
                </button>
                <BookmarkButton
                  bookmarked={isBookmarked(article.id)}
                  onToggle={() => toggleBookmark(article.id)}
                />
              </div>
            </article>
          ))}
        </section>
      ) : (
        !loading && <EmptyState message="該当するAdコラムがありません。" />
      )}
    </div>
  );
}

function BookmarkButton({
  bookmarked,
  compact = false,
  onToggle,
}: {
  bookmarked: boolean;
  compact?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`bookmark-button${bookmarked ? " active" : ""}${compact ? " compact" : ""}`}
      onClick={onToggle}
      aria-pressed={bookmarked}
      aria-label={bookmarked ? "ブックマークを解除" : "ブックマークに追加"}
      title={bookmarked ? "ブックマークを解除" : "ブックマークに追加"}
    >
      <span aria-hidden="true">{bookmarked ? "★" : "☆"}</span>
      {!compact && <strong>{bookmarked ? "保存済み" : "保存"}</strong>}
    </button>
  );
}

function ConnectionsPage({
  session,
  workspace,
  usingDemoData,
  onOpenAi,
}: {
  session: Session;
  workspace: WorkspaceSession;
  usingDemoData: boolean;
  onOpenAi: () => void;
}) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatusResponse | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [connectionNotice, setConnectionNotice] = useState("");
  const [customers, setCustomers] = useState<Array<{ resourceName: string; customerId: string }>>([]);
  const plannedConnections: Array<{
    platform: Exclude<PlatformFilter, "all">;
    label: string;
    accountHint: string;
  }> = [
    { platform: "google", label: "Google Ads", accountHint: "Google Ads API read-only OAuth" },
    { platform: "meta", label: "Meta Ads", accountHint: "Meta Marketing API read-only OAuth" },
    { platform: "yahoo", label: "Yahoo Ads", accountHint: "Yahoo広告 API read-only OAuth" },
  ];
  const policyNote =
    connectionStatus?.policy.note ??
    "MVPでは広告媒体APIへの変更操作は行わず、人間が管理画面で実行する手順だけを返します。";

  useEffect(() => {
    const controller = new AbortController();
    setConnectionLoading(true);
    setConnectionNotice("");
    fetch(`${apiBaseUrl}/connections/status?workspaceId=${workspace.workspaceId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "連携予定の取得に失敗しました。");
        setConnectionStatus(data as ConnectionStatusResponse);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setConnectionStatus(null);
        setConnectionNotice(caught instanceof Error ? `mock予定表示に切り替えています: ${caught.message}` : "mock予定表示に切り替えています。");
      })
      .finally(() => setConnectionLoading(false));
    return () => controller.abort();
  }, [session.access_token, workspace.workspaceId]);

  const googleStatus = connectionStatus?.connections?.find((connection) => connection.platform === "google")?.status ?? "pending";

  async function openGoogleOAuth() {
    const res = await fetch(`${apiBaseUrl}/oauth/google/start-url`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      setConnectionNotice(data?.error ?? "Google OAuth開始URLを取得できませんでした。");
      return;
    }
    window.location.href = data.url;
  }

  async function loadGoogleCustomers() {
    setConnectionNotice("");
    const res = await fetch(`${apiBaseUrl}/google-ads/customers?workspaceId=${workspace.workspaceId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      setConnectionNotice(data?.error ?? "Google Ads account listの取得に失敗しました。");
      return;
    }
    setCustomers(data.customers ?? []);
  }

  return (
    <div>
      <PageHeader title="データ連携" description="APIキーを取得せず、広告管理画面へのログイン許可だけで連携します。" />
      {usingDemoData && <MockDataBanner location="データ連携" />}
      <StatusLine loading={connectionLoading} error="" />
      {connectionNotice && <p className="muted connection-fallback">{connectionNotice}</p>}
      <section className="card connection-intro">
        <div>
          <p className="eyebrow">OAuth read-only</p>
          <h2>ユーザーにAPIキー取得やsecret入力をお願いしません。</h2>
          <p>
            「連携する」を押すと各広告媒体の認可画面へ移動し、ユーザーはログインして読み取り権限を許可するだけです。
            トークンはサーバー側で暗号化保存し、ブラウザやAIへの文脈には含めません。
          </p>
          <p className="connection-policy">{policyNote}</p>
        </div>
        <button type="button" onClick={onOpenAi}>mockデータでAI相談</button>
      </section>
      {customers.length > 0 && (
        <section className="card account-picker">
          <h2>取得できたGoogle Adsアカウント</h2>
          <ul>
            {customers.map((customer) => (
              <li key={customer.resourceName}>
                <strong>{customer.customerId}</strong>
                <span>{customer.resourceName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="oauth-flow">
        {["ログイン", "読み取りを許可", "分析に利用"].map((step, index) => (
          <div className="oauth-step" key={step}>
            <span>{index + 1}</span>
            <strong>{step}</strong>
          </div>
        ))}
      </section>
      <section className="connection-grid">
        {plannedConnections.map((connection) => {
          const connector = findPlannedConnector(connectionStatus, connection.platform);
          return (
            <article className="card connection-card" key={connection.platform}>
              <div className="connection-card-header">
                <p className="badge">APIキー不要</p>
                <p className="connection-status">{connection.platform === "google" ? statusLabel(googleStatus) : "未接続"}</p>
              </div>
              <h2>{connection.label}</h2>
              <p className="muted">{connection.accountHint} を予定しています。現時点では社内テスト用のmockデータで画面とAI相談を確認します。</p>
              <ul className="connection-notes">
                <li>read-only OAuth予定</li>
                <li>媒体write / 自動変更なし</li>
                <li>secretやtokenはブラウザに表示しない</li>
              </ul>
              {connector?.oauthPath && (
                <p className="connection-route">
                  予定導線: <code>{connector.oauthPath}</code>
                </p>
              )}
              {connection.platform === "google" ? (
                <div className="connection-actions">
                  <button type="button" onClick={() => void openGoogleOAuth()}>
                    Google Ads と連携
                  </button>
                  <button type="button" className="secondary-button" disabled={googleStatus !== "connected"} onClick={() => void loadGoogleCustomers()}>
                    アカウント一覧を取得
                  </button>
                </div>
              ) : (
                <button type="button" disabled>{connection.label} OAuth準備中</button>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    connected: "接続済み",
    pending: "未接続",
    expired: "期限切れ",
    error: "エラー",
    revoked: "解除済み",
  };
  return labels[status] ?? "未接続";
}

function findPlannedConnector(
  status: ConnectionStatusResponse | null,
  platform: Exclude<PlatformFilter, "all">,
) {
  return status?.nextConnectors.find((connector) => connector.platform === platform);
}

function MockDataBanner({ location }: { location: string }) {
  return (
    <p className="demo-banner">
      {location} は社内ユーザーテスト用のmock広告データを表示しています。Google / Meta / Yahoo の実広告アカウントは未接続です。
    </p>
  );
}

function AiSidebar(props: {
  input: string;
  setInput: (value: string) => void;
  threadId: string;
  threads: ChatThreadSummary[];
  threadLoading: boolean;
  messages: ChatMessage[];
  todos: TodoItem[];
  thinkingStatus: string;
  loading: boolean;
  error: string;
  onThreadChange: (threadId: string) => void;
  onNewThread: () => void;
  onCreateTodos: (message: ChatMessage) => void;
  onToggleTodo: (todoId: string) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="ai-sidebar">
      <header>
        <div>
          <h2>AIサイドバー</h2>
          <p>相談セッション</p>
        </div>
        <button type="button" onClick={props.onClose}>閉じる</button>
      </header>
      <div className="thread-toolbar">
        <select
          aria-label="会話セッション"
          value={props.threadId}
          onChange={(event) => props.onThreadChange(event.target.value)}
          disabled={props.threadLoading || props.loading}
        >
          {props.threads.map((thread) => (
            <option key={thread.id} value={thread.id}>
              {thread.title} ({thread.messageCount})
            </option>
          ))}
          {!props.threads.some((thread) => thread.id === props.threadId) && (
            <option value={props.threadId}>新しい相談</option>
          )}
        </select>
        <button type="button" onClick={props.onNewThread} disabled={props.loading}>
          新規
        </button>
      </div>
      <ChatConversation {...props} />
    </aside>
  );
}

function ChatConversation({
  input,
  setInput,
  messages,
  todos,
  thinkingStatus,
  loading,
  error,
  onCreateTodos,
  onToggleTodo,
  onSend,
}: {
  input: string;
  setInput: (value: string) => void;
  messages: ChatMessage[];
  todos: TodoItem[];
  thinkingStatus: string;
  loading: boolean;
  error: string;
  onCreateTodos: (message: ChatMessage) => void;
  onToggleTodo: (todoId: string) => void;
  onSend: () => void;
}) {
  return (
    <div className="chat-conversation">
      <div className="messages" aria-live="polite">
        {messages.map((message, index) => (
          <article key={message.id ?? `${message.role}-${index}`} className={`message ${message.role}`}>
            <MarkdownContent content={message.content} />
            {message.role === "assistant" && extractTodosFromMessage(message.content).length > 0 && (
              <button type="button" className="todo-create-button" onClick={() => onCreateTodos(message)}>
                ToDoを生成
              </button>
            )}
          </article>
        ))}
        {todos.length > 0 && <TodoList items={todos} onToggle={onToggleTodo} />}
        {loading && (
          <ThinkingMessage text={thinkingStatus} />
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="composer">
        <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="質問を入力" rows={2} />
        <button type="button" onClick={onSend} disabled={loading}>{loading ? "送信中" : "送信"}</button>
      </div>
    </div>
  );
}

function TodoList({ items, onToggle }: { items: TodoItem[]; onToggle: (todoId: string) => void }) {
  return (
    <section className="todo-panel" aria-label="この会話のToDo">
      <div className="todo-panel-header">
        <h3>この会話のToDo</h3>
        <span>{items.filter((item) => item.done).length}/{items.length}</span>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={item.done ? "done" : ""}
              onClick={() => onToggle(item.id)}
              aria-pressed={item.done}
            >
              <span aria-hidden="true">{item.done ? "✓" : ""}</span>
              <strong>{item.text}</strong>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ThinkingMessage({ text }: { text: string }) {
  return (
    <article className="message assistant thinking-message">
      <span className="loading-circle" aria-hidden="true" />
      <span>{text}</span>
    </article>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const elements: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let orderedItems: string[] = [];
  let unorderedItems: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    elements.push(
      <p key={`p-${elements.length}`}>
        {paragraph.map((line, index) => (
          <span key={`${line}-${index}`}>
            {renderInlineMarkdown(line)}
            {index < paragraph.length - 1 && <br />}
          </span>
        ))}
      </p>,
    );
    paragraph = [];
  }

  function flushOrderedList() {
    if (orderedItems.length === 0) return;
    elements.push(
      <ol key={`ol-${elements.length}`}>
        {orderedItems.map((item, index) => (
          <li key={`${item}-${index}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </ol>,
    );
    orderedItems = [];
  }

  function flushUnorderedList() {
    if (unorderedItems.length === 0) return;
    elements.push(
      <ul key={`ul-${elements.length}`}>
        {unorderedItems.map((item, index) => (
          <li key={`${item}-${index}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>,
    );
    unorderedItems = [];
  }

  function flushLists() {
    flushOrderedList();
    flushUnorderedList();
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushLists();
      continue;
    }

    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    const sectionMatch = line.match(/^(結論|根拠|原因仮説|推奨アクション|人間向け作業手順|実施前チェック|リスク|実施後の観察|自信度):\s*(.*)$/);
    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    const unorderedMatch = line.match(/^[-*]\s+(.+)$/);

    if (headingMatch) {
      flushParagraph();
      flushLists();
      elements.push(<h3 key={`h-${elements.length}`}>{renderInlineMarkdown(headingMatch[1])}</h3>);
      continue;
    }

    if (sectionMatch) {
      flushParagraph();
      flushLists();
      elements.push(<h3 key={`h-${elements.length}`}>{sectionMatch[1]}</h3>);
      if (sectionMatch[2]) paragraph.push(sectionMatch[2]);
      continue;
    }

    if (orderedMatch) {
      flushParagraph();
      flushUnorderedList();
      orderedItems.push(orderedMatch[1]);
      continue;
    }

    if (unorderedMatch) {
      flushParagraph();
      flushOrderedList();
      unorderedItems.push(unorderedMatch[1]);
      continue;
    }

    flushLists();
    paragraph.push(line);
  }

  flushParagraph();
  flushLists();

  return (
    <div className="markdown-content">
      {elements}
    </div>
  );
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch && /^https?:\/\//.test(linkMatch[2])) {
      return (
        <a key={index} href={linkMatch[2]} target="_blank" rel="noreferrer">
          {linkMatch[1]}
        </a>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function extractTodosFromMessage(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const todos: string[] = [];
  let inHumanSteps = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^(人間向け作業手順|ユーザー側の作業|担当者の作業|実行タスク|ToDo|TODO|todo):/.test(line)) {
      inHumanSteps = true;
      const inlineTask = line.split(":").slice(1).join(":").trim();
      if (inlineTask) todos.push(inlineTask);
      continue;
    }

    if (inHumanSteps && /^(実施前チェック|リスク|実施後の観察|自信度|根拠|原因仮説|推奨アクション):/.test(line)) {
      break;
    }

    if (inHumanSteps) {
      const item = line.match(/^(?:\d+\.\s+|[-*]\s+)(.+)$/);
      if (item) todos.push(item[1]);
    }
  }

  return uniqueTodos(todos);
}

function uniqueTodos(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

async function readChatStream(response: Response, onStatus: (status: string) => void) {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let buffer = "";
  let finalChat: ChatResponse | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as
        | { type: "status"; text: string }
        | { type: "done"; payload: ChatResponse }
        | { type: "error"; payload: { error?: string; detail?: string } };

      if (event.type === "status") {
        onStatus(event.text);
      }
      if (event.type === "done") {
        finalChat = event.payload;
      }
      if (event.type === "error") {
        throw new Error(event.payload.error ?? event.payload.detail ?? "AI応答の取得に失敗しました。");
      }
    }
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer) as { type: "done"; payload: ChatResponse };
    if (event.type === "done") finalChat = event.payload;
  }

  return finalChat;
}

function PageHeader({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1><p>{description}</p></div>{children}</header>;
}

function FilterControls({
  range,
  platform,
  onRangeChange,
  onPlatformChange,
}: {
  range: number;
  platform: PlatformFilter;
  onRangeChange: (range: number) => void;
  onPlatformChange: (platform: PlatformFilter) => void;
}) {
  return (
    <div className="filters">
      <select aria-label="期間" value={range} onChange={(event) => onRangeChange(Number(event.target.value))}>
        <option value="7">7日</option>
        <option value="14">14日</option>
        <option value="30">30日</option>
      </select>
      <select aria-label="媒体" value={platform} onChange={(event) => onPlatformChange(event.target.value as PlatformFilter)}>
        <option value="all">全媒体</option>
        <option value="google">Google</option>
        <option value="meta">Meta</option>
        <option value="yahoo">Yahoo</option>
      </select>
    </div>
  );
}

function KpiCards({ summary, changes }: { summary: MetricTotals; changes: DashboardResponse["changes"] }) {
  const cards = [
    { label: "CTR", value: formatPercent(summary.ctr, 2), change: changes.ctr },
    { label: "CVR", value: formatPercent(summary.cvr, 2), change: changes.cvr },
    { label: "CPA", value: formatMoney(summary.cpa), change: changes.cpa },
    { label: "ROAS", value: formatPercent(summary.roas), change: changes.roas },
    { label: "費用", value: formatMoney(summary.cost), change: changes.cost },
    { label: "CV", value: summary.conversions.toLocaleString("ja-JP"), change: changes.conversions },
  ];
  return (
    <section aria-label="KPIサマリー" className="kpi-grid">
      {cards.map((card) => (
        <article key={card.label} className="card kpi-card">
          <p>{card.label}</p>
          <strong>{card.value}</strong>
          <span className={changeClass(card.change)}>{formatChange(card.change)}</span>
        </article>
      ))}
    </section>
  );
}

function SimpleMetric({ label, value }: { label: string; value: string }) {
  return <article className="card simple-metric"><p>{label}</p><strong>{value}</strong></article>;
}

function CampaignTable({ rows, compact }: { rows: Campaign[]; compact: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>キャンペーン</th><th>媒体</th><th>費用</th>{!compact && <th>売上</th>}<th>CPA</th><th>ROAS</th>{compact && <th>CTR</th>}{compact && <th>CVR</th>}</tr></thead>
        <tbody>{rows.map((item) => <tr key={item.campaignId}><td>{item.campaign}</td><td>{item.platform}</td><td>{formatMoney(item.cost)}</td>{!compact && <td>{formatMoney(item.revenue)}</td>}<td>{formatMoney(item.cpa)}</td><td>{formatPercent(item.roas)}</td>{compact && <td>{formatPercent(item.ctr, 2)}</td>}{compact && <td>{formatPercent(item.cvr, 2)}</td>}</tr>)}</tbody>
      </table>
    </div>
  );
}

function AnomalyTable({ anomalies }: { anomalies: DashboardResponse["anomalies"] }) {
  return (
    <section className="card anomaly-card">
      <h2>異常一覧</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>日付</th><th>媒体</th><th>種別</th><th>重要度</th><th>詳細</th></tr></thead>
          <tbody>{anomalies.map((item) => <tr key={`${item.date}-${item.type}-${item.detail}`}><td>{item.date}</td><td>{item.platform}</td><td>{item.type}</td><td>{item.severity}</td><td>{item.detail}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function TagList({ tags }: { tags: string[] }) {
  return (
    <div className="tag-list">
      {tags.map((tag) => (
        <span className="tag" key={tag}>
          {tag}
        </span>
      ))}
    </div>
  );
}

function StatusLine({ loading, error }: { loading: boolean; error: string }) {
  if (loading) return <p className="status-line">読み込み中...</p>;
  if (error) return <p className="error status-line">{error}</p>;
  return null;
}

function EmptyState({ message }: { message: string }) {
  return <div className="card empty-state">{message}</div>;
}

function filterDemoDashboardData(range: number, platform: PlatformFilter): DashboardResponse {
  const campaigns = demoDashboardData.campaigns.filter((campaign) => platform === "all" || campaign.platform === platform);
  const anomalies = demoDashboardData.anomalies.filter((anomaly) => platform === "all" || anomaly.platform === platform);
  const visibleAnomalies = anomalies.length > 0 ? anomalies : demoDashboardData.anomalies.slice(0, 1);
  const summary = calculateTotals(campaigns);

  return {
    ...demoDashboardData,
    range,
    platform,
    campaigns,
    anomalies: visibleAnomalies,
    summary,
    changes: calculateChanges(summary, demoDashboardData.comparison),
    severityCounts: countSeverity(visibleAnomalies),
    relatedTags: Array.from(new Set(visibleAnomalies.flatMap((item) => item.tags))).slice(0, 4),
    adAccounts:
      platform === "all"
        ? demoDashboardData.adAccounts
        : demoDashboardData.adAccounts.filter((account) => account.platform === platform),
  };
}

function filterDemoArticles(tags: string[]) {
  if (tags.length === 0) return demoArticles;
  const normalizedTags = tags.map((tag) => tag.toLowerCase());
  return demoArticles.filter((article) => article.tags.some((tag) => normalizedTags.includes(tag.toLowerCase())));
}

function createDemoReadiness(): ReadinessResponse {
  return {
    mode: "mock",
    status: "ready_with_mock_data",
    scopes: {
      mock: {
        label: "mock test",
        decision: "Go",
        note: "credentialなしで社内体験検証できます。",
        checks: [
          {
            id: "local-services",
            label: "Web / API / ADK agentをローカル起動できる",
            status: "pass",
            evidence: ["npm run dev"],
          },
          {
            id: "mock-data",
            label: "実広告credentialなしでKPI、異常、AI回答を確認できる",
            status: "pass",
            evidence: ["dashboard fallback", "demo AI response"],
          },
          {
            id: "human-in-loop",
            label: "媒体writeを行わず、人間向け作業手順として提案する",
            status: "pass",
            evidence: ["mediaWriteEnabled=false"],
          },
        ],
        nextActions: ["社内テスト範囲をmockデータの体験検証に限定する。"],
      },
      production: {
        label: "production readiness",
        decision: "No-Go",
        note: "Supabase Auth、実OAuth、共有URLが未完了です。",
        checks: [
          {
            id: "auth-oauth",
            label: "Supabase Authと実OAuth callbackのE2E",
            status: "todo",
            evidence: ["demo workspaceで代替"],
          },
          {
            id: "real-media-apis",
            label: "Google / Meta / Yahoo read-only APIの実接続",
            status: "todo",
            evidence: ["mock広告データで代替"],
          },
          {
            id: "deployment",
            label: "共有URL、テスト用env、ログ確認手順",
            status: "todo",
            evidence: ["ローカル実施なら不要"],
          },
        ],
        nextActions: ["実OAuth、認証、デプロイは次マイルストーンで扱う。"],
      },
    },
    goNoGo: {
      decision: "go_for_internal_mock_test",
      note: "API未起動時もデモデータで確認できます。実OAuthと認証は次フェーズです。",
    },
    checks: [
      {
        id: "local-services",
        label: "Web / API / ADK agentをローカル起動できる",
        status: "pass",
        evidence: ["npm run dev"],
      },
      {
        id: "mock-data",
        label: "実広告credentialなしでKPI、異常、AI回答を確認できる",
        status: "pass",
        evidence: ["dashboard fallback", "demo AI response"],
      },
      {
        id: "human-in-loop",
        label: "媒体writeを行わず、人間向け作業手順として提案する",
        status: "pass",
        evidence: ["mediaWriteEnabled=false"],
      },
      {
        id: "auth-oauth",
        label: "Supabase Authと実OAuth callbackのE2E",
        status: "todo",
        evidence: ["demo workspaceで代替"],
      },
      {
        id: "real-media-apis",
        label: "Google / Meta / Yahoo read-only APIの実接続",
        status: "todo",
        evidence: ["mock広告データで代替"],
      },
      {
        id: "deployment",
        label: "共有URL、テスト用env、ログ確認手順",
        status: "todo",
        evidence: ["ローカル実施なら不要"],
      },
    ],
    nextActions: [
      "社内テスト範囲をmockデータの体験検証に限定する。",
      "実OAuth、認証、デプロイは次マイルストーンで扱う。",
    ],
  };
}

function normalizeReadiness(readiness: ReadinessResponse): ReadinessResponse {
  if (readiness.scopes?.mock && readiness.scopes.production) return readiness;
  return {
    ...readiness,
    scopes: {
      mock: createLegacyMockScope(readiness),
      production: createLegacyProductionScope(readiness),
    },
  };
}

function createLegacyMockScope(readiness: ReadinessResponse): ReadinessScope {
  const mockChecks = readiness.checks.filter((check) =>
    ["local-services", "mock-data", "human-in-loop"].includes(check.id),
  );
  return {
    label: "mock test",
    decision: mockChecks.every((check) => check.status === "pass") ? "Go" : "要確認",
    note: readiness.goNoGo.note,
    checks: mockChecks.length ? mockChecks : readiness.checks,
    nextActions: readiness.nextActions,
  };
}

function createLegacyProductionScope(readiness: ReadinessResponse): ReadinessScope {
  const productionChecks = readiness.checks.filter((check) =>
    ["auth-oauth", "real-media-apis", "deployment"].includes(check.id),
  );
  return {
    label: "production readiness",
    decision: productionChecks.every((check) => check.status === "pass") ? "Go" : "No-Go",
    note: "実広告データで限定運用するには未完了項目があります。",
    checks: productionChecks.length ? productionChecks : readiness.checks.filter((check) => check.status !== "pass"),
    nextActions: readiness.nextActions,
  };
}

function isMockDataExperience(usingDemoData: boolean, readiness: ReadinessResponse | null) {
  if (usingDemoData) return true;
  if (!readiness) return false;
  const productionChecks = readiness.scopes?.production.checks ?? [];
  return readiness.status.includes("mock") || productionChecks.some((check) => check.status !== "pass");
}

function readColumnBookmarks() {
  if (typeof window === "undefined") return [];
  try {
    const stored =
      window.localStorage.getItem(columnBookmarkStorageKey) ??
      window.localStorage.getItem("adops-bookmarked-articles");
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeColumnBookmarks(ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(columnBookmarkStorageKey, JSON.stringify(ids));
}

function createDemoChatResponse(question: string, data: DashboardResponse | null): ChatResponse {
  const source = data ?? demoDashboardData;
  const highPriority =
    source.campaigns.find((campaign) => campaign.priority === "High") ?? source.campaigns[0] ?? demoDashboardData.campaigns[0];

  return {
    message: {
      role: "assistant",
      content: [
        `結論:\nAPIまたはADK Agent Serviceが未起動のため、ユーザーテスト用のデモ応答を表示しています。直近では「${highPriority.campaign}」のCPA悪化を最優先で確認してください。`,
        `根拠:\n- 対象期間: 直近${source.range}日\n- CPA: ${formatMoney(source.comparison.cpa)} → ${formatMoney(source.summary.cpa)}（${formatChange(source.changes.cpa)}）\n- CVR: ${formatPercent(source.comparison.cvr, 2)} → ${formatPercent(source.summary.cvr, 2)}（${formatChange(source.changes.cvr)}）\n- CPC: ${formatMoney(source.comparison.cpc)} → ${formatMoney(source.summary.cpc)}（${formatChange(source.changes.cpc)}）\n- 優先キャンペーン: ${highPriority.campaign} / CPA ${formatMoney(highPriority.cpa)} / ROAS ${formatPercent(highPriority.roas)}`,
        "原因仮説:\nCVR低下とCPC上昇が同時に起きているため、配信面、ターゲット、検索語句、クリエイティブ訴求、LPとの一致度が影響している可能性があります。",
        "推奨アクション:\n1. 対象キャンペーンの配信単位別CPA、CVR、CPCを比較する\n2. CVR低下が大きい広告とLPの訴求一致を確認する\n3. CPC上昇が大きい配信面や検索語句を洗い出す",
        "人間向け作業手順:\n1. 媒体管理画面で対象キャンペーンを開く\n2. 直近期間と比較期間を同じ粒度で並べる\n3. 変更候補を1つに絞り、担当者が実施可否を判断する",
        "実施前チェック:\nCV数が少なすぎる単位だけで判断していないか、LP障害や在庫など広告外要因がないか、CVタグやCV定義が変わっていないかを確認してください。",
        "リスク:\n配信対象を急に絞ると、CPAは改善してもCV総数が落ちる可能性があります。媒体APIで直接変更は行いません。",
        "実施後の観察:\n変更後24〜48時間はCPA、CV数、CVR、CPCを確認してください。",
        `自信度:\n${question.includes("CPA") ? "Medium" : "Low"}。これはデモデータに基づく回答で、実媒体データでは断定していません。`,
      ].join("\n\n"),
    },
    recommendation: {
      title: `${highPriority.campaign} のCPA悪化要因を分解する`,
      confidence: question.includes("CPA") ? "medium" : "low",
      operatorSteps: ["前期間比較を開く", "CPA悪化上位の配信単位を確認", "変更候補を実施前チェックに通す"],
    },
    humanTaskDraft: {
      title: `${highPriority.campaign} のCPA/CVR/CPCを確認`,
      priority: "high",
      status: "suggested",
    },
  };
}

function calculateTotals(campaigns: Campaign[]): MetricTotals {
  const totals = campaigns.reduce(
    (acc, item) => ({
      impressions: acc.impressions + item.impressions,
      clicks: acc.clicks + item.clicks,
      cost: acc.cost + item.cost,
      conversions: acc.conversions + item.conversions,
      revenue: acc.revenue + item.revenue,
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 },
  );

  return {
    ...totals,
    ctr: totals.impressions ? totals.clicks / totals.impressions : null,
    cvr: totals.clicks ? totals.conversions / totals.clicks : null,
    cpc: totals.clicks ? totals.cost / totals.clicks : null,
    cpa: totals.conversions ? totals.cost / totals.conversions : null,
    roas: totals.cost ? totals.revenue / totals.cost : null,
  };
}

function calculateChanges(current: MetricTotals, comparison: MetricTotals): DashboardResponse["changes"] {
  return {
    ctr: changeValue(current.ctr, comparison.ctr),
    cvr: changeValue(current.cvr, comparison.cvr),
    cpc: changeValue(current.cpc, comparison.cpc),
    cpa: changeValue(current.cpa, comparison.cpa),
    roas: changeValue(current.roas, comparison.roas),
    cost: changeValue(current.cost, comparison.cost),
    conversions: changeValue(current.conversions, comparison.conversions),
  };
}

function changeValue(current: number | null, comparison: number | null) {
  if (current === null || comparison === null || comparison === 0) return null;
  return current / comparison - 1;
}

function countSeverity(anomalies: DashboardResponse["anomalies"]) {
  return anomalies.reduce(
    (acc, item) => ({ ...acc, [item.severity]: acc[item.severity] + 1 }),
    { High: 0, Medium: 0, Low: 0 },
  );
}

function severityChartData(data: DashboardResponse) {
  return [
    { severity: "High", count: data.severityCounts.High, color: "#d93025" },
    { severity: "Medium", count: data.severityCounts.Medium, color: "#d97706" },
    { severity: "Low", count: data.severityCounts.Low, color: "#0f9d58" },
  ];
}

function formatMoney(value: number | null) {
  if (value === null) return "-";
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function formatPercent(value: number | null, digits = 1) {
  if (value === null) return "-";
  return `${(value * 100).toFixed(digits)}%`;
}

function formatChange(value: number | null) {
  if (value === null) return "-";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function changeClass(value: number | null) {
  if (value === null) return "kpi-change neutral";
  if (value > 0) return "kpi-change up";
  if (value < 0) return "kpi-change down";
  return "kpi-change neutral";
}

function numericValue(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function platformColor(platform: Exclude<PlatformFilter, "all">) {
  if (platform === "google") return "#d97706";
  if (platform === "meta") return "#0b5fff";
  return "#0f9d58";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
