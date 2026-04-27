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

export type AuthContext = {
  token: string;
  user: SupabaseUser;
  workspace: Workspace;
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

export async function readEncryptedAccessToken(workspaceId: string, userId: string, platform: "google" | "meta" | "yahoo") {
  const config = getSupabaseConfig();
  const rows = await serviceFetch<Array<{ access_token_encrypted: string }>>(
    config,
    `/rest/v1/ad_platform_connections?select=access_token_encrypted&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(userId)}&platform=eq.${platform}&status=eq.connected&limit=1`,
  );
  return rows[0]?.access_token_encrypted ?? null;
}

async function serviceFetch<T>(config: SupabaseConfig, path: string, init: RequestInit = {}): Promise<T> {
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
