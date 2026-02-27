import crypto from "crypto";

import { createClient } from "@supabase/supabase-js";

import { hasSupabaseConfig, env } from "@/lib/env";
import { summarizeKpi } from "@/lib/kpi";
import type { Anomaly, ChatMessage, HelpArticle, NormalizedMetric, Platform } from "@/types/domain";

type DataSource = {
  workspace_id: string;
  sheets_url: string;
  last_refresh_status: "success" | "failed" | null;
  last_error: string | null;
  updated_at?: string;
};

type AppLog = {
  event_type: string;
  level: "info" | "warn" | "error";
  payload: Record<string, unknown>;
};

type MemoryStore = {
  workspaceId: string;
  dataSource: DataSource | null;
  rawRows: Array<{ workspace_id: string; platform: Platform; row_hash: string; row_json: object }>;
  normalized: NormalizedMetric[];
  anomalies: Anomaly[];
  chat: Record<string, ChatMessage[]>;
  logs: AppLog[];
};

const globalStore = globalThis as unknown as { __ADOPS_STORE__?: MemoryStore };

const memory: MemoryStore =
  globalStore.__ADOPS_STORE__ ??
  (globalStore.__ADOPS_STORE__ = {
    workspaceId: "default-workspace",
    dataSource: null,
    rawRows: [],
    normalized: [],
    anomalies: [],
    chat: {},
    logs: [],
  });

const supabase = hasSupabaseConfig
  ? createClient(env.supabaseUrl!, env.supabaseServiceRoleKey!, {
      auth: { persistSession: false },
    })
  : null;

export async function getWorkspaceId() {
  if (!supabase) {
    return memory.workspaceId;
  }

  const { data, error } = await supabase
    .from("workspaces")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data?.id) {
    return data.id as string;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("workspaces")
    .insert({ name: "Default Workspace" })
    .select("id")
    .single();

  if (insertErr) {
    throw insertErr;
  }

  return inserted.id as string;
}

