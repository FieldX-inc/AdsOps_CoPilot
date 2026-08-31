import { createHash, randomBytes } from "node:crypto";

import {
  DashboardFilterError,
  resolveDashboardHierarchyFilters,
  type DashboardFilterOptions,
  type DashboardHierarchyFilters,
  type ResolvedDashboardHierarchyFilters,
} from "./mock-repository.js";

type SupabaseUser = {
  id: string;
  email?: string;
};

type Workspace = {
  id: string;
  name: string;
  role: string;
  billingState: "pending_payment" | "active" | "past_due" | "cancelled";
};

export type PlatformConnectionStatus = {
  id: string;
  workspace_id: string;
  user_id: string;
  platform: "google" | "meta" | "yahoo";
  provider_account_id?: string | null;
  scopes: string[];
  status: "pending" | "connected" | "expired" | "revoked" | "error";
  expires_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentThreadSummary = {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  updated_at: string;
  message_count?: number;
  last_message_preview?: string;
};

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  created_at: string;
  metadata?: Record<string, unknown>;
};

export type StoredRecommendationRow = {
  id: string;
  workspace_id: string;
  user_id?: string | null;
  ad_account_id?: string | null;
  thread_id?: string | null;
  title: string;
  conclusion: string;
  evidence: Record<string, unknown>;
  diagnosis?: string | null;
  recommended_actions: unknown[];
  operator_steps: unknown[];
  risks?: string | null;
  observation_plan?: string | null;
  confidence: "high" | "medium" | "low";
  status: "draft" | "suggested" | "accepted" | "rejected" | "archived";
  created_at: string;
  updated_at: string;
};

export type StoredTaskRow = {
  id: string;
  workspace_id: string;
  user_id?: string | null;
  ad_account_id?: string | null;
  recommendation_id?: string | null;
  title: string;
  description?: string | null;
  priority: "high" | "medium" | "low";
  status: "draft" | "suggested" | "accepted" | "doing" | "done" | "rejected" | "ignored";
  created_at: string;
  updated_at?: string;
  completed_at?: string | null;
};

export type OperatorFeedbackRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  recommendation_id?: string | null;
  human_task_id?: string | null;
  outcome: "accepted" | "rejected" | "implemented" | "worked" | "did_not_work" | "unclear";
  comment?: string | null;
  observed_metrics: Record<string, unknown>;
  created_at: string;
};

export type AuditLogRow = {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  event_type: string;
  level: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type SetupIntakeRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  status: "in_progress" | "ready" | "archived";
  score: number;
  dimension_scores: Record<string, number>;
  facts: Record<string, unknown>;
  missing_fields: string[];
  generated_steps: SetupStepRow[];
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type SetupIntakeMessageRow = {
  id: string;
  intake_id: string;
  workspace_id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type SetupStepRow = {
  id: string;
  title: string;
  steps: string[];
};

export type AuthContext = {
  token: string;
  user: SupabaseUser;
  workspace: Workspace;
};

export type BillingCustomerRow = {
  id: string;
  workspace_id: string;
  user_id?: string | null;
  stripe_customer_id: string;
  created_at: string;
  updated_at: string;
};

export type BillingSubscriptionRow = {
  id: string;
  workspace_id: string;
  stripe_customer_id: string;
  stripe_subscription_id?: string | null;
  stripe_price_id?: string | null;
  plan_id?: "minimum" | "standard" | "premium" | null;
  billing_interval?: "month" | "year" | null;
  status: string;
  current_period_end?: string | null;
  cancel_at_period_end: boolean;
  raw: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AiUsageEventRow = {
  id: string;
  workspace_id: string;
  user_id?: string | null;
  source_type: "setup" | "chat" | "scheduled_report";
  source_id: string;
  model: string;
  requests: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  estimated_cost_microunits: number;
  credit_units: number;
  rate_version: string;
  idempotency_key: string;
  occurred_at: string;
};

export type ReportScheduleRow = {
  workspace_id: string;
  interval_days: 3;
  timezone: string;
  next_run_at: string;
  last_run_at?: string | null;
  enabled: boolean;
};

export type ReportRunRow = {
  id: string;
  workspace_id: string;
  period_start: string;
  period_end: string;
  due_at: string;
  status: "queued" | "running" | "completed" | "needs_reconnect" | "failed";
  content: Record<string, unknown>;
  usage_event_id?: string | null;
  email_status: "pending" | "delivered" | "queued" | "bounced" | "failed" | "skipped";
  email_result: Record<string, unknown>;
  retry_count: number;
  error_code?: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
};

export type NotificationPreferenceRow = {
  workspace_id: string;
  user_id: string;
  report_email_enabled: boolean;
  unsubscribed_at?: string | null;
};

type SupabaseConfig = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

export class AuthError extends Error {
  status: 400 | 401 | 403 | 500;

  constructor(message: string, status: 400 | 401 | 403 | 500 = 401) {
    super(message);
    this.status = status;
  }
}

function getSupabaseConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new AuthError("Supabase環境変数が不足しています。", 500);
  }
  return { url: url.replace(/\/$/, ""), anonKey, serviceRoleKey };
}

export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function authenticateRequest(request: Request): Promise<AuthContext> {
  const token = extractBearerToken(request.headers.get("Authorization"));
  if (!token) throw new AuthError("ログインが必要です。", 401);

  const config = getSupabaseConfig();
  const user = await fetchSupabaseUser(config, token);
  const workspace = await ensureWorkspace(config, user);
  return { token, user, workspace };
}

export function extractBearerToken(value: string | null) {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function fetchSupabaseUser(config: SupabaseConfig, token: string): Promise<SupabaseUser> {
  const res = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new AuthError("Supabase JWTを検証できませんでした。", 401);
  const data = (await res.json()) as { id?: string; email?: string };
  if (!data.id) throw new AuthError("Supabase user idを取得できませんでした。", 401);
  return { id: data.id, email: data.email };
}

async function ensureWorkspace(config: SupabaseConfig, user: SupabaseUser): Promise<Workspace> {
  const existing = await serviceFetch<Array<{ workspace_id: string; role: string; workspaces?: { name?: string; billing_state?: Workspace["billingState"] } }>>(
    config,
    `/rest/v1/workspace_members?select=workspace_id,role,is_primary,workspaces(name,billing_state)&user_id=eq.${encodeURIComponent(user.id)}&order=is_primary.desc,created_at.asc&limit=1`,
  );
  const membership = existing[0];
  if (membership) {
    return {
      id: membership.workspace_id,
      name: membership.workspaces?.name ?? "Workspace",
      role: membership.role,
      billingState: membership.workspaces?.billing_state ?? "pending_payment",
    };
  }

  const workspaceName = user.email ? `${user.email.split("@")[0]} workspace` : "AdOps Workspace";
  const created = await serviceFetch<Array<{ id: string; name: string }>>(config, "/rest/v1/workspaces?select=id,name", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: workspaceName }),
  });
  const workspace = created[0];
  if (!workspace?.id) throw new AuthError("workspaceを作成できませんでした。", 500);

  await serviceFetch(config, "/rest/v1/workspace_members", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspace.id, user_id: user.id, role: "owner", is_primary: true }),
  });

  return { id: workspace.id, name: workspace.name, role: "owner", billingState: "pending_payment" };
}

export async function assertWorkspaceMembership(request: Request, workspaceId: string | undefined, auth?: AuthContext) {
  const context = auth ?? (await authenticateRequest(request));
  if (!workspaceId || workspaceId === context.workspace.id) return context;

  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<{ role: string; workspaces?: { name?: string; billing_state?: Workspace["billingState"] } }>>(
    config,
    `/rest/v1/workspace_members?select=role,workspaces(name,billing_state)&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(context.user.id)}&limit=1`,
  );
  if (!rows[0]) throw new AuthError("指定workspaceへのアクセス権がありません。", 403);
  return {
    ...context,
    workspace: {
      id: workspaceId,
      name: rows[0].workspaces?.name ?? "Workspace",
      role: rows[0].role,
      billingState: rows[0].workspaces?.billing_state ?? "pending_payment",
    },
  };
}

