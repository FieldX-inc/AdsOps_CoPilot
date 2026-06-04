import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
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

type View = "dashboard" | "setup" | "bi" | "columns" | "connections";
type IconName = "dashboard" | "setup" | "chart" | "book" | "plug" | "ai" | "lock" | "check" | "arrow";
type PlatformFilter = "all" | "google" | "meta" | "yahoo";
type Confidence = "high" | "medium" | "low";
type AdvisorMode = "beginner" | "experienced";
type AdvisorEntry = "setup_advisor_beginner" | "performance_analyst_experienced";

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

type StoredRecommendation = {
  id: string;
  title: string;
  confidence: Confidence;
  status: "draft" | "suggested" | "accepted" | "rejected" | "archived";
  operator_steps?: string[];
  created_at: string;
};

type StoredTask = {
  id: string;
  title: string;
  priority: "high" | "medium" | "low";
  status: "draft" | "suggested" | "accepted" | "doing" | "done" | "rejected" | "ignored";
  created_at: string;
};

type ReadinessResponse = {
  mode: "mock" | "agent-proxy";
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

type SetupWizardState = {
  goal: string;
  product: string;
  audience: string;
  budget: string;
  targetCpa: string;
  platforms: Array<Exclude<PlatformFilter, "all">>;
  measurement: string;
  planNotes: string;
};

type SetupIntakeMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

type SetupStep = {
  id: string;
  title: string;
  steps: string[];
};

type SetupIntakeSummary = {
  id: string;
  title: string;
  status: "in_progress" | "ready" | "archived";
  score: number;
  readyForSetupSteps: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SetupIntakeResponse = {
  intake: {
    id: string;
    title: string;
    status: "in_progress" | "ready" | "archived";
    score: number;
    dimensionScores: Record<"goal" | "product" | "audience" | "budget" | "platforms" | "measurement", number>;
    facts: Record<string, unknown>;
    missingFields: string[];
    readyForSetupSteps: boolean;
    setupSteps: SetupStep[];
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  messages: SetupIntakeMessage[];
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
    access: "read-only" | "read-write-after-human-approval";
    mediaWriteEnabled: boolean;
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

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const appEnv = String(import.meta.env.VITE_APP_ENV ?? import.meta.env.MODE ?? "local").toLowerCase();
const allowBillingDemoBypass = appEnv !== "production";
const apiBaseUrl =
  /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/.test(configuredApiBaseUrl) &&
  !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? ""
    : configuredApiBaseUrl;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const authRedirectPath = import.meta.env.VITE_AUTH_REDIRECT_PATH ?? "/auth/callback";
const authRedirectUrl =
  import.meta.env.VITE_AUTH_REDIRECT_URL ??
  `${window.location.origin}${authRedirectPath.startsWith("/") ? authRedirectPath : `/${authRedirectPath}`}`;
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        persistSession: true,
      },
    })
  : null;
const columnBookmarkStorageKey = "adops-advisor:column-bookmarks";
const mascotWaitingSrc = "/mascot/inhouse-bot-waiting.gif";
const mascotReviewSrc = "/mascot/inhouse-bot-review.gif";
const mascotStaticSrc = "/mascot/inhouse-bot-static.png";
const demoPayload = {
  workspaceId: "demo-workspace",
  userId: "demo-user",
  threadId: "demo-thread",
};

function createThreadId() {
  return crypto.randomUUID();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type WorkspaceSession = {
  workspaceId: string;
  userId: string;
  threadId: string;
  workspaceName: string;
  userEmail: string;
};

type BillingStatus = {
  workspaceId: string;
  configured: boolean;
  access: "active" | "billing_required";
  customer: { id: string; stripeCustomerId: string } | null;
  subscription: {
    id: string;
    stripeSubscriptionId?: string | null;
    status: string;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
};

const welcomeMessage: ChatMessage = {
  id: "local-welcome",
  role: "assistant",
  content:
    "こんにちは。最新広告データ、保存済みナレッジ、必要に応じた外部検索を分けて扱いながら、原因分析と人間向け作業手順まで整理します。",
};

const brandChartColors = {
  green: "#2d6a4f",
  greenSoft: "#78a684",
  yellow: "#d6a419",
  yellowDeep: "#8a6810",
  grid: "#d8e2d8",
};

const navItems: Array<{ key: View; label: string; icon: IconName }> = [
  { key: "dashboard", label: "ダッシュボード", icon: "dashboard" },
  { key: "setup", label: "広告準備", icon: "setup" },
  { key: "bi", label: "BI分析", icon: "chart" },
  { key: "columns", label: "Adコラム", icon: "book" },
  { key: "connections", label: "データ連携", icon: "plug" },
];

const confidenceLabels: Record<Confidence, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const recommendationStatusLabels: Record<StoredRecommendation["status"], string> = {
  draft: "下書き",
  suggested: "提案中",
  accepted: "採用",
  rejected: "却下",
  archived: "アーカイブ済み",
};

const taskStatusLabels: Record<StoredTask["status"], string> = {
  draft: "下書き",
  suggested: "提案中",
  accepted: "採用",
  doing: "対応中",
  done: "完了",
  rejected: "却下",
  ignored: "保留",
};

const taskPriorityLabels: Record<StoredTask["priority"], string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const advisorEntryByMode: Record<AdvisorMode, AdvisorEntry> = {
  beginner: "setup_advisor_beginner",
  experienced: "performance_analyst_experienced",
};

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
    id: "oauth-approval-write",
    title: "OAuth連携と承認付きwriteを分ける",
    difficulty: "初級",
    tags: ["oauth", "approval", "security"],
    body:
      "広告データ連携では、OAuthで費用、クリック、CV、キャンペーン情報を取得します。Google Adsの予算変更や停止は、AIが勝手に実行せず、対象ID、理由、戻し条件を確認したうえで承認付きAPIだけが実行します。権限と承認を分けることで、導入時の安全性を保ちます。",
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
    id: "approval-gated-action-plan",
    title: "承認付きwrite運用でのAI提案の使い方",
    difficulty: "初級",
    tags: ["approval", "human-review", "action-plan"],
    body:
      "承認付きwrite運用では、AIは原因仮説、変更候補、戻し条件、観察計画を整理します。担当者は対象を確認し、必要ならGoogle Adsの予算変更や停止を承認付きAPIまたは管理画面で実施します。AIの価値は自動実行ではなく、見る順番と判断材料を短時間で揃えることにあります。",
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
  const [advisorMode, setAdvisorMode] = useState<AdvisorMode>("beginner");
  const [pendingAdvisorMode, setPendingAdvisorMode] = useState<AdvisorMode | null>(null);
  const [input, setInput] = useState("");
  const [threadId, setThreadId] = useState(demoPayload.threadId);
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [threadTodos, setThreadTodos] = useState<Record<string, TodoItem[]>>({});
  const [latestRecommendation, setLatestRecommendation] = useState<ChatResponse["recommendation"] | null>(null);
  const [storedRecommendations, setStoredRecommendations] = useState<StoredRecommendation[]>([]);
  const [storedTasks, setStoredTasks] = useState<StoredTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState("root_agent が会話内容を確認しています。");
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [workspaceSession, setWorkspaceSession] = useState<WorkspaceSession | null>(null);
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingActionLoading, setBillingActionLoading] = useState<"checkout" | "portal" | "">("");
  const [billingError, setBillingError] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  const activePayload = workspaceSession ?? demoPayload;
  const billingActive = Boolean(workspaceSession && billingStatus?.access === "active");

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

    const authErrorDescription = readAuthErrorFromUrl();
    if (authErrorDescription) {
      setAuthError(authErrorDescription);
      window.history.replaceState({}, document.title, window.location.origin);
    }

    let mounted = true;
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (!mounted || settled) return;
      settled = true;
      setSession(null);
      setAuthLoading(false);
      setAuthError("保存済みセッションを復元できませんでした。もう一度ログインしてください。");
    }, 6000);
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted || settled) return;
      settled = true;
      window.clearTimeout(timeout);
      setSession(data.session);
      setAuthLoading(false);
    }).catch(() => {
      if (!mounted || settled) return;
      settled = true;
      window.clearTimeout(timeout);
      setSession(null);
      setAuthLoading(false);
      setAuthError("保存済みセッションを復元できませんでした。もう一度ログインしてください。");
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setWorkspaceSession(null);
        setBillingStatus(null);
        setMessages([welcomeMessage]);
      }
    });
    return () => {
      mounted = false;
      window.clearTimeout(timeout);
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
        if (window.location.pathname === authRedirectPath) {
          window.history.replaceState({}, document.title, window.location.origin);
        }
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
    setBillingLoading(true);
    setBillingError("");
    fetch(`${apiBaseUrl}/billing/status`, { headers: authHeaders(), signal: controller.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "課金状態の取得に失敗しました。");
        setBillingStatus(data as BillingStatus);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setBillingStatus(null);
        setBillingError(caught instanceof Error ? caught.message : "課金状態の取得に失敗しました。");
      })
      .finally(() => setBillingLoading(false));
    return () => controller.abort();
  }, [workspaceSession?.workspaceId, session?.access_token]);

  async function openBillingSession(kind: "checkout" | "portal") {
    setBillingError("");
    setBillingActionLoading(kind);
    const path = kind === "checkout" ? "/billing/checkout-session" : "/billing/portal-session";
    const res = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ workspaceId: workspaceSession?.workspaceId }),
    });
    const data = await res.json();
    setBillingActionLoading("");
    if (!res.ok || !data.url) {
      setBillingError(data?.error ?? "Stripe sessionを作成できませんでした。");
      return;
    }
    window.location.href = data.url;
  }

  useEffect(() => {
    if (!billingActive) return;
    const controller = new AbortController();
    setDashboardLoading(true);
    setDashboardError("");
    setDashboardData(null);
    fetch(
      `${apiBaseUrl}/dashboard?workspaceId=${activePayload.workspaceId}&range=${range}&platform=${platform}`,
      { headers: authHeaders(), signal: controller.signal },
    )
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok && data?.code === "ad_data_required") {
          setDashboardData(null);
          setUsingDemoData(false);
          return;
        }
        if (!res.ok) throw new Error(data?.error ?? "ダッシュボードデータの取得に失敗しました。");
        setDashboardData(data as DashboardResponse);
        setUsingDemoData(false);
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setDashboardData(null);
        setUsingDemoData(false);
        setDashboardError(caught instanceof Error ? caught.message : "ダッシュボードデータの取得に失敗しました。");
      })
      .finally(() => setDashboardLoading(false));
    return () => controller.abort();
  }, [range, platform, billingActive, workspaceSession?.workspaceId, session?.access_token]);

  useEffect(() => {
    if (!billingActive) return;
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
  }, [billingActive, workspaceSession?.workspaceId, session?.access_token]);

  useEffect(() => {
    if (!billingActive) return;
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
  }, [billingActive, workspaceSession?.workspaceId, session?.access_token]);

  useEffect(() => {
    if (!billingActive) return;
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
  }, [threadId, billingActive, workspaceSession?.workspaceId, session?.access_token]);

  function refreshThreads() {
    if (!billingActive) return;
    fetch(`${apiBaseUrl}/agent/threads?workspaceId=${activePayload.workspaceId}`, { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => setThreads((data.threads as ChatThreadSummary[]) ?? []))
      .catch(() => undefined);
  }

  function refreshWorkItems() {
    if (!workspaceSession || !billingActive) return;
    Promise.all([
      fetch(`${apiBaseUrl}/recommendations?workspaceId=${workspaceSession.workspaceId}`, { headers: authHeaders() }).then((res) => res.json()),
      fetch(`${apiBaseUrl}/tasks?workspaceId=${workspaceSession.workspaceId}`, { headers: authHeaders() }).then((res) => res.json()),
    ])
      .then(([recommendationData, taskData]) => {
        setStoredRecommendations((recommendationData.recommendations as StoredRecommendation[]) ?? []);
        setStoredTasks((taskData.tasks as StoredTask[]) ?? []);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    if (!billingActive) return;
    refreshWorkItems();
  }, [billingActive, workspaceSession?.workspaceId, session?.access_token]);

  function startNewThread() {
    const nextThreadId = createThreadId();
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

  function hasActiveChatConversation() {
    return messages.some((message) => message.role === "user");
  }

  function requestAdvisorModeChange(nextMode: AdvisorMode) {
    if (nextMode === advisorMode || loading) return;
    if (hasActiveChatConversation()) {
      setPendingAdvisorMode(nextMode);
      return;
    }
    setAdvisorMode(nextMode);
  }

  function confirmAdvisorModeChange() {
    if (!pendingAdvisorMode) return;
    setAdvisorMode(pendingAdvisorMode);
    setPendingAdvisorMode(null);
    startNewThread();
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
    if (!billingActive) {
      setError("課金状態がactiveになるまでAI相談は利用できません。");
      return;
    }

    setInput("");
    setError("");
    setLoading(true);
    setThinkingStatus("root_agent が会話内容を確認しています。");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    const activeThreadId = isUuid(threadId) ? threadId : createThreadId();
    if (activeThreadId !== threadId) {
      setThreadId(activeThreadId);
    }

    try {
      const res = await fetch(`${apiBaseUrl}/agent/chat/stream`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          ...activePayload,
          threadId: activeThreadId,
          message: text,
          context: {
            range,
            platform,
            dateRange: `last_${range}_days`,
            comparisonRange: `previous_${range}_days`,
            advisorMode,
            agentEntry: advisorEntryByMode[advisorMode],
          },
        }),
      });
      if (!res.ok || !res.body) throw new Error("AI応答ストリームの開始に失敗しました。");

      const chat = await readChatStream(res, setThinkingStatus);
      if (!chat) throw new Error("AI応答を取得できませんでした。");
      setMessages(chat.thread?.messages ?? ((prev) => [...prev, chat.message]));
      setLatestRecommendation(chat.recommendation);
      refreshThreads();
      refreshWorkItems();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI応答の取得に失敗しました。");
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
            options: { emailRedirectTo: authRedirectUrl },
          });
          if (signInError) setAuthError(signInError.message);
          else setAuthError("確認メールを送信しました。メール内リンクからログインしてください。");
        }}
        onGoogleLogin={async () => {
          if (!supabase) {
            setAuthError("Supabase Auth clientが未設定です。");
            return;
          }
          setAuthError("");
          const { error: signInError } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
              redirectTo: authRedirectUrl,
              queryParams: { prompt: "select_account" },
            },
          });
          if (signInError) setAuthError(signInError.message);
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
            options: { emailRedirectTo: authRedirectUrl },
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

  if (billingLoading) {
    return <LoadingScreen message="課金状態を確認しています。" />;
  }

  if (!billingStatus || billingStatus.access !== "active") {
    return (
      <BillingGate
        workspace={workspaceSession}
        status={billingStatus}
        error={billingError}
        loading={billingActionLoading}
        onCheckout={() => void openBillingSession("checkout")}
        onPortal={() => void openBillingSession("portal")}
        onContinueDemo={
          allowBillingDemoBypass && (billingStatus?.configured === false || !billingStatus)
            ? () =>
                setBillingStatus({
                  workspaceId: workspaceSession.workspaceId,
                  configured: false,
                  access: "active",
                  customer: null,
                  subscription: null,
                })
            : undefined
        }
        onLogout={() => supabase?.auth.signOut()}
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
            onRangeChange={setRange}
            onPlatformChange={setPlatform}
            onOpenAi={() => setAiOpen(true)}
            onOpenColumns={(tags) => {
              setColumnTags(tags);
              setSelectedArticleId(null);
              setView("columns");
            }}
            onOpenSetup={() => setView("setup")}
            onOpenConnections={() => setView("connections")}
          />
        )}
        {view === "setup" && (
          <SetupWizardPage
            onOpenConnections={() => setView("connections")}
            authHeaders={authHeaders}
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

      <button
        type="button"
        className={`ai-launcher${aiOpen ? " is-open" : ""}${loading ? " is-thinking" : ""}`}
        onClick={() => setAiOpen(true)}
        aria-controls="ai-sidebar"
        aria-expanded={aiOpen}
        aria-label={aiOpen ? "AIチャットパネルを表示中" : "AIチャットパネルを開く"}
      >
        <span className="ai-launcher-mascot" aria-hidden="true">
          <picture>
            <source srcSet={mascotStaticSrc} media="(prefers-reduced-motion: reduce)" />
            <img src={loading ? mascotReviewSrc : mascotWaitingSrc} alt="" width={72} height={78} />
          </picture>
        </span>
        <span className="ai-launcher-copy">
          <span>{loading ? "考え中" : "AI相談"}</span>
          <strong>{aiOpen ? "開いています" : "相談する"}</strong>
        </span>
      </button>

      {aiOpen && (
        <AiSidebar
          input={input}
          setInput={setInput}
          threadId={threadId}
          threads={threads}
          advisorMode={advisorMode}
          onAdvisorModeChange={requestAdvisorModeChange}
          pendingAdvisorMode={pendingAdvisorMode}
          onCancelAdvisorModeChange={() => setPendingAdvisorMode(null)}
          onConfirmAdvisorModeChange={confirmAdvisorModeChange}
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
        <img
          src="/brand/chokotto-symbol.png"
          alt=""
          width={32}
          height={32}
          aria-hidden="true"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
        <p>{workspace.workspaceName}</p>
        <strong>ちょこっとインハウス</strong>
        <span>{workspace.userEmail}</span>
      </div>
      <nav aria-label="メインナビゲーション" className="nav">
        {navItems.map((item) => (
          <button
            key={item.key}
            className={active === item.key ? "active" : ""}
            onClick={() => onNavigate(item.key)}
          >
            <InlineIcon name={item.icon} />
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

function InlineIcon({ name }: { name: IconName }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
  };

  if (name === "dashboard") {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <path d="M14 17h7M14 21h7" />
      </svg>
    );
  }

  if (name === "chart") {
    return (
      <svg {...common}>
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="m7 15 4-4 3 3 5-7" />
      </svg>
    );
  }

  if (name === "setup") {
    return (
      <svg {...common}>
        <path d="M12 3v4" />
        <path d="M12 17v4" />
        <path d="M3 12h4" />
        <path d="M17 12h4" />
        <path d="M7.8 7.8 5.4 5.4" />
        <path d="m18.6 18.6-2.4-2.4" />
        <path d="m16.2 7.8 2.4-2.4" />
        <path d="m5.4 18.6 2.4-2.4" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    );
  }

  if (name === "book") {
    return (
      <svg {...common}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
      </svg>
    );
  }

  if (name === "plug") {
    return (
      <svg {...common}>
        <path d="M9 7V2" />
        <path d="M15 7V2" />
        <path d="M6 13V8h12v5a6 6 0 0 1-12 0z" />
        <path d="M12 19v3" />
      </svg>
    );
  }

  if (name === "ai") {
    return (
      <svg {...common}>
        <path d="M12 3v3" />
        <path d="M12 18v3" />
        <path d="M3 12h3" />
        <path d="M18 12h3" />
        <path d="m5.6 5.6 2.1 2.1" />
        <path d="m16.3 16.3 2.1 2.1" />
        <path d="m18.4 5.6-2.1 2.1" />
        <path d="m7.7 16.3-2.1 2.1" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  if (name === "lock") {
    return (
      <svg {...common}>
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    );
  }

  if (name === "check") {
    return (
      <svg {...common}>
        <path d="m20 6-11 11-5-5" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
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

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="auth-shell">
      <section className="auth-panel">
        <p className="eyebrow">ちょこっとインハウス</p>
        <h1>確認中</h1>
        <p>{message}</p>
      </section>
    </div>
  );
}

function BillingGate({
  workspace,
  status,
  error,
  loading,
  onCheckout,
  onPortal,
  onContinueDemo,
  onLogout,
}: {
  workspace: WorkspaceSession;
  status: BillingStatus | null;
  error: string;
  loading: "checkout" | "portal" | "";
  onCheckout: () => void;
  onPortal: () => void;
  onContinueDemo?: () => void;
  onLogout: () => void;
}) {
  const subscriptionStatus = status?.subscription?.status ?? "未開始";
  return (
    <div className="auth-shell">
      <section className="auth-panel billing-gate">
        <p className="eyebrow">Stripe billing</p>
        <h1>利用開始には課金設定が必要です</h1>
        <p>
          {workspace.workspaceName} の課金状態を確認しました。ログイン後にStripe Checkoutでsubscriptionを開始すると、
          ダッシュボード、AI Advisor、Google Ads連携を利用できます。
        </p>
        <dl className="billing-status-list">
          <div>
            <dt>workspace</dt>
            <dd>{workspace.workspaceName}</dd>
          </div>
          <div>
            <dt>subscription</dt>
            <dd>{subscriptionStatus}</dd>
          </div>
        </dl>
        {error && <p className="form-message">{error}</p>}
        <div className="auth-actions">
          <button type="button" disabled={loading !== ""} onClick={onCheckout}>
            {loading === "checkout" ? "作成中" : "Stripe Checkoutへ進む"}
          </button>
          {status?.customer && (
            <button type="button" className="secondary-button" disabled={loading !== ""} onClick={onPortal}>
              {loading === "portal" ? "作成中" : "Billing Portalを開く"}
            </button>
          )}
          {onContinueDemo && (
            <button type="button" className="text-button" onClick={onContinueDemo}>
              Stripe未設定のためデモで続ける
            </button>
          )}
          <button type="button" className="text-button" onClick={onLogout}>
            ログアウト
          </button>
        </div>
      </section>
    </div>
  );
}

function AuthPage({
  error,
  session,
  onGoogleLogin,
  onMagicLink,
  onPasswordLogin,
  onPasswordSignup,
  onLogout,
}: {
  error: string;
  session: Session | null;
  onGoogleLogin: () => Promise<void>;
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
        <p className="eyebrow">ちょこっとインハウス</p>
        <h1>ログイン</h1>
        <p>社内テスト用のGoogleログインで入れます。Supabase AuthのGoogle providerを有効にしてください。</p>
        {!session ? (
          <div>
            <button type="button" className="google-login-button" onClick={() => void onGoogleLogin()}>
              Googleでログイン
            </button>
            <button type="button" className="text-button auth-help" onClick={() => setShowMagicLink((current) => !current)}>
              メール/パスワードの開発用ログインを表示
            </button>
            {showMagicLink && (
              <>
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
              <div className="magic-link-box">
                <p>メール送信制限に当たる場合があります。通常は上のパスワードログインを使ってください。</p>
                <button type="button" className="secondary-button" onClick={() => void onMagicLink(normalizeLoginId(email))}>
                  Magic Linkを送る
                </button>
              </div>
              </>
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

const setupWizardSteps = [
  { key: "goal", label: "目的" },
  { key: "product", label: "商材" },
  { key: "audience", label: "ターゲット" },
  { key: "budget", label: "予算" },
  { key: "platforms", label: "媒体" },
  { key: "measurement", label: "計測" },
  { key: "plan", label: "出稿プラン" },
];

const setupPlatformOptions: Array<{ value: Exclude<PlatformFilter, "all">; label: string; role: string }> = [
  { value: "google", label: "Google", role: "検索意図が強い顕在層を取りに行く" },
  { value: "meta", label: "Meta", role: "認知と比較検討の母数を作る" },
  { value: "yahoo", label: "Yahoo", role: "検索とリターゲティングを補完する" },
];

const setupScoreDimensions: Array<{ key: keyof SetupIntakeResponse["intake"]["dimensionScores"]; label: string; max: number }> = [
  { key: "goal", label: "目的", max: 15 },
  { key: "product", label: "商材", max: 20 },
  { key: "audience", label: "ターゲット", max: 20 },
  { key: "budget", label: "予算", max: 15 },
  { key: "platforms", label: "媒体", max: 10 },
  { key: "measurement", label: "計測", max: 20 },
];

function setupDimensionLabel(field: string) {
  return setupScoreDimensions.find((dimension) => dimension.key === field)?.label ?? field;
}

function formatSetupFact(facts: Record<string, unknown>, key: keyof SetupIntakeResponse["intake"]["dimensionScores"]) {
  const value = facts[key];
  if (Array.isArray(value)) return value.join(" / ") || "未入力";
  const text = String(value ?? "").trim();
  return text ? (text.length > 64 ? `${text.slice(0, 64)}...` : text) : "未入力";
}

function setupPlatformSummary(facts: Record<string, unknown>) {
  const value = facts.platforms;
  const platforms = Array.isArray(value) && value.length ? value.map(String) : ["google"];
  return platforms
    .map((platform) => setupPlatformOptions.find((option) => option.value === platform)?.label ?? platform)
    .join(" / ");
}

function setupTodoKey(stepId: string, index: number) {
  return `${stepId}:${index}`;
}

function SetupWizardPage({
  onOpenConnections,
  authHeaders,
}: {
  onOpenConnections: () => void;
  authHeaders: (extra?: HeadersInit) => HeadersInit;
}) {
  const [data, setData] = useState<SetupIntakeResponse | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSteps, setShowSteps] = useState(false);
  const [editableSteps, setEditableSteps] = useState<SetupStep[]>([]);
  const [activeSetupStep, setActiveSetupStep] = useState(0);
  const [completedSetupTodos, setCompletedSetupTodos] = useState<Record<string, boolean>>({});
  const [setupSessions, setSetupSessions] = useState<SetupIntakeSummary[]>([]);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch(`${apiBaseUrl}/setup/intake`, { headers: authHeaders() })
      .then((res) => res.ok ? res.json() : Promise.reject(new Error("広告準備ヒアリングを取得できませんでした。")))
      .then((nextData: SetupIntakeResponse) => {
        if (!mounted) return;
        applySetupData(nextData);
        return refreshSetupSessions();
      })
      .catch((caught) => {
        if (!mounted) return;
        setError(caught instanceof Error ? caught.message : "広告準備ヒアリングを取得できませんでした。");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  function applySetupData(nextData: SetupIntakeResponse) {
    setData(nextData);
    setEditableSteps(nextData.intake.setupSteps);
    setShowSteps(nextData.intake.readyForSetupSteps);
  }

  async function refreshSetupSessions() {
    const res = await fetch(`${apiBaseUrl}/setup/intakes`, { headers: authHeaders() });
    if (!res.ok) return;
    const body = await res.json() as { intakes?: SetupIntakeSummary[] };
    setSetupSessions(body.intakes ?? []);
  }

  async function loadSetupSession(intakeId: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/setup/intake?intakeId=${encodeURIComponent(intakeId)}`, { headers: authHeaders() });
      const nextData = await res.json();
      if (!res.ok) throw new Error(nextData?.error ?? "広告準備ヒアリングを取得できませんでした。");
      applySetupData(nextData);
      await refreshSetupSessions();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "広告準備ヒアリングを取得できませんでした。");
    } finally {
      setLoading(false);
    }
  }

  async function createSetupSession(title?: string) {
    setSessionBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/setup/intake`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ title }),
      });
      const nextData = await res.json();
      if (!res.ok) throw new Error(nextData?.error ?? "新しい広告準備を作成できませんでした。");
      applySetupData(nextData);
      setMessage("");
      await refreshSetupSessions();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "新しい広告準備を作成できませんでした。");
    } finally {
      setSessionBusy(false);
    }
  }

  async function renameSetupSession(title: string) {
    if (!data || title.trim() === data.intake.title) return;
    setSessionBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/setup/intake`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ intakeId: data.intake.id, title }),
      });
      const nextData = await res.json();
      if (!res.ok) throw new Error(nextData?.error ?? "タイトルを保存できませんでした。");
      applySetupData(nextData);
      setSetupSessions(nextData.intakes ?? setupSessions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "タイトルを保存できませんでした。");
    } finally {
      setSessionBusy(false);
    }
  }

  async function resetSetupSession() {
    if (!data) return;
    if (!window.confirm("現在のヒアリングをアーカイブして、新しい広告準備を始めます。よろしいですか？")) return;
    setSessionBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/setup/intake`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ intakeId: data.intake.id, archive: true }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.error ?? "ヒアリングをやり直せませんでした。");
      }
      await createSetupSession();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ヒアリングをやり直せませんでした。");
    } finally {
      setSessionBusy(false);
    }
  }

  useEffect(() => {
    const messagesElement = messagesRef.current;
    if (!messagesElement) return;
    window.requestAnimationFrame(() => {
      messagesElement.scrollTo({
        top: messagesElement.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [data?.messages.length, sending]);

  async function sendSetupMessage() {
    const text = message.trim();
    if (!text || sending || !data) return;
    setMessage("");
    setSending(true);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/setup/intake/message`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ intakeId: data?.intake.id, message: text }),
      });
      const nextData = await res.json();
      if (!res.ok) throw new Error(nextData?.error ?? "広告準備ヒアリングに失敗しました。");
      applySetupData(nextData);
      void refreshSetupSessions();
      if (nextData.intake.readyForSetupSteps) setShowSteps(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "広告準備ヒアリングに失敗しました。");
    } finally {
      setSending(false);
    }
  }

  async function saveSetupSteps() {
    if (!data) return;
    const res = await fetch(`${apiBaseUrl}/setup/intake/steps`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ intakeId: data.intake.id, setupSteps: editableSteps }),
    });
    const nextData = await res.json();
    if (res.ok) {
      setData(nextData);
      setEditableSteps(nextData.intake.setupSteps);
    } else {
      setError(nextData?.error ?? "出稿ステップの保存に失敗しました。");
    }
  }

  const intake = data?.intake;
  const facts = intake?.facts ?? {};
  const activeStep = editableSteps[Math.min(activeSetupStep, Math.max(editableSteps.length - 1, 0))];
  const activeStepIndex = editableSteps.findIndex((step) => step.id === activeStep?.id);
  const activeTodosDone = activeStep ? activeStep.steps.every((_, index) => completedSetupTodos[setupTodoKey(activeStep.id, index)]) : false;
  const completedStepCount = editableSteps.filter((step) => step.steps.length > 0 && step.steps.every((_, index) => completedSetupTodos[setupTodoKey(step.id, index)])).length;

  function toggleSetupTodo(stepId: string, index: number) {
    const key = setupTodoKey(stepId, index);
    setCompletedSetupTodos((current) => ({ ...current, [key]: !current[key] }));
  }

  function goNextSetupStep() {
    setActiveSetupStep((current) => Math.min(current + 1, editableSteps.length - 1));
  }

  return (
    <div className="setup-page md3-expressive-page md3-setup-page">
      <PageHeader title="広告準備" description="専用エージェントが深掘りし、準備スコアが80点を超えたら出稿ステップを確認できます。">
        <div className="setup-header-actions md3-expressive-actions">
          <button type="button" className="secondary-button md3-tonal-button" onClick={onOpenConnections}>
            データ連携を見る
          </button>
        </div>
      </PageHeader>

      {error && <p className="error">{error}</p>}
      <section className="setup-intake-layout">
        <article className="card setup-intake-chat">
          <div className="section-header setup-chat-header">
            <div className="setup-chat-heading">
              <p className="eyebrow">Setup intake agent</p>
              <h2>デプスヒアリング</h2>
            </div>
            <div className="setup-session-controls">
              <label className="setup-session-select">
                <span>{intake?.title ?? "準備セッション"} / {intake?.score ?? 0}/100</span>
                <select
                  aria-label="準備セッション"
                  value={intake?.id ?? ""}
                  onChange={(event) => void loadSetupSession(event.target.value)}
                  disabled={loading || sessionBusy || sending}
                >
                  {setupSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title} / {session.score}/100
                    </option>
                  ))}
                  {!setupSessions.length && intake && (
                    <option value={intake.id}>{intake.title} / {intake.score}/100</option>
                  )}
                </select>
              </label>
              <div className="setup-session-buttons">
                <button type="button" className="setup-session-icon" onClick={() => void createSetupSession()} disabled={sessionBusy} aria-label="新しい準備">
                  +
                </button>
                <button type="button" className="setup-session-text-action" onClick={() => {
                  const title = window.prompt("準備セッション名", intake?.title ?? "");
                  if (title !== null) void renameSetupSession(title);
                }} disabled={!data || sessionBusy}>
                  名前変更
                </button>
                <button type="button" className="setup-session-text-action" onClick={() => void resetSetupSession()} disabled={!data || sessionBusy}>
                  リセット
                </button>
              </div>
            </div>
          </div>
          <div className="setup-intake-messages" ref={messagesRef} aria-live="polite">
            {loading && <ThinkingMessage text="広告準備ヒアリングを読み込んでいます。" />}
            {data?.messages.map((item) => (
              <article key={item.id} className={`message ${item.role === "user" ? "user" : "assistant"}`}>
                <MarkdownContent content={item.content} />
              </article>
            ))}
            {sending && <ThinkingMessage text="setup_intake_agent が準備度を採点しています。" />}
            {intake?.readyForSetupSteps && (
              <article className="setup-chat-steps-card" aria-label="出稿手順の確認">
                <div>
                  <p className="eyebrow">Setup steps ready</p>
                  <strong>出稿前の操作手順を確認できます</strong>
                  <span>{setupPlatformSummary(facts)} の広告マネージャーで人間が確認・手動実行するための手順です。</span>
                </div>
                <button type="button" className="md3-filled-button" onClick={() => setShowSteps(true)}>
                  出稿手順を確認する
                </button>
              </article>
            )}
          </div>
          <div className="composer md3-chat-field setup-intake-composer">
            <label className="composer-label" htmlFor="setup-intake-input">広告準備について回答</label>
            <textarea
              id="setup-intake-input"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="例: 月10件の問い合わせを増やしたい。商材は月額の広告運用支援で、予算は初月10万円くらいです。"
              rows={3}
            />
            <div className="composer-supporting-row">
              <span className="composer-supporting-text">目的・商材・ターゲット・予算・媒体・計測を深掘りします</span>
              <div className="composer-actions">
                <button type="button" onClick={() => void sendSetupMessage()} disabled={sending || !data || !message.trim()} aria-label="送信">
                  {sending ? "…" : "↑"}
                </button>
              </div>
            </div>
          </div>
        </article>

        <aside className="card setup-readiness-panel">
          <p className="eyebrow">Readiness score</p>
          <div className="setup-score">
            <strong>{intake?.score ?? 0}</strong>
            <span>/100</span>
          </div>
          <div className="setup-score-bars">
            {setupScoreDimensions.map((dimension) => (
              <div key={dimension.key} className="setup-score-row">
                <span>{dimension.label}</span>
                <progress value={intake?.dimensionScores[dimension.key] ?? 0} max={dimension.max} />
                <strong>{intake?.dimensionScores[dimension.key] ?? 0}/{dimension.max}</strong>
              </div>
            ))}
          </div>
          <div className="setup-facts-panel">
            <h3>保存済みfacts</h3>
            {setupScoreDimensions.map((dimension) => (
              <p key={dimension.key}>
                <span>{dimension.label}</span>
                <strong>{formatSetupFact(facts, dimension.key)}</strong>
              </p>
            ))}
          </div>
          {intake?.missingFields.length ? (
            <div className="setup-missing-panel">
              <h3>足りない深掘り</h3>
              <div className="tag-list">
                {intake.missingFields.map((field) => <span key={field} className="tag">{setupDimensionLabel(field)}</span>)}
              </div>
            </div>
          ) : null}
        </aside>
      </section>

      {showSteps && intake?.readyForSetupSteps && (
        <div className="setup-steps-modal-backdrop" role="presentation" onMouseDown={() => setShowSteps(false)}>
          <section className="setup-steps-modal" role="dialog" aria-modal="true" aria-labelledby="setup-steps-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className="section-header setup-steps-modal-header">
            <div>
              <p className="eyebrow">Ad manager checklist</p>
              <h2 id="setup-steps-title">広告マネージャー操作手順</h2>
            </div>
            <button type="button" className="setup-modal-close" onClick={() => setShowSteps(false)} aria-label="閉じる">×</button>
          </div>
          <div className="setup-steps-modal-body">
            <nav className="setup-step-rail" aria-label="出稿手順ステップ">
              {editableSteps.map((step, index) => {
                const done = step.steps.length > 0 && step.steps.every((_, itemIndex) => completedSetupTodos[setupTodoKey(step.id, itemIndex)]);
                return (
                  <button
                    key={step.id}
                    type="button"
                    className={index === activeStepIndex ? "active" : done ? "done" : ""}
                    onClick={() => setActiveSetupStep(index)}
                  >
                    <span>{done ? "✓" : index + 1}</span>
                    {step.title}
                  </button>
                );
              })}
            </nav>
            {activeStep && (
              <article className="setup-step-workspace">
                <div className="setup-step-progress">
                  <span>{completedStepCount}/{editableSteps.length} steps</span>
                  <progress value={completedStepCount} max={Math.max(editableSteps.length, 1)} />
                </div>
                <input
                  aria-label={`${activeStep.title} の見出し`}
                  value={activeStep.title}
                  onChange={(event) => setEditableSteps((current) => current.map((item, index) => index === activeStepIndex ? { ...item, title: event.target.value } : item))}
                />
                <div className="setup-manager-todos">
                  {activeStep.steps.map((stepText, itemIndex) => (
                    <label key={`${activeStep.id}-${itemIndex}`} className="setup-manager-todo">
                      <input
                        type="checkbox"
                        checked={Boolean(completedSetupTodos[setupTodoKey(activeStep.id, itemIndex)])}
                        onChange={() => toggleSetupTodo(activeStep.id, itemIndex)}
                      />
                      <textarea
                        aria-label={`${activeStep.title} Todo ${itemIndex + 1}`}
                        value={stepText}
                        onChange={(event) => setEditableSteps((current) => current.map((item, index) => index === activeStepIndex ? { ...item, steps: item.steps.map((text, textIndex) => textIndex === itemIndex ? event.target.value : text) } : item))}
                        rows={2}
                      />
                    </label>
                  ))}
                </div>
              </article>
            )}
          </div>
          <div className="setup-steps-modal-actions">
            <button type="button" className="secondary-button" onClick={() => setShowSteps(false)}>閉じる</button>
            <button type="button" className="secondary-button" onClick={goNextSetupStep} disabled={!activeTodosDone || activeStepIndex >= editableSteps.length - 1}>
              Next
            </button>
            <button type="button" className="md3-filled-button" onClick={() => void saveSetupSteps()}>
              編集内容を保存
            </button>
          </div>
          </section>
        </div>
      )}
    </div>
  );
}

function SetupTextArea({
  id,
  eyebrow,
  title,
  description,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <section className="card setup-form-card md3-card md3-textarea-card">
      <p className="eyebrow md3-section-label">{eyebrow}</p>
      <h2>{title}</h2>
      <p className="setup-supporting-text md3-supporting-text">{description}</p>
      <label className="setup-field md3-text-field" htmlFor={id}>
        入力内容
        <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={7} />
      </label>
    </section>
  );
}

function SetupPlanPreview({ form }: { form: SetupWizardState }) {
  const selectedPlatforms = form.platforms.length
    ? form.platforms.map((platform) => setupPlatformOptions.find((option) => option.value === platform)?.label ?? platform).join(" / ")
    : "未選択";
  const instructionSections = buildSetupInstructionSections(form);
  const previewItems = [
    { label: "目的", value: form.goal || "未入力" },
    { label: "商材", value: form.product || "未入力" },
    { label: "ターゲット", value: form.audience || "未入力" },
    { label: "予算", value: [form.budget, form.targetCpa && `目標 ${form.targetCpa}`].filter(Boolean).join(" / ") || "未入力" },
    { label: "媒体", value: selectedPlatforms },
    { label: "計測", value: form.measurement || "未入力" },
    { label: "補足", value: form.planNotes || "未入力" },
  ];

  return (
    <div className="setup-plan-preview md3-preview-surface md3-expressive-preview">
      <div className="section-header md3-preview-header">
        <h3>出稿準備プレビュー</h3>
      </div>
      <dl className="setup-preview-list md3-preview-list">
        {previewItems.map((item) => (
          <div key={item.label} className="setup-preview-item md3-preview-item">
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      <section className="setup-instruction-board" aria-label="セットアップ設定指示">
        <div className="section-header">
          <div>
            <p className="eyebrow">Setup guide</p>
            <h3>この内容で進める設定指示</h3>
          </div>
        </div>
        <div className="setup-instruction-grid">
          {instructionSections.map((section) => (
            <article key={section.title} className="setup-instruction-card">
              <span>{section.label}</span>
              <h4>{section.title}</h4>
              <ol>
                {section.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </section>
      <div className="setup-review-note md3-assist-card">
        <strong>実施前チェック</strong>
        <p>このプランは媒体を直接変更しません。上の設定指示をもとに、担当者が各広告管理画面で確認・承認・手動実行してください。</p>
      </div>
    </div>
  );
}

function buildSetupInstructionSections(form: SetupWizardState) {
  const platforms = form.platforms.length ? form.platforms : ["google" as const];
  const platformSteps = platforms.flatMap((platform) => setupPlatformInstructionSteps(platform));
  return [
    {
      label: "01",
      title: "計測を先に固定する",
      steps: [
        form.measurement || "成果地点を1つ決める。例: 問い合わせ完了、購入完了、電話タップ。",
        "Thanksページ、GTM/GA4、媒体タグ、CRM突合のどれでCVを確認するか決める。",
        "出稿前にテストCVを1回発火させ、媒体管理画面とGA4の両方で記録を確認する。",
      ],
    },
    {
      label: "02",
      title: "初期キャンペーンの前提を置く",
      steps: [
        form.goal || "今回の広告目的を1つに絞る。",
        form.audience || "最初に狙うターゲットと、今回追わない層を分ける。",
        form.budget ? `初月予算は ${form.budget} を上限にし、日予算へ分解して設定する。` : "初月予算と日予算の上限を決める。",
      ],
    },
    {
      label: "03",
      title: "媒体管理画面で設定する",
      steps: platformSteps,
    },
    {
      label: "04",
      title: "初回7日間の観察ルール",
      steps: [
        "開始直後は毎日、費用・クリック・CV・CPA/CPL・CV計測漏れを確認する。",
        form.targetCpa ? `目標 ${form.targetCpa} から大きく外れる場合は、配信面・検索語句・クリエイティブをレビューする。` : "目標CPA/CPLを決め、そこから大きく外れる場合の確認順を決める。",
        "媒体設定の停止・予算変更・除外は、担当者が根拠を確認してから手動で反映する。",
      ],
    },
  ];
}

function setupPlatformInstructionSteps(platform: Exclude<PlatformFilter, "all">) {
  if (platform === "meta") {
    return [
      "Meta: キャンペーン目的をCVまたはリードに合わせ、最初は訴求を2-3案に絞る。",
      "Meta: 画像/動画、見出し、本文、CTAを組み合わせ、反応差が見える単位で広告セットを作る。",
      "Meta: Pixel/CAPIまたはGA4でCV確認できる状態にしてから配信開始する。",
    ];
  }
  if (platform === "yahoo") {
    return [
      "Yahoo: Google検索で使う構成を参考に、指名/一般/リターゲティングを分けて検討する。",
      "Yahoo: 検索広告とディスプレイで目的を混ぜず、初期予算を分けて管理する。",
      "Yahoo: CVタグと管理画面の成果計測を開始前に確認する。",
    ];
  }
  return [
    "Google: 指名検索と一般検索を分け、検索意図が強いキーワードから開始する。",
    "Google: 完全一致/フレーズ一致を中心にし、除外キーワード候補を事前に用意する。",
    "Google: CVアクション、入札戦略、日予算、地域、配信スケジュールを出稿前に確認する。",
  ];
}

function DashboardPage({
  data,
  loading,
  error,
  range,
  platform,
  latestRecommendation,
  usingDemoData,
  onRangeChange,
  onPlatformChange,
  onOpenAi,
  onOpenColumns,
  onOpenSetup,
  onOpenConnections,
}: {
  data: DashboardResponse | null;
  loading: boolean;
  error: string;
  range: number;
  platform: PlatformFilter;
  latestRecommendation: ChatResponse["recommendation"] | null;
  usingDemoData: boolean;
  onRangeChange: (range: number) => void;
  onPlatformChange: (platform: PlatformFilter) => void;
  onOpenAi: () => void;
  onOpenColumns: (tags: string[]) => void;
  onOpenSetup: () => void;
  onOpenConnections: () => void;
}) {
  const needsAdDataSetup = !loading && !data && !error;

  return (
    <div>
      <PageHeader title="ダッシュボード" description="AIに相談する前に、いま見るべきKPI、異常、優先キャンペーンを確認します。">
        <FilterControls range={range} platform={platform} onRangeChange={onRangeChange} onPlatformChange={onPlatformChange} />
      </PageHeader>
      <StatusLine loading={loading} error={error} />
      {needsAdDataSetup ? (
        <DashboardDataGate onOpenSetup={onOpenSetup} onOpenConnections={onOpenConnections} />
      ) : data && !usingDemoData ? (
        <>
          <KpiCards summary={data.summary} changes={data.changes} />

          <section className="dashboard-grid">
            <article className="card chart-card trend-card">
              <h2>費用と売上トレンド</h2>
              <ResponsiveContainer width="100%" height={288}>
                <LineChart data={data.series} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={brandChartColors.grid} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={72} tickFormatter={(value) => `¥${Math.round(Number(value) / 1000)}k`} />
                  <Tooltip formatter={(value, name) => [name === "conversions" ? numericValue(value) : formatMoney(numericValue(value)), name]} />
                  <Legend />
                  <Line type="monotone" dataKey="cost" stroke={brandChartColors.yellowDeep} strokeWidth={2} name="費用" dot={false} />
                  <Line type="monotone" dataKey="revenue" stroke={brandChartColors.green} strokeWidth={2} name="売上" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </article>

            <article className="card chart-card severity-card">
              <h2>異常重要度サマリー</h2>
              <ResponsiveContainer width="100%" height={288}>
                <BarChart data={severityChartData(data)} margin={{ top: 12, right: 10, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={brandChartColors.grid} />
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
                  <p className={`confidence-chip confidence-${latestRecommendation.confidence}`}>
                    自信度: {confidenceLabels[latestRecommendation.confidence]}
                  </p>
                </>
              ) : (
                <p>AIに渡せる検知タグ: {data.relatedTags.join(", ") || "monitoring"}</p>
              )}
              <div className="help-actions">
                <button type="button" onClick={onOpenAi}>
                  <InlineIcon name="ai" />
                  この状況をAIに相談
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

function DashboardDataGate({
  onOpenSetup,
  onOpenConnections,
}: {
  onOpenSetup: () => void;
  onOpenConnections: () => void;
}) {
  return (
    <div className="dashboard-data-gate-backdrop" role="presentation">
      <section className="dashboard-data-gate-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-data-gate-title">
        <p className="eyebrow">
          <InlineIcon name="lock" />
          data required
        </p>
        <h2 id="dashboard-data-gate-title">広告データ連携後にダッシュボードを表示します</h2>
        <p>
          Google Adsアカウントを接続して同期すると、KPI、キャンペーン、異常検知、AI相談の文脈が実データに切り替わります。
        </p>
        <div className="dashboard-data-gate-actions">
          <button type="button" onClick={onOpenConnections}>
            <InlineIcon name="plug" />
            データ連携へ
          </button>
          <button type="button" className="secondary-button" onClick={onOpenSetup}>
            <InlineIcon name="setup" />
            広告準備へ
          </button>
        </div>
      </section>
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
                  <CartesianGrid strokeDasharray="3 3" stroke={brandChartColors.grid} />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis yAxisId="money" tickLine={false} axisLine={false} width={72} tickFormatter={(value) => `¥${Math.round(Number(value) / 1000)}k`} />
                  <YAxis yAxisId="cv" orientation="right" allowDecimals={false} tickLine={false} axisLine={false} width={32} />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="money" type="monotone" dataKey="cost" stroke={brandChartColors.yellowDeep} strokeWidth={2} name="費用" dot={false} />
                  <Line yAxisId="money" type="monotone" dataKey="revenue" stroke={brandChartColors.green} strokeWidth={2} name="売上" dot={false} />
                  <Line yAxisId="cv" type="monotone" dataKey="conversions" stroke={brandChartColors.greenSoft} strokeWidth={2} name="CV" />
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
                <CartesianGrid strokeDasharray="3 3" stroke={brandChartColors.grid} />
                <XAxis type="number" tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="campaign" tickLine={false} axisLine={false} width={132} />
                <Tooltip formatter={(value) => (rankingMetric === "roas" ? formatPercent(numericValue(value)) : formatMoney(numericValue(value)))} />
                <Bar dataKey={rankingMetric} fill={brandChartColors.green} radius={[0, 8, 8, 0]} />
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

function WorkItemsPanel({
  recommendations,
  tasks,
  authHeaders,
  onRefresh,
}: {
  recommendations: StoredRecommendation[];
  tasks: StoredTask[];
  authHeaders: (extra?: HeadersInit) => HeadersInit;
  onRefresh: () => void;
}) {
  const [comment, setComment] = useState("");
  const latestRecommendation = recommendations[0];
  const latestTask = tasks[0];

  async function patchRecommendation(id: string, status: StoredRecommendation["status"]) {
    await fetch(`${apiBaseUrl}/recommendations/${id}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ status }),
    });
    onRefresh();
  }

  async function patchTask(id: string, status: StoredTask["status"]) {
    await fetch(`${apiBaseUrl}/tasks/${id}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ status }),
    });
    onRefresh();
  }

  async function sendFeedback(outcome: "implemented" | "worked" | "did_not_work" | "unclear") {
    await fetch(`${apiBaseUrl}/feedback`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        recommendationId: latestRecommendation?.id,
        humanTaskId: latestTask?.id,
        outcome,
        comment,
      }),
    });
    setComment("");
    onRefresh();
  }

  if (!latestRecommendation && !latestTask) {
    return null;
  }

  return (
    <section className="card work-items-panel">
      <div className="section-header">
        <h2>AI提案と実施フィードバック</h2>
        <button type="button" className="secondary-button" onClick={onRefresh}>更新</button>
      </div>
      {latestRecommendation && (
        <article className={`work-item recommendation-status-${latestRecommendation.status}`}>
          <p className="eyebrow">AI提案</p>
          <h3>{latestRecommendation.title}</h3>
          <div className="status-row">
            <span className={`status-chip status-${latestRecommendation.status}`}>
              {recommendationStatusLabels[latestRecommendation.status]}
            </span>
            <span className={`confidence-chip confidence-${latestRecommendation.confidence}`}>
              自信度: {confidenceLabels[latestRecommendation.confidence]}
            </span>
          </div>
          <div className="inline-actions">
            <button type="button" onClick={() => void patchRecommendation(latestRecommendation.id, "accepted")}>採用する</button>
            <button type="button" className="secondary-button" onClick={() => void patchRecommendation(latestRecommendation.id, "rejected")}>見送る</button>
          </div>
        </article>
      )}
      {latestTask && (
        <article className={`work-item task-status-${latestTask.status}`}>
          <p className="eyebrow">人間が確認して実行する作業</p>
          <h3>{latestTask.title}</h3>
          <div className="status-row">
            <span className={`status-chip status-${latestTask.status}`}>
              {taskStatusLabels[latestTask.status]}
            </span>
            <span className={`priority-chip priority-${latestTask.priority}`}>
              優先度: {taskPriorityLabels[latestTask.priority]}
            </span>
          </div>
          <div className="inline-actions">
            <button type="button" onClick={() => void patchTask(latestTask.id, "doing")}>対応中にする</button>
            <button type="button" onClick={() => void patchTask(latestTask.id, "done")}>完了にする</button>
            <button type="button" className="secondary-button" onClick={() => void patchTask(latestTask.id, "rejected")}>見送る</button>
          </div>
        </article>
      )}
      <div className="feedback-box">
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="実施結果、判断理由、次回AIに覚えてほしい観察メモ" rows={3} />
        <div className="inline-actions">
          <button type="button" onClick={() => void sendFeedback("implemented")}>実施した</button>
          <button type="button" onClick={() => void sendFeedback("worked")}>効果あり</button>
          <button type="button" onClick={() => void sendFeedback("did_not_work")}>効果なし</button>
          <button type="button" className="secondary-button" onClick={() => void sendFeedback("unclear")}>まだ不明</button>
        </div>
      </div>
    </section>
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
  type GoogleCustomer = {
    resourceName: string;
    customerId: string;
    descriptiveName?: string | null;
    managerCustomerId?: string | null;
    manager?: boolean | null;
  };
  const [customers, setCustomers] = useState<GoogleCustomer[]>([]);
  const [syncingCustomerId, setSyncingCustomerId] = useState("");
  const plannedConnections: Array<{
    platform: Exclude<PlatformFilter, "all">;
    label: string;
    accountHint: string;
  }> = [
    { platform: "google", label: "Google Ads", accountHint: "Google Ads API OAuth + 承認付きwrite" },
    { platform: "meta", label: "Meta Ads", accountHint: "Meta Marketing API read OAuth" },
    { platform: "yahoo", label: "Yahoo Ads", accountHint: "Yahoo広告 API read OAuth" },
  ];
  const policyNote =
    connectionStatus?.policy.note ??
    "Google Ads writeは、対象と理由を確認したうえで承認付きAPIだけが実行します。AI単体では媒体変更しません。";

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
    const res = await fetch(`${apiBaseUrl}/google/customers?workspaceId=${workspace.workspaceId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const data = await res.json();
    if (!res.ok) {
      setConnectionNotice(data?.error ?? "Google Ads account listの取得に失敗しました。");
      return;
    }
    setCustomers(data.customers ?? []);
  }

  async function connectCustomer(customer: GoogleCustomer) {
    setConnectionNotice("");
    const res = await fetch(`${apiBaseUrl}/google/customers/${customer.customerId}/connect?workspaceId=${workspace.workspaceId}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ managerCustomerId: customer.managerCustomerId ?? null }),
    });
    const data = await res.json();
    if (!res.ok) {
      setConnectionNotice(data?.error ?? "Google Ads customerの接続に失敗しました。");
      return;
    }
    setConnectionNotice(`Google Ads ${data.customerId} をworkspaceに接続しました。`);
  }

  async function syncCustomer(customer: GoogleCustomer) {
    setConnectionNotice("");
    setSyncingCustomerId(customer.customerId);
    const res = await fetch(`${apiBaseUrl}/sync/google`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ customerId: customer.customerId, managerCustomerId: customer.managerCustomerId ?? null, days: 30 }),
    });
    const data = await res.json();
    setSyncingCustomerId("");
    if (!res.ok) {
      setConnectionNotice(data?.error ?? "Google Ads syncに失敗しました。");
      return;
    }
    setConnectionNotice(`Google Ads ${data.customerId} から ${data.rowsSynced} 行を同期しました。Dashboard/AIに実データを反映します。`);
  }

  return (
    <div>
      <PageHeader title="データ連携" description="Google AdsはOAuthで連携し、readデータと承認付きwriteを安全に扱います。" />
      {usingDemoData && <MockDataBanner location="データ連携" />}
      <StatusLine loading={connectionLoading} error="" />
      {connectionNotice && <p className="muted connection-fallback">{connectionNotice}</p>}
      <section className="card connection-intro">
        <div>
          <p className="eyebrow">
            <InlineIcon name="lock" />
            OAuth + approval
          </p>
          <h2>ユーザーにAPIキー取得やsecret入力をお願いしません。</h2>
          <p>
            「連携する」を押すと各広告媒体の認可画面へ移動します。Google Adsの変更操作は、対象IDと承認を確認したAPI routeだけが実行します。
            トークンはサーバー側で暗号化保存し、ブラウザやAIへの文脈には含めません。
          </p>
          <p className="connection-policy">{policyNote}</p>
        </div>
        <button type="button" onClick={onOpenAi}>
          <InlineIcon name="ai" />
          連携前にAI相談を試す
        </button>
      </section>
      {customers.length > 0 && (
        <section className="card account-picker">
          <h2>取得できたGoogle Adsアカウント</h2>
          <ul>
            {customers.map((customer) => (
              <li key={`${customer.resourceName}-${customer.managerCustomerId ?? "direct"}`}>
                <strong>{customer.descriptiveName || customer.customerId}</strong>
                <span>
                  {customer.customerId}
                  {customer.manager ? " / MCC" : ""}
                  {customer.managerCustomerId ? ` / MCC ${customer.managerCustomerId} 配下` : ""}
                </span>
                <div className="inline-actions">
                  <button type="button" onClick={() => void connectCustomer(customer)}>接続</button>
                  <button type="button" className="secondary-button" disabled={Boolean(customer.manager) || syncingCustomerId === customer.customerId} onClick={() => void syncCustomer(customer)}>
                    {syncingCustomerId === customer.customerId ? "同期中" : "30日同期"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="oauth-flow">
        {["ログイン", "OAuth許可", "分析と承認付き実行"].map((step, index) => (
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
            <article className={`card connection-card platform-${connection.platform}`} key={connection.platform}>
              <div className="connection-card-header">
                <p className="badge">APIキー不要</p>
                <p className={`connection-status status-${connection.platform === "google" ? googleStatus : "pending"}`}>
                  {connection.platform === "google" ? statusLabel(googleStatus) : "未接続"}
                </p>
              </div>
              <h2>{connection.label}</h2>
              <p className="muted">{connection.accountHint} を予定しています。現時点では社内テスト用のmockデータで画面とAI相談を確認します。</p>
              <ul className="connection-notes">
                <li><InlineIcon name="lock" />OAuth tokenは暗号化保存</li>
                <li><InlineIcon name="check" />AI単体の自動変更なし</li>
                <li><InlineIcon name="check" />Google Adsは承認付きwrite対応</li>
                <li><InlineIcon name="lock" />secretやtokenはブラウザに表示しない</li>
              </ul>
              {connector?.oauthPath && (
                <p className="connection-route">
                  予定導線: <code>{connector.oauthPath}</code>
                </p>
              )}
              {connection.platform === "google" ? (
                <div className="connection-actions">
                  <button type="button" onClick={() => void openGoogleOAuth()}>
                    <InlineIcon name="plug" />
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

function timestampIsValid(value: string) {
  if (!value) return false;
  return Number.isFinite(Date.parse(value));
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
  advisorMode: AdvisorMode;
  onAdvisorModeChange: (mode: AdvisorMode) => void;
  pendingAdvisorMode: AdvisorMode | null;
  onCancelAdvisorModeChange: () => void;
  onConfirmAdvisorModeChange: () => void;
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
    <aside id="ai-sidebar" className={`ai-sidebar advisor-mode-${props.advisorMode}${props.loading ? " is-thinking" : ""}`}>
      <header className="ai-sidebar-header">
        <div className="ai-header-main">
          <span className="ai-header-icon" aria-hidden="true">
            <picture>
              <source srcSet={mascotStaticSrc} media="(prefers-reduced-motion: reduce)" />
              <img src={props.loading ? mascotReviewSrc : mascotWaitingSrc} alt="" width={44} height={48} />
            </picture>
          </span>
          <div className="ai-header-copy">
            <div className="ai-header-title-row">
              <h2>AI広告相談</h2>
              <span className="ai-entry-chip">
                {props.advisorMode === "beginner" ? "はじめて向け" : "実務者向け"}
              </span>
            </div>
            <p>{props.advisorMode === "beginner" ? "数字の見方から順番に整理" : "仮説と判断材料を短く深掘り"}</p>
          </div>
        </div>
        <button type="button" className="ai-close-button" onClick={props.onClose} aria-label="AIチャットを閉じる">
          ×
        </button>
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
          新しい相談
        </button>
      </div>
      <ChatConversation {...props} />
      {props.pendingAdvisorMode && (
        <div className="advisor-switch-modal-backdrop" role="presentation">
          <section className="advisor-switch-modal" role="dialog" aria-modal="true" aria-labelledby="advisor-switch-title">
            <p className="eyebrow">エージェント入口を切り替えます</p>
            <h3 id="advisor-switch-title">
              {props.pendingAdvisorMode === "beginner" ? "はじめて向け" : "実務者向け"}で新しい相談を開始します
            </h3>
            <p>
              途中で入口を変えると、回答方針と会話メモリが混ざりやすくなります。
              現在の会話は残したまま、新しいスレッドで切り替えます。
            </p>
            <div className="advisor-switch-actions">
              <button type="button" className="secondary-button" onClick={props.onCancelAdvisorModeChange}>
                キャンセル
              </button>
              <button type="button" onClick={props.onConfirmAdvisorModeChange}>
                切り替えて新規相談
              </button>
            </div>
          </section>
        </div>
      )}
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
  advisorMode,
  onAdvisorModeChange,
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
  advisorMode: AdvisorMode;
  onAdvisorModeChange: (mode: AdvisorMode) => void;
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
      <div className="composer md3-chat-field">
        <label className="composer-label" htmlFor="ai-chat-input">AIへの相談内容</label>
        <textarea
          id="ai-chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="例: CPAが悪化した原因と、今日確認する順番を教えて"
          rows={3}
        />
        <div className="composer-supporting-row">
          <span className="composer-supporting-text">
            {advisorMode === "beginner" ? "専門用語をほどいて、確認順に整理します" : "指標・仮説・運用判断を短く深掘りします"}
          </span>
          <div className="composer-actions">
            <label className="advisor-mode-select">
              <span>回答</span>
              <select
                aria-label="AI回答モード"
                value={advisorMode}
                onChange={(event) => onAdvisorModeChange(event.target.value as AdvisorMode)}
                disabled={loading}
              >
                <option value="beginner">はじめて</option>
                <option value="experienced">実務</option>
              </select>
            </label>
            <button type="button" onClick={onSend} disabled={loading} aria-label={loading ? "分析中" : "送信"}>
              {loading ? "…" : "↑"}
            </button>
          </div>
        </div>
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
        throw new Error(event.payload.detail ?? event.payload.error ?? "AI応答の取得に失敗しました。");
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
    { label: "CTR", value: formatPercent(summary.ctr, 2), change: changes.ctr, tone: "primary" },
    { label: "CVR", value: formatPercent(summary.cvr, 2), change: changes.cvr, tone: "secondary" },
    { label: "CPA", value: formatMoney(summary.cpa), change: changes.cpa, tone: "warning" },
    { label: "ROAS", value: formatPercent(summary.roas), change: changes.roas, tone: "success" },
    { label: "費用", value: formatMoney(summary.cost), change: changes.cost, tone: "neutral" },
    { label: "CV", value: summary.conversions.toLocaleString("ja-JP"), change: changes.conversions, tone: "tertiary" },
  ];
  return (
    <section aria-label="KPIサマリー" className="kpi-grid">
      {cards.map((card) => (
        <article key={card.label} className={`card kpi-card kpi-card-${card.tone}`}>
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
            label: "Web / API / OpenAI agentをローカル起動できる",
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
            label: "媒体writeは承認付きAPIだけで実行する",
            status: "pass",
            evidence: ["humanInTheLoopRequired=true"],
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
            id: "auth-callback-url",
            label: "Supabase Auth Redirect URLsにcallbackが登録されている",
            status: "todo",
            evidence: ["API未接続時のfallback。/auth/callback を環境ごとに登録してください。"],
          },
          {
            id: "google-login-provider",
            label: "Googleログイン用OAuth provider credentialが設定されている",
            status: "todo",
            evidence: ["API未接続時のfallback。Supabase Auth ProviderでGoogleを有効化してください。"],
          },
          {
            id: "real-media-apis",
            label: "Google Ads read/write APIの実接続",
            status: "todo",
            evidence: ["mock広告データで代替"],
          },
          {
            id: "stripe-billing",
            label: "Stripe Checkout / Portal / Webhookが設定されている",
            status: "todo",
            evidence: ["API未接続時のfallback。Stripe secretとwebhook secretを環境ごとに設定してください。"],
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
        label: "Web / API / OpenAI agentをローカル起動できる",
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
        label: "媒体writeは承認付きAPIだけで実行する",
        status: "pass",
        evidence: ["humanInTheLoopRequired=true"],
      },
      {
        id: "auth-callback-url",
        label: "Supabase Auth Redirect URLsにcallbackが登録されている",
        status: "todo",
        evidence: ["API未接続時のfallback。/auth/callback を環境ごとに登録してください。"],
      },
      {
        id: "google-login-provider",
        label: "Googleログイン用OAuth provider credentialが設定されている",
        status: "todo",
        evidence: ["API未接続時のfallback。Supabase Auth ProviderでGoogleを有効化してください。"],
      },
      {
        id: "real-media-apis",
        label: "Google Ads read/write APIの実接続",
        status: "todo",
        evidence: ["mock広告データで代替"],
      },
      {
        id: "stripe-billing",
        label: "Stripe Checkout / Portal / Webhookが設定されている",
        status: "todo",
        evidence: ["API未接続時のfallback。Stripe secretとwebhook secretを環境ごとに設定してください。"],
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
    [
      "supabase-auth-env",
      "auth-site-url",
      "auth-callback-url",
      "google-login-provider",
      "auth-oauth",
      "real-media-apis",
      "deployment",
    ].includes(check.id),
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

function readAuthErrorFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const error =
    params.get("error_description") ??
    hashParams.get("error_description") ??
    params.get("error") ??
    hashParams.get("error");
  if (!error) return "";
  return decodeURIComponent(error).replace(/\+/g, " ");
}

function createDemoChatResponse(question: string, data: DashboardResponse | null): ChatResponse {
  const source = data ?? demoDashboardData;
  const highPriority =
    source.campaigns.find((campaign) => campaign.priority === "High") ?? source.campaigns[0] ?? demoDashboardData.campaigns[0];

  return {
    message: {
      role: "assistant",
      content: [
        `結論:\nAPIまたはOpenAI Agent Serviceが未起動のため、ユーザーテスト用のデモ応答を表示しています。直近では「${highPriority.campaign}」のCPA悪化を最優先で確認してください。`,
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
    { severity: "High", count: data.severityCounts.High, color: brandChartColors.green },
    { severity: "Medium", count: data.severityCounts.Medium, color: brandChartColors.yellowDeep },
    { severity: "Low", count: data.severityCounts.Low, color: brandChartColors.greenSoft },
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
  if (platform === "google") return brandChartColors.yellow;
  if (platform === "meta") return brandChartColors.green;
  return brandChartColors.greenSoft;
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
