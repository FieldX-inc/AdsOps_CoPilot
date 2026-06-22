import { randomBytes, createHash } from "node:crypto";

import { decryptToken, encryptToken } from "./crypto.js";
import {
  type AuthContext,
  consumeOAuthState,
  createOAuthState,
  getConnectedAdAccount,
  readPlatformConnectionTokens,
  recordAuditLog,
  upsertAdAccount,
  upsertAdGroupSnapshot,
  upsertCampaignSnapshot,
  upsertDailyMetrics,
  upsertPlatformConnection,
} from "./supabase.js";

const googleOAuthStates = new Map<string, {
  workspaceId: string;
  userId: string;
  codeVerifier: string;
  expiresAt: number;
}>();

const googleAdsScope = "https://www.googleapis.com/auth/adwords";
const googleAdsApiVersion = "v22";
const defaultGoogleAdsMaxBudgetAmount = 50_000;

type GoogleCampaignStatus = "ENABLED" | "PAUSED";
type GoogleAdsRequestOptions = {
  omitLoginCustomerId?: boolean;
  loginCustomerId?: string | null;
};

export class GoogleAdsWriteError extends Error {
  status: 400 | 503;

  constructor(message: string, status: 400 | 503 = 400) {
    super(message);
    this.status = status;
  }
}

export function buildGoogleOAuthUrl(auth: AuthContext) {
  const { url } = buildGoogleOAuthState(auth);
  return url;
}