export async function listConnectionStatuses(workspaceId: string, platform?: string) {
  const config = getSupabaseConfig();
  const filters = [
    `workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    platform && platform !== "all" ? `platform=eq.${encodeURIComponent(platform)}` : "",
    "order=created_at.desc",
  ].filter(Boolean);
  return serviceFetch<PlatformConnectionStatus[]>(
    config,
    `/rest/v1/ad_platform_connection_statuses?select=*&${filters.join("&")}`,
  );
}

export async function listAgentThreads(workspaceId: string, userId: string) {
  const config = getSupabaseConfig();
  const threads = await serviceFetch<AgentThreadSummary[]>(
    config,
    `/rest/v1/agent_threads?select=id,workspace_id,user_id,title,updated_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc`,
  );
  if (threads.length === 0) return [];

  const enriched = await Promise.all(
    threads.map(async (thread) => {
      const messages = await serviceFetch<Array<{ content: string }>>(
        config,
        `/rest/v1/agent_messages?select=content&workspace_id=eq.${encodeURIComponent(workspaceId)}&thread_id=eq.${encodeURIComponent(thread.id)}&order=created_at.desc&limit=1`,
      );
      const count = await countRows(
        config,
        `/rest/v1/agent_messages?select=id&workspace_id=eq.${encodeURIComponent(workspaceId)}&thread_id=eq.${encodeURIComponent(thread.id)}`,
      );
      return {
        ...thread,
        message_count: count,
        last_message_preview: truncate(messages[0]?.content ?? "", 72),
      };
    }),
  );
  return enriched;
}

export async function ensureAgentThread(workspaceId: string, userId: string, threadId: string, title = "新しい相談") {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<AgentThreadSummary[]>(
    config,
    "/rest/v1/agent_threads?on_conflict=id&select=id,workspace_id,user_id,title,updated_at",
    {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        id: threadId,
        workspace_id: workspaceId,
        user_id: userId,
        title: titleFromMessage(title) || "新しい相談",
      }),
    },
  );
  return rows[0];
}

export async function getAgentThread(workspaceId: string, userId: string, threadId: string) {
  const config = getSupabaseConfig();
  await ensureAgentThread(workspaceId, userId, threadId);
  const threads = await serviceFetch<AgentThreadSummary[]>(
    config,
    `/rest/v1/agent_threads?select=id,workspace_id,user_id,title,updated_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(threadId)}&limit=1`,
  );
  const messages = await serviceFetch<AgentMessage[]>(
    config,
    `/rest/v1/agent_messages?select=id,role,content,created_at,metadata&workspace_id=eq.${encodeURIComponent(workspaceId)}&thread_id=eq.${encodeURIComponent(threadId)}&order=created_at.asc`,
  );
  return { thread: threads[0], messages };
}

export async function appendAgentMessage(input: {
  workspaceId: string;
  userId?: string | null;
  threadId: string;
  role: AgentMessage["role"];
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<AgentMessage[]>(config, "/rest/v1/agent_messages?select=id,role,content,created_at,metadata", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      user_id: input.userId ?? null,
      thread_id: input.threadId,
      role: input.role,
      content: input.content,
      metadata: sanitize(input.metadata ?? {}),
    }),
  });
  await touchAgentThread(input.workspaceId, input.threadId);
  return rows[0];
}

export async function createRecommendation(input: {
  workspaceId: string;
  userId: string;
  threadId: string;
  adAccountId?: string | null;
  title: string;
  conclusion: string;
  evidence?: Record<string, unknown>;
  diagnosis?: string | null;
  recommendedActions?: unknown[];
  operatorSteps?: unknown[];
  risks?: string | null;
  observationPlan?: string | null;
  confidence: "high" | "medium" | "low";
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<StoredRecommendationRow[]>(config, "/rest/v1/recommendations?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      thread_id: input.threadId,
      ad_account_id: input.adAccountId ?? null,
      title: input.title,
      conclusion: input.conclusion,
      evidence: sanitize(input.evidence ?? {}),
      diagnosis: input.diagnosis ?? null,
      recommended_actions: sanitize(input.recommendedActions ?? []),
      operator_steps: sanitize(input.operatorSteps ?? []),
      risks: input.risks ?? null,
      observation_plan: input.observationPlan ?? null,
      confidence: input.confidence,
      status: "suggested",
    }),
  });
  return rows[0];
}

export async function listRecommendations(workspaceId: string) {
  const config = getSupabaseConfig();
  return serviceFetch<StoredRecommendationRow[]>(
    config,
    `/rest/v1/recommendations?select=*&workspace_id=eq.${encodeURIComponent(workspaceId)}&order=created_at.desc&limit=50`,
  );
}

export async function updateRecommendationStatus(workspaceId: string, recommendationId: string, status: StoredRecommendationRow["status"]) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<StoredRecommendationRow[]>(
    config,
    `/rest/v1/recommendations?id=eq.${encodeURIComponent(recommendationId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status }),
    },
  );
  return rows[0];
}

export async function createHumanTask(input: {
  workspaceId: string;
  userId: string;
  threadId?: string | null;
  recommendationId?: string | null;
  adAccountId?: string | null;
  title: string;
  description?: string | null;
  priority: "high" | "medium" | "low";
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<StoredTaskRow[]>(config, "/rest/v1/human_tasks?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      ad_account_id: input.adAccountId ?? null,
      recommendation_id: input.recommendationId ?? null,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      status: "suggested",
    }),
  });
  return rows[0];
}

export async function listHumanTasks(workspaceId: string) {
  const config = getSupabaseConfig();
  return serviceFetch<StoredTaskRow[]>(
    config,
    `/rest/v1/human_tasks?select=*&workspace_id=eq.${encodeURIComponent(workspaceId)}&order=created_at.desc&limit=50`,
  );
}

export async function updateHumanTaskStatus(workspaceId: string, taskId: string, status: StoredTaskRow["status"]) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<StoredTaskRow[]>(
    config,
    `/rest/v1/human_tasks?id=eq.${encodeURIComponent(taskId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status,
        completed_at: status === "done" ? new Date().toISOString() : null,
      }),
    },
  );
  return rows[0];
}

export async function createOperatorFeedback(input: {
  workspaceId: string;
  userId: string;
  recommendationId?: string | null;
  humanTaskId?: string | null;
  outcome: OperatorFeedbackRow["outcome"];
  comment?: string | null;
  observedMetrics?: Record<string, unknown>;
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<OperatorFeedbackRow[]>(config, "/rest/v1/operator_feedback?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      recommendation_id: input.recommendationId ?? null,
      human_task_id: input.humanTaskId ?? null,
      outcome: input.outcome,
      comment: input.comment ?? null,
      observed_metrics: sanitize(input.observedMetrics ?? {}),
    }),
  });
  return rows[0];
}

export async function listRecentOperatorFeedback(workspaceId: string, userId: string, limit = 10) {
  const config = getSupabaseConfig();
  return serviceFetch<OperatorFeedbackRow[]>(
    config,
    `/rest/v1/operator_feedback?select=*&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}`,
  );
}

export async function listUserMemories(workspaceId: string, userId: string, limit = 10) {
  const config = getSupabaseConfig();
  return serviceFetch<Array<{ id: string; memory_type: string; content: string; confidence: number; updated_at: string }>>(
    config,
    `/rest/v1/user_memories?select=id,memory_type,content,confidence,updated_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc&limit=${limit}`,
  );
}

export async function getWorkspaceProfile(workspaceId: string) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<Record<string, unknown>>>(
    config,
    `/rest/v1/workspace_profiles?select=*&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function listSetupIntakes(workspaceId: string, userId: string, includeArchived = false) {
  const config = getSupabaseConfig();
  const archivedFilter = includeArchived ? "" : "&archived_at=is.null";
  return serviceFetch<SetupIntakeRow[]>(
    config,
    `/rest/v1/ad_setup_intakes?select=*&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}${archivedFilter}&order=updated_at.desc`,
  );
}

export async function getSetupIntake(workspaceId: string, userId: string, intakeId?: string) {
  const rows = intakeId
    ? [await getSetupIntakeById(workspaceId, userId, intakeId)]
    : (await listSetupIntakes(workspaceId, userId, false)).slice(0, 1);
  if (!rows[0]) return null;
  return {
    intake: rows[0],
    messages: await listSetupIntakeMessages(rows[0].id, workspaceId, userId),
  };
}

export async function getActiveSetupIntake(workspaceId: string, userId: string) {
  return getSetupIntake(workspaceId, userId);
}

export async function ensureSetupIntake(workspaceId: string, userId: string) {
  const existing = await getSetupIntake(workspaceId, userId);
  if (existing) return existing;

  return createSetupIntake(workspaceId, userId);
}

export async function createSetupIntake(workspaceId: string, userId: string, title?: string) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<SetupIntakeRow[]>(config, "/rest/v1/ad_setup_intakes?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      workspace_id: workspaceId,
      user_id: userId,
      title: title?.trim() || defaultSetupIntakeTitle(),
      status: "in_progress",
      score: 0,
      dimension_scores: {},
      facts: {},
      missing_fields: [
        "basicInfo",
        "product",
        "goal",
        "area",
        "audience",
        "strengths",
        "keyMessage",
        "budget",
        "destination",
        "assets",
        "acquisitionMethods",
        "adExperience",
      ],
      generated_steps: [],
    }),
  });
  return { intake: rows[0], messages: [] };
}

export async function appendSetupIntakeMessage(input: {
  intakeId: string;
  workspaceId: string;
  userId: string;
  role: SetupIntakeMessageRow["role"];
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<SetupIntakeMessageRow[]>(config, "/rest/v1/ad_setup_intake_messages?select=*", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      intake_id: input.intakeId,
      workspace_id: input.workspaceId,
      user_id: input.userId,
      role: input.role,
      content: input.content,
      metadata: sanitize(input.metadata ?? {}),
    }),
  });
  return rows[0];
}

