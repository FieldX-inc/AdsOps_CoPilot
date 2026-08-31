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
const googleAdsApiRelease = process.env.GOOGLE_ADS_API_VERSION?.trim() || "v24.2";
const googleAdsRestApiVersion = normalizeGoogleAdsRestVersion(googleAdsApiRelease);
const defaultGoogleAdsMaxBudgetAmount = 50_000;

type GoogleCampaignStatus = "ENABLED" | "PAUSED";
type GoogleAdsRequestOptions = {
  omitLoginCustomerId?: boolean;
  loginCustomerId?: string | null;
};

export class GoogleAdsWriteError extends Error {
  status: 400 | 409 | 503;

  constructor(message: string, status: 400 | 409 | 503 = 400) {
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
  const res = await fetch(`https://googleads.googleapis.com/${googleAdsRestApiVersion}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": requiredEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
    },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google Ads customer list取得に失敗しました: ${googleAdsErrorSummary(detail)}`);
  }
  const data = (await res.json()) as { resourceNames?: string[] };
  const accessibleCustomers = await Promise.all(
    (data.resourceNames ?? []).map(async (resourceName) => {
      const customerId = resourceName.replace("customers/", "");
      const detail = await fetchGoogleCustomerDetail(accessToken, customerId);
      return {
        resourceName,
        customerId,
        managerCustomerId: null as string | null,
        descriptiveName: detail.descriptiveName,
        manager: detail.manager,
      };
    }),
  );
  const childCustomers = (await Promise.all(
    accessibleCustomers.map((customer) => listGoogleCustomerClients(accessToken, customer.customerId)),
  )).flat();
  return dedupeGoogleCustomers([...accessibleCustomers, ...childCustomers]);
}

async function fetchGoogleCustomerDetail(accessToken: string, customerId: string) {
  const query = `
    SELECT
      customer.id,
      customer.descriptive_name,
      customer.manager,
      customer.currency_code,
      customer.time_zone
    FROM customer
    LIMIT 1
  `;
  try {
    const payload = await postGoogleAdsSearch(accessToken, customerId, query, { omitLoginCustomerId: true });
    const customer = payload.flatMap((chunk) => chunk.results ?? [])[0]?.customer;
    return {
      descriptiveName: String(customer?.descriptiveName ?? customer?.descriptive_name ?? "") || null,
      manager: Boolean(customer?.manager ?? false),
      currency: String(customer?.currencyCode ?? customer?.currency_code ?? "") || null,
      timezone: String(customer?.timeZone ?? customer?.time_zone ?? "") || null,
    };
  } catch {
    return { descriptiveName: null, manager: null as boolean | null, currency: null, timezone: null };
  }
}