export async function buildGoogleOAuthUrlForRedirect(auth: AuthContext) {
  const { url, state, codeVerifier, expiresAt } = buildGoogleOAuthState(auth);
  if (process.env.GOOGLE_OAUTH_STATE_STORE !== "memory") {
    await createOAuthState({
      state,
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      platform: "google",
      codeVerifier,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }
  return url;
}

function buildGoogleOAuthState(auth: AuthContext) {
  const state = randomBytes(24).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const stateRecord = {
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  googleOAuthStates.set(state, stateRecord);

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", requiredEnv("GOOGLE_ADS_CLIENT_ID"));
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", googleAdsScope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), state, codeVerifier, expiresAt: stateRecord.expiresAt };
}

export async function handleGoogleOAuthCallback(code: string | null, state: string | null) {
  if (!code || !state) throw new Error("OAuth code/stateが不足しています。");
  const saved = await loadOAuthState(state);
  googleOAuthStates.delete(state);
  if (!saved || saved.expiresAt < Date.now()) throw new Error("OAuth stateが無効または期限切れです。");

  const token = await exchangeCodeForToken(code, saved.codeVerifier);
  const accessTokenEncrypted = encryptToken(token.access_token);
  const refreshTokenEncrypted = token.refresh_token ? encryptToken(token.refresh_token) : null;
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;

  await upsertPlatformConnection({
    workspaceId: saved.workspaceId,
    userId: saved.userId,
    platform: "google",
    providerAccountId: null,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [googleAdsScope],
    expiresAt,
  });
  await recordAuditLog({
    workspaceId: saved.workspaceId,
    userId: saved.userId,
    eventType: "google_ads.oauth_connected",
    level: "info",
    payload: {
      platform: "google",
      scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [googleAdsScope],
      expiresAt,
      refreshIssued: Boolean(token.refresh_token),
    },
  });

  return { workspaceId: saved.workspaceId };
}

export async function listAccessibleGoogleCustomers(auth: AuthContext) {
  const accessToken = await readGoogleAccessToken(auth);
  return listAccessibleGoogleCustomersForToken(accessToken);
}

async function listAccessibleGoogleCustomersForToken(accessToken: string) {
  const res = await fetch(`https://googleads.googleapis.com/${googleAdsApiVersion}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": requiredEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
    },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google Ads customer list取得に失敗しました: ${redact(detail).slice(0, 240)}`);
  }
  const data = (await res.json()) as { resourceNames?: string[] };
  const accessibleCustomers = (data.resourceNames ?? []).map((resourceName) => ({
    resourceName,
    customerId: resourceName.replace("customers/", ""),
    managerCustomerId: null as string | null,
    descriptiveName: null as string | null,
    manager: null as boolean | null,
  }));
  const childCustomers = (await Promise.all(
    accessibleCustomers.map((customer) => listGoogleCustomerClients(accessToken, customer.customerId)),
  )).flat();
  return dedupeGoogleCustomers([...accessibleCustomers, ...childCustomers]);
}

async function listGoogleCustomerClients(accessToken: string, managerCustomerId: string) {
  const query = `
    SELECT
      customer_client.client_customer,
      customer_client.descriptive_name,
      customer_client.manager,
      customer_client.hidden,
      customer_client.status
    FROM customer_client
    WHERE customer_client.hidden = false
  `;
  try {
    const payload = await postGoogleAdsSearch(accessToken, managerCustomerId, query, { omitLoginCustomerId: true });
    return payload.flatMap((chunk) => chunk.results ?? []).map((item) => {
      const resourceName = String(item.customerClient?.clientCustomer ?? item.customer_client?.client_customer ?? "");
      return {
        resourceName,
        customerId: resourceName.replace("customers/", ""),
        managerCustomerId,
        descriptiveName: String(item.customerClient?.descriptiveName ?? item.customer_client?.descriptive_name ?? "") || null,
        manager: Boolean(item.customerClient?.manager ?? item.customer_client?.manager ?? false),
      };
    }).filter((customer) => customer.customerId);
  } catch {
    return [];
  }
}

function dedupeGoogleCustomers<T extends { customerId: string; managerCustomerId?: string | null }>(customers: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const customer of customers) {
    const key = `${customer.customerId}:${customer.managerCustomerId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(customer);
  }
  return result;
}

export async function connectGoogleCustomer(auth: AuthContext, customerId: string, managerCustomerId?: string | null) {
  const normalized = normalizeCustomerId(customerId);
  if (!normalized) throw new Error("customerIdが不正です。");
  const normalizedManagerCustomerId = normalizeCustomerId(managerCustomerId ?? "");
  const account = await upsertAdAccount({
    workspaceId: auth.workspace.id,
    platform: "google",
    externalAccountId: normalized,
    name: normalizedManagerCustomerId ? `Google Ads ${normalized} (MCC ${normalizedManagerCustomerId})` : `Google Ads ${normalized}`,
    status: "connected",
  });
  return { customerId: normalized, managerCustomerId: normalizedManagerCustomerId || null, adAccountId: account.id };
}

export async function syncGoogleCustomer(auth: AuthContext, customerId: string, days = 30, options: { managerCustomerId?: string | null } = {}) {
  const normalized = normalizeCustomerId(customerId);
  if (!normalized) throw new Error("customerIdが不正です。");
  const normalizedManagerCustomerId = normalizeCustomerId(options.managerCustomerId ?? "");
  const accessToken = await readGoogleAccessToken(auth);

  const account = await upsertAdAccount({
    workspaceId: auth.workspace.id,
    platform: "google",
    externalAccountId: normalized,
    name: normalizedManagerCustomerId ? `Google Ads ${normalized} (MCC ${normalizedManagerCustomerId})` : `Google Ads ${normalized}`,
    status: "connected",
  });
  const loginCustomerIds = await resolveGoogleAdsLoginCustomerIds(accessToken, normalized, normalizedManagerCustomerId);
  const { rows, loginCustomerId } = await fetchGoogleAdGroupMetricsWithLoginFallback(accessToken, normalized, days, loginCustomerIds);
  const campaignIds = new Map<string, string>();
  for (const row of rows) {
    const campaign = await upsertCampaignSnapshot({
      workspaceId: auth.workspace.id,
      adAccountId: account.id,
      platform: "google",
      externalCampaignId: row.campaignId,
      name: row.campaignName,
      status: row.campaignStatus,
      raw: { source: "google_ads_sync" },
    });
    campaignIds.set(row.campaignId, campaign.id);
  }
  for (const row of rows) {
    await upsertAdGroupSnapshot({
      workspaceId: auth.workspace.id,
      adAccountId: account.id,
      campaignSnapshotId: campaignIds.get(row.campaignId) ?? null,
      platform: "google",
      externalAdGroupId: row.adGroupId,
      name: row.adGroupName,
      status: row.adGroupStatus,
      raw: { source: "google_ads_sync" },
    });
  }
  await upsertDailyMetrics(rows.map((row) => ({
    workspaceId: auth.workspace.id,
    adAccountId: account.id,
    platform: "google",
    date: row.date,
    externalCampaignId: row.campaignId,
    campaignName: row.campaignName,
    externalAdGroupId: row.adGroupId,
    adGroupName: row.adGroupName,
    impressions: row.impressions,
    clicks: row.clicks,
    cost: row.cost,
    conversions: row.conversions,
    revenue: row.revenue,
    raw: { source: "google_ads_sync" },
  })));
  return {
    customerId: normalized,
    managerCustomerId: normalizedManagerCustomerId || null,
    loginCustomerId,
    adAccountId: account.id,
    rowsSynced: rows.length,
    campaignCount: new Set(rows.map((row) => row.campaignId)).size,
    adGroupCount: new Set(rows.map((row) => row.adGroupId)).size,
  };
}

async function resolveGoogleAdsLoginCustomerIds(accessToken: string, customerId: string, preferredManagerCustomerId: string) {
  const candidates: Array<string | null> = [];
  if (preferredManagerCustomerId) candidates.push(preferredManagerCustomerId);
  try {
    const customers = await listAccessibleGoogleCustomersForToken(accessToken);
    for (const customer of customers) {
      if (normalizeCustomerId(customer.customerId) !== customerId) continue;
      const managerCustomerId = normalizeCustomerId(customer.managerCustomerId ?? "");
      candidates.push(managerCustomerId || null);
    }
  } catch {
    // Sync can still work with the selected candidate even if discovery is temporarily unavailable.
  }
  candidates.push(null);
  return dedupeLoginCustomerIds(candidates);
}

function dedupeLoginCustomerIds(customerIds: Array<string | null>) {
  const seen = new Set<string>();
  const result: Array<string | null> = [];
  for (const customerId of customerIds) {
    const key = customerId ?? "direct";
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(customerId);
  }
  return result;
}

async function fetchGoogleAdGroupMetricsWithLoginFallback(
  accessToken: string,
  customerId: string,
  days: number,
  loginCustomerIds: Array<string | null>,
) {
  let lastPermissionError: unknown = null;
  for (const loginCustomerId of loginCustomerIds) {
    try {
      const rows = await fetchGoogleAdGroupMetrics(accessToken, customerId, days, { loginCustomerId });
      return { rows, loginCustomerId };
    } catch (error) {
      if (!isGoogleAdsPermissionError(error)) throw error;
      lastPermissionError = error;
    }
  }
  throw lastPermissionError ?? new Error("Google Ads metrics取得に失敗しました。");
}

export function isGoogleAdsWriteConfigured() {
  return process.env.GOOGLE_ADS_WRITE_ENABLED === "true";
}

export async function updateGoogleCampaignStatus(input: {
  auth: AuthContext;
  customerId: string;
  campaignId: string;
  status: GoogleCampaignStatus;
  confirmed: boolean;
  approvalNote: string;
}) {
  const customerId = requireNormalizedCustomerId(input.customerId);
  const campaignId = requireGoogleEntityId(input.campaignId, "campaignId");
  if (!input.confirmed) throw new GoogleAdsWriteError("confirmed=true が必要です。");
  assertGoogleAdsWriteEnabled();
  await assertConnectedGoogleAdAccount(input.auth.workspace.id, customerId);

  const accessToken = await readGoogleAccessToken(input.auth);
  const operation = {
    update: {
      resourceName: `customers/${customerId}/campaigns/${campaignId}`,
      status: input.status,
    },
    updateMask: "status",
  };
  let result: unknown;
  const approvalAudit = googleAdsApprovalAuditPayload(input);
  try {
    result = await postGoogleAdsMutate(accessToken, customerId, "campaigns:mutate", { operations: [operation] });
  } catch (error) {
    await recordGoogleAdsWriteFailure({
      auth: input.auth,
      eventType: "google_ads.campaign_status_update_failed",
      payload: {
        customerId,
        campaignId,
        status: input.status,
        approvalNote: input.approvalNote,
        ...approvalAudit,
        platform: "google",
        error: errorMessage(error),
      },
    });
    throw error;
  }
  await recordAuditLog({
    workspaceId: input.auth.workspace.id,
    userId: input.auth.user.id,
    eventType: "google_ads.campaign_status_updated",
    level: "info",
    payload: {
      customerId,
      campaignId,
      status: input.status,
      approvalNote: input.approvalNote,
      ...approvalAudit,
      platform: "google",
    },
  });
  return { customerId, campaignId, status: input.status, result };
}

export async function updateGoogleCampaignBudget(input: {
  auth: AuthContext;
  customerId: string;
  campaignId: string;
  amount: number;
  confirmed: boolean;
  approvalNote: string;
}) {
  const customerId = requireNormalizedCustomerId(input.customerId);
  const campaignId = requireGoogleEntityId(input.campaignId, "campaignId");
  if (!input.confirmed) throw new GoogleAdsWriteError("confirmed=true が必要です。");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new GoogleAdsWriteError("amount は正の数で指定してください。");
  const maxBudgetAmount = googleAdsMaxBudgetAmount();
  if (input.amount > maxBudgetAmount) {
    throw new GoogleAdsWriteError(`amount は GOOGLE_ADS_MAX_BUDGET_AMOUNT (${maxBudgetAmount}) 以下で指定してください。`);
  }
  assertGoogleAdsWriteEnabled();
  await assertConnectedGoogleAdAccount(input.auth.workspace.id, customerId);

  const accessToken = await readGoogleAccessToken(input.auth);
  const approvalAudit = googleAdsApprovalAuditPayload(input);
  let campaignBudgetResourceName: string;
  try {
    campaignBudgetResourceName = await fetchCampaignBudgetResourceName(accessToken, customerId, campaignId);
  } catch (error) {
    await recordGoogleAdsWriteFailure({
      auth: input.auth,
      eventType: "google_ads.campaign_budget_update_failed",
      payload: {
        customerId,
        campaignId,
        amount: input.amount,
        approvalNote: input.approvalNote,
        ...approvalAudit,
        platform: "google",
        stage: "budget_lookup",
        error: errorMessage(error),
      },
    });
    throw error;
  }
  const operation = {
    update: {
      resourceName: campaignBudgetResourceName,
      amountMicros: Math.round(input.amount * 1_000_000),
    },
    updateMask: "amount_micros",
  };
  let result: unknown;
  try {
    result = await postGoogleAdsMutate(accessToken, customerId, "campaignBudgets:mutate", { operations: [operation] });
  } catch (error) {
    await recordGoogleAdsWriteFailure({
      auth: input.auth,
      eventType: "google_ads.campaign_budget_update_failed",
      payload: {
        customerId,
        campaignId,
        campaignBudgetResourceName,
        amount: input.amount,
        approvalNote: input.approvalNote,
        ...approvalAudit,
        platform: "google",
        stage: "mutate",
        error: errorMessage(error),
      },
    });
    throw error;
  }
  await recordAuditLog({
    workspaceId: input.auth.workspace.id,
    userId: input.auth.user.id,
    eventType: "google_ads.campaign_budget_updated",
    level: "info",
    payload: {
      customerId,
      campaignId,
      campaignBudgetResourceName,
      amount: input.amount,
      approvalNote: input.approvalNote,
      ...approvalAudit,
      platform: "google",
    },
  });
  return { customerId, campaignId, campaignBudgetResourceName, amount: input.amount, result };
}

function googleAdsApprovalAuditPayload(input: { auth: AuthContext; confirmed: boolean }) {
  return {
    confirmed: input.confirmed,
    approvalType: "explicit_user_confirmation",
    approvedByUserId: input.auth.user.id,
    approvedAt: new Date().toISOString(),
  };
}

async function recordGoogleAdsWriteFailure(input: {
  auth: AuthContext;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  try {
    await recordAuditLog({
      workspaceId: input.auth.workspace.id,
      userId: input.auth.user.id,
      eventType: input.eventType,
      level: "error",
      payload: input.payload,
    });
  } catch {
    // Preserve the provider failure as the primary error; audit persistence is best-effort.
  }
}

async function assertConnectedGoogleAdAccount(workspaceId: string, customerId: string) {
  const account = await getConnectedAdAccount(workspaceId, "google", customerId);
  if (!account) {
    throw new GoogleAdsWriteError("Google Ads customer is not connected to this workspace. Connect the customer before write execution.");
  }
}

async function loadOAuthState(state: string) {
  if (process.env.GOOGLE_OAUTH_STATE_STORE !== "memory") {
    try {
      const row = await consumeOAuthState(state, "google");
      if (row) {
        return {
          workspaceId: row.workspace_id,
          userId: row.user_id,
          codeVerifier: row.code_verifier,
          expiresAt: new Date(row.expires_at).getTime(),
        };
      }
    } catch {
      // Fall back to memory for local smoke tests and old migrations.
    }
  }
  return googleOAuthStates.get(state) ?? null;
}

type GoogleMetricRow = {
  date: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string | null;
  adGroupId: string;
  adGroupName: string;
  adGroupStatus: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  revenue: number;
};

async function fetchGoogleAdGroupMetrics(accessToken: string, customerId: string, days: number, options: GoogleAdsRequestOptions = {}): Promise<GoogleMetricRow[]> {
  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      campaign.status,
      ad_group.id,
      ad_group.name,
      ad_group.status,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM ad_group
    WHERE segments.date DURING LAST_${Math.min(Math.max(days, 7), 30)}_DAYS
  `;
  const res = await fetch(`https://googleads.googleapis.com/${googleAdsApiVersion}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: googleAdsHeaders(accessToken, options),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google Ads metrics取得に失敗しました: ${googleAdsErrorSummary(detail)}`);
  }
  const payload = (await res.json()) as Array<{ results?: any[] }>;
  return payload.flatMap((chunk) => chunk.results ?? []).map((item) => ({
    date: String(item.segments?.date ?? ""),
    campaignId: String(item.campaign?.id ?? ""),
    campaignName: String(item.campaign?.name ?? "Campaign"),
    campaignStatus: item.campaign?.status ?? null,
    adGroupId: String(item.adGroup?.id ?? ""),
    adGroupName: String(item.adGroup?.name ?? "Ad group"),
    adGroupStatus: item.adGroup?.status ?? null,
    impressions: Number(item.metrics?.impressions ?? 0),
    clicks: Number(item.metrics?.clicks ?? 0),
    cost: Number(item.metrics?.costMicros ?? item.metrics?.cost_micros ?? 0) / 1_000_000,
    conversions: Number(item.metrics?.conversions ?? 0),
    revenue: Number(item.metrics?.conversionsValue ?? item.metrics?.conversions_value ?? 0),
  })).filter((row) => row.date && row.campaignId && row.adGroupId);
}

async function fetchCampaignBudgetResourceName(accessToken: string, customerId: string, campaignId: string) {
  const query = `
    SELECT
      campaign.id,
      campaign.campaign_budget
    FROM campaign
    WHERE campaign.id = ${campaignId}
    LIMIT 1
  `;
  const payload = await postGoogleAdsSearch(accessToken, customerId, query);
  const budget = payload.flatMap((chunk) => chunk.results ?? [])[0]?.campaign?.campaignBudget;
  if (!budget) throw new Error("対象campaignのbudget resourceを取得できませんでした。");
  return String(budget);
}

async function postGoogleAdsSearch(accessToken: string, customerId: string, query: string, options: GoogleAdsRequestOptions = {}) {
  const res = await fetch(`https://googleads.googleapis.com/${googleAdsApiVersion}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: googleAdsHeaders(accessToken, options),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google Ads queryに失敗しました: ${redact(detail).slice(0, 240)}`);
  }
  return (await res.json()) as Array<{ results?: any[] }>;
}