export async function updateSetupIntake(input: {
  intakeId: string;
  workspaceId: string;
  userId: string;
  status: SetupIntakeRow["status"];
  title?: string;
  score: number;
  dimensionScores: Record<string, number>;
  facts: Record<string, unknown>;
  missingFields: string[];
  generatedSteps: SetupStepRow[];
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<SetupIntakeRow[]>(
    config,
    `/rest/v1/ad_setup_intakes?id=eq.${encodeURIComponent(input.intakeId)}&workspace_id=eq.${encodeURIComponent(input.workspaceId)}&user_id=eq.${encodeURIComponent(input.userId)}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        ...(input.title ? { title: input.title } : {}),
        status: input.status,
        score: Math.max(0, Math.min(100, Math.round(input.score))),
        dimension_scores: sanitize(input.dimensionScores),
        facts: sanitize(input.facts),
        missing_fields: input.missingFields,
        generated_steps: sanitize(input.generatedSteps),
        updated_at: new Date().toISOString(),
      }),
    },
  );
  return rows[0];
}

export async function updateSetupIntakeSession(input: {
  intakeId: string;
  workspaceId: string;
  userId: string;
  title?: string;
  archive?: boolean;
}) {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) updates.title = input.title.trim() || "新しい広告準備";
  if (input.archive !== undefined) {
    updates.archived_at = input.archive ? new Date().toISOString() : null;
    updates.status = input.archive ? "archived" : "in_progress";
  }
  const config = getSupabaseConfig();
  const rows = await serviceFetch<SetupIntakeRow[]>(
    config,
    `/rest/v1/ad_setup_intakes?id=eq.${encodeURIComponent(input.intakeId)}&workspace_id=eq.${encodeURIComponent(input.workspaceId)}&user_id=eq.${encodeURIComponent(input.userId)}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(updates),
    },
  );
  if (!rows[0]) throw new AuthError("setup intakeが見つかりません。", 403);
  return rows[0];
}

export async function updateSetupIntakeSteps(input: {
  intakeId: string;
  workspaceId: string;
  userId: string;
  generatedSteps: SetupStepRow[];
}) {
  const current = await getSetupIntakeById(input.workspaceId, input.userId, input.intakeId);
  return updateSetupIntake({
    intakeId: input.intakeId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    status: current.status,
    score: current.score,
    dimensionScores: current.dimension_scores,
    facts: current.facts,
    missingFields: current.missing_fields,
    generatedSteps: input.generatedSteps,
  });
}

