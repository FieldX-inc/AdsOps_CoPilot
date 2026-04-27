import { serve } from "@hono/node-server";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";

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

const app = new Hono();
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
  }),
);

app.get("/dashboard", (c) => {
  const { workspaceId } = getRequestContext(c.req.raw);
  const range = parseRange(c.req.query("range"));
  const platform = parsePlatform(c.req.query("platform"));
  return c.json(getDashboardData(workspaceId, range, platform));
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

serve({ fetch: app.fetch, port });

console.log(`adops-api listening on http://localhost:${port}`);

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