export async function getDataSource(workspaceId: string): Promise<DataSource | null> {
  if (!supabase) {
    return memory.dataSource;
  }

  const { data, error } = await supabase
    .from("data_sources")
    .select("workspace_id,sheets_url,last_refresh_status,last_error,updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as DataSource | null;
}

export async function upsertDataSource(
  workspaceId: string,
  sheetsUrl: string,
  status?: "success" | "failed",
  lastError?: string | null,
) {
  if (!supabase) {
    memory.dataSource = {
      workspace_id: workspaceId,
      sheets_url: sheetsUrl,
      last_refresh_status: status ?? null,
      last_error: lastError ?? null,
      updated_at: new Date().toISOString(),
    };
    return;
  }

  const { error } = await supabase.from("data_sources").upsert(
    {
      workspace_id: workspaceId,
      sheets_url: sheetsUrl,
      last_refresh_status: status ?? null,
      last_error: lastError ?? null,
    },
    { onConflict: "workspace_id" },
  );

  if (error) {
    throw error;
  }
}

export async function insertRawRows(
  workspaceId: string,
  rows: Array<{ platform: Platform; rowHash: string; rowJson: object }>,
) {
  if (!supabase) {
    const existing = new Set(memory.rawRows.map((r) => r.row_hash));
    const toInsert = rows.filter((r) => !existing.has(r.rowHash));
    memory.rawRows.push(
      ...toInsert.map((row) => ({
        workspace_id: workspaceId,
        platform: row.platform,
        row_hash: row.rowHash,
        row_json: row.rowJson,
      })),
    );
    return;
  }

  const payload = rows.map((row) => ({
    workspace_id: workspaceId,
    platform: row.platform,
    row_hash: row.rowHash,
    row_json: row.rowJson,
  }));

  const { error } = await supabase
    .from("raw_import_rows")
    .upsert(payload, { onConflict: "workspace_id,row_hash", ignoreDuplicates: true });

  if (error) {
    throw error;
  }
}

export async function upsertNormalizedMetrics(rows: NormalizedMetric[]) {
  if (!supabase) {
    const rowKeys = new Set(
      memory.normalized.map(
        (r) => `${r.workspace_id}:${r.date}:${r.platform}:${r.campaign}:${r.adgroup}`,
      ),
    );
    for (const row of rows) {
      const key = `${row.workspace_id}:${row.date}:${row.platform}:${row.campaign}:${row.adgroup}`;
      if (rowKeys.has(key)) {
        continue;
      }
      memory.normalized.push(row);
    }
    return;
  }

  const { error } = await supabase.from("normalized_metrics").upsert(rows, {
    onConflict: "workspace_id,date,platform,campaign,adgroup",
  });

  if (error) {
    throw error;
  }
}

export async function getNormalizedMetrics(
  workspaceId: string,
  range: number,
  platform: Platform | "all",
): Promise<NormalizedMetric[]> {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - range + 1);
  const from = fromDate.toISOString().slice(0, 10);

  if (!supabase) {
    return memory.normalized.filter(
      (row) =>
        row.workspace_id === workspaceId &&
        row.date >= from &&
        (platform === "all" || row.platform === platform),
    );
  }

  let query = supabase
    .from("normalized_metrics")
    .select("*")
    .eq("workspace_id", workspaceId)
    .gte("date", from)
    .order("date", { ascending: true });

  if (platform !== "all") {
    query = query.eq("platform", platform);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data as NormalizedMetric[];
}

export async function replaceAnomalies(workspaceId: string, anomalies: Anomaly[]) {
  if (!supabase) {
    memory.anomalies = anomalies;
    return;
  }

  const { error: deleteErr } = await supabase
    .from("anomalies")
    .delete()
    .eq("workspace_id", workspaceId);

  if (deleteErr) {
    throw deleteErr;
  }

  if (!anomalies.length) {
    return;
  }

  const { error: insertErr } = await supabase.from("anomalies").insert(anomalies);
  if (insertErr) {
    throw insertErr;
  }
}

export async function getAnomalies(
  workspaceId: string,
  range: number,
  platform: Platform | "all",
): Promise<Anomaly[]> {
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - range + 1);
  const from = fromDate.toISOString().slice(0, 10);

  if (!supabase) {
    return memory.anomalies.filter(
      (row) => row.date >= from && (platform === "all" || row.platform === platform),
    );
  }

  let query = supabase
    .from("anomalies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .gte("date", from)
    .order("date", { ascending: false });

  if (platform !== "all") {
    query = query.eq("platform", platform);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return (data as Anomaly[]).map((item) => ({
    ...item,
    tags: Array.isArray(item.tags) ? item.tags : [],
  }));
}

const defaultHelpArticles: HelpArticle[] = [
  {
    id: "help-1",
    platform: "all",
    tags: ["bidding", "budget_change"],
    difficulty: "初級",
    title: "CPA悪化時の入札見直し",
    body: "直近3日でCVがある配信面に入札を寄せ、学習中の広告セットは急激な予算変更を避けます。",
    updated_at: "2026-02-26",
  },
  {
    id: "help-2",
    platform: "all",
    tags: ["creative", "reporting"],
    difficulty: "初級",
    title: "CTR低下時のクリエイティブ点検",
    body: "主要配信面の頻度と掲載順位を確認し、訴求軸を2-3パターン差し替えて比較します。",
    updated_at: "2026-02-26",
  },
  {
    id: "help-3",
    platform: "all",
    tags: ["conversion_tracking"],
    difficulty: "中級",
    title: "CV急減時の計測確認",
    body: "タグマネージャの発火条件と重複計測を確認し、媒体側CV定義の更新履歴を点検します。",
    updated_at: "2026-02-26",
  },
  {
    id: "help-4",
    platform: "all",
    tags: ["budget_change", "reporting"],
    difficulty: "中級",
    title: "予算増減時の段階調整チェックリスト",
    body: "日予算は一度に大きく変更せず20%刻みで調整し、学習状態とCV単価の推移を24時間ごとに監視します。",
    updated_at: "2026-02-26",
  },
  {
    id: "help-5",
    platform: "all",
    tags: ["creative"],
    difficulty: "初級",
    title: "広告疲労を防ぐクリエイティブ運用",
    body: "配信頻度上昇時は訴求軸・フォーマット・サムネイルを分けた3パターンを同時投入して比較します。",
    updated_at: "2026-02-26",
  },
  {
    id: "help-6",
    platform: "all",
    tags: ["bidding", "conversion_tracking"],
    difficulty: "上級",
    title: "入札戦略変更前の計測整合性確認",
    body: "入札戦略を切り替える前にCV定義・重複計測・計測遅延を確認し、学習シグナルの欠損を防ぎます。",
    updated_at: "2026-02-26",
  },
];

export async function getHelpArticles(tags: string[]) {
  if (!supabase) {
    if (!tags.length) {
      return defaultHelpArticles;
    }
    return defaultHelpArticles.filter((item) =>
      item.tags.some((tag) => tags.includes(tag)),
    );
  }

  let query = supabase.from("help_articles").select("*").order("updated_at", {
    ascending: false,
  });

  if (tags.length) {
    query = query.overlaps("tags", tags);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data as HelpArticle[];
}

export async function getHelpArticleById(id: string): Promise<HelpArticle | null> {
  if (!supabase) {
    return defaultHelpArticles.find((item) => item.id === id) ?? null;
  }

  const { data, error } = await supabase
    .from("help_articles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return (data as HelpArticle | null) ?? null;
}

export async function logEvent(log: AppLog) {
  if (!supabase) {
    memory.logs.push(log);
    return;
  }
  const { error } = await supabase.from("app_logs").insert({
    event_type: log.event_type,
    level: log.level,
    payload: log.payload,
  });
  if (error) {
    throw error;
  }
}

export async function saveChatMessage(sessionId: string, message: ChatMessage) {
  if (!supabase) {
    memory.chat[sessionId] = memory.chat[sessionId] ?? [];
    memory.chat[sessionId].push(message);
    return;
  }

  await supabase.from("ai_chat_sessions").upsert(
    { id: sessionId, workspace_id: await getWorkspaceId() },
    { onConflict: "id" },
  );

  const { error } = await supabase.from("ai_chat_messages").insert({
    session_id: sessionId,
    role: message.role,
    content: message.content,
    created_at: message.createdAt,
  });

  if (error) {
    throw error;
  }
}

export async function getChatMessages(sessionId: string): Promise<ChatMessage[]> {
  if (!supabase) {
    return memory.chat[sessionId] ?? [];
  }

  const { data, error } = await supabase
    .from("ai_chat_messages")
    .select("role,content,created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).map((item) => ({
    role: item.role,
    content: item.content,
    createdAt: item.created_at,
  }));
}

export type ChatSessionSummary = {
  id: string;
  createdAt: string;
  lastMessageAt: string | null;
  title: string;
};

function buildSessionTitle(messages: Array<{ role: string; content: string }>) {
  const firstUser = messages.find((item) => item.role === "user");
  if (!firstUser) {
    return "新しい会話";
  }
  const normalized = firstUser.content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "新しい会話";
  }
  return normalized.length > 32 ? `${normalized.slice(0, 32)}...` : normalized;
}

export async function listChatSessions(
  workspaceId: string,
  limit = 20,
): Promise<ChatSessionSummary[]> {
  if (!supabase) {
    return Object.entries(memory.chat)
      .map(([id, messages]) => {
        const lastMessageAt = messages[messages.length - 1]?.createdAt ?? null;
        return {
          id,
          createdAt: messages[0]?.createdAt ?? new Date().toISOString(),
          lastMessageAt,
          title: buildSessionTitle(messages),
        };
      })
      .sort((a, b) => {
        const aDate = a.lastMessageAt ?? a.createdAt;
        const bDate = b.lastMessageAt ?? b.createdAt;
        return aDate < bDate ? 1 : -1;
      })
      .slice(0, limit);
  }

  const { data: sessions, error: sessionsError } = await supabase
    .from("ai_chat_sessions")
    .select("id,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (sessionsError) {
    throw sessionsError;
  }

  const ids = (sessions ?? []).map((session) => session.id as string);
  if (!ids.length) {
    return [];
  }

  const { data: messages, error: messagesError } = await supabase
    .from("ai_chat_messages")
    .select("session_id,role,content,created_at")
    .in("session_id", ids)
    .order("created_at", { ascending: true });

  if (messagesError) {
    throw messagesError;
  }

  const bySession = new Map<
    string,
    Array<{ session_id: string; role: string; content: string; created_at: string }>
  >();
  for (const message of messages ?? []) {
    const sessionId = message.session_id as string;
    bySession.set(sessionId, [...(bySession.get(sessionId) ?? []), message]);
  }

  return ids
    .map((id) => {
      const session = (sessions ?? []).find((item) => item.id === id);
      const rows = bySession.get(id) ?? [];
      return {
        id,
        createdAt: (session?.created_at as string) ?? new Date().toISOString(),
        lastMessageAt: rows[rows.length - 1]?.created_at ?? null,
        title: buildSessionTitle(rows),
      };
    })
    .sort((a, b) => {
      const aDate = a.lastMessageAt ?? a.createdAt;
      const bDate = b.lastMessageAt ?? b.createdAt;
      return aDate < bDate ? 1 : -1;
    });
}

export function buildTopCampaigns(rows: NormalizedMetric[], limit = 5) {
  const map = new Map<string, { campaign: string; cost: number; revenue: number }>();
  for (const row of rows) {
    const cur = map.get(row.campaign) ?? { campaign: row.campaign, cost: 0, revenue: 0 };
    cur.cost += row.cost;
    cur.revenue += row.revenue;
    map.set(row.campaign, cur);
  }

  return [...map.values()].sort((a, b) => b.cost - a.cost).slice(0, limit);
}

export function computeSessionId() {
  return crypto.randomUUID();
}

export function buildTimeSeries(rows: NormalizedMetric[]) {
  const byDate = new Map<string, NormalizedMetric[]>();
  for (const row of rows) {
    byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  }
  return [...byDate.entries()].map(([date, values]) => ({
    date,
    ...summarizeKpi(values),
  }));
}

export function buildComposition(rows: NormalizedMetric[]) {
  const byPlatform = new Map<Platform, { platform: Platform; cost: number; revenue: number }>();
  for (const row of rows) {
    const cur = byPlatform.get(row.platform) ?? {
      platform: row.platform,
      cost: 0,
      revenue: 0,
    };
    cur.cost += row.cost;
    cur.revenue += row.revenue;
    byPlatform.set(row.platform, cur);
  }
  return [...byPlatform.values()];
}

export function buildSeverityCounts(anomalies: Anomaly[]) {
  const counts = { High: 0, Medium: 0, Low: 0 };
  for (const anomaly of anomalies) {
    counts[anomaly.severity] += 1;
  }
  return counts;
}