async function listGoogleCustomerClients(accessToken: string, managerCustomerId: string) {
  const query = `
    SELECT
      customer_client.client_customer,
      customer_client.descriptive_name,
      customer_client.manager,
      customer_client.level,
      customer_client.hidden,
      customer_client.status
    FROM customer_client
    WHERE customer_client.hidden = false
  `;
  try {
    const payload = await postGoogleAdsSearch(accessToken, managerCustomerId, query, { omitLoginCustomerId: true });
    return payload.flatMap((chunk) => chunk.results ?? []).map((item) => {
      const resourceName = String(item.customerClient?.clientCustomer ?? item.customer_client?.client_customer ?? "");
      const level = Number(item.customerClient?.level ?? item.customer_client?.level ?? 0);
      return {
        resourceName,
        customerId: resourceName.replace("customers/", ""),
        managerCustomerId,
        descriptiveName: String(item.customerClient?.descriptiveName ?? item.customer_client?.descriptive_name ?? "") || null,
        manager: Boolean(item.customerClient?.manager ?? item.customer_client?.manager ?? false),
        level,
      };
    }).filter((customer) => customer.customerId && customer.level > 0 && customer.customerId !== managerCustomerId);
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
  const accessToken = await readGoogleAccessToken(auth);
  const customerDetail = await fetchGoogleCustomerDetail(accessToken, normalized);
  if (customerDetail.manager) {
    throw new GoogleAdsWriteError(
      "MCC（管理者アカウント）は広告アカウント上限へ算入せず、接続対象にもできません。MCC配下のクライアント広告アカウントを選んでください。",
      409,
    );
  }
  const account = await upsertAdAccount({
    workspaceId: auth.workspace.id,
    platform: "google",
    externalAccountId: normalized,
    managerCustomerId: normalizedManagerCustomerId || null,
    name: customerDetail.descriptiveName
      ? customerDetail.descriptiveName
      : normalizedManagerCustomerId ? `Google Ads ${normalized} (MCC ${normalizedManagerCustomerId})` : `Google Ads ${normalized}`,
    currency: customerDetail.currency,
    timezone: customerDetail.timezone,
    status: "connected",
  });
  return { customerId: normalized, managerCustomerId: normalizedManagerCustomerId || null, adAccountId: account.id };
}

export async function syncGoogleCustomer(auth: AuthContext, customerId: string, days = 30, options: { managerCustomerId?: string | null } = {}) {
  const normalized = normalizeCustomerId(customerId);
  if (!normalized) throw new Error("customerIdが不正です。");
  const normalizedManagerCustomerId = normalizeCustomerId(options.managerCustomerId ?? "");
  const accessToken = await readGoogleAccessToken(auth);
  const customerDetail = await fetchGoogleCustomerDetail(accessToken, normalized);
  if (customerDetail.manager) {
    throw new Error("MCC（管理者アカウント）は指標同期できません。アカウント一覧からMCC配下のクライアント広告アカウントを選んで同期してください。");
  }

  const account = await upsertAdAccount({
    workspaceId: auth.workspace.id,
    platform: "google",
    externalAccountId: normalized,
    managerCustomerId: normalizedManagerCustomerId || null,
    name: customerDetail.descriptiveName
      ? customerDetail.descriptiveName
      : normalizedManagerCustomerId ? `Google Ads ${normalized} (MCC ${normalizedManagerCustomerId})` : `Google Ads ${normalized}`,
    currency: customerDetail.currency,
    timezone: customerDetail.timezone,
    status: "connected",
  });
  const loginCustomerIds = await resolveGoogleAdsLoginCustomerIds(accessToken, normalized, normalizedManagerCustomerId);
  const { rows, loginCustomerId } = await fetchGoogleAdGroupMetricsWithLoginFallback(accessToken, normalized, days, loginCustomerIds);
  if ((loginCustomerId ?? null) !== (normalizedManagerCustomerId || null)) {
    await upsertAdAccount({
      workspaceId: auth.workspace.id,
      platform: "google",
      externalAccountId: normalized,
      managerCustomerId: loginCustomerId,
      name: customerDetail.descriptiveName
        ? customerDetail.descriptiveName
        : loginCustomerId ? `Google Ads ${normalized} (MCC ${loginCustomerId})` : `Google Ads ${normalized}`,
      currency: customerDetail.currency,
      timezone: customerDetail.timezone,
      status: "connected",
    });
  }
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
    managerCustomerId: loginCustomerId,
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
  expectedCurrentStatus: GoogleCampaignStatus;
  confirmed: boolean;
  approvalNote: string;
  rollbackAuditId?: string | null;
}) {
  const customerId = requireNormalizedCustomerId(input.customerId);
  const campaignId = requireGoogleEntityId(input.campaignId, "campaignId");
  if (!input.confirmed) throw new GoogleAdsWriteError("confirmed=true が必要です。");
  assertGoogleAdsWriteEnabled();
  const account = await assertConnectedGoogleAdAccount(input.auth.workspace.id, customerId);
  const requestOptions = googleAdsRequestOptionsForAccount(account);

  const accessToken = await readGoogleAccessToken(input.auth);
  const before = await fetchGoogleCampaignLiveState(accessToken, customerId, campaignId, requestOptions);
  if (before.status !== input.expectedCurrentStatus) {
    await recordGoogleAdsWriteConflict(input.auth, "campaign_status", customerId, campaignId, input.expectedCurrentStatus, before.status);
    throw new GoogleAdsWriteError("実行直前のcampaign statusが確認時点から変更されています。再度previewを確認してください。", 409);
  }
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
    result = await postGoogleAdsMutate(accessToken, customerId, "campaigns:mutate", { operations: [operation] }, requestOptions);
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
  const audit = await recordAuditLog({
    workspaceId: input.auth.workspace.id,
    userId: input.auth.user.id,
    eventType: "google_ads.campaign_status_updated",
    level: "info",
    payload: {
      customerId,
      campaignId,
      before: { status: before.status },
      after: { status: input.status },
      status: input.status,
      approvalNote: input.approvalNote,
      rollbackOfAuditId: input.rollbackAuditId ?? null,
      ...approvalAudit,
      platform: "google",
    },
  });
  return {
    customerId,
    campaignId,
    before: { status: before.status },
    after: { status: input.status },
    status: input.status,
    auditId: audit?.id ?? null,
    rollback: { operation: "campaign_status", expectedCurrentStatus: input.status, status: before.status },
    result,
  };
}

