import assert from "node:assert/strict";
import { test } from "node:test";

import { app } from "./index.js";

const baseChatPayload = {
  workspaceId: "test-workspace",
  userId: "test-user",
  threadId: "test-thread",
  context: {
    range: 7,
    platform: "all",
  },
};

test("readiness splits mock Go and production No-Go scopes", async () => {
  const res = await app.request("/readiness?workspaceId=readiness-workspace");
  const body = (await res.json()) as {
    workspaceId: string;
    scopes: {
      mock: { decision: string; checks: Array<{ status: string }> };
      production: { decision: string; checks: Array<{ status: string }> };
    };
  };

  assert.equal(res.status, 200);
  assert.equal(body.workspaceId, "readiness-workspace");
  assert.equal(body.scopes.mock.decision, "Go");
  assert.equal(body.scopes.production.decision, "No-Go");
  assert.ok(body.scopes.mock.checks.every((check) => check.status === "pass"));
  assert.ok(body.scopes.production.checks.some((check) => check.status === "todo"));
});

test("chat rejects secret-like input without echoing or storing it", async () => {
  const secret = "sk-test-dummy-not-a-real-secret";
  const workspaceId = "secret-guard-workspace";
  const payload = {
    ...baseChatPayload,
    workspaceId,
    threadId: "secret-thread",
    message: `このAPI keyを使って分析して: ${secret}`,
  };

  const beforeTasks = await app.request(`/tasks?workspaceId=${workspaceId}`);
  assert.deepEqual(((await beforeTasks.json()) as { tasks: unknown[] }).tasks, []);

  const res = await app.request("/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  const body = JSON.parse(text) as {
    code: string;
    categories: string[];
    policy: { secretStored: boolean; sentToAdk: boolean; repeatedSecretValue: boolean };
  };

  assert.equal(res.status, 400);
  assert.equal(body.code, "secret_like_input_rejected");
  assert.ok(body.categories.includes("api_key"));
  assert.equal(body.policy.secretStored, false);
  assert.equal(body.policy.sentToAdk, false);
  assert.equal(body.policy.repeatedSecretValue, false);
  assert.equal(text.includes(secret), false);

  const afterTasks = await app.request(`/tasks?workspaceId=${workspaceId}`);
  assert.deepEqual(((await afterTasks.json()) as { tasks: unknown[] }).tasks, []);
});

test("chat converts media write requests into human-in-the-loop steps", async () => {
  const cases = [
    { message: "CPAが悪いキャンペーンを停止して。", operation: "campaign_status" },
    { message: "今月の予算を上げて。", operation: "budget" },
    { message: "Google Adsの予算を2万円にして、入札戦略も変更して。", operation: "budget" },
    { message: "Google Adsの予算を2万円にして、入札戦略も変更して。", operation: "bid" },
    { message: "新しい広告を入稿して。", operation: "ad_creation" },
  ];

  for (const [index, item] of cases.entries()) {
    const res = await app.request("/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...baseChatPayload,
        workspaceId: `no-write-workspace-${index}`,
        threadId: `no-write-thread-${index}`,
        message: item.message,
      }),
    });
    const body = (await res.json()) as {
      mode: string;
      message: { content: string };
      policy: {
        mediaWriteEnabled: boolean;
        humanInTheLoopRequired: boolean;
        platformMutationExecuted: boolean;
        interceptedOperations: string[];
      };
    };

    assert.equal(res.status, 200);
    assert.equal(body.mode, "policy-guard");
    assert.equal(body.policy.mediaWriteEnabled, false);
    assert.equal(body.policy.humanInTheLoopRequired, true);
    assert.equal(body.policy.platformMutationExecuted, false);
    assert.ok(body.policy.interceptedOperations.includes(item.operation));
    assert.match(body.message.content, /人間向け作業手順/);
    assert.doesNotMatch(body.message.content, /停止しました|変更しました|入稿しました|作成しました/);
  }
});

test("connections endpoint presents mock OAuth connectors as unconnected", async () => {
  const res = await app.request("/connections?workspaceId=connections-workspace");
  const body = (await res.json()) as {
    mode: string;
    policy: { access: string; mediaWriteEnabled: boolean };
    accounts: Array<{ status: string; lastFetchedAt: string }>;
    nextConnectors: Array<{ status: string; oauthPath: string }>;
  };

  assert.equal(res.status, 200);
  assert.equal(body.mode, "mock");
  assert.equal(body.policy.access, "read-only");
  assert.equal(body.policy.mediaWriteEnabled, false);
  assert.ok(body.accounts.length > 0);
  assert.ok(body.accounts.every((account) => account.status === "pending"));
  assert.ok(body.accounts.every((account) => account.lastFetchedAt === ""));
  assert.ok(body.nextConnectors.every((connector) => connector.status === "planned" && connector.oauthPath.startsWith("/oauth/")));
});

test("stream chat applies no-write guard before mock or ADK runtime", async () => {
  const res = await app.request("/agent/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...baseChatPayload,
      workspaceId: "stream-no-write-workspace",
      threadId: "stream-no-write-thread",
      message: "予算変更を媒体に反映して。",
    }),
  });
  const text = await res.text();
  const events = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line)) as Array<{
    type: string;
    label?: string;
    payload?: {
      mode: string;
      policy: {
        mediaWriteEnabled: boolean;
        platformMutationExecuted: boolean;
        interceptedOperations: string[];
      };
    };
  }>;
  const done = events.find((event) => event.type === "done");

  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type") ?? "", /application\/x-ndjson/);
  assert.equal(events[0]?.label, "policy_guard");
  assert.equal(done?.payload?.mode, "policy-guard");
  assert.equal(done?.payload?.policy.mediaWriteEnabled, false);
  assert.equal(done?.payload?.policy.platformMutationExecuted, false);
  assert.deepEqual(done?.payload?.policy.interceptedOperations.sort(), ["budget", "platform_mutation"]);
  assert.equal(events.some((event) => event.label === "mock_runtime" || event.label === "adk_agent_service"), false);
});

test("normal chat still returns mock advisor response with no write policy", async () => {
  const res = await app.request("/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...baseChatPayload,
      workspaceId: "normal-chat-workspace",
      threadId: "normal-chat-thread",
      message: "CPAが悪化した理由を教えて。次に何を見ればいい？",
    }),
  });
  const body = (await res.json()) as {
    mode: string;
    message: { content: string };
    policy: { mediaWriteEnabled: boolean; humanInTheLoopRequired: boolean };
  };

  assert.equal(res.status, 200);
  assert.equal(body.mode, "mock");
  assert.equal(body.policy.mediaWriteEnabled, false);
  assert.equal(body.policy.humanInTheLoopRequired, true);
  assert.match(body.message.content, /結論/);
  assert.match(body.message.content, /人間向け作業手順/);
});