async function getSetupIntakeById(workspaceId: string, userId: string, intakeId: string) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<SetupIntakeRow[]>(
    config,
    `/rest/v1/ad_setup_intakes?select=*&id=eq.${encodeURIComponent(intakeId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  if (!rows[0]) throw new AuthError("setup intakeが見つかりません。", 403);
  return rows[0];
}

async function listSetupIntakeMessages(intakeId: string, workspaceId: string, userId: string) {
  const config = getSupabaseConfig();
  return serviceFetch<SetupIntakeMessageRow[]>(
    config,
    `/rest/v1/ad_setup_intake_messages?select=*&intake_id=eq.${encodeURIComponent(intakeId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&order=created_at.asc`,
  );
}

function defaultSetupIntakeTitle() {
  const timestamp = new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date()).replace(/\//g, "/");
  return `広告準備 ${timestamp}`;
}

export async function getDashboardDataFromDb(
  workspaceId: string,
  range: number,
  platform: string,
  adAccountId?: string | null,
  selectedDateRange?: { from: string; to: string } | null,
  hierarchyFilters: DashboardHierarchyFilters = {},
) {
  const requestedFilters = { ...hierarchyFilters, adAccountId: adAccountId ?? hierarchyFilters.adAccountId };
  if (requestedFilters.adAccountId) await assertAdAccountFilter(workspaceId, requestedFilters.adAccountId, platform);
  const accounts = await listAdAccounts(workspaceId, platform);
  if (accounts.length === 0) return null;
  const latestAdData = await getLatestAdDataFromDb(
    workspaceId,
    range,
    platform,
    requestedFilters.adAccountId,
    selectedDateRange,
    requestedFilters,
  );
  if (!latestAdData) return null;
  const resolvedFilters = dashboardHierarchyFromData(latestAdData);
  const series = await getDailySeries(workspaceId, range, platform, resolvedFilters, selectedDateRange);
  const severityCounts = latestAdData.anomalies.reduce(
    (acc, anomaly) => {
      acc[anomaly.severity as "High" | "Medium" | "Low"] += 1;
      return acc;
    },
    { High: 0, Medium: 0, Low: 0 },
  );
  return {
    ...latestAdData,
    summary: latestAdData.current.totals,
    comparison: latestAdData.comparison.totals,
    series,
    severityCounts,
    adAccounts: accounts.map((account) => ({
      id: account.id,
      externalAccountId: account.external_account_id,
      platform: account.platform,
      name: account.name,
      currency: account.currency,
      timezone: account.timezone,
      status: account.status === "removed" ? "pending" : "connected",
      lastFetchedAt: account.updated_at ?? account.created_at,
    })),
    mode: "production",
  };
}

export async function getLatestAdDataFromDb(
  workspaceId: string,
  range: number,
  platform: string,
  adAccountId?: string | null,
  selectedDateRange?: { from: string; to: string } | null,
  hierarchyFilters: DashboardHierarchyFilters = {},
) {
  const requestedFilters = { ...hierarchyFilters, adAccountId: adAccountId ?? hierarchyFilters.adAccountId };
  if (requestedFilters.adAccountId) await assertAdAccountFilter(workspaceId, requestedFilters.adAccountId, platform);
  const resolvedFilters = await resolveDashboardHierarchyFiltersFromDb(workspaceId, platform, requestedFilters);
  const current = selectedDateRange
    ? { start: selectedDateRange.from, end: selectedDateRange.to }
    : dateWindow(range, 0);
  const comparison = selectedDateRange
    ? comparisonWindow(selectedDateRange.from, selectedDateRange.to)
    : dateWindow(range, range);
  const [currentRows, comparisonRows, campaignRows, snapshots, accounts] = await Promise.all([
    listMetricRows(workspaceId, platform, current.start, current.end, resolvedFilters),
    listMetricRows(workspaceId, platform, comparison.start, comparison.end, resolvedFilters),
    listCampaignMetricRows(workspaceId, platform, current.start, current.end, resolvedFilters),
    listCampaignSnapshots(workspaceId, platform, resolvedFilters.adAccountId, resolvedFilters.campaignId),
    listAdAccounts(workspaceId, platform),
  ]);
  if (currentRows.length === 0 && comparisonRows.length === 0) return null;
  const currentTotals = totals(currentRows);
  const comparisonTotals = totals(comparisonRows);
  const changes = {
    ctr: change(currentTotals.ctr, comparisonTotals.ctr),
    cvr: change(currentTotals.cvr, comparisonTotals.cvr),
    cpc: change(currentTotals.cpc, comparisonTotals.cpc),
    cpa: change(currentTotals.cpa, comparisonTotals.cpa),
    roas: change(currentTotals.roas, comparisonTotals.roas),
    cost: change(currentTotals.cost, comparisonTotals.cost),
    conversions: change(currentTotals.conversions, comparisonTotals.conversions),
  };
  const campaigns = campaignRows.map((row) => {
    const rowTotals = withKpis(row);
    const snapshot = snapshots.find((item) => item.external_campaign_id === row.external_campaign_id && item.ad_account_id === row.ad_account_id);
    const account = accounts.find((item) => item.id === row.ad_account_id);
    return {
      campaignId: String(row.external_campaign_id ?? ""),
      campaign: String(row.campaign_name ?? "Campaign"),
      adAccountId: String(row.ad_account_id ?? ""),
      customerId: account?.external_account_id ?? "",
      status: snapshot?.status ?? null,
      platform: row.platform,
      priority: priorityFor(rowTotals.cpa),
      ...rowTotals,
    };
  });
  const anomalies = buildDbAnomalies(platform, changes);
  return {
    workspaceId,
    generatedAt: new Date().toISOString(),
    range,
    dateRange: selectedDateRange ?? null,
    comparisonDateRange: selectedDateRange ? { from: comparison.start, to: comparison.end } : null,
    platform,
    ...resolvedFilters,
    current: { label: selectedDateRange ? `${selectedDateRange.from}〜${selectedDateRange.to}` : `直近${range}日`, totals: currentTotals },
    comparison: { label: selectedDateRange ? `${comparison.start}〜${comparison.end}` : `前${range}日`, totals: comparisonTotals },
    changes,
    campaigns,
    anomalies,
    relatedTags: [...new Set(anomalies.flatMap((anomaly) => anomaly.tags))],
  };
}

export async function getDashboardFilterOptionsFromDb(
  workspaceId: string,
  platform: string,
  filters: DashboardHierarchyFilters = {},
): Promise<DashboardFilterOptions> {
  if (filters.adAccountId) await assertAdAccountFilter(workspaceId, filters.adAccountId, platform);
  const allOptions = await listDashboardFilterOptions(workspaceId, platform);
  let resolved: ResolvedDashboardHierarchyFilters;
  try {
    resolved = resolveDashboardHierarchyFilters(allOptions, filters);
  } catch (error) {
    if (error instanceof DashboardFilterError) throw new AuthError(error.message, 400);
    throw error;
  }
  return {
    accounts: allOptions.accounts,
    campaigns: allOptions.campaigns.filter((item) => !resolved.adAccountId || item.adAccountId === resolved.adAccountId),
    adGroups: allOptions.adGroups.filter((item) => (
      (!resolved.adAccountId || item.adAccountId === resolved.adAccountId)
      && (!resolved.campaignId || item.campaignId === resolved.campaignId)
    )),
    ads: allOptions.ads.filter((item) => (
      (!resolved.adAccountId || item.adAccountId === resolved.adAccountId)
      && (!resolved.campaignId || item.campaignId === resolved.campaignId)
      && (!resolved.adGroupId || item.adGroupId === resolved.adGroupId)
    )),
  };
}

export async function upsertPlatformConnection(input: {
  workspaceId: string;
  userId: string;
  platform: "google" | "meta" | "yahoo";
  providerAccountId?: string | null;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string | null;
  scopes: string[];
  expiresAt?: string | null;
}) {
  const config = getSupabaseConfig();
  const existing = await serviceFetch<Array<{ id: string }>>(
    config,
    `/rest/v1/ad_platform_connections?select=id&workspace_id=eq.${encodeURIComponent(input.workspaceId)}&user_id=eq.${encodeURIComponent(input.userId)}&platform=eq.${input.platform}&limit=1`,
  );
  const body = {
    workspace_id: input.workspaceId,
    user_id: input.userId,
    platform: input.platform,
    provider_account_id: input.providerAccountId ?? null,
    access_token_encrypted: input.accessTokenEncrypted,
    refresh_token_encrypted: input.refreshTokenEncrypted ?? null,
    scopes: input.scopes,
    status: "connected",
    expires_at: input.expiresAt ?? null,
    token_key_id: process.env.TOKEN_ENCRYPTION_KEY_ID || "local-v1",
    last_error: null,
  };

  if (existing[0]?.id) {
    const rows = await serviceFetch<PlatformConnectionStatus[]>(
      config,
      `/rest/v1/ad_platform_connections?id=eq.${existing[0].id}&select=id,workspace_id,user_id,platform,provider_account_id,scopes,status,expires_at,last_error,created_at,updated_at`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(body),
      },
    );
    return rows[0];
  }

  const rows = await serviceFetch<PlatformConnectionStatus[]>(
    config,
    "/rest/v1/ad_platform_connections?select=id,workspace_id,user_id,platform,provider_account_id,scopes,status,expires_at,last_error,created_at,updated_at",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    },
  );
  return rows[0];
}

export async function createOAuthState(input: {
  state: string;
  workspaceId: string;
  userId: string;
  platform: "google" | "meta" | "yahoo";
  codeVerifier: string;
  expiresAt: string;
}) {
  const config = getSupabaseConfig();
  await serviceFetch(config, "/rest/v1/oauth_states", {
    method: "POST",
    body: JSON.stringify({
      state: input.state,
      workspace_id: input.workspaceId,
      user_id: input.userId,
      platform: input.platform,
      code_verifier: input.codeVerifier,
      expires_at: input.expiresAt,
    }),
  });
}

export async function consumeOAuthState(state: string, platform: "google" | "meta" | "yahoo") {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<{ state: string; workspace_id: string; user_id: string; code_verifier: string; expires_at: string }>>(
    config,
    `/rest/v1/oauth_states?select=state,workspace_id,user_id,code_verifier,expires_at&state=eq.${encodeURIComponent(state)}&platform=eq.${platform}&limit=1`,
  );
  await serviceFetch(config, `/rest/v1/oauth_states?state=eq.${encodeURIComponent(state)}&platform=eq.${platform}`, { method: "DELETE" });
  const row = rows[0];
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export async function upsertAdAccount(input: {
  workspaceId: string;
  connectionId?: string | null;
  platform: "google" | "meta" | "yahoo";
  externalAccountId: string;
  managerCustomerId?: string | null;
  name: string;
  currency?: string | null;
  timezone?: string | null;
  status?: string | null;
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<{ id: string }>>(config, "/rest/v1/ad_accounts?on_conflict=workspace_id,platform,external_account_id&select=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      connection_id: input.connectionId ?? null,
      platform: input.platform,
      external_account_id: input.externalAccountId,
      manager_customer_id: input.managerCustomerId ?? null,
      name: input.name,
      currency: input.currency ?? null,
      timezone: input.timezone ?? null,
      status: input.status ?? "enabled",
    }),
  });
  return rows[0];
}

export async function getConnectedAdAccount(workspaceId: string, platform: "google" | "meta" | "yahoo", externalAccountId: string) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<{ id: string; status?: string | null; manager_customer_id?: string | null }>>(
    config,
    `/rest/v1/ad_accounts?select=id,status,manager_customer_id&workspace_id=eq.${encodeURIComponent(workspaceId)}&platform=eq.${encodeURIComponent(platform)}&external_account_id=eq.${encodeURIComponent(externalAccountId)}&limit=1`,
  );
  const account = rows[0];
  if (!account || account.status === "removed" || account.status === "revoked") return null;
  return account;
}

export async function upsertCampaignSnapshot(input: {
  workspaceId: string;
  adAccountId: string;
  platform: "google" | "meta" | "yahoo";
  externalCampaignId: string;
  name: string;
  status?: string | null;
  objective?: string | null;
  raw?: Record<string, unknown>;
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<{ id: string }>>(config, "/rest/v1/campaign_snapshots?on_conflict=workspace_id,platform,external_campaign_id&select=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      ad_account_id: input.adAccountId,
      platform: input.platform,
      external_campaign_id: input.externalCampaignId,
      name: input.name,
      status: input.status ?? null,
      objective: input.objective ?? null,
      raw: sanitize(input.raw ?? {}),
      fetched_at: new Date().toISOString(),
    }),
  });
  return rows[0];
}

export async function upsertAdGroupSnapshot(input: {
  workspaceId: string;
  adAccountId: string;
  campaignSnapshotId?: string | null;
  platform: "google" | "meta" | "yahoo";
  externalAdGroupId: string;
  name: string;
  status?: string | null;
  raw?: Record<string, unknown>;
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<{ id: string }>>(config, "/rest/v1/ad_group_snapshots?on_conflict=workspace_id,platform,external_ad_group_id&select=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      ad_account_id: input.adAccountId,
      campaign_snapshot_id: input.campaignSnapshotId ?? null,
      platform: input.platform,
      external_ad_group_id: input.externalAdGroupId,
      name: input.name,
      status: input.status ?? null,
      raw: sanitize(input.raw ?? {}),
      fetched_at: new Date().toISOString(),
    }),
  });
  return rows[0];
}

export async function upsertDailyMetrics(rows: Array<{
  workspaceId: string;
  adAccountId: string;
  platform: "google" | "meta" | "yahoo";
  date: string;
  externalCampaignId?: string | null;
  campaignName?: string | null;
  externalAdGroupId?: string | null;
  adGroupName?: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  revenue: number;
  raw?: Record<string, unknown>;
}>) {
  if (rows.length === 0) return [];
  const config = getSupabaseConfig();
  return serviceFetch(config, "/rest/v1/ad_daily_metrics?on_conflict=workspace_id,ad_account_id,platform,date,external_campaign_id,external_ad_group_id,external_ad_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows.map((row) => ({
      workspace_id: row.workspaceId,
      ad_account_id: row.adAccountId,
      platform: row.platform,
      date: row.date,
      external_campaign_id: row.externalCampaignId ?? null,
      campaign_name: row.campaignName ?? null,
      external_ad_group_id: row.externalAdGroupId ?? null,
      ad_group_name: row.adGroupName ?? null,
      external_ad_id: "",
      ad_name: null,
      impressions: row.impressions,
      clicks: row.clicks,
      cost: row.cost,
      conversions: row.conversions,
      revenue: row.revenue,
      raw: sanitize(row.raw ?? {}),
      fetched_at: new Date().toISOString(),
    }))),
  });
}

export async function readEncryptedAccessToken(workspaceId: string, userId: string, platform: "google" | "meta" | "yahoo") {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<{ access_token_encrypted: string }>>(
    config,
    `/rest/v1/ad_platform_connections?select=access_token_encrypted&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&platform=eq.${platform}&status=eq.connected&limit=1`,
  );
  return rows[0]?.access_token_encrypted ?? null;
}

export async function readPlatformConnectionTokens(workspaceId: string, userId: string, platform: "google" | "meta" | "yahoo") {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<{
    access_token_encrypted: string | null;
    refresh_token_encrypted: string | null;
    scopes: string[] | null;
    expires_at: string | null;
  }>>(
    config,
    `/rest/v1/ad_platform_connections?select=access_token_encrypted,refresh_token_encrypted,scopes,expires_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&platform=eq.${platform}&status=eq.connected&limit=1`,
  );
  return rows[0] ?? null;
}

export async function recordAuditLog(input: {
  workspaceId?: string | null;
  userId?: string | null;
  eventType: string;
  level?: "debug" | "info" | "warn" | "error";
  payload?: Record<string, unknown>;
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<{ id: string }>>(config, "/rest/v1/audit_logs?select=id", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      workspace_id: input.workspaceId ?? null,
      user_id: input.userId ?? null,
      event_type: input.eventType,
      level: input.level ?? "info",
      payload: sanitize(input.payload ?? {}),
    }),
  });
  return rows[0];
}

export async function listRecentAuditLogs(workspaceId: string, eventTypePrefix?: string, limit = 20) {
  const config = getSupabaseConfig();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const filters = [
    "select=id,workspace_id,user_id,event_type,level,payload,created_at",
    `workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    "order=created_at.desc",
    `limit=${safeLimit}`,
  ];
  if (eventTypePrefix) {
    filters.push(`event_type=like.${encodeURIComponent(`${eventTypePrefix}%`)}`);
  }
  return serviceFetch<AuditLogRow[]>(config, `/rest/v1/audit_logs?${filters.join("&")}`);
}

export async function getBillingCustomer(workspaceId: string) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<BillingCustomerRow[]>(
    config,
    `/rest/v1/billing_customers?select=*&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function getBillingCustomerByStripeCustomerId(stripeCustomerId: string) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<BillingCustomerRow[]>(
    config,
    `/rest/v1/billing_customers?select=*&stripe_customer_id=eq.${encodeURIComponent(stripeCustomerId)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function getBillingSubscription(workspaceId: string) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<BillingSubscriptionRow[]>(
    config,
    `/rest/v1/billing_subscriptions?select=*&workspace_id=eq.${encodeURIComponent(workspaceId)}&order=updated_at.desc&limit=1`,
  );
  return rows[0] ?? null;
}

export async function upsertBillingCustomer(input: {
  workspaceId: string;
  userId?: string | null;
  stripeCustomerId: string;
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<BillingCustomerRow[]>(config, "/rest/v1/billing_customers?on_conflict=workspace_id&select=*", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      user_id: input.userId ?? null,
      stripe_customer_id: input.stripeCustomerId,
    }),
  });
  return rows[0];
}