export async function updateGoogleCampaignBudget(input: {
  auth: AuthContext;
  customerId: string;
  campaignId: string;
  amount: number;
  expectedCurrentAmount: number;
  confirmed: boolean;
  approvalNote: string;
  rollbackAuditId?: string | null;
}) {
  const customerId = requireNormalizedCustomerId(input.customerId);
  const campaignId = requireGoogleEntityId(input.campaignId, "campaignId");
  if (!input.confirmed) throw new GoogleAdsWriteError("confirmed=true が必要です。");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new GoogleAdsWriteError("amount は正の数で指定してください。");
  if (!Number.isFinite(input.expectedCurrentAmount) || input.expectedCurrentAmount <= 0) {
    throw new GoogleAdsWriteError("expectedCurrentAmount は正の数で指定してください。");
  }
  const maxBudgetAmount = googleAdsMaxBudgetAmount();
  if (input.amount > maxBudgetAmount) {
    throw new GoogleAdsWriteError(`amount は GOOGLE_ADS_MAX_BUDGET_AMOUNT (${maxBudgetAmount}) 以下で指定してください。`);
  }
  assertGoogleAdsWriteEnabled();
  const account = await assertConnectedGoogleAdAccount(input.auth.workspace.id, customerId);
  const requestOptions = googleAdsRequestOptionsForAccount(account);

  const accessToken = await readGoogleAccessToken(input.auth);
  const approvalAudit = googleAdsApprovalAuditPayload(input);
  let campaignBudgetResourceName: string;
  let before: Awaited<ReturnType<typeof fetchGoogleCampaignLiveState>>;
  try {
    before = await fetchGoogleCampaignLiveState(accessToken, customerId, campaignId, requestOptions);
    campaignBudgetResourceName = before.budgetResourceName;
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
  if (before.budgetExplicitlyShared) {
    await recordGoogleAdsWriteFailure({
      auth: input.auth,
      eventType: "google_ads.shared_campaign_budget_rejected",
      payload: { platform: "google", customerId, campaignId, campaignBudgetResourceName },
    });
    throw new GoogleAdsWriteError("共有予算は複数campaignへ影響するため、この承認付きrouteでは変更できません。", 409);
  }
  if (Math.round((before.budgetAmount ?? 0) * 1_000_000) !== Math.round(input.expectedCurrentAmount * 1_000_000)) {
    await recordGoogleAdsWriteConflict(input.auth, "campaign_budget", customerId, campaignId, input.expectedCurrentAmount, before.budgetAmount);
    throw new GoogleAdsWriteError("実行直前のbudgetが確認時点から変更されています。再度previewを確認してください。", 409);
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
    result = await postGoogleAdsMutate(accessToken, customerId, "campaignBudgets:mutate", { operations: [operation] }, requestOptions);
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
  const audit = await recordAuditLog({
    workspaceId: input.auth.workspace.id,
    userId: input.auth.user.id,
    eventType: "google_ads.campaign_budget_updated",
    level: "info",
    payload: {
      customerId,
      campaignId,
      campaignBudgetResourceName,
      before: { amount: before.budgetAmount, currency: before.currency },
      after: { amount: input.amount, currency: before.currency },
      amount: input.amount,
      approvalNote: input.approvalNote,
      rollbackOfAuditId: input.rollbackAuditId ?? null,
      ...approvalAudit,
      platform: "google",
    },
  });
  return {
    customerId,
    campaignId,
    campaignBudgetResourceName,
    before: { amount: before.budgetAmount, currency: before.currency },
    after: { amount: input.amount, currency: before.currency },
    amount: input.amount,
    auditId: audit?.id ?? null,
    rollback: { operation: "campaign_budget", expectedCurrentAmount: input.amount, amount: before.budgetAmount },
    result,
  };
}

export async function getGoogleCampaignChangePreview(auth: AuthContext, rawCustomerId: string, rawCampaignId: string) {
  const customerId = requireNormalizedCustomerId(rawCustomerId);
  const campaignId = requireGoogleEntityId(rawCampaignId, "campaignId");
  const account = await assertConnectedGoogleAdAccount(auth.workspace.id, customerId);
  const requestOptions = googleAdsRequestOptionsForAccount(account);
  const accessToken = await readGoogleAccessToken(auth);
  const state = await fetchGoogleCampaignLiveState(accessToken, customerId, campaignId, requestOptions);
  return {
    customerId,
    campaignId,
    campaignName: state.name,
    current: {
      status: state.status,
      budgetAmount: state.budgetAmount,
      currency: state.currency,
      budgetExplicitlyShared: state.budgetExplicitlyShared,
    },
    timezone: state.timezone,
    observedAt: new Date().toISOString(),
  };
}

async function recordGoogleAdsWriteConflict(
  auth: AuthContext,
  operation: string,
  customerId: string,
  campaignId: string,
  expected: unknown,
  actual: unknown,
) {
  await recordGoogleAdsWriteFailure({
    auth,
    eventType: "google_ads.write_conflict",
    payload: { platform: "google", operation, customerId, campaignId, expected, actual },
  });
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
  return account;
}

function googleAdsRequestOptionsForAccount(account: { manager_customer_id?: string | null }): GoogleAdsRequestOptions {
  const managerCustomerId = normalizeCustomerId(account.manager_customer_id ?? "");
  return managerCustomerId ? { loginCustomerId: managerCustomerId } : { omitLoginCustomerId: true };
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
  const res = await fetch(`https://googleads.googleapis.com/${googleAdsRestApiVersion}/customers/${customerId}/googleAds:searchStream`, {
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

async function fetchGoogleCampaignLiveState(
  accessToken: string,
  customerId: string,
  campaignId: string,
  options: GoogleAdsRequestOptions,
) {
  const query = `
    SELECT
      customer.currency_code,
      customer.time_zone,
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.campaign_budget,
      campaign_budget.resource_name,
      campaign_budget.amount_micros,
      campaign_budget.explicitly_shared
    FROM campaign
    WHERE campaign.id = ${campaignId}
    LIMIT 1
  `;
  const payload = await postGoogleAdsSearch(accessToken, customerId, query, options);
  const result = payload.flatMap((chunk) => chunk.results ?? [])[0];
  if (!result?.campaign) throw new GoogleAdsWriteError("対象campaignをGoogle Adsから取得できませんでした。");
  const status = String(result.campaign.status ?? "");
  if (status !== "ENABLED" && status !== "PAUSED") {
    throw new GoogleAdsWriteError(`対象campaignの現在status (${status || "unknown"}) はwrite対象外です。`);
  }
  const budget = result.campaignBudget ?? result.campaign_budget ?? {};
  const budgetResourceName = String(
    budget.resourceName
      ?? budget.resource_name
      ?? result.campaign.campaignBudget
      ?? result.campaign.campaign_budget
      ?? "",
  );
  if (!budgetResourceName) throw new GoogleAdsWriteError("対象campaignのbudget resourceを取得できませんでした。");
  const amountMicros = Number(budget.amountMicros ?? budget.amount_micros ?? 0);
  const explicitlyShared = budget.explicitlyShared ?? budget.explicitly_shared ?? false;
  return {
    name: String(result.campaign.name ?? "Campaign"),
    status: status as GoogleCampaignStatus,
    budgetResourceName,
    budgetAmount: Number.isFinite(amountMicros) && amountMicros > 0 ? amountMicros / 1_000_000 : null,
    budgetExplicitlyShared: explicitlyShared === true || String(explicitlyShared).toLowerCase() === "true",
    currency: String(result.customer?.currencyCode ?? result.customer?.currency_code ?? "") || null,
    timezone: String(result.customer?.timeZone ?? result.customer?.time_zone ?? "") || null,
  };
}

async function postGoogleAdsSearch(accessToken: string, customerId: string, query: string, options: GoogleAdsRequestOptions = {}) {
  const res = await fetch(`https://googleads.googleapis.com/${googleAdsRestApiVersion}/customers/${customerId}/googleAds:searchStream`, {
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

async function postGoogleAdsMutate(
  accessToken: string,
  customerId: string,
  path: string,
  body: Record<string, unknown>,
  options: GoogleAdsRequestOptions,
) {
  const res = await fetch(`https://googleads.googleapis.com/${googleAdsRestApiVersion}/customers/${customerId}/${path}`, {
    method: "POST",
    headers: googleAdsHeaders(accessToken, options),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google Ads writeに失敗しました: ${redact(detail).slice(0, 240)}`);
  }
  return (await res.json()) as unknown;
}

export function normalizeGoogleAdsRestVersion(release: string) {
  const normalized = release.trim();
  const match = normalized.match(/^v?(\d+)(?:\.\d+)?$/i);
  if (!match) throw new Error("GOOGLE_ADS_API_VERSION must look like v24 or v24.2");
  return `v${match[1]}`;
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
  const configured = process.env.GOOGLE_ADS_REDIRECT_URI?.trim();
  const apiOrigin = process.env.API_PUBLIC_ORIGIN?.trim().replace(/\/+$/, "");
  const candidate = configured || (apiOrigin ? `${apiOrigin}/oauth/google/callback` : "http://localhost:8787/oauth/google/callback");
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(candidate);
  } catch {
    throw new Error("GOOGLE_ADS_REDIRECT_URI must be a valid URL.");
  }
  if (!["http:", "https:"].includes(redirectUrl.protocol) || redirectUrl.pathname !== "/oauth/google/callback") {
    throw new Error("GOOGLE_ADS_REDIRECT_URI must use /oauth/google/callback.");
  }

  const appOrigin = process.env.WEB_ORIGIN?.trim();
  if (appOrigin && isPublicHttpOrigin(appOrigin) && isLoopbackHostname(redirectUrl.hostname)) {
    throw new Error("Public WEB_ORIGIN cannot use a localhost GOOGLE_ADS_REDIRECT_URI.");
  }
  return redirectUrl.toString();
}

function isPublicHttpOrigin(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string) {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname.toLowerCase());
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
