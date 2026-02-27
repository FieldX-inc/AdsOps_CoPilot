export type Platform = "google" | "yahoo" | "meta" | "tiktok";

export type ApiError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type NormalizedMetric = {
  id?: string;
  workspace_id: string;
  date: string;
  platform: Platform;
  campaign: string;
  adgroup: string;
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  created_at?: string;
};

export type KpiSummary = {
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  cost: number;
  ctr: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
};

export type AnomalySeverity = "High" | "Medium" | "Low";
export type AnomalyType = "CPA悪化" | "CV減少" | "CTR低下" | "検知スキップ";

export type Anomaly = {
  id?: string;
  workspace_id: string;
  date: string;
  platform: Platform | "all";
  campaign: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  metric_value: number;
  baseline_value: number;
  detail: string;
  tags: string[];
  created_at?: string;
};

export type HelpArticle = {
  id: string;
  platform: Platform | "all";
  tags: string[];
  difficulty: "初級" | "中級" | "上級";
  title: string;
  body: string;
  updated_at: string;
};

export type AiInsightRequest = {
  summary: KpiSummary;
  anomalies: Anomaly[];
  top_campaigns: Array<{ campaign: string; cost: number; revenue: number }>;
  period: "7d" | "14d" | "30d";
};

export type AiInsightResponse = {
  text: string;
  mode: "mock" | "gemini";
  fallbackReason?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type AIRuntime = "legacy" | "adk";