export async function upsertBillingSubscription(input: {
  workspaceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  planId?: "minimum" | "standard" | "premium" | null;
  billingInterval?: "month" | "year" | null;
  status: string;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  raw?: Record<string, unknown>;
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<BillingSubscriptionRow[]>(
    config,
    "/rest/v1/billing_subscriptions?on_conflict=workspace_id,stripe_customer_id&select=*",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        workspace_id: input.workspaceId,
        stripe_customer_id: input.stripeCustomerId,
        stripe_subscription_id: input.stripeSubscriptionId ?? null,
        stripe_price_id: input.stripePriceId ?? null,
        plan_id: input.planId ?? null,
        billing_interval: input.billingInterval ?? null,
        status: input.status,
        current_period_end: input.currentPeriodEnd ?? null,
        cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
        raw: sanitize(input.raw ?? {}),
      }),
    },
  );
  return rows[0];
}

export async function claimStripeWebhookEvent(input: {
  eventId: string;
  eventType: string;
  stripeCreatedAt?: string | null;
}) {
  const config = getSupabaseConfig();
  return serviceFetch<boolean>(config, "/rest/v1/rpc/claim_stripe_webhook_event", {
    method: "POST",
    body: JSON.stringify({
      p_event_id: truncate(input.eventId, 255),
      p_event_type: truncate(input.eventType, 120),
      p_stripe_created_at: input.stripeCreatedAt ?? null,
    }),
  });
}

export async function finishStripeWebhookEvent(eventId: string, succeeded: boolean, errorCode?: string | null) {
  const config = getSupabaseConfig();
  await serviceFetch(config, "/rest/v1/rpc/finish_stripe_webhook_event", {
    method: "POST",
    body: JSON.stringify({
      p_event_id: truncate(eventId, 255),
      p_succeeded: succeeded,
      p_error_code: succeeded ? null : truncate(errorCode || "processing_failed", 80),
    }),
  });
}

export async function updateWorkspaceBillingState(
  workspaceId: string,
  billingState: Workspace["billingState"],
) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<{ id: string; billing_state: Workspace["billingState"] }>>(
    config,
    `/rest/v1/workspaces?id=eq.${encodeURIComponent(workspaceId)}&select=id,billing_state`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ billing_state: billingState }),
    },
  );
  return rows[0] ?? null;
}

export async function countWorkspaceMembers(workspaceId: string) {
  const config = getSupabaseConfig();
  return countRows(config, `/rest/v1/workspace_members?select=user_id&workspace_id=eq.${encodeURIComponent(workspaceId)}`);
}

export async function countPendingWorkspaceInvitations(workspaceId: string) {
  const config = getSupabaseConfig();
  const now = encodeURIComponent(new Date().toISOString());
  return countRows(
    config,
    `/rest/v1/workspace_invitations?select=id&workspace_id=eq.${encodeURIComponent(workspaceId)}&accepted_at=is.null&revoked_at=is.null&expires_at=gt.${now}`,
  );
}

export async function createWorkspaceInvitation(input: {
  workspaceId: string;
  invitedByUserId: string;
  email: string;
  role: "admin" | "member";
}) {
  const config = getSupabaseConfig();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const email = input.email.trim().toLowerCase();
  const rows = await serviceFetch<Array<{ id: string; email: string; role: string; expires_at: string; created_at: string }>>(
    config,
    "/rest/v1/workspace_invitations?select=id,email,role,expires_at,created_at",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        workspace_id: input.workspaceId,
        invited_by_user_id: input.invitedByUserId,
        email,
        role: input.role,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    },
  );
  return rows[0] ? { ...rows[0], token } : null;
}

export async function revokeWorkspaceInvitation(workspaceId: string, invitationId: string) {
  const config = getSupabaseConfig();
  await serviceFetch(
    config,
    `/rest/v1/workspace_invitations?id=eq.${encodeURIComponent(invitationId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    },
  );
}

export async function listWorkspaceInvitations(workspaceId: string) {
  const config = getSupabaseConfig();
  return serviceFetch<Array<{ id: string; email: string; role: string; expires_at: string; accepted_at?: string | null; revoked_at?: string | null; created_at: string }>>(
    config,
    `/rest/v1/workspace_invitations?select=id,email,role,expires_at,accepted_at,revoked_at,created_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&order=created_at.desc`,
  );
}

export async function acceptWorkspaceInvitation(auth: AuthContext, rawToken: string) {
  const config = getSupabaseConfig();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const rows = await serviceFetch<Array<{ id: string; workspace_id: string; email: string; role: "admin" | "member"; expires_at: string }>>(
    config,
    `/rest/v1/workspace_invitations?select=id,workspace_id,email,role,expires_at&token_hash=eq.${encodeURIComponent(tokenHash)}&accepted_at=is.null&revoked_at=is.null&limit=1`,
  );
  const invitation = rows[0];
  if (!invitation || new Date(invitation.expires_at).getTime() <= Date.now()) throw new AuthError("招待が無効または期限切れです。", 400);
  if (!auth.user.email || auth.user.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) {
    throw new AuthError("招待先とログイン中のメールアドレスが一致しません。", 403);
  }
  // Add the membership before switching the primary workspace. If the plan-limit
  // trigger rejects the insert, the user's current primary workspace is preserved.
  await serviceFetch(config, "/rest/v1/workspace_members?on_conflict=workspace_id,user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ workspace_id: invitation.workspace_id, user_id: auth.user.id, role: invitation.role, is_primary: false }),
  });
  await serviceFetch(config, `/rest/v1/workspace_members?user_id=eq.${encodeURIComponent(auth.user.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ is_primary: false }),
  });
  await serviceFetch(config, `/rest/v1/workspace_members?workspace_id=eq.${encodeURIComponent(invitation.workspace_id)}&user_id=eq.${encodeURIComponent(auth.user.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ is_primary: true }),
  });
  await serviceFetch(config, `/rest/v1/workspace_invitations?id=eq.${encodeURIComponent(invitation.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ accepted_at: new Date().toISOString() }),
  });
  const workspace = await serviceFetch<Array<{ id: string; name: string; billing_state: Workspace["billingState"] }>>(
    config,
    `/rest/v1/workspaces?select=id,name,billing_state&id=eq.${encodeURIComponent(invitation.workspace_id)}&limit=1`,
  );
  return workspace[0] ? { ...workspace[0], role: invitation.role } : null;
}

export async function listWorkspaceMembers(workspaceId: string) {
  const config = getSupabaseConfig();
  const memberships = await serviceFetch<Array<{ user_id: string; role: string; created_at: string }>>(
    config,
    `/rest/v1/workspace_members?select=user_id,role,created_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&order=created_at.asc`,
  );
  return Promise.all(memberships.map(async (membership) => {
    const user = await fetchSupabaseAdminUser(config, membership.user_id);
    return { userId: membership.user_id, email: user.email, role: membership.role, createdAt: membership.created_at };
  }));
}

