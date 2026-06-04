import { serve } from "@hono/node-server";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";

import { loadLocalEnv } from "./env.js";
import {
  buildGoogleOAuthUrlForRedirect,
  connectGoogleCustomer,
  GoogleAdsWriteError,
  handleGoogleOAuthCallback,
  isGoogleAdsWriteConfigured,
  listAccessibleGoogleCustomers,
  syncGoogleCustomer,
  updateGoogleCampaignBudget,
  updateGoogleCampaignStatus,
} from "./google-ads.js";
import {
  type ChatRequest,
  type ChatResponse,
  appendChatExchange,
  createMockChatResponse,
  ensureChatThread,
  getColumnById,
  getColumns,
  getConnectionStatus,
  getChatThread,
  getDashboardData,
  getLatestAdData,
  getRequestContext,
  listChatThreads,
  parsePlatform,
  parseRange,
} from "./mock-repository.js";
import {
  AuthError,
  appendAgentMessage,
  appendSetupIntakeMessage,
  assertWorkspaceMembership,
  authenticateRequest,
  createHumanTask,
  createOperatorFeedback,
  createRecommendation,
  createSetupIntake,
  ensureAgentThread,
  ensureSetupIntake,
  getAgentThread,
  getSetupIntake,
  getDashboardDataFromDb,
  getLatestAdDataFromDb,
  getWorkspaceProfile,
  getBillingCustomer,
  getBillingCustomerByStripeCustomerId,
  getBillingSubscription,
  isSupabaseConfigured,
  listAgentThreads,
  listRecentAuditLogs,
  listConnectionStatuses,
  listHumanTasks,
  listRecentOperatorFeedback,
  listRecommendations,
  listSetupIntakes,
  listUserMemories,
  recordAuditLog,
  type SetupIntakeMessageRow,
  type SetupIntakeRow,
  type SetupStepRow,
  updateSetupIntake,
  updateSetupIntakeSession,
  updateSetupIntakeSteps,
  updateHumanTaskStatus,
  updateRecommendationStatus,
  upsertBillingCustomer,
  upsertBillingSubscription,
} from "./supabase.js";

loadLocalEnv();

type StoredRecommendation = ChatResponse["recommendation"] & {
  id: string;
  workspaceId: string;
  threadId: string;
  createdAt: string;
};

type StoredTask = ChatResponse["humanTaskDraft"] & {
  id: string;
  workspaceId: string;
  threadId: string;
  description: string;
  createdAt: string;
};

type ChatPolicyResult =
  | { action: "allow" }
  | {
      action: "reject_secret";
      categories: string[];
    }
  | {
      action: "manual_media_steps";
      operations: MediaWriteOperation[];
    };

type MediaWriteOperation = "budget" | "campaign_status" | "bid" | "ad_creation" | "targeting" | "platform_mutation";

export const app = new Hono();
const agentServiceUrl = process.env.AGENT_SERVICE_URL ?? process.env.ADK_AGENT_URL ?? "http://localhost:8000";
const useAgentService = (process.env.USE_AGENT_SERVICE ?? process.env.USE_ADK_AGENT) === "true";
const agentServiceAuthMode = (process.env.AGENT_SERVICE_AUTH_MODE ?? "none").trim().toLowerCase();
const agentServiceAudience = process.env.AGENT_SERVICE_AUDIENCE ?? agentServiceUrl;
const agentFetchTimeoutMs = Number(process.env.AGENT_SERVICE_TIMEOUT_MS ?? process.env.ADK_AGENT_TIMEOUT_MS ?? "35000");
const chatStatusEventDelayMs = Number(process.env.CHAT_STATUS_EVENT_DELAY_MS ?? "80");
const port = Number(process.env.PORT ?? "8787");
const recommendations: StoredRecommendation[] = [];
const tasks: StoredTask[] = [];

type LatestAdData = ReturnType<typeof getLatestAdData>;

type ProcessChatOptions = {
  latestAdData?: LatestAdData;
  auth?: {
    workspaceId: string;
    userId: string;
  };
};

type SetupIntakeAgentResult = {
  assistantMessage: string;
  extractedFacts: Record<string, unknown>;
  dimensionScores: Record<string, number>;
  score: number;
  missingFields: string[];
  readyForSetupSteps: boolean;
  setupSteps: SetupStepRow[];
};

type ReadinessCheck = {
  id: string;
  label: string;
  status: "pass" | "todo" | "risk";
  evidence: string[];
};

const stagingEvidenceKeys = [
  "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
  "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
  "STRIPE_STAGING_E2E_PASSED_AT",
] as const;
const maxStagingEvidenceAgeMs = 90 * 24 * 60 * 60 * 1000;
const maxStagingEvidenceFutureMs = 24 * 60 * 60 * 1000;
const maxStagingEvidenceSpreadMs = 7 * 24 * 60 * 60 * 1000;

function getAuthReadiness(): { note: string; checks: ReadinessCheck[] } {
  const webOrigin = trimTrailingSlash(process.env.WEB_ORIGIN ?? "http://localhost:5173");
  const authSiteUrl = trimTrailingSlash(process.env.SUPABASE_AUTH_SITE_URL ?? "");
  const expectedCallbackUrl = `${webOrigin}/auth/callback`;
  const allowedRedirectUrls = splitEnvList(process.env.SUPABASE_AUTH_REDIRECT_URLS);
  const hasGoogleProviderEnv = Boolean(process.env.SUPABASE_AUTH_GOOGLE_CLIENT_ID && process.env.SUPABASE_AUTH_GOOGLE_CLIENT_SECRET);
  const hasExpectedCallback = allowedRedirectUrls.includes(expectedCallbackUrl);
  const hasSiteUrl = Boolean(authSiteUrl);
  const siteUrlMatchesWebOrigin = hasSiteUrl && authSiteUrl === webOrigin;

  const checks: ReadinessCheck[] = [
    {
      id: "supabase-auth-env",
      label: "Supabase Auth/API環境変数が揃っている",
      status: isSupabaseConfigured() ? "pass" : "todo",
      evidence: [
        `SUPABASE_URL=${presence(process.env.SUPABASE_URL)}`,
        `SUPABASE_ANON_KEY=${presence(process.env.SUPABASE_ANON_KEY)}`,
        `SUPABASE_SERVICE_ROLE_KEY=${presence(process.env.SUPABASE_SERVICE_ROLE_KEY)}`,
      ],
    },
    {
      id: "auth-site-url",
      label: "Supabase Auth Site URLがWeb originと一致している",
      status: siteUrlMatchesWebOrigin ? "pass" : "todo",
      evidence: [
        `WEB_ORIGIN=${webOrigin}`,
        hasSiteUrl ? `SUPABASE_AUTH_SITE_URL=${authSiteUrl}` : "SUPABASE_AUTH_SITE_URL is missing",
      ],
    },
    {
      id: "auth-callback-url",
      label: "Supabase Auth Redirect URLsにcallbackが登録されている",
      status: hasExpectedCallback ? "pass" : "todo",
      evidence: [
        `expected=${expectedCallbackUrl}`,
        allowedRedirectUrls.length ? `configured_count=${allowedRedirectUrls.length}` : "SUPABASE_AUTH_REDIRECT_URLS is missing",
      ],
    },
    {
      id: "google-login-provider",
      label: "Googleログイン用OAuth provider credentialが設定されている",
      status: hasGoogleProviderEnv ? "pass" : "todo",
      evidence: [
        `SUPABASE_AUTH_GOOGLE_CLIENT_ID=${presence(process.env.SUPABASE_AUTH_GOOGLE_CLIENT_ID)}`,
        `SUPABASE_AUTH_GOOGLE_CLIENT_SECRET=${presence(process.env.SUPABASE_AUTH_GOOGLE_CLIENT_SECRET)}`,
        "Google Cloud側のAuthorized redirect URIは Supabase callback URL を登録する",
      ],
    },
  ];

  const note = checks.every((check) => check.status === "pass")
    ? "Supabase Authの環境契約は揃っています。次はstagingでGoogleログインE2Eを確認してください。"
    : "Supabase Auth / Googleログインの設定が未完了です。未pass項目を解消しない限りproduction No-Goです。";
  return { note, checks };
}

function getAgentServiceReadiness(): { note: string; checks: ReadinessCheck[] } {
  const appEnv = (process.env.APP_ENV ?? "local").trim().toLowerCase();
  const urlIsLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/.test(agentServiceUrl);
  const hasPreferredToggle = process.env.USE_AGENT_SERVICE === "true";
  const hasLegacyToggle = process.env.USE_ADK_AGENT === "true";
  const isProduction = appEnv === "production";
  const legacyAgentEnv = [
    isPresent(process.env.ADK_AGENT_URL) ? "ADK_AGENT_URL" : "",
    process.env.USE_ADK_AGENT === "true" ? "USE_ADK_AGENT" : "",
    isPresent(process.env.ADK_AGENT_TIMEOUT_MS) ? "ADK_AGENT_TIMEOUT_MS" : "",
  ].filter(Boolean);
  const modernAgentEnvIsClean = !isProduction || legacyAgentEnv.length === 0;

  const checks: ReadinessCheck[] = [
    {
      id: "agent-service-enabled",
      label: "APIがOpenAI Agent Serviceへproxyする設定になっている",
      status: useAgentService ? "pass" : "todo",
      evidence: [
        `USE_AGENT_SERVICE=${process.env.USE_AGENT_SERVICE ?? "missing"}`,
        hasLegacyToggle ? "USE_ADK_AGENT=true is a backward-compatible alias; prefer USE_AGENT_SERVICE=true" : "USE_ADK_AGENT not used",
      ],
    },
    {
      id: "agent-service-modern-env",
      label: "Production API envがOpenAI Agent Serviceの新env名だけを使っている",
      status: modernAgentEnvIsClean ? "pass" : "todo",
      evidence: modernAgentEnvIsClean
        ? ["AGENT_SERVICE_URL / USE_AGENT_SERVICE / AGENT_SERVICE_TIMEOUT_MS are the production API env contract."]
        : [
            `legacy_aliases=${legacyAgentEnv.join(",")}`,
            "Production env must not use ADK_AGENT_URL, USE_ADK_AGENT, or ADK_AGENT_TIMEOUT_MS.",
          ],
    },
    {
      id: "agent-service-url",
      label: "Agent Service URLがstaging/production向けに設定されている",
      status: agentServiceUrl && (!isProduction || !urlIsLocalhost) ? "pass" : "todo",
      evidence: [
        `AGENT_SERVICE_URL=${presence(process.env.AGENT_SERVICE_URL)}`,
        `resolved=${redactUrl(agentServiceUrl)}`,
        isProduction && urlIsLocalhost ? "production must not point to localhost" : "url shape ok",
      ],
    },
    {
      id: "openai-agent-service-health",
      label: "OpenAI Agent Serviceのruntime設定はservice側health/E2Eで確認する",
      status: isPresent(process.env.OPENAI_AGENT_STAGING_E2E_PASSED_AT) ? "pass" : "todo",
      evidence: [
        "OPENAI_API_KEY and OpenAI Agents logging controls belong to the Agent Service env, not the API env.",
        "npm run smoke:deploy checks deployed Agent /health for OpenAI runtime and data-safety flags.",
        `OPENAI_AGENT_STAGING_E2E_PASSED_AT=${presence(process.env.OPENAI_AGENT_STAGING_E2E_PASSED_AT)}`,
      ],
    },
  ];

  const note = checks.every((check) => check.status === "pass")
    ? "OpenAI Agent Serviceの接続証跡は揃っています。Agent側のOpenAI keyとlogging安全設定はservice health/smokeで確認してください。"
    : "OpenAI Agent Serviceの接続またはstaging E2E証跡が未完了です。未pass項目を解消しない限りproduction No-Goです。";

  if (!hasPreferredToggle && hasLegacyToggle) {
    checks[0]?.evidence.push("新規deploymentでは USE_AGENT_SERVICE=true に移行してください。");
  }
  return { note, checks };
}

function splitEnvList(value: string | undefined) {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((item) => trimTrailingSlash(item))
    .filter(Boolean);
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function presence(value: string | undefined) {
  return value ? "set" : "missing";
}

function isPresent(value: string | undefined) {
  return Boolean(value?.trim());
}

function isEvidenceTimestamp(value: string | undefined) {
  if (!value?.trim()) return false;
  return Number.isFinite(Date.parse(value));
}

function getStagingEvidenceReadiness(now = Date.now()) {
  const parsed: Array<{ key: (typeof stagingEvidenceKeys)[number]; value: string; parsed: number }> = [];
  const issues: string[] = [];

  for (const key of stagingEvidenceKeys) {
    const value = String(process.env[key] ?? "").trim();
    if (!value) {
      issues.push(`${key}=missing`);
      continue;
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      issues.push(`${key}=invalid`);
      continue;
    }
    if (timestamp > now + maxStagingEvidenceFutureMs) {
      issues.push(`${key}=future`);
    }
    if (now - timestamp > maxStagingEvidenceAgeMs) {
      issues.push(`${key}=older_than_90_days`);
    }
    parsed.push({ key, value, parsed: timestamp });
  }

  if (parsed.length === stagingEvidenceKeys.length) {
    const oldest = parsed.reduce((current, candidate) => (candidate.parsed < current.parsed ? candidate : current));
    const newest = parsed.reduce((current, candidate) => (candidate.parsed > current.parsed ? candidate : current));
    if (newest.parsed - oldest.parsed > maxStagingEvidenceSpreadMs) {
      issues.push(`evidence_window=spread_more_than_7_days (${oldest.key}..${newest.key})`);
    }
  }

  return {
    valid: issues.length === 0,
    parsed,
    issues,
  };
}

function isTrueEnv(value: string | undefined) {
  return value === "true";
}

function redactUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = url.username ? "[REDACTED]" : "";
      url.password = url.password ? "[REDACTED]" : "";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return value ? "[invalid-url]" : "missing";
  }
}

app.use(
  "*",
  cors({
    origin: (origin) => (origin === webOrigin() ? origin : null),
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-demo-user-id"],
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "adops-api",
    mode: useAgentService ? "agent-proxy" : "mock",
    agentServiceUrl,
    mediaWriteEnabled: isGoogleAdsWriteConfigured(),
    billingConfigured: isStripeConfigured(),
    supabaseConfigured: isSupabaseConfigured(),
    authConfigured: getAuthReadiness().checks.every((check) => check.status === "pass"),
  }),
);

