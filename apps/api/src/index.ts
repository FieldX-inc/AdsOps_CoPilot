import { serve } from "@hono/node-server";
import { pathToFileURL } from "node:url";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";

import { loadLocalEnv } from "./env.js";
import { buildGoogleOAuthUrl, handleGoogleOAuthCallback, listAccessibleGoogleCustomers } from "./google-ads.js";
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
import { AuthError, assertWorkspaceMembership, authenticateRequest, isSupabaseConfigured } from "./supabase.js";
import { listConnectionStatuses } from "./supabase.js";

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
const adkAgentUrl = process.env.ADK_AGENT_URL ?? "http://localhost:8000";
const useAdkAgent = process.env.USE_ADK_AGENT === "true";
const port = Number(process.env.PORT ?? "8787");
const recommendations: StoredRecommendation[] = [];
const tasks: StoredTask[] = [];

app.use(
  "*",
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "x-demo-user-id"],
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "adops-api",
    mode: useAdkAgent ? "adk-proxy" : "mock",
    adkAgentUrl,
    mediaWriteEnabled: false,
    supabaseConfigured: isSupabaseConfigured(),
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
  return c.json({
    workspaceId,
    mode: useAdkAgent ? "adk-proxy" : "mock",
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
            label: "Web / API / ADK agentをローカル起動できる",
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
            label: "媒体writeを行わず、人間向け作業手順として提案する",
            status: "pass",
            evidence: ["mediaWriteEnabled=false", "policy.humanInTheLoopRequired=true"],
          },
        ],
        nextActions: [
          "社内テスターには docs/user-test-readiness.md のシナリオだけを渡す。",
          "テスト範囲をmockデータの体験検証に限定すると明記する。",
        ],
      },
      production: {
        label: "production readiness",
        decision: "No-Go",
        note: "Supabase Auth、実OAuth、実広告API、共有URLが未完了です。",
        checks: [
          {
            id: "auth-oauth",
            label: "Supabase Authと実OAuth callbackのE2E",
            status: "todo",
            evidence: ["MVP後続。社内テストではdemo workspaceを使う。"],
          },
          {
            id: "real-media-apis",
            label: "Google / Meta / Yahoo read-only APIの実接続",
            status: "todo",
            evidence: ["MVP後続。今回のテストではmock広告データを使う。"],
          },
          {
            id: "deployment",
            label: "共有URL、テスト用env、ログ確認手順",
            status: "todo",
            evidence: ["ローカル実施なら不要。社内配布前にCloudflare/Cloud Run候補を決める。"],
          },
        ],
        nextActions: ["実OAuth、認証、デプロイは次マイルストーンの残タスクとして切り分ける。"],
      },
    },
    goNoGo: {
      decision: "go_for_internal_mock_test",
      note: "実広告OAuthとSupabase Authは未接続のため、credentialなしの社内体験検証に限定します。",
    },
    checks: [
      {
        id: "local-services",
        label: "Web / API / ADK agentをローカル起動できる",
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
        label: "媒体writeを行わず、人間向け作業手順として提案する",
        status: "pass",
        evidence: ["mediaWriteEnabled=false", "policy.humanInTheLoopRequired=true"],
      },
      {
        id: "auth-oauth",
        label: "Supabase Authと実OAuth callbackのE2E",
        status: "todo",
        evidence: ["MVP後続。社内テストではdemo workspaceを使う。"],
      },
      {
        id: "real-media-apis",
        label: "Google / Meta / Yahoo read-only APIの実接続",
        status: "todo",
        evidence: ["MVP後続。今回のテストではmock広告データを使う。"],
      },
      {
        id: "deployment",
        label: "共有URL、テスト用env、ログ確認手順",
        status: "todo",
        evidence: ["ローカル実施なら不要。社内配布前にCloudflare/Cloud Run候補を決める。"],
      },
    ],
    nextActions: [
      "社内テスターには docs/user-test-readiness.md のシナリオだけを渡す。",
      "テスト範囲をmockデータの体験検証に限定すると明記する。",
      "実OAuth、認証、デプロイは次マイルストーンの残タスクとして切り分ける。",
    ],
  });
});