export async function removeWorkspaceMember(workspaceId: string, userId: string) {
  const config = getSupabaseConfig();
  await serviceFetch(config, `/rest/v1/workspace_members?workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

export async function sendSupabaseAuthInvitation(email: string, redirectTo: string) {
  const config = getSupabaseConfig();
  const response = await fetch(`${config.url}/auth/v1/invite`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, redirect_to: redirectTo }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new AuthError(`Supabase Auth招待メールを送信できませんでした: ${truncate(detail, 120)}`, 500);
  }
}

export async function countWorkspaceAdAccounts(workspaceId: string) {
  const config = getSupabaseConfig();
  return countRows(
    config,
    `/rest/v1/ad_accounts?select=id&workspace_id=eq.${encodeURIComponent(workspaceId)}&status=not.in.(removed,revoked)`,
  );
}

export async function recordAiUsageEvent(input: {
  workspaceId: string;
  userId?: string | null;
  sourceType: AiUsageEventRow["source_type"];
  sourceId: string;
  model: string;
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCostMicrounits: number;
  creditUnits: number;
  rateVersion: string;
  idempotencyKey: string;
  occurredAt?: string;
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<AiUsageEventRow[]>(
    config,
    "/rest/v1/ai_usage_events?on_conflict=workspace_id,idempotency_key&select=*",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        workspace_id: input.workspaceId,
        user_id: input.userId ?? null,
        source_type: input.sourceType,
        source_id: input.sourceId,
        model: input.model,
        requests: nonNegativeInteger(input.requests),
        input_tokens: nonNegativeInteger(input.inputTokens),
        cached_input_tokens: nonNegativeInteger(input.cachedInputTokens),
        output_tokens: nonNegativeInteger(input.outputTokens),
        reasoning_tokens: nonNegativeInteger(input.reasoningTokens),
        total_tokens: nonNegativeInteger(input.totalTokens),
        estimated_cost_microunits: nonNegativeInteger(input.estimatedCostMicrounits),
        credit_units: nonNegativeInteger(input.creditUnits),
        rate_version: truncate(input.rateVersion, 80),
        idempotency_key: truncate(input.idempotencyKey, 200),
        occurred_at: input.occurredAt ?? new Date().toISOString(),
      }),
    },
  );
  return rows[0];
}

export async function getAiUsageSummary(
  workspaceId: string,
  sourceType: AiUsageEventRow["source_type"],
  from: string,
  to: string,
) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<Pick<AiUsageEventRow, "credit_units" | "estimated_cost_microunits">>>(
    config,
    `/rest/v1/ai_usage_events?select=credit_units,estimated_cost_microunits&workspace_id=eq.${encodeURIComponent(workspaceId)}&source_type=eq.${sourceType}&occurred_at=gte.${encodeURIComponent(from)}&occurred_at=lt.${encodeURIComponent(to)}`,
  );
  return rows.reduce(
    (summary, row) => ({
      creditUnits: summary.creditUnits + Number(row.credit_units ?? 0),
      estimatedCostMicrounits: summary.estimatedCostMicrounits + Number(row.estimated_cost_microunits ?? 0),
      events: summary.events + 1,
    }),
    { creditUnits: 0, estimatedCostMicrounits: 0, events: 0 },
  );
}

export async function ensureReportSchedule(workspaceId: string, timezone = "Asia/Tokyo") {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<ReportScheduleRow[]>(
    config,
    "/rest/v1/report_schedules?on_conflict=workspace_id&select=*",
    {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({
        workspace_id: workspaceId,
        interval_days: 3,
        timezone: normalizeTimezone(timezone),
        next_run_at: nextReportRunAt(timezone),
        enabled: true,
      }),
    },
  );
  if (rows[0]) return rows[0];
  const existing = await serviceFetch<ReportScheduleRow[]>(
    config,
    `/rest/v1/report_schedules?select=*&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
  );
  return existing[0] ?? null;
}

export async function listDueReportSchedules(now = new Date().toISOString(), limit = 50) {
  const config = getSupabaseConfig();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  return serviceFetch<ReportScheduleRow[]>(
    config,
    `/rest/v1/report_schedules?select=*&enabled=eq.true&next_run_at=lte.${encodeURIComponent(now)}&order=next_run_at.asc&limit=${safeLimit}`,
  );
}

export async function claimReportRun(input: {
  workspaceId: string;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  idempotencyKey: string;
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<ReportRunRow[]>(
    config,
    "/rest/v1/report_runs?on_conflict=workspace_id,idempotency_key&select=*",
    {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({
        workspace_id: input.workspaceId,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        due_at: input.dueAt,
        idempotency_key: input.idempotencyKey,
        status: "running",
      }),
    },
  );
  if (rows[0]) return rows[0];

  const existingRows = await serviceFetch<ReportRunRow[]>(
    config,
    `/rest/v1/report_runs?select=*&workspace_id=eq.${encodeURIComponent(input.workspaceId)}&idempotency_key=eq.${encodeURIComponent(input.idempotencyKey)}&limit=1`,
  );
  const existing = existingRows[0];
  const maxRetries = reportJobMaxRetries();
  if (!existing
    || existing.status !== "failed"
    || !isRetryableReportErrorCode(existing.error_code)
    || existing.retry_count >= maxRetries) return null;
  const retried = await serviceFetch<ReportRunRow[]>(
    config,
    `/rest/v1/report_runs?id=eq.${encodeURIComponent(existing.id)}&workspace_id=eq.${encodeURIComponent(input.workspaceId)}&status=eq.failed&retry_count=eq.${existing.retry_count}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: "running",
        retry_count: existing.retry_count + 1,
        error_code: null,
      }),
    },
  );
  return retried[0] ?? null;
}

export function reportJobMaxRetries() {
  const parsed = Number(process.env.REPORT_JOB_MAX_RETRIES ?? "3");
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(Math.max(Math.trunc(parsed), 0), 10);
}

export function isRetryableReportErrorCode(value: string | null | undefined) {
  return /^retryable:/.test(String(value ?? ""));
}

export async function updateReportRun(
  workspaceId: string,
  reportRunId: string,
  patch: Partial<Pick<ReportRunRow, "status" | "content" | "usage_event_id" | "email_status" | "email_result" | "retry_count" | "error_code">>,
) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<ReportRunRow[]>(
    config,
    `/rest/v1/report_runs?id=eq.${encodeURIComponent(reportRunId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(sanitize(patch)),
    },
  );
  return rows[0] ?? null;
}

export async function completeReportSchedule(workspaceId: string, completedAt = new Date()) {
  const config = getSupabaseConfig();
  const schedules = await serviceFetch<ReportScheduleRow[]>(
    config,
    `/rest/v1/report_schedules?select=*&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
  );
  const schedule = schedules[0];
  if (!schedule) return null;
  const nextRun = nextScheduledLocalNine(
    new Date(schedule.next_run_at),
    normalizeTimezone(schedule.timezone),
    schedule.interval_days,
    completedAt,
  ).toISOString();
  const rows = await serviceFetch<ReportScheduleRow[]>(
    config,
    `/rest/v1/report_schedules?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ last_run_at: completedAt.toISOString(), next_run_at: nextRun }),
    },
  );
  return rows[0] ?? null;
}

export async function listReportRuns(workspaceId: string, limit = 20) {
  const config = getSupabaseConfig();
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  return serviceFetch<ReportRunRow[]>(
    config,
    `/rest/v1/report_runs?select=*&workspace_id=eq.${encodeURIComponent(workspaceId)}&order=created_at.desc&limit=${safeLimit}`,
  );
}

export async function getReportRun(workspaceId: string, reportRunId: string) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<ReportRunRow[]>(
    config,
    `/rest/v1/report_runs?select=*&workspace_id=eq.${encodeURIComponent(workspaceId)}&id=eq.${encodeURIComponent(reportRunId)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function getNotificationPreference(workspaceId: string, userId: string) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<NotificationPreferenceRow[]>(
    config,
    `/rest/v1/notification_preferences?select=*&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function upsertNotificationPreference(input: {
  workspaceId: string;
  userId: string;
  enabled: boolean;
}) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<NotificationPreferenceRow[]>(
    config,
    "/rest/v1/notification_preferences?on_conflict=workspace_id,user_id&select=*",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        workspace_id: input.workspaceId,
        user_id: input.userId,
        report_email_enabled: input.enabled,
        unsubscribed_at: input.enabled ? null : new Date().toISOString(),
      }),
    },
  );
  return rows[0];
}