app.get("/auth/session", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    return c.json({
      user: auth.user,
      workspace: auth.workspace,
    });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.get("/readiness", (c) => {
  const { workspaceId } = getRequestContext(c.req.raw);
  const authReadiness = getAuthReadiness();
  const agentReadiness = getAgentServiceReadiness();
  const stagingEvidenceReadiness = getStagingEvidenceReadiness();
  const googleAdsE2ePassed = isEvidenceTimestamp(process.env.GOOGLE_ADS_STAGING_E2E_PASSED_AT);
  const stripeE2ePassed = isEvidenceTimestamp(process.env.STRIPE_STAGING_E2E_PASSED_AT);
  const openAiAgentE2ePassed = isEvidenceTimestamp(process.env.OPENAI_AGENT_STAGING_E2E_PASSED_AT);
  const deploymentOriginIsPublic =
    isPresent(process.env.API_PUBLIC_ORIGIN) &&
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/.test(process.env.API_PUBLIC_ORIGIN ?? "");
  const deploymentRunbookAcknowledged = isTrueEnv(process.env.DEPLOYMENT_RUNBOOK_ACK);
  const productionChecks = [
    ...authReadiness.checks,
    ...agentReadiness.checks,
    {
      id: "openai-agent-staging-e2e",
      label: "OpenAI Agent Serviceのstaging E2E確認",
      status: openAiAgentE2ePassed ? "pass" as const : "todo" as const,
      evidence: [
        `OPENAI_AGENT_STAGING_E2E_PASSED_AT=${presence(process.env.OPENAI_AGENT_STAGING_E2E_PASSED_AT)}`,
        "Agent /health と API経由 /agent/chat のstaging E2Eを通してから設定する。",
      ],
    },
    {
      id: "real-media-apis",
      label: "Google Ads read/write APIの実接続",
      status: isGoogleAdsWriteConfigured() && googleAdsE2ePassed ? "pass" as const : "todo" as const,
      evidence: [
        "Google Ads OAuth、customer list、metrics sync、campaign status/budget write routeを実装済み。",
        `GOOGLE_ADS_WRITE_ENABLED=${isGoogleAdsWriteConfigured() ? "true" : "false"}`,
        `GOOGLE_ADS_STAGING_E2E_PASSED_AT=${presence(process.env.GOOGLE_ADS_STAGING_E2E_PASSED_AT)}`,
        "Meta/Yahooは後続。production初期はGoogle Adsから開始する。",
      ],
    },
    {
      id: "stripe-billing",
      label: "Stripe Checkout / Portal / Webhookが設定されている",
      status: isStripeConfigured() && stripeE2ePassed ? "pass" as const : "todo" as const,
      evidence: [
        `STRIPE_SECRET_KEY=${presence(process.env.STRIPE_SECRET_KEY)}`,
        `STRIPE_PRICE_ID=${presence(process.env.STRIPE_PRICE_ID)}`,
        `STRIPE_WEBHOOK_SECRET=${presence(process.env.STRIPE_WEBHOOK_SECRET)}`,
        `STRIPE_STAGING_E2E_PASSED_AT=${presence(process.env.STRIPE_STAGING_E2E_PASSED_AT)}`,
      ],
    },
    {
      id: "staging-e2e-evidence-window",
      label: "staging E2E証跡が同一リリース検証窓に揃っている",
      status: stagingEvidenceReadiness.valid ? "pass" as const : "todo" as const,
      evidence: stagingEvidenceReadiness.valid
        ? [
            "OPENAI / Google Ads / Stripe staging evidence timestamps are valid ISO values.",
            "All three staging evidence timestamps are within the 7-day release validation window and fresher than 90 days.",
          ]
        : [
            ...stagingEvidenceReadiness.issues,
            "Refresh OpenAI Agent, Google Ads, and Stripe staging E2E evidence in the same release validation window.",
          ],
    },
    {
      id: "deployment",
      label: "共有URL、テスト用env、ログ確認手順",
      status: deploymentOriginIsPublic && deploymentRunbookAcknowledged ? "pass" as const : "todo" as const,
      evidence: [
        `API_PUBLIC_ORIGIN=${process.env.API_PUBLIC_ORIGIN ? redactUrl(process.env.API_PUBLIC_ORIGIN) : "missing"}`,
        `DEPLOYMENT_RUNBOOK_ACK=${process.env.DEPLOYMENT_RUNBOOK_ACK ?? "missing"}`,
        "Cloudflare/Cloud Runなどのstaging URLと環境別secret運用、ログ確認手順を確定してからackする。",
      ],
    },
  ];
  return c.json({
    workspaceId,
    mode: useAgentService ? "agent-proxy" : "mock",
    audience: "internal_user_test",
    status: "ready_with_mock_data",
    scopes: {
      mock: {
        label: "mock test",
        decision: "Go",
        note: "credentialなしで社内体験検証できます。",
        checks: [
          {
            id: "local-services",
            label: "Web / API / OpenAI Agent Serviceをローカル起動できる",
            status: "pass",
            evidence: ["npm run dev", "GET /health", "GET http://localhost:8000/health"],
          },
          {
            id: "mock-data",
            label: "実広告credentialなしでKPI、異常、AI回答を確認できる",
            status: "pass",
            evidence: ["GET /dashboard", "GET /ad-data/latest", "POST /agent/chat/stream"],
          },
          {
            id: "human-in-loop",
            label: "媒体writeは承認付きAPIだけで実行する",
            status: "pass",
            evidence: ["policy.humanInTheLoopRequired=true", "confirmed=true required for write routes"],
          },
        ],
        nextActions: [
          "社内テスターには docs/user-test-readiness.md のシナリオだけを渡す。",
          "テスト範囲をmockデータの体験検証に限定すると明記する。",
        ],
      },
      production: {
        label: "production readiness",
        decision: productionChecks.every((check) => check.status === "pass") ? "Go" : "No-Go",
        note: [authReadiness.note, agentReadiness.note].join(" "),
        checks: productionChecks,
        nextActions: [
          "Supabase AuthのSite URLとRedirect URLsを環境ごとに固定する。",
          "Googleログイン用OAuth clientをSupabase Auth Providerへ設定する。",
          "OpenAI / Google Ads OAuth / Google Ads write / Stripe billing / デプロイをstagingでE2E確認する。",
        ],
      },
    },
    goNoGo: {
      decision: "go_for_internal_mock_test",
      note: "実広告OAuthとSupabase Authは未接続のため、credentialなしの社内体験検証に限定します。",
    },
    checks: [
      {
        id: "local-services",
        label: "Web / API / OpenAI Agent Serviceをローカル起動できる",
        status: "pass",
        evidence: ["npm run dev", "GET /health", "GET http://localhost:8000/health"],
      },
      {
        id: "mock-data",
        label: "実広告credentialなしでKPI、異常、AI回答を確認できる",
        status: "pass",
        evidence: ["GET /dashboard", "GET /ad-data/latest", "POST /agent/chat/stream"],
      },
      {
        id: "human-in-loop",
        label: "媒体writeは承認付きAPIだけで実行する",
        status: "pass",
        evidence: ["policy.humanInTheLoopRequired=true", "confirmed=true required for write routes"],
      },
      ...authReadiness.checks,
      {
        id: "real-media-apis",
        label: "Google Ads read/write APIの実接続",
        status: "todo",
        evidence: ["Google Ads OAuth、metrics sync、campaign status/budget write routeのstaging E2E確認が必要。"],
      },
      {
        id: "stripe-billing",
        label: "Stripe Checkout / Portal / Webhookが設定されている",
        status: isStripeConfigured() ? "pass" : "todo",
        evidence: [
          `STRIPE_SECRET_KEY=${presence(process.env.STRIPE_SECRET_KEY)}`,
          `STRIPE_PRICE_ID=${presence(process.env.STRIPE_PRICE_ID)}`,
          `STRIPE_WEBHOOK_SECRET=${presence(process.env.STRIPE_WEBHOOK_SECRET)}`,
        ],
      },
      {
        id: "deployment",
        label: "共有URL、テスト用env、ログ確認手順",
        status: "todo",
        evidence: ["Cloudflare/Cloud Runなどのstaging URLと環境別secret運用が必要。"],
      },
    ],
    nextActions: [
      "社内テスターには docs/user-test-readiness.md のシナリオだけを渡す。",
      "テスト範囲をmockデータの体験検証に限定すると明記する。",
      "Supabase Auth / OAuth / deploymentの設定をreadinessでpassにしてから実データ検証へ進む。",
    ],
  });
});

app.get("/dashboard", async (c) => {
  const auth = await optionalAuth(c);
  const authGate = requireProductAuth(c, auth);
  if (authGate) return authGate;
  const { workspaceId: demoWorkspaceId } = getRequestContext(c.req.raw);
  const workspaceId = auth?.workspace.id ?? demoWorkspaceId;
  const range = parseRange(c.req.query("range"));
  const platform = parsePlatform(c.req.query("platform"));
  if (auth && isSupabaseConfigured()) {
    try {
      const billingGate = await requireBillingAccess(c, auth);
      if (billingGate) return billingGate;
      const data = await getDashboardDataFromDb(workspaceId, range, platform);
      if (data) return c.json(data);
    } catch (error) {
      if (isStrictProductionMode()) return handleAuthError(c, error);
    }
  }
  return c.json(getDashboardData(workspaceId, range, platform));
});

app.get("/workspace/bootstrap", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    return c.json({
      user: auth.user,
      workspace: auth.workspace,
    });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.get("/workspace/:workspaceId/membership", async (c) => {
  try {
    const auth = await assertWorkspaceMembership(c.req.raw, c.req.param("workspaceId"));
    return c.json({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      role: auth.workspace.role,
    });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.get("/ad-data/latest", async (c) => {
  const auth = await optionalAuth(c);
  const authGate = requireProductAuth(c, auth);
  if (authGate) return authGate;
  const { workspaceId: demoWorkspaceId } = getRequestContext(c.req.raw);
  const workspaceId = auth?.workspace.id ?? demoWorkspaceId;
  const range = parseRange(c.req.query("range"));
  const platform = parsePlatform(c.req.query("platform"));
  if (auth && isSupabaseConfigured()) {
    try {
      const billingGate = await requireBillingAccess(c, auth);
      if (billingGate) return billingGate;
      const latestAdData = await getLatestAdDataFromDb(workspaceId, range, platform);
      if (latestAdData) return c.json({ latestAdData });
    } catch (error) {
      if (isStrictProductionMode()) return handleAuthError(c, error);
    }
  }
  return c.json({ latestAdData: getLatestAdData(workspaceId, range, platform) });
});

app.get("/connections", (c) => {
  const { workspaceId } = getRequestContext(c.req.raw);
  const platform = parsePlatform(c.req.query("platform"));
  return c.json(getConnectionStatus(workspaceId, platform));
});

app.get("/connections/status", async (c) => {
  try {
    const auth = await assertWorkspaceMembership(c.req.raw, c.req.query("workspaceId"));
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const platform = parsePlatform(c.req.query("platform"));
    const statuses = await listConnectionStatuses(auth.workspace.id, platform);
    return c.json({
      workspaceId: auth.workspace.id,
      mode: "production",
      policy: {
        access: "read-write-after-human-approval",
        mediaWriteEnabled: isGoogleAdsWriteConfigured(),
        note: "OAuth tokenは暗号化保存し、ブラウザやAIには返しません。媒体writeは明示承認されたAPI routeだけで実行します。",
      },
      connections: statuses,
      nextConnectors: getConnectionStatus(auth.workspace.id, platform).nextConnectors.map((connector) => ({
        ...connector,
        status: connector.platform === "google" ? "ready" : connector.status,
      })),
    });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.get("/oauth/google/start", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    return c.redirect(await buildGoogleOAuthUrlForRedirect(auth), 302);
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.get("/oauth/google/start-url", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    return c.json({ url: await buildGoogleOAuthUrlForRedirect(auth) });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.get("/oauth/google/callback", async (c) => {
  try {
    await handleGoogleOAuthCallback(c.req.query("code") ?? null, c.req.query("state") ?? null);
    return c.redirect(`${process.env.WEB_ORIGIN ?? "http://localhost:5173"}?connection=google&status=connected`, 302);
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : "google_oauth_failed");
    return c.redirect(`${process.env.WEB_ORIGIN ?? "http://localhost:5173"}?connection=google&status=error&message=${message}`, 302);
  }
});

app.get("/google/customers", async (c) => {
  try {
    const auth = await assertWorkspaceMembership(c.req.raw, c.req.query("workspaceId"));
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const customers = await listAccessibleGoogleCustomers(auth);
    return c.json({ customers });
  } catch (error) {
    return handleAuthError(c, error);
  }
});
app.get("/google-ads/customers", handleGoogleCustomers);

async function handleGoogleCustomers(c: Context) {
  try {
    const auth = await assertWorkspaceMembership(c.req.raw, c.req.query("workspaceId"));
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const customers = await listAccessibleGoogleCustomers(auth);
    return c.json({ customers });
  } catch (error) {
    return handleAuthError(c, error);
  }
}

app.post("/google/customers/:customerId/connect", async (c) => {
  try {
    const auth = await assertWorkspaceMembership(c.req.raw, c.req.query("workspaceId"));
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const result = await connectGoogleCustomer(auth, c.req.param("customerId"));
    return c.json(result);
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.post("/sync/google", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const body: { customerId?: string; days?: number } = await c.req.json<{ customerId?: string; days?: number }>().catch(() => ({}));
    const customerId = body.customerId ?? c.req.query("customerId");
    if (!customerId) return c.json({ error: "customerId is required" }, 400);
    const result = await syncGoogleCustomer(auth, customerId, body.days ?? 30);
    return c.json(result);
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.post("/google/customers/:customerId/campaigns/:campaignId/status", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const body: { status?: string; confirmed?: boolean; approvalNote?: string } = await c.req
      .json<{ status?: string; confirmed?: boolean; approvalNote?: string }>()
      .catch(() => ({}));
    const status = normalizeGoogleCampaignStatus(body.status);
    if (!status) return c.json({ error: "status must be ENABLED or PAUSED" }, 400);
    const approvalNote = normalizeApprovalNote(body.approvalNote);
    if (!approvalNote) return c.json({ error: "approvalNote is required and must include the reason and rollback condition" }, 400);
    const result = await updateGoogleCampaignStatus({
      auth,
      customerId: c.req.param("customerId"),
      campaignId: c.req.param("campaignId"),
      status,
      confirmed: body.confirmed === true,
      approvalNote,
    });
    return c.json({ mode: "executed", policy: googleWritePolicy(), ...result });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.post("/google/customers/:customerId/campaigns/:campaignId/budget", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const body: { amount?: number; confirmed?: boolean; approvalNote?: string } = await c.req
      .json<{ amount?: number; confirmed?: boolean; approvalNote?: string }>()
      .catch(() => ({}));
    const approvalNote = normalizeApprovalNote(body.approvalNote);
    if (!approvalNote) return c.json({ error: "approvalNote is required and must include the reason and rollback condition" }, 400);
    const result = await updateGoogleCampaignBudget({
      auth,
      customerId: c.req.param("customerId"),
      campaignId: c.req.param("campaignId"),
      amount: Number(body.amount),
      confirmed: body.confirmed === true,
      approvalNote,
    });
    return c.json({ mode: "executed", policy: googleWritePolicy(), ...result });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.get("/audit-logs/recent", async (c) => {
  try {
    const auth = await assertWorkspaceMembership(c.req.raw, c.req.query("workspaceId"));
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const eventTypePrefix = c.req.query("eventTypePrefix") || undefined;
    const limit = Number(c.req.query("limit") ?? "20");
    const logs = await listRecentAuditLogs(auth.workspace.id, eventTypePrefix, limit);
    return c.json({ workspaceId: auth.workspace.id, logs });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.post("/billing/checkout-session", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const configuredGate = requireStripeConfigured(c, auth.workspace.id);
    if (configuredGate) return configuredGate;
    const session = await createStripeCheckoutSession(auth);
    return c.json({ url: session.url, id: session.id });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.get("/billing/status", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const [customer, subscription] = await Promise.all([
      getBillingCustomer(auth.workspace.id),
      getBillingSubscription(auth.workspace.id),
    ]);
    const active = subscription ? isUsableSubscriptionStatus(subscription.status) : false;
    return c.json({
      workspaceId: auth.workspace.id,
      configured: isStripeConfigured(),
      customer: customer
        ? {
            id: customer.id,
            stripeCustomerId: customer.stripe_customer_id,
          }
        : null,
      subscription: subscription
        ? {
            id: subscription.id,
            stripeSubscriptionId: subscription.stripe_subscription_id,
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          }
        : null,
      access: active ? "active" : "billing_required",
    });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.post("/billing/portal-session", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const configuredGate = requireStripeConfigured(c, auth.workspace.id);
    if (configuredGate) return configuredGate;
    const customer = await getBillingCustomer(auth.workspace.id);
    if (!customer) return c.json({ error: "Stripe customerがまだ作成されていません。" }, 404);
    const session = await createStripePortalSession(auth, customer.stripe_customer_id);
    return c.json({ url: session.url, id: session.id });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.post("/billing/webhook", async (c) => {
  try {
    const rawBody = await c.req.text();
    const signature = c.req.header("stripe-signature") ?? "";
    verifyStripeWebhookSignature(rawBody, signature);
    const event = JSON.parse(rawBody) as StripeEvent;
    const result = await handleStripeWebhookEvent(event);
    return c.json({ received: true, ...result });
  } catch (error) {
    if (error instanceof StripeWebhookError) {
      return c.json({ error: error.message }, 400);
    }
    return handleAuthError(c, error);
  }
});

app.get("/columns", (c) => {
  const tags = splitTags(c.req.query("tags"));
  return c.json({ articles: getColumns(tags) });
});

app.get("/columns/:id", (c) => {
  const result = getColumnById(c.req.param("id"));
  if (!result) return c.json({ error: "記事が見つかりません。" }, 404);
  return c.json(result);
});

app.get("/tasks", async (c) => {
  const auth = await optionalAuth(c);
  const authGate = requireProductAuth(c, auth);
  if (authGate) return authGate;
  const { workspaceId: demoWorkspaceId } = getRequestContext(c.req.raw);
  const workspaceId = auth?.workspace.id ?? demoWorkspaceId;
  if (auth && isSupabaseConfigured()) {
    try {
      const billingGate = await requireBillingAccess(c, auth);
      if (billingGate) return billingGate;
      return c.json({ tasks: await listHumanTasks(workspaceId) });
    } catch (error) {
      if (isStrictProductionMode()) return handleAuthError(c, error);
    }
  }
  return c.json({
    tasks: tasks.filter((task) => task.workspaceId === workspaceId),
  });
});

app.get("/recommendations", async (c) => {
  const auth = await optionalAuth(c);
  const authGate = requireProductAuth(c, auth);
  if (authGate) return authGate;
  const { workspaceId: demoWorkspaceId } = getRequestContext(c.req.raw);
  const workspaceId = auth?.workspace.id ?? demoWorkspaceId;
  if (auth && isSupabaseConfigured()) {
    try {
      const billingGate = await requireBillingAccess(c, auth);
      if (billingGate) return billingGate;
      return c.json({ recommendations: await listRecommendations(workspaceId) });
    } catch (error) {
      if (isStrictProductionMode()) return handleAuthError(c, error);
    }
  }
  const range = parseRange(c.req.query("range"));
  const platform = parsePlatform(c.req.query("platform"));
  const seeded = seedRecommendations(workspaceId, range, platform);
  const stored = recommendations.filter((recommendation) => recommendation.workspaceId === workspaceId);
  return c.json({
    recommendations: [...stored, ...seeded],
  });
});

app.get("/threads", handleListThreads);
app.get("/agent/threads", handleListThreads);

async function handleListThreads(c: Context) {
  const auth = await optionalAuth(c);
  const authGate = requireProductAuth(c, auth);
  if (authGate) return authGate;
  const { workspaceId, userId } = auth ? { workspaceId: auth.workspace.id, userId: auth.user.id } : getRequestContext(c.req.raw);
  if (auth && isSupabaseConfigured()) {
    try {
      const billingGate = await requireBillingAccess(c, auth);
      if (billingGate) return billingGate;
      const threads = await listAgentThreads(workspaceId, userId);
      return c.json({
        threads: threads.map((thread) => ({
          id: thread.id,
          workspaceId: thread.workspace_id,
          userId: thread.user_id,
          title: thread.title,
          updatedAt: thread.updated_at,
          messageCount: thread.message_count ?? 0,
          lastMessagePreview: thread.last_message_preview ?? "",
        })),
      });
    } catch (error) {
      if (isStrictProductionMode()) return handleAuthError(c, error);
    }
  }
  ensureChatThread(workspaceId, userId, c.req.query("threadId") || "demo-thread");
  return c.json(listChatThreads(workspaceId, userId));
}

app.post("/threads", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const body: { threadId?: string; title?: string } = await c.req.json<{ threadId?: string; title?: string }>().catch(() => ({}));
    const threadId = body.threadId || randomUUID();
    const thread = await ensureAgentThread(auth.workspace.id, auth.user.id, threadId, body.title);
    return c.json({
      thread: {
        id: thread.id,
        workspaceId: thread.workspace_id,
        userId: thread.user_id,
        title: thread.title,
        updatedAt: thread.updated_at,
      },
    });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.get("/threads/:threadId", handleGetThread);
app.get("/agent/threads/:threadId", handleGetThread);

async function handleGetThread(c: Context) {
  const auth = await optionalAuth(c);
  const authGate = requireProductAuth(c, auth);
  if (authGate) return authGate;
  const { workspaceId, userId } = auth ? { workspaceId: auth.workspace.id, userId: auth.user.id } : getRequestContext(c.req.raw);
  if (auth && isSupabaseConfigured()) {
    try {
      const billingGate = await requireBillingAccess(c, auth);
      if (billingGate) return billingGate;
      const requestedThreadId = c.req.param("threadId");
      if (!requestedThreadId) return c.json({ error: "threadId is required" }, 400);
      const data = await getAgentThread(workspaceId, userId, requestedThreadId);
      return c.json({
        thread: {
          id: data.thread.id,
          workspaceId: data.thread.workspace_id,
          userId: data.thread.user_id,
          title: data.thread.title,
          updatedAt: data.thread.updated_at,
        },
        messages: data.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.created_at,
        })),
      });
    } catch (error) {
      if (isStrictProductionMode()) return handleAuthError(c, error);
    }
  }
    const requestedThreadId = c.req.param("threadId");
    if (!requestedThreadId) return c.json({ error: "threadId is required" }, 400);
    return c.json(getChatThread(workspaceId, userId, requestedThreadId));
}

app.patch("/recommendations/:id", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const body = await c.req.json<{ status?: "accepted" | "rejected" | "archived" | "suggested" }>();
    if (!body.status) return c.json({ error: "status is required" }, 400);
    return c.json({ recommendation: await updateRecommendationStatus(auth.workspace.id, c.req.param("id"), body.status) });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.patch("/tasks/:id", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const body = await c.req.json<{ status?: "suggested" | "accepted" | "doing" | "done" | "rejected" | "ignored" }>();
    if (!body.status) return c.json({ error: "status is required" }, 400);
    return c.json({ task: await updateHumanTaskStatus(auth.workspace.id, c.req.param("id"), body.status) });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.post("/feedback", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const body = await c.req.json<{
      recommendationId?: string;
      humanTaskId?: string;
      outcome?: "accepted" | "rejected" | "implemented" | "worked" | "did_not_work" | "unclear";
      comment?: string;
      observedMetrics?: Record<string, unknown>;
    }>();
    if (!body.outcome) return c.json({ error: "outcome is required" }, 400);
    const feedback = await createOperatorFeedback({
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      recommendationId: body.recommendationId ?? null,
      humanTaskId: body.humanTaskId ?? null,
      outcome: body.outcome,
      comment: body.comment ?? null,
      observedMetrics: body.observedMetrics ?? {},
    });
    return c.json({ feedback });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.get("/setup/intakes", async (c) => {
  try {
    const auth = await assertWorkspaceMembership(c.req.raw, c.req.query("workspaceId"));
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const intakes = await listSetupIntakes(auth.workspace.id, auth.user.id);
    return c.json({ intakes: intakes.map(serializeSetupIntakeSummary) });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.get("/setup/intake", async (c) => {
  try {
    const auth = await assertWorkspaceMembership(c.req.raw, c.req.query("workspaceId"));
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const data = await getSetupIntake(auth.workspace.id, auth.user.id, c.req.query("intakeId"));
    if (data) return c.json(serializeSetupIntake(data.intake, data.messages));
    const created = await ensureSetupIntake(auth.workspace.id, auth.user.id);
    if (created.messages.length === 0) {
      await appendSetupIntakeMessage({
        intakeId: created.intake.id,
        workspaceId: auth.workspace.id,
        userId: auth.user.id,
        role: "assistant",
        content: setupWelcomeMessage(),
      });
      const refreshed = await getSetupIntake(auth.workspace.id, auth.user.id, created.intake.id);
      if (refreshed) return c.json(serializeSetupIntake(refreshed.intake, refreshed.messages));
    }
    return c.json(serializeSetupIntake(created.intake, created.messages));
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.post("/setup/intake", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const body = await safeJson<{ title?: string }>(c);
    const data = await createSetupIntake(auth.workspace.id, auth.user.id, body.title);
    await appendSetupIntakeMessage({
      intakeId: data.intake.id,
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      role: "assistant",
      content: setupWelcomeMessage(),
    });
    const refreshed = await getSetupIntake(auth.workspace.id, auth.user.id, data.intake.id);
    return c.json(serializeSetupIntake(refreshed?.intake ?? data.intake, refreshed?.messages ?? []));
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.patch("/setup/intake", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const body = await c.req.json<{ intakeId?: string; title?: string; archive?: boolean }>();
    if (!body.intakeId) return c.json({ error: "intakeId is required" }, 400);
    const intake = await updateSetupIntakeSession({
      intakeId: body.intakeId,
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      title: body.title,
      archive: body.archive,
    });
    const data = body.archive ? null : await getSetupIntake(auth.workspace.id, auth.user.id, intake.id);
    const intakes = await listSetupIntakes(auth.workspace.id, auth.user.id);
    return c.json({
      ...(data ? serializeSetupIntake(data.intake, data.messages) : { intake: serializeSetupIntakeSummary(intake), messages: [] }),
      intakes: intakes.map(serializeSetupIntakeSummary),
    });
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.post("/setup/intake/message", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const body = await c.req.json<{ message?: string; intakeId?: string }>();
    const message = String(body.message ?? "").trim();
    if (!message) return c.json({ error: "message is required" }, 400);
    if (!body.intakeId) return c.json({ error: "intakeId is required" }, 400);

    const current = await getSetupIntake(auth.workspace.id, auth.user.id, body.intakeId);
    if (!current) return c.json({ error: "setup intakeが見つかりません。" }, 404);
    await appendSetupIntakeMessage({
      intakeId: current.intake.id,
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      role: "user",
      content: message,
    });

    const agentResult = await runSetupIntakeAgent({
      message,
      intake: current.intake,
      messages: current.messages,
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
    });
    const updated = await updateSetupIntake({
      intakeId: current.intake.id,
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      title: deriveSetupIntakeTitle(current.intake.title, agentResult.extractedFacts),
      status: agentResult.readyForSetupSteps ? "ready" : "in_progress",
      score: agentResult.score,
      dimensionScores: agentResult.dimensionScores,
      facts: agentResult.extractedFacts,
      missingFields: agentResult.missingFields,
      generatedSteps: agentResult.setupSteps,
    });
    await appendSetupIntakeMessage({
      intakeId: current.intake.id,
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      role: "assistant",
      content: agentResult.assistantMessage,
      metadata: {
        score: agentResult.score,
        dimensionScores: agentResult.dimensionScores,
        missingFields: agentResult.missingFields,
      },
    });
    const refreshed = await getSetupIntake(auth.workspace.id, auth.user.id, current.intake.id);
    return c.json(serializeSetupIntake(updated, refreshed?.messages ?? []));
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.patch("/setup/intake/steps", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    const body = await c.req.json<{ intakeId?: string; setupSteps?: SetupStepRow[] }>();
    if (!body.intakeId || !Array.isArray(body.setupSteps)) {
      return c.json({ error: "intakeId and setupSteps are required" }, 400);
    }
    const intake = await updateSetupIntakeSteps({
      intakeId: body.intakeId,
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      generatedSteps: normalizeSetupSteps(body.setupSteps),
    });
    const data = await getSetupIntake(auth.workspace.id, auth.user.id, intake.id);
    return c.json(serializeSetupIntake(intake, data?.messages ?? []));
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.post("/advisor/chat", handleChat);
app.post("/agent/chat", handleChat);
app.post("/agent/chat/stream", handleChatStream);

async function handleChat(c: Context) {
  let body: ChatRequest;
  try {
    body = await c.req.json<ChatRequest>();
  } catch {
    return c.json({ error: "JSON bodyを読み取れませんでした。" }, 400);
  }

  if (!body.workspaceId || !body.userId || !body.threadId || !body.message?.trim()) {
    return c.json(
      {
        error: "workspaceId, userId, threadId, message は必須です。",
      },
      400,
    );
  }

  const auth = await optionalAuth(c);
  const authGate = requireProductAuth(c, auth);
  if (authGate) return authGate;
  if (auth) {
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    body = {
      ...body,
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
    };
  }

  const policy = evaluateChatPolicy(body);
  if (policy.action === "reject_secret") {
    return c.json(buildSecretRejectedPayload(policy.categories), 400);
  }

  if (policy.action === "manual_media_steps") {
    return c.json(processMediaWriteRequest(body, policy.operations), 200);
  }

  const result = await processChat(body, auth ? { auth: { workspaceId: auth.workspace.id, userId: auth.user.id } } : {});
  return c.json(result.payload, result.status);
}

async function handleChatStream(c: Context) {
  let body: ChatRequest;
  try {
    body = await c.req.json<ChatRequest>();
  } catch {
    return c.json({ error: "JSON bodyを読み取れませんでした。" }, 400);
  }

  if (!body.workspaceId || !body.userId || !body.threadId || !body.message?.trim()) {
    return c.json(
      {
        error: "workspaceId, userId, threadId, message は必須です。",
      },
      400,
    );
  }

  const auth = await optionalAuth(c);
  const authGate = requireProductAuth(c, auth);
  if (authGate) return authGate;
  if (auth) {
    const billingGate = await requireBillingAccess(c, auth);
    if (billingGate) return billingGate;
    body = {
      ...body,
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
    };
  }

  const policy = evaluateChatPolicy(body);
  if (policy.action === "reject_secret") {
    return c.json(buildSecretRejectedPayload(policy.categories), 400);
  }

  if (policy.action === "manual_media_steps") {
    const result = processMediaWriteRequest(body, policy.operations);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };

        send({
          type: "status",
          label: "policy_guard",
          text: "媒体write依頼を検知したため、Agent Serviceで実行せず、承認付きwrite候補と人間向け手順に変換しています。",
        });
        send({ type: "done", payload: result });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const needsAdData = requiresLatestAdData(body.message);
  const range = parseRange(body.context?.range?.toString() ?? rangeFromDateRange(body.context?.dateRange));
  const platform = parsePlatform(body.context?.platform);
  const latestAdData = needsAdData ? await loadLatestAdData(body.workspaceId, range, platform, Boolean(auth)) : undefined;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      const statusEvents = buildChatStatusEvents(body, latestAdData, useAgentService);
      for (const [index, event] of statusEvents.entries()) {
        send({ type: "status", ...event });
        if (index < statusEvents.length - 1 && chatStatusEventDelayMs > 0) {
          await delay(chatStatusEventDelayMs);
        }
      }

      const result = await processChat(body, {
        latestAdData,
        ...(auth ? { auth: { workspaceId: auth.workspace.id, userId: auth.user.id } } : {}),
      });
      if (result.status >= 400) {
        send({ type: "error", payload: result.payload });
      } else {
        send({
          type: "status",
          label: "finalizing",
          text: "qa_agent の観点で、媒体writeになっていないかと回答形式を確認しています。",
        });
        send({ type: "done", payload: result.payload });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}

async function processChat(
  body: ChatRequest,
  options: ProcessChatOptions = {},
): Promise<{ payload: Record<string, unknown>; status: 200 | 502 }> {
  const needsAdData = requiresLatestAdData(body.message);
  const range = parseRange(body.context?.range?.toString() ?? rangeFromDateRange(body.context?.dateRange));
  const platform = parsePlatform(body.context?.platform);
  const latestAdData = options.latestAdData ?? (needsAdData ? await loadLatestAdData(body.workspaceId, range, platform, Boolean(options.auth)) : undefined);
  const productionContext = options.auth ? await buildProductionAgentContext(options.auth.workspaceId, options.auth.userId) : {};

  if (!useAgentService) {
    const data = latestAdData ? createMockChatResponse(body, latestAdData) : createLightweightChatResponse(body);
    const thread = options.auth
      ? await appendProductionChatExchange(body, data)
      : appendChatExchange(body, data);
    const artifacts = options.auth
      ? await storeProductionAdvisorArtifacts(body, data)
      : storeAdvisorArtifacts(body, data);
    return {
      status: 200,
      payload: {
        ...data,
        ...artifacts,
        thread,
        mode: options.auth ? "production-fallback" : "mock",
        ...(latestAdData ? { latestAdData } : {}),
        policy: {
          mediaWriteEnabled: false,
          humanInTheLoopRequired: true,
        },
      },
    };
  }

  const agentServiceRequestBody = {
    ...body,
    context: {
      dateRange: body.context?.dateRange ?? `last_${range}_days`,
      comparisonRange: body.context?.comparisonRange ?? `previous_${range}_days`,
      range,
      platform,
      advisorMode: advisorModeFromContext(body.context),
      agentEntry: advisorEntryFromContext(body.context),
      apiPersistence: Boolean(options.auth),
      ...productionContext,
    },
    ...(latestAdData ? { latestAdData } : {}),
  };
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), agentFetchTimeoutMs);

  try {
    const res = await fetch(`${agentServiceUrl}/chat`, {
      method: "POST",
      headers: await agentServiceHeaders(),
      signal: abortController.signal,
      body: JSON.stringify(agentServiceRequestBody),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        status: 502,
        payload: {
          error: "OpenAI Agent Serviceから正常な応答を取得できませんでした。",
          detail: text.slice(0, 400),
        },
      };
    }

    const data = (await res.json()) as ChatResponse;
    const thread = options.auth
      ? await appendProductionChatExchange(body, data)
      : appendChatExchange(body, data);
    const artifacts = options.auth
      ? await storeProductionAdvisorArtifacts(body, data)
      : storeAdvisorArtifacts(body, data);

    return { status: 200, payload: { ...data, ...artifacts, thread } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (isAgentServiceAuthError(message)) {
      return {
        status: 502,
        payload: {
          error: "OpenAI Agent Serviceの認証トークンを取得できませんでした。Cloud Runのサービスアカウント権限とAGENT_SERVICE_AUTH_MODEを確認してください。",
          code: "agent_service_auth_failed",
          detail: message.slice(0, 400),
        },
      };
    }
    return {
      status: 502,
      payload: {
        error:
          error instanceof DOMException && error.name === "AbortError"
            ? "OpenAI Agent Serviceの応答がタイムアウトしました。時間を置いて再試行してください。"
            : "OpenAI Agent Serviceに接続できません。`npm run dev:agent` が起動しているか確認してください。",
        detail: message,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isAgentServiceAuthError(message: string) {
  return /AGENT_SERVICE_AUTH_TOKEN|AGENT_SERVICE_AUTH_MODE|metadata identity token request failed/i.test(message);
}

export function startServer() {
  serve({ fetch: app.fetch, port });

  console.log(`adops-api listening on http://localhost:${port}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}

function splitTags(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function rangeFromDateRange(value: string | undefined) {
  if (value === "last_14_days") return "14";
  if (value === "last_30_days") return "30";
  return "7";
}

function buildChatStatusEvents(body: ChatRequest, latestAdData: LatestAdData | undefined, agentServiceEnabled: boolean) {
  const message = body.message.toLowerCase();
  if (isLightweightChatIntent(message)) {
    return [
      {
        label: "root_agent",
        text: "root_agent が挨拶・使い方確認として軽量ルーティングしています。",
      },
      {
        label: agentServiceEnabled ? "agent_service" : "mock_runtime",
        text: agentServiceEnabled
          ? "広告KPI payloadなしで OpenAI Agent Service に会話文脈を渡しています。"
          : "Agent Serviceプロキシが無効のため、mock runtime で軽量回答を生成しています。",
      },
    ];
  }
  if (!latestAdData) {
    return [
      {
        label: agentServiceEnabled ? "agent_service" : "mock_runtime",
        text: agentServiceEnabled ? "OpenAI Agent Service に会話文脈を渡しています。" : "mock runtime で回答を生成しています。",
      },
    ];
  }
  const tags = new Set(latestAdData.relatedTags.map((tag) => tag.toLowerCase()));
  const events = [
    {
      label: "root_agent",
      text: `root_agent が ${latestAdData.platform === "all" ? "全媒体" : latestAdData.platform} / 直近${latestAdData.range}日の相談としてルーティングしています。`,
    },
    {
      label: "metrics_tool",
      text: "fetch_campaign_metrics / compare_period_metrics 相当の広告KPI文脈を読み込んでいます。",
    },
  ];

  if (mentionsAny(message, ["cpa", "roas", "cvr", "ctr", "cpc", "悪化", "改善", "原因", "分析"]) || latestAdData.anomalies.length > 0) {
    const anomaly = latestAdData.anomalies[0];
    events.push({
      label: "performance_analyst_agent",
      text: `performance_analyst_agent が ${anomaly.type} と ${latestAdData.relatedTags.join(" / ") || "主要KPI"} の変化を見ています。`,
    });
  }

  if (mentionsAny(message, ["設定", "始め", "開始", "設計", "連携", "oauth", "アカウント"])) {
    events.push({
      label: "setup_advisor_agent",
      text: "setup_advisor_agent が連携状態、read-only権限、初期設定の文脈を確認しています。",
    });
  }

  if (mentionsAny(message, ["todo", "タスク", "手順", "次に", "やる", "作業", "改善案", "アクション"])) {
    events.push({
      label: "action_plan_agent",
      text: "action_plan_agent が担当者が管理画面で確認できる作業手順に変換しています。",
    });
  }

  if (
    mentionsAny(message, ["最新", "google検索", "検索して", "仕様", "アップデート", "変わった", "ナレッジ"]) ||
    tags.has("oauth") ||
    tags.has("measurement")
  ) {
    events.push({
      label: "google_search_latest_knowledge",
      text: "google_search_latest_knowledge の利用要否を判定しています。内部ナレッジとAdコラムで足りない場合だけ検索結果を補助にします。",
    });
  }

  if (mentionsAny(message, ["コラム", "記事", "学び", "知識", "ナレッジ"]) || latestAdData.relatedTags.length > 0) {
    events.push({
      label: "ad_column_knowledge",
      text: `Adコラム候補を ${latestAdData.relatedTags.slice(0, 3).join(" / ") || "monitoring"} タグで照合しています。`,
    });
  }

  events.push({
    label: agentServiceEnabled ? "agent_service" : "mock_runtime",
    text: agentServiceEnabled
      ? "OpenAI Agent Service に会話文脈を渡して、OpenAI実行結果を待っています。"
      : "Agent Serviceプロキシが無効のため、mock runtime で回答を生成しています。",
  });

  return events;
}

function isLightweightChatIntent(message: string) {
  const normalized = message.trim().replace(/[!！。.\s]/g, "");
  if (["こんにちは", "こんにちわ", "こんばんは", "おはよう", "hello", "hi", "はじめまして"].includes(normalized)) {
    return true;
  }
  return mentionsAny(message.toLowerCase(), [
    "使い方",
    "何ができる",
    "なにができる",
    "どう使う",
    "ヘルプ",
    "help",
    "how to use",
    "what can you do",
  ]);
}

function requiresLatestAdData(message: string) {
  const normalized = message.toLowerCase();
  if (isLightweightChatIntent(normalized)) return false;
  if (
    mentionsAny(normalized, [
      "コンバージョンとして",
      "cv地点",
      "コンバージョン地点",
      "コンバージョン値",
      "媒体で合って",
      "他媒体",
      "ターゲティング",
      "入札戦略",
      "検索クエリ",
      "仕様",
      "文字数",
      "使い方",
      "考え方",
    ])
  ) {
    return false;
  }
  return mentionsAny(normalized, [
    "今の",
    "現状",
    "状況",
    "うまくいって",
    "課題",
    "改善",
    "原因",
    "悪化",
    "取れない",
    "問い合わせ",
    "ボトルネック",
    "予算",
    "消化",
    "学習",
    "配信",
    "cpa",
    "roas",
    "cvr",
    "ctr",
    "cpc",
    "cv",
    "成果",
    "数値",
  ]);
}

function mentionsAny(message: string, terms: string[]) {
  return terms.some((term) => message.includes(term.toLowerCase()));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function googleWritePolicy() {
  return {
    access: "read-write-after-human-approval",
    mediaWriteEnabled: isGoogleAdsWriteConfigured(),
    humanInTheLoopRequired: true,
    platformMutationExecuted: true,
    note: "Google Ads writeは認証済みユーザーがconfirmed=trueで明示承認した場合だけ実行します。",
  };
}

function normalizeGoogleCampaignStatus(value: string | undefined) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "ENABLED" || normalized === "PAUSED") return normalized;
  return null;
}

function normalizeApprovalNote(value: string | undefined) {
  const normalized = redactSecretLikeText(String(value ?? "").trim().replace(/\s+/g, " "));
  if (normalized.length < 10) return null;
  if (!hasRollbackCondition(normalized)) return null;
  return normalized.slice(0, 1000);
}

function hasRollbackCondition(value: string) {
  return /戻す|戻し|復元|ロールバック|rollback|restore|revert|元に/i.test(value);
}

function redactSecretLikeText(value: string) {
  return value
    .replace(/\b(?:sk|pk|rk|whsec)[_-][A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED]")
    .replace(/\bAuthorization\s*:?\s*Bearer\s+[^"',\s\n]+/gi, "Authorization=[REDACTED]")
    .replace(
      /\b(refresh[_-]?token|access[_-]?token|oauth[_-]?token|api[_-]?key|client[_-]?secret|developer[_-]?token|service[_-]?role)\s*[:=]\s*["']?[^"',\s\n]+/gi,
      "[REDACTED]",
    );
}

function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID && process.env.STRIPE_WEBHOOK_SECRET);
}

function isUsableSubscriptionStatus(status: string) {
  return ["active", "trialing", "checkout_completed"].includes(status);
}

function requireStripeConfigured(c: Context, workspaceId: string) {
  if (isStripeConfigured()) return null;
  return c.json(
    {
      error: "billing_not_configured",
      code: "billing_not_configured",
      workspaceId,
      access: "billing_required",
      message: "Stripe billing is not configured. Set STRIPE_SECRET_KEY, STRIPE_PRICE_ID, and STRIPE_WEBHOOK_SECRET before billing flows.",
    },
    503,
  );
}

async function requireBillingAccess(c: Context, auth: Awaited<ReturnType<typeof authenticateRequest>>) {
  if (!isStripeConfigured()) {
    if (!isStrictProductionMode()) return null;
    return requireStripeConfigured(c, auth.workspace.id);
  }
  const subscription = await getBillingSubscription(auth.workspace.id);
  if (subscription && isUsableSubscriptionStatus(subscription.status)) return null;
  return c.json(
    {
      error: "billing_required",
      code: "billing_required",
      workspaceId: auth.workspace.id,
      access: "billing_required",
      message: "この機能を利用するにはStripe Checkoutで課金を有効化してください。",
    },
    402,
  );
}

function requireProductAuth(c: Context, auth: Awaited<ReturnType<typeof optionalAuth>>) {
  if (auth || (!isStrictProductionMode() && !(isSupabaseConfigured() && isStripeConfigured()))) return null;
  return c.json(
    {
      error: "authentication_required",
      code: "authentication_required",
      message: "この機能を利用するにはログインが必要です。",
    },
    401,
  );
}

async function agentServiceHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (agentServiceAuthMode === "none" || agentServiceAuthMode === "") return headers;
  if (agentServiceAuthMode === "bearer") {
    const token = process.env.AGENT_SERVICE_AUTH_TOKEN?.trim();
    if (!token) throw new Error("AGENT_SERVICE_AUTH_TOKEN is required when AGENT_SERVICE_AUTH_MODE=bearer");
    headers.Authorization = `Bearer ${token}`;
    return headers;
  }
  if (agentServiceAuthMode === "google_id_token") {
    headers.Authorization = `Bearer ${await fetchGoogleIdentityToken(agentServiceAudience)}`;
    return headers;
  }
  throw new Error("AGENT_SERVICE_AUTH_MODE must be none, bearer, or google_id_token");
}

async function fetchGoogleIdentityToken(audience: string): Promise<string> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 2500);
  try {
    const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`;
    const response = await fetch(url, {
      headers: { "Metadata-Flavor": "Google" },
      signal: abortController.signal,
    });
    const token = (await response.text()).trim();
    if (!response.ok || !token) throw new Error(`metadata identity token request failed with HTTP ${response.status}`);
    return token;
  } finally {
    clearTimeout(timeout);
  }
}

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

class StripeWebhookError extends Error {}

async function createStripeCheckoutSession(auth: Awaited<ReturnType<typeof authenticateRequest>>) {
  const existingCustomer = await getBillingCustomer(auth.workspace.id);
  const params = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": requiredStripeEnv("STRIPE_PRICE_ID"),
    "line_items[0][quantity]": "1",
    success_url: `${webOrigin()}/?billing=success`,
    cancel_url: `${webOrigin()}/?billing=cancelled`,
    client_reference_id: auth.workspace.id,
    "metadata[workspace_id]": auth.workspace.id,
    "metadata[user_id]": auth.user.id,
    "subscription_data[metadata][workspace_id]": auth.workspace.id,
    "subscription_data[metadata][user_id]": auth.user.id,
  });
  if (existingCustomer?.stripe_customer_id) {
    params.set("customer", existingCustomer.stripe_customer_id);
  } else if (auth.user.email) {
    params.set("customer_email", auth.user.email);
  }
  const session = await stripeRequest<{ id: string; url: string }>("/v1/checkout/sessions", params);
  await recordAuditLog({
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
    eventType: "stripe.checkout_session_created",
    payload: { sessionId: session.id },
  });
  return session;
}

async function createStripePortalSession(auth: Awaited<ReturnType<typeof authenticateRequest>>, stripeCustomerId: string) {
  const params = new URLSearchParams({
    customer: stripeCustomerId,
    return_url: `${webOrigin()}/?billing=portal-return`,
  });
  const session = await stripeRequest<{ id: string; url: string }>("/v1/billing_portal/sessions", params);
  await recordAuditLog({
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
    eventType: "stripe.portal_session_created",
    payload: {
      sessionId: session.id,
      stripeCustomerId,
    },
  });
  return session;
}

async function stripeRequest<T>(path: string, params: URLSearchParams): Promise<T> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredStripeEnv("STRIPE_SECRET_KEY")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Stripe API request failed: ${redactStripeProviderError(detail).slice(0, 240)}`);
  }
  return (await res.json()) as T;
}

function redactStripeProviderError(value: string) {
  return value
    .replace(/\b(?:sk|pk|rk|whsec)[_-][A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bAuthorization\s*:?\s*Bearer\s+[^"',\s\n]+/gi, "Authorization=[REDACTED]")
    .replace(/https:\/\/(?:checkout|billing)\.stripe\.[^\s"',)]+/gi, "[REDACTED_URL]");
}

function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string) {
  const secret = requiredStripeEnv("STRIPE_WEBHOOK_SECRET");
  const parts = Object.fromEntries(
    signatureHeader
      .split(",")
      .map((part) => part.split("="))
      .filter((part): part is [string, string] => part.length === 2),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) throw new StripeWebhookError("Stripe webhook signatureが不正です。");
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) throw new StripeWebhookError("Stripe webhook signatureが期限切れです。");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const received = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (received.length !== expectedBuffer.length || !timingSafeEqual(received, expectedBuffer)) {
    throw new StripeWebhookError("Stripe webhook signatureを検証できませんでした。");
  }
}

async function handleStripeWebhookEvent(event: StripeEvent) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const workspaceId = stripeCheckoutWebhookWorkspaceId(session, event.type);
    const userId = optionalStripeWebhookUuid(stringValue(session.metadata, "user_id"), "metadata.user_id", event.type);
    const customerId = stringValue(session, "customer");
    if (!customerId) throw new StripeWebhookError("Stripe checkout.session.completed webhook requires customer.");
    await assertStripeCustomerWorkspace(customerId, workspaceId, event.type);
    await upsertBillingCustomer({ workspaceId, userId, stripeCustomerId: customerId });
    await upsertBillingSubscription({
      workspaceId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: stringValue(session, "subscription"),
      status: "checkout_completed",
      raw: { eventId: event.id, type: event.type },
    });
    return { handled: true, eventType: event.type };
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const workspaceId = requireStripeWebhookUuid(stringValue(subscription.metadata, "workspace_id"), "metadata.workspace_id", event.type);
    const customerId = stringValue(subscription, "customer");
    const subscriptionId = stringValue(subscription, "id");
    if (!customerId) throw new StripeWebhookError(`${event.type} webhook requires customer.`);
    if (!subscriptionId) throw new StripeWebhookError(`${event.type} webhook requires subscription id.`);
    await assertStripeCustomerWorkspace(customerId, workspaceId, event.type);
    await upsertBillingSubscription({
      workspaceId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: stripeSubscriptionPriceId(subscription),
      status: stringValue(subscription, "status") || "unknown",
      currentPeriodEnd: stripePeriodEnd(subscription),
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      raw: { eventId: event.id, type: event.type },
    });
    return { handled: true, eventType: event.type };
  }

  return { handled: false, ignored: true, eventType: event.type };
}

async function assertStripeCustomerWorkspace(stripeCustomerId: string, workspaceId: string, eventType: string) {
  const existing = await getBillingCustomerByStripeCustomerId(stripeCustomerId);
  if (existing && existing.workspace_id !== workspaceId) {
    throw new StripeWebhookError(`${eventType} webhook customer is already linked to another workspace.`);
  }
}

function stripeCheckoutWebhookWorkspaceId(session: Record<string, unknown>, eventType: string) {
  const metadataWorkspaceId = stringValue(session.metadata, "workspace_id");
  const clientReferenceId = stringValue(session, "client_reference_id");
  const workspaceId = requireStripeWebhookUuid(metadataWorkspaceId || clientReferenceId, "metadata.workspace_id", eventType);
  if (metadataWorkspaceId && clientReferenceId && metadataWorkspaceId !== clientReferenceId) {
    throw new StripeWebhookError(`${eventType} webhook metadata.workspace_id must match client_reference_id.`);
  }
  return workspaceId;
}

function requireStripeWebhookUuid(value: string | null, field: string, eventType: string) {
  if (!value) throw new StripeWebhookError(`${eventType} webhook requires ${field}.`);
  if (!isUuid(value)) throw new StripeWebhookError(`${eventType} webhook ${field} must be a UUID.`);
  return value;
}

function optionalStripeWebhookUuid(value: string | null, field: string, eventType: string) {
  if (!value) return null;
  if (!isUuid(value)) throw new StripeWebhookError(`${eventType} webhook ${field} must be a UUID.`);
  return value;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function stripeSubscriptionPriceId(subscription: Record<string, unknown>) {
  const items = subscription.items;
  if (!items || typeof items !== "object" || !Array.isArray((items as { data?: unknown[] }).data)) return null;
  const first = (items as { data: Array<{ price?: { id?: string } }> }).data[0];
  return first?.price?.id ?? null;
}

function stripePeriodEnd(subscription: Record<string, unknown>) {
  const value = Number(subscription.current_period_end);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function stringValue(source: unknown, key: string) {
  if (!source || typeof source !== "object") return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

function webOrigin() {
  return (process.env.WEB_ORIGIN ?? "http://localhost:5173").replace(/\/+$/, "");
}

function requiredStripeEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function handleAuthError(c: Context, error: unknown) {
  if (error instanceof AuthError) {
    return c.json({ error: error.message }, error.status);
  }
  if (error instanceof GoogleAdsWriteError) {
    return c.json({ error: error.message }, error.status);
  }
  const message = error instanceof Error ? error.message : "認証処理に失敗しました。";
  return c.json({ error: message }, 500);
}

async function optionalAuth(c: Context) {
  if (!c.req.header("Authorization") || !isSupabaseConfigured()) return null;
  try {
    return await authenticateRequest(c.req.raw);
  } catch (error) {
    if (isStrictProductionMode()) throw error;
    return null;
  }
}

function isStrictProductionMode() {
  return process.env.APP_ENV === "production" || process.env.AUTH_REQUIRED === "true";
}

async function loadLatestAdData(workspaceId: string, range: number, platform: ReturnType<typeof parsePlatform>, preferDb: boolean) {
  if (preferDb && isSupabaseConfigured()) {
    try {
      const dbData = await getLatestAdDataFromDb(workspaceId, range, platform);
      if (dbData) return dbData as LatestAdData;
    } catch {
      if (isStrictProductionMode()) throw new AuthError("実広告データの取得に失敗しました。", 500);
    }
  }
  return getLatestAdData(workspaceId, range, platform);
}

async function buildProductionAgentContext(workspaceId: string, userId: string): Promise<Record<string, unknown>> {
  try {
    const [workspaceProfile, memories, feedback, recentRecommendations, recentTasks] = await Promise.all([
      getWorkspaceProfile(workspaceId),
      listUserMemories(workspaceId, userId, 8),
      listRecentOperatorFeedback(workspaceId, userId, 8),
      listRecommendations(workspaceId).then((items) => items.slice(0, 5)),
      listHumanTasks(workspaceId).then((items) => items.slice(0, 5)),
    ]);
    return sanitizeAgentContext({
      workspaceProfile,
      userMemories: memories,
      operatorFeedbackSummary: summarizeFeedback(feedback),
      recentRecommendations: recentRecommendations.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        confidence: item.confidence,
      })),
      recentHumanTasks: recentTasks.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        priority: item.priority,
      })),
    }) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function summarizeFeedback(feedback: Awaited<ReturnType<typeof listRecentOperatorFeedback>>) {
  return feedback.map((item) => ({
    outcome: item.outcome,
    comment: item.comment,
    createdAt: item.created_at,
    recommendationId: item.recommendation_id,
    humanTaskId: item.human_task_id,
  }));
}

function sanitizeAgentContext(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeAgentContext(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/token|secret|password|api[_-]?key|authorization|service[_-]?role/i.test(key))
        .map(([key, item]) => [key, sanitizeAgentContext(item)]),
    );
  }
  if (
    typeof value === "string" &&
    /\b(eyJ[A-Za-z0-9_-]{10,}\.|AIza[A-Za-z0-9_-]{20,}|(?:sk|pk|rk)-[A-Za-z0-9_-]{10,}|(?:refresh[_-]?token|access[_-]?token|oauth[_-]?token|api[_-]?key|client[_-]?secret|developer[_-]?token|service[_-]?role)\s*[:=]\s*[^\s]+)/i.test(value)
  ) {
    return "[REDACTED]";
  }
  return value;
}

async function appendProductionChatExchange(body: ChatRequest, data: ChatResponse) {
  await ensureAgentThread(body.workspaceId, body.userId, body.threadId, body.message);
  await appendAgentMessage({
    workspaceId: body.workspaceId,
    userId: body.userId,
    threadId: body.threadId,
    role: "user",
    content: body.message,
  });
  await appendAgentMessage({
    workspaceId: body.workspaceId,
    userId: body.userId,
    threadId: body.threadId,
    role: "assistant",
    content: data.message.content,
    metadata: { recommendation: data.recommendation, humanTaskDraft: data.humanTaskDraft },
  });
  const thread = await getAgentThread(body.workspaceId, body.userId, body.threadId);
  return {
    thread: {
      id: thread.thread.id,
      workspaceId: thread.thread.workspace_id,
      userId: thread.thread.user_id,
      title: thread.thread.title,
      updatedAt: thread.thread.updated_at,
    },
    messages: thread.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
    })),
  };
}

function evaluateChatPolicy(body: ChatRequest): ChatPolicyResult {
  const inspectedText = collectInspectableText(body).join("\n");
  const secretCategories = detectSecretLikeInput(inspectedText);
  if (secretCategories.length > 0) {
    return {
      action: "reject_secret",
      categories: secretCategories,
    };
  }

  const mediaOperations = detectMediaWriteRequest(body.message);
  if (mediaOperations.length > 0) {
    return {
      action: "manual_media_steps",
      operations: mediaOperations,
    };
  }

  return { action: "allow" };
}

function collectInspectableText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];

  return Object.entries(value)
    .filter(([key]) => !["workspaceId", "userId", "threadId"].includes(key))
    .flatMap(([, nested]) => collectInspectableText(nested));
}

function detectSecretLikeInput(text: string) {
  const patterns: Array<{ category: string; pattern: RegExp }> = [
    { category: "api_key", pattern: /\b(api[_-]?key|developer[_-]?token|client[_-]?secret)\b[^\n]{0,80}[:=]\s*["']?[A-Za-z0-9_\-.]{12,}/i },
    { category: "api_key", pattern: /\b(?:sk|pk|rk)-(?:test|live|proj|dummy)?-?[A-Za-z0-9_-]{10,}\b/i },
    { category: "api_key", pattern: /\bAIza[A-Za-z0-9_-]{20,}\b/ },
    { category: "oauth_token", pattern: /\b(access[_-]?token|refresh[_-]?token|oauth[_-]?token)\b[^\n]{0,80}[:=]\s*["']?[A-Za-z0-9_\-.]{12,}/i },
    { category: "bearer_token", pattern: /\bbearer\s+[A-Za-z0-9_\-.]{20,}/i },
    { category: "supabase_service_role", pattern: /\b(service[_-]?role|supabase[_-]?service[_-]?role[_-]?key)\b[^\n]{0,80}[:=]\s*["']?[A-Za-z0-9_\-.]{12,}/i },
    { category: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  ];

  return [...new Set(patterns.filter(({ pattern }) => pattern.test(text)).map(({ category }) => category))];
}

function buildSecretRejectedPayload(categories: string[]) {
  return {
    error: "秘密情報らしき入力を検知したため、チャットには保存せずAIにも送信しませんでした。",
    code: "secret_like_input_rejected",
    categories,
    guidance:
      "OAuth token、refresh token、API key、client secret、service role keyは貼り付けないでください。すでに共有した可能性がある場合は、該当credentialをローテーションしてください。",
    policy: {
      secretStored: false,
      sentToAdk: false,
      repeatedSecretValue: false,
      mediaWriteEnabled: false,
      humanInTheLoopRequired: true,
    },
  };
}

function detectMediaWriteRequest(message: string): MediaWriteOperation[] {
  const normalized = message.toLowerCase();
  const checks: Array<{ operation: MediaWriteOperation; terms: string[] }> = [
    { operation: "budget", terms: ["予算を上げ", "予算を下げ", "予算変更", "予算を変更", "予算を調整", "予算を設定", "予算を反映", "予算を増や", "予算を減ら", "増額", "減額", "budget increase", "increase budget", "decrease budget", "change budget", "set budget", "update budget"] },
    { operation: "campaign_status", terms: ["キャンペーンを停止", "広告を停止", "配信停止", "一時停止", "止めて", "停止して", "pause campaign", "stop campaign", "disable campaign"] },
    { operation: "bid", terms: ["入札を上げ", "入札を下げ", "入札変更", "入札を変更", "入札を調整", "入札を設定", "入札戦略を変更", "入札単価を変更", "bid increase", "increase bid", "decrease bid", "change bid", "set bid", "update bid"] },
    { operation: "ad_creation", terms: ["広告を入稿", "広告を作成", "広告作成", "クリエイティブを入稿", "create ad", "submit ad", "publish ad"] },
    { operation: "targeting", terms: ["ターゲティングを変更", "オーディエンスを変更", "除外キーワードを追加", "add negative keyword", "change targeting"] },
    { operation: "platform_mutation", terms: ["媒体に反映", "管理画面に反映", "変更しておいて", "apply the change", "make the change"] },
  ];

  const operations = checks.filter(({ terms }) => mentionsAny(normalized, terms)).map(({ operation }) => operation);
  if (/予算[^\n。]{0,30}(して|変更|調整|設定|反映|上げ|下げ|増や|減ら)/.test(normalized)) {
    operations.push("budget");
  }
  if (/入札[^\n。]{0,30}(して|変更|調整|設定|反映|上げ|下げ)/.test(normalized)) {
    operations.push("bid");
  }
  return [...new Set(operations)];
}

function processMediaWriteRequest(body: ChatRequest, operations: MediaWriteOperation[]) {
  const data = createMediaWritePolicyResponse(operations);
  const thread = appendChatExchange(body, data);
  storeAdvisorArtifacts(body, data);
  return {
    ...data,
    thread,
    mode: "write-approval-required",
    policy: {
      mediaWriteEnabled: isGoogleAdsWriteConfigured(),
      humanInTheLoopRequired: true,
      platformMutationExecuted: false,
      interceptedOperations: operations,
      executableAfterApproval: operations.some((operation) => operation === "budget" || operation === "campaign_status"),
      executionRoutes: [
        "POST /google/customers/:customerId/campaigns/:campaignId/status",
        "POST /google/customers/:customerId/campaigns/:campaignId/budget",
      ],
    },
  };
}

function createLightweightChatResponse(body?: ChatRequest): ChatResponse {
  const advisorMode = advisorModeFromContext(body?.context);
  const beginnerContent = [
    "結論: こんにちは。広告データ分析、CPA/CVR/ROASの意味、原因仮説、次に人間が確認する作業をわかりやすく整理できます。",
    "",
    "推奨アクション: まずは「CPAが悪い理由を教えて」「どの数字から見ればいい？」のように聞いてください。専門用語は短く補足しながら説明します。",
    "",
    "人間向け作業手順: 相談したい媒体、期間、気になるKPIを1つ添えると、見る順番と管理画面での確認手順に分けて返します。",
    "",
    "実施前チェック: AIチャット単体では媒体設定を直接変更しません。Google Adsのcampaign status / budget変更は、担当者が対象ID、変更理由、戻し条件を確認し、承認付きAPI routeで実行する前提です。",
    "",
    "自信度: high",
  ].join("\n");
  const experiencedContent = [
    "結論: 広告運用の診断、KPI分解、優先順位付け、変更候補のレビュー設計まで支援できます。",
    "",
    "推奨アクション: CPA/CVR/CPC/CTR/ROAS、campaign/ad group/ad/search term/placement単位、期間比較、CV母数、計測差分を指定して相談してください。",
    "",
    "人間向け作業手順: 期間、媒体、対象階層、見たいKPIを渡してください。write操作は実行せず、候補・影響額・戻し条件・観察指標に落とします。",
    "",
    "実施前チェック: attribution、CV定義、tag欠損、LP deploy、学習状態、budget pacingを確認してください。",
    "",
    "自信度: high",
  ].join("\n");
  return {
    message: {
      role: "assistant",
      content: advisorMode === "experienced" ? experiencedContent : beginnerContent,
    },
    recommendation: {
      title: "相談したいKPIと期間を指定する",
      confidence: "high",
      operatorSteps: ["媒体、期間、気になるKPIを入力する", "AIの提案を確認し、必要な作業だけ人間が手動実行する"],
    },
    humanTaskDraft: {
      title: "最初の相談内容を入力する",
      priority: "low",
      status: "suggested",
    },
  };
}

function serializeSetupIntake(intake: SetupIntakeRow, messages: SetupIntakeMessageRow[]) {
  const score = normalizeScore(intake.score);
  const storedSteps = normalizeSetupSteps(intake.generated_steps ?? []);
  const setupSteps = score >= 80 && shouldRegenerateSetupSteps(storedSteps)
    ? buildSetupStepsFromFacts(intake.facts ?? {})
    : storedSteps;
  return {
    intake: {
      id: intake.id,
      title: intake.title,
      status: intake.status,
      score,
      dimensionScores: normalizeDimensionScores(intake.dimension_scores),
      facts: intake.facts ?? {},
      missingFields: intake.missing_fields ?? [],
      readyForSetupSteps: score >= 80,
      setupSteps,
      archivedAt: intake.archived_at ?? null,
      createdAt: intake.created_at,
      updatedAt: intake.updated_at,
    },
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
    })),
  };
}

function serializeSetupIntakeSummary(intake: SetupIntakeRow) {
  const score = normalizeScore(intake.score);
  return {
    id: intake.id,
    title: intake.title,
    status: intake.status,
    score,
    readyForSetupSteps: score >= 80,
    archivedAt: intake.archived_at ?? null,
    createdAt: intake.created_at,
    updatedAt: intake.updated_at,
  };
}

async function safeJson<T>(c: Context): Promise<T> {
  try {
    return await c.req.json<T>();
  } catch {
    return {} as T;
  }
}

function deriveSetupIntakeTitle(currentTitle: string, facts: Record<string, unknown>) {
  const generic = !currentTitle || currentTitle === "新しい広告準備" || currentTitle.startsWith("広告準備 ");
  if (!generic) return currentTitle;
  const product = String(facts.product ?? "").split("\n")[0]?.trim();
  if (!product) return currentTitle || "新しい広告準備";
  return `${product.slice(0, 28)}の広告準備`;
}

async function runSetupIntakeAgent(input: {
  message: string;
  intake: SetupIntakeRow;
  messages: SetupIntakeMessageRow[];
  workspaceId: string;
  userId: string;
}): Promise<SetupIntakeAgentResult> {
  if (useAgentService) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), agentFetchTimeoutMs);
    try {
      const res = await fetch(`${agentServiceUrl}/setup-intake/message`, {
        method: "POST",
        headers: await agentServiceHeaders(),
        signal: abortController.signal,
        body: JSON.stringify({
          workspaceId: input.workspaceId,
          userId: input.userId,
          message: input.message,
          facts: input.intake.facts ?? {},
          messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
        }),
      });
      if (res.ok) {
        return normalizeSetupAgentResult(await res.json());
      }
    } catch {
      // Fall through to deterministic local scoring so the setup page remains usable during local dev.
    } finally {
      clearTimeout(timeout);
    }
  }
  return buildLocalSetupIntakeResult(input.message, input.intake.facts ?? {}, input.messages);
}

export function buildLocalSetupIntakeResult(message: string, previousFacts: Record<string, unknown>, messages: SetupIntakeMessageRow[] = []): SetupIntakeAgentResult {
  const facts = extractSetupFacts(message, previousFacts, messages);
  const dimensionScores = scoreSetupFacts(facts);
  const score = Object.values(dimensionScores).reduce((sum, value) => sum + value, 0);
  const missingFields = setupMissingFields(dimensionScores);
  const readyForSetupSteps = score >= 80;
  const nextField = readyForSetupSteps ? "" : nextSetupField(missingFields, facts);
  facts._intakeState = setupStateFor(facts, dimensionScores, nextField);
  const setupSteps = readyForSetupSteps ? buildSetupStepsFromFacts(facts) : [];
  return {
    assistantMessage: buildSetupAssistantMessage(facts, score, missingFields, readyForSetupSteps, nextField),
    extractedFacts: facts,
    dimensionScores,
    score,
    missingFields,
    readyForSetupSteps,
    setupSteps,
  };
}

function setupWelcomeMessage() {
  return "広告準備専用のヒアリングを始めます。まず、何を広告で増やしたいか、商材、誰に届けたいかをざっくり教えてください。まだ曖昧で大丈夫です。";
}

const setupFieldOrder = ["goal", "product", "audience", "budget", "platforms", "measurement"] as const;
type SetupField = typeof setupFieldOrder[number];

function extractSetupFacts(message: string, previousFacts: Record<string, unknown>, messages: SetupIntakeMessageRow[]) {
  const text = message.trim();
  const current = { ...previousFacts };
  const state = normalizeSetupState(current);
  delete current._intakeState;
  const lower = text.toLowerCase();
  const numbered = numberedSetupAssignments(text, state, messages);
  const activeField = typeof state.activeField === "string" && isSetupField(state.activeField) ? state.activeField : "";
  if (Object.keys(numbered).length > 0) {
    Object.entries(numbered).forEach(([field, value]) => setSetupFact(current, field, value, true));
  } else if (activeField) {
    setSetupFact(current, activeField, text, true);
  }
  if (/(問い合わせ|購入|予約|来店|資料請求|リード|売上|認知|cv|コンバージョン)/i.test(text)) setSetupFact(current, "goal", text);
  if (/(サービス|商品|商材|lp|価格|月額|店舗|saas|ai|エージェント|広告運用|不動産|管理)/i.test(text)) setSetupFact(current, "product", text);
  if (/(向け|ターゲット|顧客|企業|個人|担当者|経営者|決裁|従業員|管理戸数|オーナー|会社|法人|地域|業界|層|追わない|除外)/i.test(text)) setSetupFact(current, "audience", text);
  if (hasBudgetAmount(text) || /(予算|円|万円|月|初月|cpa|cpl|単価|上限)/i.test(text)) setSetupFact(current, "budget", text);
  if (/(計測|ga4|gtm|タグ|thanks|サンクス|フォーム完了|問い合わせ完了|電話|crm|hubspot|コンバージョン)/i.test(text)) setSetupFact(current, "measurement", text);
  const platforms = new Set(Array.isArray(current.platforms) ? current.platforms.map(String) : []);
  if (/google|グーグル|検索/i.test(lower)) platforms.add("google");
  if (/meta|facebook|instagram|インスタ|fb/i.test(lower)) platforms.add("meta");
  if (/yahoo|ヤフー/i.test(lower)) platforms.add("yahoo");
  if (platforms.size > 0) current.platforms = [...platforms];
  current.lastNote = text;
  current._intakeState = state;
  return current;
}

function normalizeSetupState(facts: Record<string, unknown>) {
  const raw = facts._intakeState && typeof facts._intakeState === "object" ? facts._intakeState as Record<string, unknown> : {};
  const answered = new Set(Array.isArray(raw.answeredFields) ? raw.answeredFields.map(String).filter(isSetupField) : []);
  setupFieldOrder.forEach((field) => {
    if (hasSetupFact(facts, field)) answered.add(field);
  });
  return {
    activeField: isSetupField(String(raw.activeField ?? "")) ? String(raw.activeField) : "",
    lastAskedFields: Array.isArray(raw.lastAskedFields) ? raw.lastAskedFields.map(String).filter(isSetupField) : [],
    answeredFields: setupFieldOrder.filter((field) => answered.has(field)),
    fieldConfidence: raw.fieldConfidence && typeof raw.fieldConfidence === "object" ? raw.fieldConfidence : {},
  };
}

function numberedSetupAssignments(text: string, state: ReturnType<typeof normalizeSetupState>, messages: SetupIntakeMessageRow[]) {
  let asked = state.lastAskedFields;
  if (asked.length <= 1) asked = askedSetupFieldsFromMessages(messages);
  if (asked.length <= 1) return {} as Record<string, string>;
  const result: Record<string, string> = {};
  for (const match of text.matchAll(/(?:^|\n)\s*(\d+)[.)．、]?\s*([^\n]+)/g)) {
    const field = asked[Number(match[1]) - 1];
    if (field && match[2]?.trim()) result[field] = match[2].trim();
  }
  return result;
}

function askedSetupFieldsFromMessages(messages: SetupIntakeMessageRow[]) {
  const questions = setupQuestions();
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") continue;
    const fields = setupFieldOrder.filter((field) => message.content.includes(questions[field].slice(0, 15)));
    if (fields.length) return fields;
  }
  return [];
}

function setSetupFact(facts: Record<string, unknown>, field: string, value: string, force = false) {
  if (!isSetupField(field)) return;
  const text = String(value ?? "").trim();
  if (!text) return;
  if (field === "platforms") {
    const platforms = new Set(Array.isArray(facts.platforms) ? facts.platforms.map(String) : []);
    if (/google|グーグル|検索/i.test(text)) platforms.add("google");
    if (/meta|facebook|instagram|インスタ|fb/i.test(text)) platforms.add("meta");
    if (/yahoo|ヤフー/i.test(text)) platforms.add("yahoo");
    if (platforms.size) facts.platforms = [...platforms];
    return;
  }
  const existing = String(facts[field] ?? "").trim();
  if (force || !existing) facts[field] = text;
}

function scoreSetupFacts(facts: Record<string, unknown>) {
  return {
    goal: scoreSetupGoal(facts.goal),
    product: scoreSetupProduct(facts.product),
    audience: scoreSetupAudience(facts.audience),
    budget: scoreSetupBudget(facts.budget),
    platforms: Array.isArray(facts.platforms) && facts.platforms.length > 0 ? 10 : 0,
    measurement: scoreSetupMeasurement(facts.measurement),
  };
}

function scoreSetupGoal(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  return /(問い合わせ|資料請求|購入|予約|来店|リード|売上|cv|コンバージョン)/i.test(text) ? 15 : 8;
}

function scoreSetupProduct(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  let score = 10;
  if (/(ai|saas|サービス|商品|商材|エージェント|不動産|管理)/i.test(text)) score += 4;
  if (/(価格|月額|万円|円)/i.test(text)) score += 3;
  if (text.length >= 35) score += 3;
  return Math.min(score, 20);
}

function scoreSetupAudience(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  let score = 8;
  if (/(ターゲット|顧客|届けたい|狙う|向け)/.test(text)) score += 3;
  if (/(従業員|管理戸数|売上|規模|名以上|戸以上|以上)/.test(text)) score += 5;
  if (/(決裁|経営者|担当者|責任者|会社|法人|企業|業界|中小|管理会社)/.test(text)) score += 5;
  if (/(追わない|除外|ではなく|以外|自社物)/.test(text)) score += 2;
  return Math.min(score, 20);
}

function scoreSetupBudget(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (hasBudgetAmount(text)) return /(月|初月|上限|予算)/.test(text) ? 15 : 12;
  return 7;
}

function scoreSetupMeasurement(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  let score = 8;
  if (/(フォーム完了|問い合わせ完了|サンクス|thanks|電話|資料請求)/i.test(text)) score += 6;
  if (/(ga4|gtm|タグ|crm|hubspot|媒体)/i.test(text)) score += 6;
  return Math.min(score, 20);
}

function setupMissingFields(scores: Record<string, number>) {
  const requiredMax: Record<string, number> = { goal: 15, product: 20, audience: 20, budget: 15, platforms: 10, measurement: 20 };
  return Object.entries(requiredMax)
    .filter(([key, max]) => (scores[key] ?? 0) < Math.ceil(max * 0.7))
    .map(([key]) => key);
}

function nextSetupField(missingFields: string[], facts: Record<string, unknown>) {
  const state = normalizeSetupState(facts);
  return missingFields.find((field) => field !== state.activeField) ?? missingFields[0] ?? "";
}

function setupStateFor(facts: Record<string, unknown>, scores: Record<string, number>, nextField: string) {
  return {
    activeField: nextField,
    lastAskedFields: nextField ? [nextField] : [],
    answeredFields: setupFieldOrder.filter((field) => hasSetupFact(facts, field)),
    fieldConfidence: scores,
  };
}

function buildSetupAssistantMessage(facts: Record<string, unknown>, score: number, missingFields: string[], ready: boolean, nextField = "") {
  if (ready) {
    return `準備スコアは ${score}/100 です。出稿ステップを確認できる状態になりました。次は計測、媒体設定、初回7日間の観察ルールを確認してください。`;
  }
  const question = setupQuestionForField(nextField || missingFields[0] || "");
  return [
    `準備スコアは ${score}/100 です。ここまでの内容は保存しました。`,
    setupCapturedSummary(facts),
    "",
    `次に1つだけ確認します。${question}`,
    "媒体設定の直接変更は行わず、準備が整ったら人間向けの確認手順に変換します。",
  ].join("\n");
}

function setupQuestionForField(field: string) {
  const questions = setupQuestions();
  return questions[field] ?? "不足している前提をもう少し教えてください。";
}

function setupQuestions(): Record<string, string> {
  return {
    goal: "今回の広告で一番増やしたい成果は何ですか？問い合わせ、購入、予約などで教えてください。",
    product: "売りたい商材の内容、価格帯、選ばれる理由を教えてください。",
    audience: "最初に届けたい顧客像を、会社規模・業種・役職などで教えてください。追わない層があればそれも添えてください。",
    budget: "初月の広告予算、またはこれ以上は使いたくない上限を教えてください。",
    platforms: "Google、Meta、Yahooのうち、使いたい媒体や迷っている媒体はありますか？",
    measurement: "成果地点と計測方法は決まっていますか？例: フォーム完了、電話、GA4/GTMなど。",
  };
}

function setupCapturedSummary(facts: Record<string, unknown>) {
  const labels: Record<SetupField, string> = { goal: "目的", product: "商材", audience: "ターゲット", budget: "予算", platforms: "媒体", measurement: "計測" };
  const parts = setupFieldOrder
    .filter((field) => hasSetupFact(facts, field))
    .map((field) => {
      const value = facts[field];
      const text = Array.isArray(value) ? value.join(" / ") : String(value ?? "");
      return `${labels[field]}: ${text.slice(0, 48)}`;
    });
  return parts.length ? `保存済み: ${parts.join("、")}` : "保存済み: まだ主要項目は未確定です。";
}

function hasSetupFact(facts: Record<string, unknown>, field: SetupField) {
  const value = facts[field];
  if (field === "platforms") return Array.isArray(value) && value.length > 0;
  return Boolean(String(value ?? "").trim());
}

function isSetupField(value: string): value is SetupField {
  return (setupFieldOrder as readonly string[]).includes(value);
}

function hasBudgetAmount(text: string) {
  return /(?:\d{2,}(?:,\d{3})*|\d+(?:\.\d+)?\s*万)\s*(?:円|くらい|程度|前後)?/.test(text);
}

type SetupInstructionConfig = {
  platforms: string[];
  goal: string;
  product: string;
  audience: string;
  budget: string;
  measurement: string;
  conversionEvent: string;
  campaignName: string;
  keywords: string[];
  exclusions: string[];
  area: string;
  dailyBudget: string;
  adCopy: { headlines: string[]; descriptions: string[] };
};

function buildSetupStepsFromFacts(facts: Record<string, unknown>): SetupStepRow[] {
  const config = buildSetupInstructionConfig(facts);
  return normalizeSetupSteps([
    {
      id: "measurement",
      title: "1. CV計測を設定",
      steps: setupMeasurementSteps(config),
    },
    {
      id: "campaign",
      title: "2. キャンペーンを作成",
      steps: setupCampaignSteps(config),
    },
    {
      id: "targeting",
      title: "3. 配信対象を設定",
      steps: setupTargetingSteps(config),
    },
    {
      id: "keywords",
      title: "4. キーワード/訴求を入力",
      steps: setupCreativeSteps(config),
    },
    {
      id: "platform",
      title: "5. 媒体別の最終確認",
      steps: config.platforms.flatMap((platform) => setupPlatformSteps(platform, config)),
    },
    {
      id: "observation",
      title: "6. 初回7日間を観察",
      steps: [
        "毎日、費用・クリック・CV・CPA/CPL・CV計測漏れを確認する。",
        "検索語句/配信面/広告文ごとの反応を見て、明らかにズレた語句や面を除外候補にする。",
        "停止・予算変更・除外は、担当者が根拠を確認してから広告マネージャーで手動反映する。",
      ],
    },
  ]);
}

function buildSetupInstructionConfig(facts: Record<string, unknown>): SetupInstructionConfig {
  const platforms = normalizeSetupPlatforms(facts.platforms);
  const goal = setupGoalLabel(facts);
  const product = compactSetupFact(facts.product, "訴求する商材");
  const audience = compactSetupFact(facts.audience, "最初に届けたい顧客像");
  const budget = compactSetupFact(facts.budget, "初月予算");
  const measurement = setupConversionName(facts);
  const conversionEvent = setupConversionEvent(facts);
  const keywords = setupKeywordIdeas(facts);
  const exclusions = setupExclusionIdeas(facts);
  const area = setupAreaIdea(facts);
  const dailyBudget = setupDailyBudget(budget);
  const campaignName = setupCampaignName(product, goal);
  const adCopy = setupAdCopyIdeas(product, goal, audience);
  return { platforms, goal, product, audience, budget, measurement, conversionEvent, campaignName, keywords, exclusions, area, dailyBudget, adCopy };
}

function normalizeSetupPlatforms(value: unknown) {
  const raw = Array.isArray(value) && value.length ? value.map(String) : ["google"];
  const platforms = raw
    .map((item) => item.toLowerCase())
    .map((item) => {
      if (item.includes("meta") || item.includes("facebook") || item.includes("instagram")) return "meta";
      if (item.includes("yahoo")) return "yahoo";
      if (item.includes("google")) return "google";
      return "";
    })
    .filter(Boolean);
  return [...new Set(platforms)].length ? [...new Set(platforms)] : ["google"];
}

function setupPlatformSteps(platform: string, context: SetupInstructionConfig) {
  if (platform === "meta") return [
    `Meta広告マネージャで「作成 > キャンペーン目的」を開き、「リード」または「コンバージョン」を選択する。キャンペーン名は「${context.campaignName}」。`,
    `「広告セット > コンバージョンの場所」でWebサイトまたはインスタントフォームを選び、成果地点を「${context.measurement}」に合わせる。`,
    `「広告セット > 予算と掲載期間」の日予算に「${context.dailyBudget}」を入力し、地域は「${context.area}」を指定する。`,
    `「広告 > メインテキスト/見出し」に「${context.adCopy.headlines[0]}」「${context.adCopy.descriptions[0]}」を入力する。`,
  ];
  if (platform === "yahoo") return [
    `Yahoo広告 管理画面で「検索広告 > キャンペーン作成」を開き、キャンペーン名に「${context.campaignName}」を入力する。`,
    `「キャンペーン設定 > 1日の予算」に「${context.dailyBudget}」を入力し、地域ターゲティングに「${context.area}」を設定する。`,
    `「広告グループ > キーワード」に「${context.keywords.join("」「")}」を入力し、除外キーワードに「${context.exclusions.join("」「")}」を入れる。`,
    `「広告作成 > タイトル/説明文」に「${context.adCopy.headlines[0]}」「${context.adCopy.descriptions[0]}」を入力する。`,
  ];
  return [
    `Google広告で「新しいキャンペーン > 見込み顧客 > 検索」を選び、キャンペーン名に「${context.campaignName}」を入力する。`,
    `「単価設定」ではCV計測「${context.measurement}」を使う前提で、初期はコンバージョン数の最大化または手動CPCを選ぶ。`,
    `「予算」欄に日予算「${context.dailyBudget}」を入力し、「地域」欄に「${context.area}」を設定する。`,
    `「キーワード」欄に「${context.keywords.join("」「")}」を入力し、「除外キーワード」に「${context.exclusions.join("」「")}」を入れる。`,
    `「広告」欄の見出し/説明文に「${context.adCopy.headlines.join("」「")}」「${context.adCopy.descriptions.join("」「")}」を入力する。`,
  ];
}

function setupMeasurementSteps(config: SetupInstructionConfig) {
  const steps: string[] = [];
  if (config.platforms.includes("google")) {
    steps.push(`Google広告の「目標 > コンバージョン > 新しいコンバージョンアクション」を開き、コンバージョン名に「${config.measurement}」を入力する。カテゴリは「リード」または「お問い合わせ」を選ぶ。`);
  }
  if (config.platforms.includes("meta")) {
    steps.push(`Metaイベントマネージャの「データソース > イベント」を開き、標準イベント「${config.conversionEvent}」またはカスタムCV「${config.measurement}」を作成して、送信完了条件に紐付ける。`);
  }
  if (config.platforms.includes("yahoo")) {
    steps.push(`Yahoo広告 管理画面の「ツール > コンバージョン測定」を開き、コンバージョン名に「${config.measurement}」を入力して、サイトジェネラルタグ/コンバージョン測定タグの設置先を確認する。`);
  }
  steps.push(`GTM/GA4では、フォーム送信完了ページまたは送信完了イベントを発火条件にし、テスト送信で「${config.measurement}」が記録されるか確認する。`);
  return steps;
}

function setupCampaignSteps(config: SetupInstructionConfig) {
  return config.platforms.flatMap((platform) => {
    if (platform === "meta") {
      return [
        `Meta広告マネージャで「作成」を押し、キャンペーン目的は「リード」または「コンバージョン」を選ぶ。成果目的は「${config.goal}」。`,
        `キャンペーン名に「${config.campaignName}」を入力し、広告セットの「予算と掲載期間」で日予算「${config.dailyBudget}」を設定する。`,
      ];
    }
    if (platform === "yahoo") {
      return [
        `Yahoo広告 管理画面で「検索広告 > キャンペーン作成」を開き、キャンペーン名に「${config.campaignName}」を入力する。`,
        `キャンペーン目的は「サイト誘導/コンバージョン」前提で、1日の予算に「${config.dailyBudget}」を設定する。`,
      ];
    }
    return [
      `Google広告で「新しいキャンペーン > 見込み顧客 > 検索」を選び、キャンペーン名に「${config.campaignName}」を入力する。`,
      `「予算」欄に日予算「${config.dailyBudget}」を入力し、月額上限メモとして「${config.budget}」を控える。`,
    ];
  });
}

function setupTargetingSteps(config: SetupInstructionConfig) {
  return config.platforms.flatMap((platform) => {
    if (platform === "meta") {
      return [
        `Metaの「広告セット > オーディエンス > 地域」に「${config.area}」を設定する。`,
        `詳細ターゲット設定や運用メモには「${config.audience}」を残し、追わない層は除外条件または配信後の除外判断メモにする。`,
      ];
    }
    if (platform === "yahoo") {
      return [
        `Yahoo広告の「キャンペーン設定 > 地域ターゲティング」に「${config.area}」を設定する。`,
        `「広告グループ > 除外キーワード」に「${config.exclusions.join("」「")}」を候補として入力する。`,
      ];
    }
    return [
      `Google広告の「キャンペーン > 設定 > 地域」で「${config.area}」を入力し、所在地オプションは「所在地: ターゲット地域にいるユーザー」を選ぶ。`,
      `「除外キーワード」に「${config.exclusions.join("」「")}」を候補として入力する。オーディエンス条件のメモには「${config.audience}」を残す。`,
    ];
  });
}

function setupCreativeSteps(config: SetupInstructionConfig) {
  const searchPlatforms = config.platforms.filter((platform) => platform === "google" || platform === "yahoo");
  const steps: string[] = [];
  if (searchPlatforms.length) {
    const label = searchPlatforms.map(setupPlatformLabel).join(" / ");
    steps.push(`${label}の「キーワード」画面で、初期キーワードに「${config.keywords.join("」「")}」をフレーズ一致または完全一致で入力する。`);
    steps.push(`${label}の広告作成画面で、見出しに「${config.adCopy.headlines.join("」「")}」を入力する。`);
  }
  if (config.platforms.includes("meta")) {
    steps.push(`Metaの「広告 > メインテキスト」に「${config.adCopy.descriptions[0]}」を、見出しに「${config.adCopy.headlines[0]}」を入力する。CTAは「お問い合わせ」または「詳しくはこちら」を選ぶ。`);
  } else {
    steps.push(`説明文欄には「${config.adCopy.descriptions.join("」「")}」を入力する。`);
  }
  return steps;
}

function setupPlatformLabel(platform: string) {
  if (platform === "meta") return "Meta";
  if (platform === "yahoo") return "Yahoo広告";
  return "Google広告";
}

function compactSetupFact(value: unknown, fallback: string) {
  const text = cleanSetupText(String(value ?? ""));
  return text ? text.slice(0, 80) : fallback;
}

function cleanSetupText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^\s*\d+[.)．、]\s*/g, "")
    .replace(/[「」『』"']/g, "")
    .replace(/[。.!！?？\s]*(?:だね|ですね|です|ます|かな|かも|くらい|程度|でお願いします|でいいです)$/g, "")
    .trim();
}

function setupGoalLabel(facts: Record<string, unknown>) {
  const text = `${facts.goal ?? ""} ${facts.measurement ?? ""}`;
  if (/資料請求/.test(text) && /(問い合わせ|問合せ)/.test(text)) return "資料請求・問い合わせ獲得";
  if (/資料請求/.test(text)) return "資料請求獲得";
  if (/(問い合わせ|問合せ)/.test(text)) return "問い合わせ獲得";
  if (/予約/.test(text)) return "予約獲得";
  if (/購入|EC|売上/.test(text)) return "購入獲得";
  return compactSetupFact(facts.goal, "資料請求/問い合わせ獲得");
}

function setupConversionName(facts: Record<string, unknown>) {
  const text = cleanSetupText(`${facts.measurement ?? ""} ${facts.goal ?? ""}`);
  if (/資料請求/.test(text)) return "資料請求完了";
  if (/(問い合わせ|問合せ)/.test(text)) return "問い合わせ完了";
  if (/フォーム|form/i.test(text)) return "フォーム送信完了";
  if (/予約/.test(text)) return "予約完了";
  if (/購入|決済|注文/.test(text)) return "購入完了";
  if (/電話/.test(text)) return "電話問い合わせ";
  return "フォーム送信完了";
}

function setupConversionEvent(facts: Record<string, unknown>) {
  const text = `${facts.measurement ?? ""} ${facts.goal ?? ""}`;
  if (/購入|決済|注文/.test(text)) return "Purchase";
  if (/予約/.test(text)) return "Schedule";
  if (/電話/.test(text)) return "Contact";
  return "Lead";
}

function setupKeywordIdeas(facts: Record<string, unknown>) {
  const text = `${facts.product ?? ""} ${facts.audience ?? ""}`;
  const ideas = new Set<string>();
  if (/賃貸|管理会社|管理戸数|オーナー/.test(text)) {
    ["賃貸管理 AI", "賃貸管理 問い合わせ 自動化", "管理会社 AIエージェント", "不動産管理 業務効率化"].forEach((item) => ideas.add(item));
  }
  if (/広告運用|広告/.test(text)) ["広告運用 相談", "広告運用 代行", "Google広告 改善"].forEach((item) => ideas.add(item));
  if (/AI|エージェント/.test(text)) ["AIエージェント 導入", "業務自動化 AI"].forEach((item) => ideas.add(item));
  return [...ideas].slice(0, 5).length ? [...ideas].slice(0, 5) : ["商材名 問い合わせ", "商材カテゴリ 比較", "商材カテゴリ 導入"];
}

function setupExclusionIdeas(facts: Record<string, unknown>) {
  const text = String(facts.audience ?? "");
  const ideas = new Set(["無料", "求人", "個人"]);
  if (/自社物|オーナー/.test(text)) ideas.add("自社物件");
  if (/30名以上|3000戸以上/.test(text)) {
    ideas.add("小規模");
    ideas.add("個人大家");
  }
  return [...ideas].slice(0, 5);
}

function setupAreaIdea(facts: Record<string, unknown>) {
  const text = `${facts.audience ?? ""} ${facts.product ?? ""}`;
  const region = text.match(/(北海道|東京都|大阪府|京都府|(?:神奈川|埼玉|千葉|兵庫|愛知|福岡|宮城|広島|静岡|茨城|栃木|群馬|長野|新潟|石川|岡山|熊本|鹿児島|沖縄)県)/);
  return region?.[1] ?? "日本全国";
}

function setupCampaignName(product: string, goal: string) {
  return `${product.slice(0, 18)}_${goal.slice(0, 10)}_初期配信`;
}

function setupDailyBudget(budget: string) {
  const normalized = budget.replace(/,/g, "");
  const man = normalized.match(/(\d+(?:\.\d+)?)\s*万/);
  const yen = normalized.match(/(\d{4,})/);
  const monthly = man ? Number(man[1]) * 10000 : yen ? Number(yen[1]) : 0;
  if (!monthly || !Number.isFinite(monthly)) return "月額予算 ÷ 30 の金額";
  return `¥${Math.max(1000, Math.round(monthly / 30)).toLocaleString("ja-JP")}`;
}

function setupAdCopyIdeas(product: string, goal: string, audience: string) {
  const productShort = product.slice(0, 24);
  const goalShort = goal.replace(/獲得|増加/g, "").slice(0, 18);
  const audienceHint = /賃貸|管理会社/.test(audience) ? "賃貸管理会社向け" : "法人向け";
  return {
    headlines: [
      `${audienceHint}AI支援`,
      `${goalShort}を増やす`,
      `${productShort}を相談`,
    ],
    descriptions: [
      `${audienceHint}に、${productShort}で業務負担を減らす提案です。`,
      `${goalShort}につながる導入相談を受け付けています。`,
    ],
  };
}

function shouldRegenerateSetupSteps(steps: SetupStepRow[]) {
  if (!steps.length) return true;
  const joined = steps.map((step) => `${step.title}\n${step.steps.join("\n")}`).join("\n");
  if (/(?:だね|かな|かも|フォーム完了だね|名前に「|なら「|Google\/Yahoo検索広告|Googleなら|Metaなら|Yahooなら)/.test(joined)) return true;
  return !/Google広告で「新しいキャンペーン|Meta広告マネージャで「作成|Yahoo広告 管理画面/.test(joined);
}

function normalizeSetupAgentResult(value: unknown): SetupIntakeAgentResult {
  const source = (value && typeof value === "object" ? value : {}) as Partial<SetupIntakeAgentResult>;
  const dimensionScores = normalizeDimensionScores(source.dimensionScores ?? {});
  const score = normalizeScore(source.score ?? Object.values(dimensionScores).reduce((sum, item) => sum + item, 0));
  const facts = typeof source.extractedFacts === "object" && source.extractedFacts ? source.extractedFacts as Record<string, unknown> : {};
  const missingFields = Array.isArray(source.missingFields) ? source.missingFields.map(String) : setupMissingFields(dimensionScores);
  return {
    assistantMessage: String(source.assistantMessage ?? buildSetupAssistantMessage(facts, score, missingFields, score >= 80)),
    extractedFacts: facts,
    dimensionScores,
    score,
    missingFields,
    readyForSetupSteps: Boolean(source.readyForSetupSteps ?? score >= 80),
    setupSteps: normalizeSetupSteps(source.setupSteps ?? (score >= 80 ? buildSetupStepsFromFacts(facts) : [])),
  };
}

function normalizeDimensionScores(value: Record<string, unknown>) {
  return {
    goal: normalizeScore(value.goal, 15),
    product: normalizeScore(value.product, 20),
    audience: normalizeScore(value.audience, 20),
    budget: normalizeScore(value.budget, 15),
    platforms: normalizeScore(value.platforms, 10),
    measurement: normalizeScore(value.measurement, 20),
  };
}

function normalizeScore(value: unknown, max = 100) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(max, Math.round(numeric)));
}

function normalizeSetupSteps(value: unknown): SetupStepRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const row = item && typeof item === "object" ? item as Partial<SetupStepRow> : {};
    return {
      id: String(row.id || `step-${index + 1}`),
      title: String(row.title || `ステップ ${index + 1}`),
      steps: Array.isArray(row.steps) ? row.steps.map(String).filter(Boolean) : [],
    };
  }).filter((item) => item.steps.length > 0);
}

function advisorModeFromContext(context: ChatRequest["context"] | undefined) {
  return context?.advisorMode === "experienced" ? "experienced" : "beginner";
}

function advisorEntryFromContext(context: ChatRequest["context"] | undefined) {
  const mode = advisorModeFromContext(context);
  const requestedEntry = context?.agentEntry;
  if (mode === "experienced" && requestedEntry === "performance_analyst_experienced") {
    return requestedEntry;
  }
  if (mode === "beginner" && requestedEntry === "setup_advisor_beginner") {
    return requestedEntry;
  }
  return mode === "experienced" ? "performance_analyst_experienced" : "setup_advisor_beginner";
}

function createMediaWritePolicyResponse(operations: MediaWriteOperation[]): ChatResponse {
  const labels = operationLabels(operations);
  const target = labels.length > 0 ? labels.join(" / ") : "媒体設定変更";

  return {
    message: {
      role: "assistant",
      content: [
        `結論: ${target} はAIチャットからは実行しません。実行する場合は、対象campaignと数値根拠を確認したうえで、承認付きwrite APIに confirmed=true を渡したときだけ反映します。`,
        "",
        `根拠: AdOps Advisorはhuman-in-the-loopを前提にしています。Google Adsはread/write接続へ移行しますが、mediaWriteEnabled=${isGoogleAdsWriteConfigured() ? "true" : "false"} で、AIが単独でplatform mutationを呼ぶ設計にはしません。`,
        "",
        "原因仮説: 直接変更したい背景には、CPA悪化、消化ペースのズレ、CTR/CVR低下、配信対象の広がりなどがある可能性があります。ただし、実行前に対象キャンペーンと数値根拠の確認が必要です。",
        "",
        "推奨アクション: まず対象、期間、KPI変化、計測状態、戻し条件を確認し、承認者が実行可否を判断してください。",
        "",
        "人間向け作業手順:",
        "1. 媒体管理画面で対象アカウント、キャンペーン、広告セット、広告を開く。",
        "2. 直近期間と比較期間のCPA/CVR/CPC/CTR、費用、CV数を確認する。",
        "3. 実施したい変更内容、理由、期待する変化、戻し条件をメモする。",
        "4. 担当者がレビューし、必要と判断した場合だけ承認付きwrite APIまたは媒体管理画面で実行する。",
        "5. 実施後は翌日から3日間、同じKPIを観察して影響を記録する。",
        "6. Google Adsの予算/キャンペーン停止は、API実行時に confirmed=true と対象IDが必要です。",
        "",
        "実施前チェック: CV計測欠損、LP変更、セール/在庫影響、学習状態、予算消化ペース、他キャンペーンへの波及を確認してください。",
        "",
        "リスク: 急な停止や増減額、入札変更、広告入稿は学習状態や配信量に影響し、短期的にCPAやCV数が悪化する可能性があります。",
        "",
        "実施後の観察: CPA、CVR、CPC、CTR、費用、CV数を変更前と同じ期間幅で比較します。自信度: medium",
      ].join("\n"),
    },
    recommendation: {
      title: `${target}を承認付きwrite候補としてレビューする`,
      confidence: "medium",
      operatorSteps: [
        "対象キャンペーンと変更理由を管理画面で確認する",
        "KPIと計測状態を見て、実施可否を担当者が判断する",
        "実行する場合は承認付きwrite APIまたは媒体管理画面で操作し、変更内容を記録する",
        "翌日から3日間、CPA/CVR/CPC/CTRとCV数を観察する",
      ],
    },
    humanTaskDraft: {
      title: `${target}の実施可否をレビューする`,
      priority: "medium",
      status: "suggested",
    },
  };
}

function operationLabels(operations: MediaWriteOperation[]) {
  const labels: Record<MediaWriteOperation, string> = {
    budget: "予算変更",
    campaign_status: "キャンペーン/広告の停止",
    bid: "入札変更",
    ad_creation: "広告入稿",
    targeting: "ターゲティング変更",
    platform_mutation: "媒体管理画面への反映",
  };
  return [...new Set(operations.map((operation) => labels[operation]))];
}

function storeAdvisorArtifacts(body: ChatRequest, data: ChatResponse) {
  const now = new Date().toISOString();
  const idSeed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  recommendations.unshift({
    id: `rec-${idSeed}`,
    workspaceId: body.workspaceId,
    threadId: body.threadId,
    createdAt: now,
    ...data.recommendation,
  });

  tasks.unshift({
    id: `task-${idSeed}`,
    workspaceId: body.workspaceId,
    threadId: body.threadId,
    createdAt: now,
    description: data.message.content,
    ...data.humanTaskDraft,
  });
  return {};
}

async function storeProductionAdvisorArtifacts(body: ChatRequest, data: ChatResponse) {
  const recommendation = await createRecommendation({
    workspaceId: body.workspaceId,
    userId: body.userId,
    threadId: body.threadId,
    title: data.recommendation.title,
    conclusion: firstContentLine(data.message.content),
    evidence: {
      source: "agent_response",
      threadId: body.threadId,
      context: body.context ?? {},
    },
    diagnosis: extractSection(data.message.content, "原因仮説"),
    recommendedActions: [extractSection(data.message.content, "推奨アクション")].filter(Boolean),
    operatorSteps: data.recommendation.operatorSteps,
    risks: extractSection(data.message.content, "リスク"),
    observationPlan: extractSection(data.message.content, "実施後の観察"),
    confidence: data.recommendation.confidence,
  });
  const humanTask = await createHumanTask({
    workspaceId: body.workspaceId,
    userId: body.userId,
    threadId: body.threadId,
    recommendationId: recommendation.id,
    title: data.humanTaskDraft.title,
    description: data.message.content,
    priority: data.humanTaskDraft.priority,
  });
  return { persisted: { recommendation, humanTask } };
}

function seedRecommendations(workspaceId: string, range: number, platform: ReturnType<typeof parsePlatform>) {
  const latestAdData = getLatestAdData(workspaceId, range, platform);
  const response = createMockChatResponse(
    {
      workspaceId,
      userId: "demo-user",
      threadId: "seed-thread",
      message: "初期表示用の推奨アクション",
      context: { range, platform },
    },
    latestAdData,
  );

  return [
    {
      id: `seed-${workspaceId}-${platform}-${range}`,
      workspaceId,
      threadId: "seed-thread",
      createdAt: latestAdData.generatedAt,
      ...response.recommendation,
    },
  ];
}

function firstContentLine(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line && !line.endsWith(":"))
    ?.slice(0, 500) ?? "AI Advisor recommendation";
}

function extractSection(content: string, heading: string) {
  const pattern = new RegExp(`${heading}:?\\s*([\\s\\S]*?)(?:\\n\\S[^\\n]{0,30}:|$)`);
  const match = content.match(pattern);
  return match?.[1]?.trim().slice(0, 2000) || null;
}