app.get("/dashboard", (c) => {
  const { workspaceId } = getRequestContext(c.req.raw);
  const range = parseRange(c.req.query("range"));
  const platform = parsePlatform(c.req.query("platform"));
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

app.get("/ad-data/latest", (c) => {
  const { workspaceId } = getRequestContext(c.req.raw);
  const range = parseRange(c.req.query("range"));
  const platform = parsePlatform(c.req.query("platform"));
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
    const platform = parsePlatform(c.req.query("platform"));
    const statuses = await listConnectionStatuses(auth.workspace.id, platform);
    return c.json({
      workspaceId: auth.workspace.id,
      mode: "production",
      policy: {
        access: "read-only",
        mediaWriteEnabled: false,
        note: "OAuth tokenは暗号化保存し、ブラウザやAIには返しません。",
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
    return c.redirect(buildGoogleOAuthUrl(auth), 302);
  } catch (error) {
    return handleAuthError(c, error);
  }
});

app.get("/oauth/google/start-url", async (c) => {
  try {
    const auth = await authenticateRequest(c.req.raw);
    return c.json({ url: buildGoogleOAuthUrl(auth) });
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

app.get("/google-ads/customers", async (c) => {
  try {
    const auth = await assertWorkspaceMembership(c.req.raw, c.req.query("workspaceId"));
    const customers = await listAccessibleGoogleCustomers(auth);
    return c.json({ customers });
  } catch (error) {
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

app.get("/tasks", (c) => {
  const { workspaceId } = getRequestContext(c.req.raw);
  return c.json({
    tasks: tasks.filter((task) => task.workspaceId === workspaceId),
  });
});

app.get("/recommendations", (c) => {
  const { workspaceId } = getRequestContext(c.req.raw);
  const range = parseRange(c.req.query("range"));
  const platform = parsePlatform(c.req.query("platform"));
  const seeded = seedRecommendations(workspaceId, range, platform);
  const stored = recommendations.filter((recommendation) => recommendation.workspaceId === workspaceId);
  return c.json({
    recommendations: [...stored, ...seeded],
  });
});

app.get("/agent/threads", (c) => {
  const { workspaceId, userId } = getRequestContext(c.req.raw);
  ensureChatThread(workspaceId, userId, c.req.query("threadId") || "demo-thread");
  return c.json(listChatThreads(workspaceId, userId));
});

app.get("/agent/threads/:threadId", (c) => {
  const { workspaceId, userId } = getRequestContext(c.req.raw);
  return c.json(getChatThread(workspaceId, userId, c.req.param("threadId")));
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

  const policy = evaluateChatPolicy(body);
  if (policy.action === "reject_secret") {
    return c.json(buildSecretRejectedPayload(policy.categories), 400);
  }

  if (policy.action === "manual_media_steps") {
    return c.json(processMediaWriteRequest(body, policy.operations), 200);
  }

  const result = await processChat(body);
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
          text: "媒体write依頼を検知したため、API/ADK実行ではなく人間向け手順に変換しています。",
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

  const range = parseRange(body.context?.range?.toString() ?? rangeFromDateRange(body.context?.dateRange));
  const platform = parsePlatform(body.context?.platform);
  const latestAdData = getLatestAdData(body.workspaceId, range, platform);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      for (const event of buildChatStatusEvents(body, latestAdData, useAdkAgent)) {
        send({ type: "status", ...event });
        await delay(320);
      }

      const result = await processChat(body);
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

async function processChat(body: ChatRequest): Promise<{ payload: Record<string, unknown>; status: 200 | 502 }> {
  const range = parseRange(body.context?.range?.toString() ?? rangeFromDateRange(body.context?.dateRange));
  const platform = parsePlatform(body.context?.platform);
  const latestAdData = getLatestAdData(body.workspaceId, range, platform);

  if (!useAdkAgent) {
    const data = createMockChatResponse(body, latestAdData);
    const thread = appendChatExchange(body, data);
    storeAdvisorArtifacts(body, data);
    return {
      status: 200,
      payload: {
        ...data,
        thread,
        mode: "mock",
        latestAdData,
        policy: {
          mediaWriteEnabled: false,
          humanInTheLoopRequired: true,
        },
      },
    };
  }

  try {
    const res = await fetch(`${adkAgentUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        context: {
          dateRange: body.context?.dateRange ?? `last_${range}_days`,
          comparisonRange: body.context?.comparisonRange ?? `previous_${range}_days`,
          range,
          platform,
        },
        latestAdData,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        status: 502,
        payload: {
          error: "ADK Agent Serviceから正常な応答を取得できませんでした。",
          detail: text.slice(0, 400),
        },
      };
    }

    const data = (await res.json()) as ChatResponse;
    const thread = appendChatExchange(body, data);
    storeAdvisorArtifacts(body, data);

    return { status: 200, payload: { ...data, thread } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      status: 502,
      payload: {
        error: "ADK Agent Serviceに接続できません。`npm run dev:agent` が起動しているか確認してください。",
        detail: message,
      },
    };
  }
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

function buildChatStatusEvents(body: ChatRequest, latestAdData: ReturnType<typeof getLatestAdData>, adkEnabled: boolean) {
  const message = body.message.toLowerCase();
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
    label: adkEnabled ? "adk_agent_service" : "mock_runtime",
    text: adkEnabled
      ? "ADK Agent Service に会話文脈を渡して、Gemini実行結果を待っています。"
      : "ADKプロキシが無効のため、mock runtime で回答を生成しています。",
  });

  return events;
}

function mentionsAny(message: string, terms: string[]) {
  return terms.some((term) => message.includes(term.toLowerCase()));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function handleAuthError(c: Context, error: unknown) {
  if (error instanceof AuthError) {
    return c.json({ error: error.message }, error.status);
  }
  const message = error instanceof Error ? error.message : "認証処理に失敗しました。";
  return c.json({ error: message }, 500);
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
    mode: "policy-guard",
    policy: {
      mediaWriteEnabled: false,
      humanInTheLoopRequired: true,
      platformMutationExecuted: false,
      interceptedOperations: operations,
    },
  };
}

function createMediaWritePolicyResponse(operations: MediaWriteOperation[]): ChatResponse {
  const labels = operationLabels(operations);
  const target = labels.length > 0 ? labels.join(" / ") : "媒体設定変更";

  return {
    message: {
      role: "assistant",
      content: [
        `結論: ${target} はこのAPIからは実行できません。MVPでは広告媒体APIのwrite操作を行わず、担当者が管理画面で確認・承認・手動実行するための手順に変換します。`,
        "",
        "根拠: AdOps Advisorはread-only連携とhuman-in-the-loopを前提にしており、予算変更、停止、入札変更、広告作成、ターゲティング変更などのplatform mutation toolは持ちません。",
        "",
        "原因仮説: 直接変更したい背景には、CPA悪化、消化ペースのズレ、CTR/CVR低下、配信対象の広がりなどがある可能性があります。ただし、実行前に対象キャンペーンと数値根拠の確認が必要です。",
        "",
        "推奨アクション: 変更を自動実行せず、まず対象、期間、KPI変化、計測状態、戻し条件を確認してください。",
        "",
        "人間向け作業手順:",
        "1. 媒体管理画面で対象アカウント、キャンペーン、広告セット、広告を開く。",
        "2. 直近期間と比較期間のCPA/CVR/CPC/CTR、費用、CV数を確認する。",
        "3. 実施したい変更内容、理由、期待する変化、戻し条件をメモする。",
        "4. 担当者がレビューし、必要と判断した場合だけ媒体管理画面で手動実行する。",
        "5. 実施後は翌日から3日間、同じKPIを観察して影響を記録する。",
        "",
        "実施前チェック: CV計測欠損、LP変更、セール/在庫影響、学習状態、予算消化ペース、他キャンペーンへの波及を確認してください。",
        "",
        "リスク: 急な停止や増減額、入札変更、広告入稿は学習状態や配信量に影響し、短期的にCPAやCV数が悪化する可能性があります。",
        "",
        "実施後の観察: CPA、CVR、CPC、CTR、費用、CV数を変更前と同じ期間幅で比較します。自信度: medium",
      ].join("\n"),
    },
    recommendation: {
      title: `${target}を自動実行せず、人間がレビューする`,
      confidence: "medium",
      operatorSteps: [
        "対象キャンペーンと変更理由を管理画面で確認する",
        "KPIと計測状態を見て、実施可否を担当者が判断する",
        "実行する場合は媒体管理画面で手動操作し、変更内容を記録する",
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