export async function listReportRecipients(workspaceId: string) {
  const config = getSupabaseConfig();
  const members = await serviceFetch<Array<{ user_id: string; role: string }>>(
    config,
    `/rest/v1/workspace_members?select=user_id,role&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
  );
  const recipients = await Promise.all(members.map(async (member) => {
    const preference = await getNotificationPreference(workspaceId, member.user_id);
    if (preference?.report_email_enabled === false) return null;
    if (!preference) {
      const enabledByDefault = member.role === "owner" || member.role === "admin";
      await upsertNotificationPreference({ workspaceId, userId: member.user_id, enabled: enabledByDefault });
      if (!enabledByDefault) return null;
    }
    const user = await fetchSupabaseAdminUser(config, member.user_id);
    return user.email ? { userId: member.user_id, email: user.email, role: member.role } : null;
  }));
  return recipients.filter((recipient): recipient is NonNullable<typeof recipient> => Boolean(recipient));
}

export async function upsertUserMemory(input: {
  workspaceId: string;
  userId: string;
  memoryType: string;
  content: string;
  sourceThreadId?: string | null;
  sourceType: string;
  sourceRef?: string | null;
  dedupeKey: string;
  confidence: number;
}) {
  const config = getSupabaseConfig();
  const existing = await serviceFetch<Array<{ id: string }>>(
    config,
    `/rest/v1/user_memories?select=id&workspace_id=eq.${encodeURIComponent(input.workspaceId)}&user_id=eq.${encodeURIComponent(input.userId)}&memory_type=eq.${encodeURIComponent(input.memoryType)}&dedupe_key=eq.${encodeURIComponent(input.dedupeKey)}&limit=1`,
  );
  if (existing[0]) {
    const updated = await serviceFetch<Array<{ id: string }>>(
      config,
      `/rest/v1/user_memories?id=eq.${encodeURIComponent(existing[0].id)}&workspace_id=eq.${encodeURIComponent(input.workspaceId)}&user_id=eq.${encodeURIComponent(input.userId)}&select=id`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          content: truncate(input.content, 1000),
          source_thread_id: input.sourceThreadId ?? null,
          source_type: truncate(input.sourceType, 40),
          source_ref: input.sourceRef ? truncate(input.sourceRef, 160) : null,
          confidence: Math.min(Math.max(Number(input.confidence) || 0, 0), 1),
        }),
      },
    );
    return updated[0];
  }
  const rows = await serviceFetch<Array<{ id: string }>>(
    config,
    "/rest/v1/user_memories?select=id",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        workspace_id: input.workspaceId,
        user_id: input.userId,
        memory_type: truncate(input.memoryType, 40),
        content: truncate(input.content, 1000),
        source_thread_id: input.sourceThreadId ?? null,
        source_type: truncate(input.sourceType, 40),
        source_ref: input.sourceRef ? truncate(input.sourceRef, 160) : null,
        dedupe_key: truncate(input.dedupeKey, 128),
        confidence: Math.min(Math.max(Number(input.confidence) || 0, 0), 1),
      }),
    },
  );
  return rows[0];
}

export async function serviceFetch<T>(config: SupabaseConfig, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("apikey", config.serviceRoleKey);
  headers.set("Authorization", `Bearer ${config.serviceRoleKey}`);
  headers.set("Content-Type", "application/json");

  const res = await fetch(`${config.url}${path}`, { ...init, headers });
  if (!res.ok) {
    const detail = await res.text();
    throw new AuthError(`Supabase request failed: ${detail.slice(0, 180)}`, res.status === 403 ? 403 : 500);
  }
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

async function fetchSupabaseAdminUser(config: SupabaseConfig, userId: string) {
  const headers = new Headers({
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  });
  const response = await fetch(`${config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers });
  if (!response.ok) throw new AuthError("通知先ユーザーを確認できませんでした。", 500);
  const data = await response.json() as { email?: string };
  return { email: typeof data.email === "string" ? data.email : null };
}

function nonNegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function normalizeTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("ja-JP", { timeZone: value }).format();
    return value;
  } catch {
    return "Asia/Tokyo";
  }
}

function nextReportRunAt(timezone: string) {
  const normalized = normalizeTimezone(timezone);
  const now = new Date();
  const today = zonedDateParts(now, normalized);
  let candidate = zonedLocalTimeToUtc(today.year, today.month, today.day, 9, normalized);
  if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  const nextLocalDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 3));
  candidate = zonedLocalTimeToUtc(
    nextLocalDate.getUTCFullYear(),
    nextLocalDate.getUTCMonth() + 1,
    nextLocalDate.getUTCDate(),
    9,
    normalized,
  );
  return candidate.toISOString();
}

export function nextScheduledLocalNine(previousDueAt: Date, timezone: string, intervalDays: number, now: Date) {
  let localDate = zonedDateParts(previousDueAt, timezone);
  let candidate = previousDueAt;
  do {
    const advanced = new Date(Date.UTC(localDate.year, localDate.month - 1, localDate.day + intervalDays));
    localDate = {
      year: advanced.getUTCFullYear(),
      month: advanced.getUTCMonth() + 1,
      day: advanced.getUTCDate(),
    };
    candidate = zonedLocalTimeToUtc(localDate.year, localDate.month, localDate.day, 9, timezone);
  } while (candidate.getTime() <= now.getTime());
  return candidate;
}

function zonedDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

function zonedLocalTimeToUtc(year: number, month: number, day: number, hour: number, timezone: string) {
  const desired = Date.UTC(year, month - 1, day, hour, 0, 0);
  let candidate = desired;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(candidate));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
    const represented = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    candidate += desired - represented;
  }
  return new Date(candidate);
}

async function touchAgentThread(workspaceId: string, threadId: string) {
  const config = getSupabaseConfig();
  await serviceFetch(
    config,
    `/rest/v1/agent_threads?id=eq.${encodeURIComponent(threadId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ updated_at: new Date().toISOString() }),
    },
  );
}

async function countRows(config: SupabaseConfig, path: string) {
  const headers = new Headers();
  headers.set("apikey", config.serviceRoleKey);
  headers.set("Authorization", `Bearer ${config.serviceRoleKey}`);
  headers.set("Prefer", "count=exact");
  const res = await fetch(`${config.url}${path}`, { headers });
  if (!res.ok) return 0;
  const range = res.headers.get("content-range");
  return Number(range?.split("/")?.[1] ?? "0") || 0;
}

async function listAdAccounts(workspaceId: string, platform: string) {
  const config = getSupabaseConfig();
  const filters = [
    `workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    platform !== "all" ? `platform=eq.${encodeURIComponent(platform)}` : "",
    "order=platform.asc",
  ].filter(Boolean);
  return serviceFetch<Array<{
    id: string;
    external_account_id: string;
    platform: "google" | "meta" | "yahoo";
    name: string;
    currency?: string | null;
    timezone?: string | null;
    status?: string | null;
    created_at: string;
    updated_at: string;
  }>>(
    config,
    `/rest/v1/ad_accounts?select=id,external_account_id,platform,name,currency,timezone,status,created_at,updated_at&${filters.join("&")}`,
  );
}

async function assertAdAccountFilter(workspaceId: string, adAccountId: string, platform: string) {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<{ workspace_id: string; platform: string }>>(
    config,
    `/rest/v1/ad_accounts?select=workspace_id,platform&id=eq.${encodeURIComponent(adAccountId)}&limit=1`,
  );
  const account = rows[0];
  if (!account) throw new AuthError("指定された広告アカウントが存在しません。", 400);
  if (account.workspace_id !== workspaceId) throw new AuthError("広告アカウントがworkspaceに所属していません。", 403);
  if (platform !== "all" && account.platform !== platform) {
    throw new AuthError("指定されたplatformと広告アカウントが一致しません。", 400);
  }
}

async function resolveDashboardHierarchyFiltersFromDb(
  workspaceId: string,
  platform: string,
  filters: DashboardHierarchyFilters,
) {
  const options = await listDashboardFilterOptions(workspaceId, platform);
  try {
    return resolveDashboardHierarchyFilters(options, filters);
  } catch (error) {
    if (error instanceof DashboardFilterError) throw new AuthError(error.message, 400);
    throw error;
  }
}

async function listDashboardFilterOptions(workspaceId: string, platform: string): Promise<DashboardFilterOptions> {
  const config = getSupabaseConfig();
  const scope = [
    `workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    platform !== "all" ? `platform=eq.${encodeURIComponent(platform)}` : "",
  ].filter(Boolean).join("&");
  const [accountRows, campaignRows, adGroupRows, adRows] = await Promise.all([
    listAdAccounts(workspaceId, platform),
    serviceFetch<Array<{
      id: string;
      ad_account_id: string;
      external_campaign_id: string;
      name: string;
      platform: "google" | "meta" | "yahoo";
      status?: string | null;
    }>>(config, `/rest/v1/campaign_snapshots?select=id,ad_account_id,external_campaign_id,name,platform,status&${scope}&order=name.asc`),
    serviceFetch<Array<{
      ad_account_id: string;
      campaign_snapshot_id?: string | null;
      external_ad_group_id: string;
      name: string;
      platform: "google" | "meta" | "yahoo";
      status?: string | null;
    }>>(config, `/rest/v1/ad_group_snapshots?select=ad_account_id,campaign_snapshot_id,external_ad_group_id,name,platform,status&${scope}&order=name.asc`),
    serviceFetch<Array<{
      ad_account_id: string;
      external_campaign_id?: string | null;
      external_ad_group_id?: string | null;
      external_ad_id?: string | null;
      ad_name?: string | null;
      platform: "google" | "meta" | "yahoo";
      raw?: Record<string, unknown> | null;
    }>>(
      config,
      `/rest/v1/ad_daily_metrics?select=ad_account_id,external_campaign_id,external_ad_group_id,external_ad_id,ad_name,platform,raw&${scope}&external_ad_id=not.is.null&order=date.desc&limit=5000`,
    ),
  ]);

  const accountIds = new Set(accountRows.map((row) => row.id));
  const campaigns = campaignRows
    .filter((row) => accountIds.has(row.ad_account_id))
    .map((row) => ({
      id: row.external_campaign_id,
      name: row.name,
      adAccountId: row.ad_account_id,
      platform: row.platform,
      status: row.status ?? "UNKNOWN",
    }));
  const campaignBySnapshotId = new Map(campaignRows.map((row) => [row.id, row]));
  const adGroups = adGroupRows.flatMap((row) => {
    const campaign = row.campaign_snapshot_id ? campaignBySnapshotId.get(row.campaign_snapshot_id) : undefined;
    if (!campaign || campaign.ad_account_id !== row.ad_account_id || campaign.platform !== row.platform) return [];
    return [{
      id: row.external_ad_group_id,
      name: row.name,
      adAccountId: row.ad_account_id,
      campaignId: campaign.external_campaign_id,
      platform: row.platform,
      status: row.status ?? "UNKNOWN",
    }];
  });
  const campaignKeys = new Set(campaigns.map((row) => `${row.platform}:${row.adAccountId}:${row.id}`));
  const adGroupKeys = new Set(adGroups.map((row) => `${row.platform}:${row.adAccountId}:${row.campaignId}:${row.id}`));
  const adsByHierarchy = new Map<string, DashboardFilterOptions["ads"][number]>();
  for (const row of adRows) {
    const id = String(row.external_ad_id ?? "").trim();
    const campaignId = String(row.external_campaign_id ?? "").trim();
    const adGroupId = String(row.external_ad_group_id ?? "").trim();
    if (!id || !campaignId || !adGroupId) continue;
    if (!campaignKeys.has(`${row.platform}:${row.ad_account_id}:${campaignId}`)) continue;
    if (!adGroupKeys.has(`${row.platform}:${row.ad_account_id}:${campaignId}:${adGroupId}`)) continue;
    const key = `${row.platform}:${row.ad_account_id}:${campaignId}:${adGroupId}:${id}`;
    if (adsByHierarchy.has(key)) continue;
    const rawStatus = row.raw && typeof row.raw === "object"
      ? row.raw.ad_status ?? row.raw.status
      : null;
    adsByHierarchy.set(key, {
      id,
      name: String(row.ad_name ?? id),
      adAccountId: row.ad_account_id,
      campaignId,
      adGroupId,
      platform: row.platform,
      status: String(rawStatus ?? "UNKNOWN"),
    });
  }
  return {
    accounts: accountRows.map((row) => ({ id: row.id, name: row.name, platform: row.platform })),
    campaigns,
    adGroups,
    ads: [...adsByHierarchy.values()].sort((a, b) => a.name.localeCompare(b.name, "ja")),
  };
}

function dashboardHierarchyFromData(data: {
  adAccountId?: unknown;
  campaignId?: unknown;
  adGroupId?: unknown;
  adId?: unknown;
}): ResolvedDashboardHierarchyFilters {
  return {
    adAccountId: stringOrNull(data.adAccountId),
    campaignId: stringOrNull(data.campaignId),
    adGroupId: stringOrNull(data.adGroupId),
    adId: stringOrNull(data.adId),
  };
}

function stringOrNull(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

async function listMetricRows(
  workspaceId: string,
  platform: string,
  start: string,
  end: string,
  filters: DashboardHierarchyFilters = {},
) {
  const config = getSupabaseConfig();
  const queryFilters = [
    `workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    `date=gte.${start}`,
    `date=lte.${end}`,
    platform !== "all" ? `platform=eq.${encodeURIComponent(platform)}` : "",
    filters.adAccountId ? `ad_account_id=eq.${encodeURIComponent(filters.adAccountId)}` : "",
    filters.campaignId ? `external_campaign_id=eq.${encodeURIComponent(filters.campaignId)}` : "",
    filters.adGroupId ? `external_ad_group_id=eq.${encodeURIComponent(filters.adGroupId)}` : "",
    filters.adId ? `external_ad_id=eq.${encodeURIComponent(filters.adId)}` : "",
  ].filter(Boolean);
  return serviceFetch<Array<Record<string, any>>>(config, `/rest/v1/ad_daily_metrics?select=*&${queryFilters.join("&")}`);
}

