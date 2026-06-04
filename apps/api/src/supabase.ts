type SupabaseUser = {
  id: string;
  email?: string;
};

type Workspace = {
  id: string;
  name: string;
  role: string;
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
  status: string;
  current_period_end?: string | null;
  cancel_at_period_end: boolean;
  raw: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type SupabaseConfig = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

export class AuthError extends Error {
  status: 401 | 403 | 500;

  constructor(message: string, status: 401 | 403 | 500 = 401) {
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
  const existing = await serviceFetch<Array<{ workspace_id: string; role: string; workspaces?: { name?: string } }>>(
    config,
    `/rest/v1/workspace_members?select=workspace_id,role,workspaces(name)&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
  );
  const membership = existing[0];
  if (membership) {
    return {
      id: membership.workspace_id,
      name: membership.workspaces?.name ?? "Workspace",
      role: membership.role,
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
    body: JSON.stringify({ workspace_id: workspace.id, user_id: user.id, role: "owner" }),
  });

  return { id: workspace.id, name: workspace.name, role: "owner" };
}

export async function assertWorkspaceMembership(request: Request, workspaceId: string | undefined, auth?: AuthContext) {
  const context = auth ?? (await authenticateRequest(request));
  if (!workspaceId || workspaceId === context.workspace.id) return context;

  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<{ role: string }>>(
    config,
    `/rest/v1/workspace_members?select=role&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(context.user.id)}&limit=1`,
  );
  if (!rows[0]) throw new AuthError("指定workspaceへのアクセス権がありません。", 403);
  return {
    ...context,
    workspace: { id: workspaceId, name: context.workspace.name, role: rows[0].role },
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
      missing_fields: ["goal", "product", "audience", "budget", "platforms", "measurement"],
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

export async function getDashboardDataFromDb(workspaceId: string, range: number, platform: string) {
  const accounts = await listAdAccounts(workspaceId, platform);
  if (accounts.length === 0) return null;
  const latestAdData = await getLatestAdDataFromDb(workspaceId, range, platform);
  if (!latestAdData) return null;
  const series = await getDailySeries(workspaceId, range, platform);
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
      platform: account.platform,
      name: account.name,
      status: account.status === "removed" ? "pending" : "connected",
      lastFetchedAt: account.updated_at ?? account.created_at,
    })),
    mode: "production",
  };
}

export async function getLatestAdDataFromDb(workspaceId: string, range: number, platform: string) {
  const current = dateWindow(range, 0);
  const comparison = dateWindow(range, range);
  const [currentRows, comparisonRows, campaignRows] = await Promise.all([
    listMetricRows(workspaceId, platform, current.start, current.end),
    listMetricRows(workspaceId, platform, comparison.start, comparison.end),
    listCampaignMetricRows(workspaceId, platform, current.start, current.end),
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
    return {
      campaignId: String(row.external_campaign_id ?? ""),
      campaign: String(row.campaign_name ?? "Campaign"),
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
    platform,
    current: { label: `直近${range}日`, totals: currentTotals },
    comparison: { label: `前${range}日`, totals: comparisonTotals },
    changes,
    campaigns,
    anomalies,
    relatedTags: [...new Set(anomalies.flatMap((anomaly) => anomaly.tags))],
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
  const rows = await serviceFetch<Array<{ id: string; status?: string | null }>>(
    config,
    `/rest/v1/ad_accounts?select=id,status&workspace_id=eq.${encodeURIComponent(workspaceId)}&platform=eq.${encodeURIComponent(platform)}&external_account_id=eq.${encodeURIComponent(externalAccountId)}&limit=1`,
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
        status: input.status,
        current_period_end: input.currentPeriodEnd ?? null,
        cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
        raw: sanitize(input.raw ?? {}),
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
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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
  return serviceFetch<Array<{ id: string; platform: "google" | "meta" | "yahoo"; name: string; status?: string | null; created_at: string; updated_at: string }>>(
    config,
    `/rest/v1/ad_accounts?select=id,platform,name,status,created_at,updated_at&${filters.join("&")}`,
  );
}

async function listMetricRows(workspaceId: string, platform: string, start: string, end: string) {
  const config = getSupabaseConfig();
  const filters = [
    `workspace_id=eq.${encodeURIComponent(workspaceId)}`,
    `date=gte.${start}`,
    `date=lte.${end}`,
    platform !== "all" ? `platform=eq.${encodeURIComponent(platform)}` : "",
  ].filter(Boolean);
  return serviceFetch<Array<Record<string, any>>>(config, `/rest/v1/ad_daily_metrics?select=*&${filters.join("&")}`);
}

async function listCampaignMetricRows(workspaceId: string, platform: string, start: string, end: string) {
  const rows = await listMetricRows(workspaceId, platform, start, end);
  const grouped = new Map<string, Record<string, any>>();
  for (const row of rows) {
    const key = `${row.platform}:${row.external_campaign_id ?? ""}:${row.campaign_name ?? ""}`;
    const current = grouped.get(key) ?? {
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

async function getDailySeries(workspaceId: string, range: number, platform: string) {
  const current = dateWindow(range, 0);
  const rows = await listMetricRows(workspaceId, platform, current.start, current.end);
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