async function postGoogleAdsMutate(accessToken: string, customerId: string, path: string, body: Record<string, unknown>) {
  const res = await fetch(`https://googleads.googleapis.com/${googleAdsApiVersion}/customers/${customerId}/${path}`, {
    method: "POST",
    headers: googleAdsHeaders(accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google Ads writeに失敗しました: ${redact(detail).slice(0, 240)}`);
  }
  return (await res.json()) as unknown;
}

async function readGoogleAccessToken(auth: AuthContext) {
  const connection = await readPlatformConnectionTokens(auth.workspace.id, auth.user.id, "google");
  if (!connection?.access_token_encrypted) throw new Error("Google Ads連携が見つかりません。先にOAuth連携してください。");
  if (!googleAccessTokenNeedsRefresh(connection.expires_at)) return decryptToken(connection.access_token_encrypted);
  if (!connection.refresh_token_encrypted) throw new Error("Google Ads access tokenが期限切れです。再度OAuth連携してください。");

  const token = await refreshGoogleAccessToken(decryptToken(connection.refresh_token_encrypted));
  const accessTokenEncrypted = encryptToken(token.access_token);
  const refreshTokenEncrypted = token.refresh_token ? encryptToken(token.refresh_token) : connection.refresh_token_encrypted;
  await upsertPlatformConnection({
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
    platform: "google",
    providerAccountId: null,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    scopes: token.scope?.split(/\s+/).filter(Boolean) ?? connection.scopes ?? [googleAdsScope],
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : connection.expires_at,
  });
  await recordAuditLog({
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
    eventType: "google_ads.oauth_token_refreshed",
    level: "info",
    payload: {
      platform: "google",
      scopes: token.scope?.split(/\s+/).filter(Boolean) ?? connection.scopes ?? [googleAdsScope],
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : connection.expires_at,
    },
  });
  return token.access_token;
}

function googleAccessTokenNeedsRefresh(expiresAt: string | null | undefined) {
  if (!expiresAt) return false;
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs - Date.now() < 5 * 60 * 1000;
}

function googleAdsHeaders(accessToken: string, options: GoogleAdsRequestOptions = {}) {
  const loginCustomerId = options.omitLoginCustomerId
    ? ""
    : normalizeCustomerId(options.loginCustomerId ?? process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "");
  return {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": requiredEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
    "Content-Type": "application/json",
    ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
  };
}

function isGoogleAdsPermissionError(error: unknown) {
  const message = errorMessage(error);
  return /\b403\b|PERMISSION_DENIED|does not have permission/i.test(message);
}

function googleAdsErrorSummary(detail: string) {
  const redactedDetail = redact(detail);
  try {
    const parsed = JSON.parse(detail) as {
      error?: {
        code?: number;
        message?: string;
        status?: string;
        details?: Array<{ errors?: Array<{ errorCode?: Record<string, string>; message?: string }> }>;
      };
    };
    const error = parsed.error;
    const googleAdsErrors = error?.details?.flatMap((item) => item.errors ?? []) ?? [];
    const errorCodes = googleAdsErrors
      .map((item) => item.errorCode ? Object.entries(item.errorCode).map(([key, value]) => `${key}.${value}`).join(",") : "")
      .filter(Boolean);
    const errorMessages = googleAdsErrors.map((item) => item.message).filter(Boolean);
    const summary = [
      error?.code ? `code=${error.code}` : "",
      error?.status ? `status=${error.status}` : "",
      error?.message ? `message=${error.message}` : "",
      errorCodes.length ? `googleAdsErrorCode=${errorCodes.join(";")}` : "",
      errorMessages.length ? `googleAdsErrorMessage=${errorMessages.join(";")}` : "",
    ].filter(Boolean).join(" / ");
    return redact(summary).slice(0, 1200) || redactedDetail.slice(0, 1200);
  } catch {
    return redactedDetail.slice(0, 1200);
  }
}

function assertGoogleAdsWriteEnabled() {
  if (!isGoogleAdsWriteConfigured()) {
    throw new GoogleAdsWriteError("Google Ads writeは無効です。GOOGLE_ADS_WRITE_ENABLED=true を設定してから実行してください。", 503);
  }
}

function googleAdsMaxBudgetAmount() {
  const raw = process.env.GOOGLE_ADS_MAX_BUDGET_AMOUNT;
  if (!raw) return defaultGoogleAdsMaxBudgetAmount;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new GoogleAdsWriteError("GOOGLE_ADS_MAX_BUDGET_AMOUNT は正の数で指定してください。");
  return value;
}

async function exchangeCodeForToken(code: string, codeVerifier: string) {
  const params = new URLSearchParams({
    code,
    client_id: requiredEnv("GOOGLE_ADS_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_ADS_CLIENT_SECRET"),
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google OAuth token exchangeに失敗しました: ${redact(detail).slice(0, 240)}`);
  }
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const params = new URLSearchParams({
    client_id: requiredEnv("GOOGLE_ADS_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_ADS_CLIENT_SECRET"),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google OAuth token refreshに失敗しました: ${redact(detail).slice(0, 240)}`);
  }
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
}

function googleRedirectUri() {
  return process.env.GOOGLE_ADS_REDIRECT_URI || "http://localhost:8787/oauth/google/callback";
}

function requiredEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function normalizeCustomerId(value: string | undefined | null) {
  return String(value ?? "").replace(/^customers\//, "").replace(/-/g, "").trim();
}

function requireNormalizedCustomerId(value: string | undefined | null) {
  const normalized = normalizeCustomerId(value);
  if (!/^\d+$/.test(normalized)) throw new Error("customerIdが不正です。");
  return normalized;
}

function requireGoogleEntityId(value: string | undefined | null, label: string) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`${label}が不正です。`);
  return normalized;
}

function redact(value: string) {
  return value
    .replace(/\b(access_token|refresh_token|client_secret)\s*[:=]\s*["']?[^"',\s\n]+/gi, "$1=[REDACTED]")
    .replace(/\bAuthorization\s*:?\s*Bearer\s+[^"',\s\n]+/gi, "Authorization=[REDACTED]")
    .replace(/\bdeveloper-token\s*[:=]\s*["']?[^"',\s\n]+/gi, "developer-token=[REDACTED]");
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redact(message).slice(0, 400);
}