async function listCampaignMetricRows(
  workspaceId: string,
  platform: string,
  start: string,
  end: string,
  filters: DashboardHierarchyFilters = {},
) {
  const rows = await listMetricRows(workspaceId, platform, start, end, filters);
  const grouped = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const key = `${row.ad_account_id ?? ""}:${row.platform}:${row.external_campaign_id ?? ""}:${row.campaign_name ?? ""}`;
    const current = grouped.get(key) ?? {
      ad_account_id: row.ad_account_id,
      platform: row.platform,
      external_campaign_id: row.external_campaign_id,
      campaign_name: row.campaign_name,
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
      revenue: 0,
    };
    current.impressions += Number(row.impressions ?? 0);
    current.clicks += Number(row.clicks ?? 0);
    current.cost += Number(row.cost ?? 0);
    current.conversions += Number(row.conversions ?? 0);
    current.revenue += Number(row.revenue ?? 0);
    grouped.set(key, current);
  }
  return [...grouped.values()].sort((a, b) => Number(b.cost) - Number(a.cost));
}

async function listCampaignSnapshots(
  workspaceId: string,
  platform: string,
  adAccountId?: string | null,
  campaignId?: string | null,
) {
  const config = getSupabaseConfig();
  const filters = [
    `workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    platform !== "all" ? `platform=eq.${encodeURIComponent(platform)}` : "",
    adAccountId ? `ad_account_id=eq.${encodeURIComponent(adAccountId)}` : "",
    campaignId ? `external_campaign_id=eq.${encodeURIComponent(campaignId)}` : "",
  ].filter(Boolean);
  return serviceFetch<Array<{ ad_account_id: string; external_campaign_id: string; status?: string | null }>>(
    config,
    `/rest/v1/campaign_snapshots?select=ad_account_id,external_campaign_id,status&${filters.join("&")}`,
  );
}

async function getDailySeries(
  workspaceId: string,
  range: number,
  platform: string,
  filters: DashboardHierarchyFilters = {},
  selectedDateRange?: { from: string; to: string } | null,
) {
  const current = selectedDateRange
    ? { start: selectedDateRange.from, end: selectedDateRange.to }
    : dateWindow(range, 0);
  const rows = await listMetricRows(workspaceId, platform, current.start, current.end, filters);
  const grouped = new Map<string, { date: string; cost: number; revenue: number; conversions: number }>();
  for (const row of rows) {
    const date = String(row.date);
    const currentRow = grouped.get(date) ?? { date: date.slice(5).replace("-", "/"), cost: 0, revenue: 0, conversions: 0 };
    currentRow.cost += Number(row.cost ?? 0);
    currentRow.revenue += Number(row.revenue ?? 0);
    currentRow.conversions += Number(row.conversions ?? 0);
    grouped.set(date, currentRow);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
}

function dateWindow(days: number, offsetDays: number) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1 - offsetDays);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - Math.max(days, 1) + 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function comparisonWindow(from: string, to: string) {
  const days = Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1);
  const end = new Date(`${from}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function totals(rows: Array<Record<string, any>>) {
  return withKpis(rows.reduce(
    (acc, row) => ({
      impressions: acc.impressions + Number(row.impressions ?? 0),
      clicks: acc.clicks + Number(row.clicks ?? 0),
      cost: acc.cost + Number(row.cost ?? 0),
      conversions: acc.conversions + Number(row.conversions ?? 0),
      revenue: acc.revenue + Number(row.revenue ?? 0),
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 },
  ));
}

function withKpis(row: Record<string, any>) {
  const impressions = Number(row.impressions ?? 0);
  const clicks = Number(row.clicks ?? 0);
  const cost = Number(row.cost ?? 0);
  const conversions = Number(row.conversions ?? 0);
  const revenue = Number(row.revenue ?? 0);
  return {
    impressions,
    clicks,
    cost,
    conversions,
    revenue,
    ctr: rate(clicks, impressions),
    cvr: rate(conversions, clicks),
    cpc: rate(cost, clicks),
    cpa: rate(cost, conversions),
    roas: rate(revenue, cost),
  };
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

function change(current: number | null, comparison: number | null) {
  if (current === null || comparison === null || comparison === 0) return null;
  return current / comparison - 1;
}

function priorityFor(cpa: number | null): "High" | "Medium" | "Low" {
  if (cpa === null) return "Low";
  if (cpa >= 12000) return "High";
  if (cpa >= 9000) return "Medium";
  return "Low";
}

function buildDbAnomalies(platform: string, changes: Record<string, number | null>) {
  const anomalies: Array<{ date: string; type: string; platform: any; severity: "High" | "Medium" | "Low"; detail: string; tags: string[] }> = [];
  if ((changes.cpa ?? 0) > 0.25) {
    anomalies.push({
      date: new Date().toISOString().slice(0, 10),
      type: "CPA悪化",
      platform,
      severity: "High",
      detail: `CPAが前期間比 ${signedPercent(changes.cpa)}。CVR/CPCの分解確認が必要です。`,
      tags: ["cpa", "cvr", "cpc"],
    });
  }
  if ((changes.conversions ?? 0) < -0.2) {
    anomalies.push({
      date: new Date().toISOString().slice(0, 10),
      type: "CV減少",
      platform,
      severity: "Medium",
      detail: `CV数が前期間比 ${signedPercent(changes.conversions)}。計測欠損と配信変化を確認してください。`,
      tags: ["conversion", "measurement"],
    });
  }
  return anomalies.length ? anomalies : [{
    date: new Date().toISOString().slice(0, 10),
    type: "検知スキップ",
    platform,
    severity: "Low",
    detail: "重要な異常は検知されていません。",
    tags: ["monitoring"],
  }];
}

function signedPercent(value: number | null) {
  if (value === null) return "-";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function sanitize(value: any): any {
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/token|secret|password|api[_-]?key|authorization|service[_-]?role/i.test(key))
        .map(([key, item]) => [key, sanitize(item)]),
    );
  }
  if (typeof value === "string" && /\beyJ[A-Za-z0-9_-]{10,}\.|AIza[A-Za-z0-9_-]{20,}|(?:sk|pk|rk)-[A-Za-z0-9_-]{10,}/.test(value)) {
    return "[REDACTED]";
  }
  return value;
}

function titleFromMessage(message: string) {
  return truncate(message.replace(/\s+/g, " ").trim(), 80);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
