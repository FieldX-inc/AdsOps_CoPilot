import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

type IndexModule = typeof import("./index.js");

const originalUseAgentServiceForMockApp = process.env.USE_AGENT_SERVICE;
process.env.USE_AGENT_SERVICE = "false";
const { app, buildLocalSetupIntakeResult, buildStructuredSetupAnswerResult } = (await import(`./index.js?mock-tests-${Date.now()}`)) as IndexModule;
if (originalUseAgentServiceForMockApp === undefined) {
  delete process.env.USE_AGENT_SERVICE;
} else {
  process.env.USE_AGENT_SERVICE = originalUseAgentServiceForMockApp;
}

const baseChatPayload = {
  workspaceId: "test-workspace",
  userId: "test-user",
  threadId: "test-thread",
  context: {
    range: 7,
    platform: "all",
  },
};

test("dashboard accepts an explicit inclusive date range and rejects unsafe ranges", async () => {
  const valid = await app.request("/dashboard?workspaceId=date-range-workspace&from=2026-07-01&to=2026-07-07&platform=google");
  const body = (await valid.json()) as { range: number; dateRange: { from: string; to: string } };
  assert.equal(valid.status, 200);
  assert.equal(body.range, 7);
  assert.deepEqual(body.dateRange, { from: "2026-07-01", to: "2026-07-07" });

  const missingEnd = await app.request("/dashboard?workspaceId=date-range-workspace&from=2026-07-01");
  assert.equal(missingEnd.status, 400);

  const reversed = await app.request("/dashboard?workspaceId=date-range-workspace&from=2026-07-08&to=2026-07-01");
  assert.equal(reversed.status, 400);

  const tooLong = await app.request("/dashboard?workspaceId=date-range-workspace&from=2026-05-01&to=2026-07-01");
  assert.equal(tooLong.status, 400);
});

test("dashboard filter options cascade from account to campaign, ad group, and ad", async () => {
  const baseRes = await app.request("/dashboard/filter-options?workspaceId=filter-workspace&platform=google");
  const base = (await baseRes.json()) as {
    accounts: Array<{ id: string; platform: string }>;
    campaigns: Array<{ id: string; adAccountId: string; platform: string }>;
    adGroups: Array<{ id: string; adAccountId: string; campaignId: string; platform: string }>;
    ads: Array<{ id: string; adAccountId: string; campaignId: string; adGroupId: string; platform: string }>;
  };
  assert.equal(baseRes.status, 200);
  assert.deepEqual(base.accounts.map((item) => item.id), ["acct-google-001"]);
  assert.ok(base.campaigns.length > 1);

  const campaign = base.campaigns.find((item) => item.id === "cmp-google-nonbrand");
  assert.ok(campaign);
  const campaignQuery = new URLSearchParams({
    workspaceId: "filter-workspace",
    platform: "google",
    adAccountId: campaign.adAccountId,
    campaignId: campaign.id,
  });
  const campaignRes = await app.request(`/dashboard/filter-options?${campaignQuery}`);
  const campaignBody = (await campaignRes.json()) as typeof base;
  assert.equal(campaignRes.status, 200);
  assert.ok(campaignBody.campaigns.every((item) => item.adAccountId === campaign.adAccountId));
  assert.deepEqual([...new Set(campaignBody.adGroups.map((item) => item.campaignId))], [campaign.id]);
  assert.deepEqual([...new Set(campaignBody.ads.map((item) => item.campaignId))], [campaign.id]);

  const adGroup = campaignBody.adGroups[0];
  assert.ok(adGroup);
  const adGroupRes = await app.request(`/dashboard/filter-options?${new URLSearchParams({
    workspaceId: "filter-workspace",
    platform: "google",
    campaignId: campaign.id,
    adGroupId: adGroup.id,
  })}`);
  const adGroupBody = (await adGroupRes.json()) as typeof base;
  assert.equal(adGroupRes.status, 200);
  assert.ok(adGroupBody.ads.length > 0);
  assert.ok(adGroupBody.ads.every((item) => item.adGroupId === adGroup.id));
});

test("dashboard hierarchy filters reject unknown and inconsistent parents", async () => {
  const accountCampaignMismatch = new URLSearchParams({
    workspaceId: "filter-workspace",
    adAccountId: "acct-google-001",
    campaignId: "cmp-meta-prospecting",
  });
  for (const path of ["/dashboard/filter-options", "/dashboard", "/ad-data/latest"]) {
    const res = await app.request(`${path}?${accountCampaignMismatch}`);
    const body = (await res.json()) as { code: string };
    assert.equal(res.status, 400, path);
    assert.equal(body.code, "invalid_dashboard_filter", path);
  }

  const unknownAd = await app.request("/dashboard/filter-options?workspaceId=filter-workspace&adId=missing-ad");
  assert.equal(unknownAd.status, 400);
  assert.equal(((await unknownAd.json()) as { code: string }).code, "invalid_dashboard_filter");
});

test("dashboard and latest ad data apply the same hierarchy query to metrics and campaign rows", async () => {
  const query = new URLSearchParams({
    workspaceId: "filter-workspace",
    platform: "google",
    adAccountId: "acct-google-001",
    campaignId: "cmp-google-nonbrand",
    adGroupId: "grp-cmp-google-nonbrand",
    adId: "ad-cmp-google-nonbrand-primary",
    range: "7",
  });
  const [dashboardRes, latestRes, unfilteredRes] = await Promise.all([
    app.request(`/dashboard?${query}`),
    app.request(`/ad-data/latest?${query}`),
    app.request("/dashboard?workspaceId=filter-workspace&platform=google&range=7"),
  ]);
  const dashboard = (await dashboardRes.json()) as {
    adAccountId: string;
    campaignId: string;
    adGroupId: string;
    adId: string;
    summary: { cost: number };
    campaigns: Array<{ campaignId: string; cost: number }>;
  };
  const latest = ((await latestRes.json()) as {
    latestAdData: {
      adAccountId: string;
      campaignId: string;
      adGroupId: string;
      adId: string;
      current: { totals: { cost: number } };
      campaigns: Array<{ campaignId: string; cost: number }>;
    };
  }).latestAdData;
  const unfiltered = (await unfilteredRes.json()) as { summary: { cost: number } };

  assert.equal(dashboardRes.status, 200);
  assert.equal(latestRes.status, 200);
  assert.deepEqual(
    [dashboard.adAccountId, dashboard.campaignId, dashboard.adGroupId, dashboard.adId],
    ["acct-google-001", "cmp-google-nonbrand", "grp-cmp-google-nonbrand", "ad-cmp-google-nonbrand-primary"],
  );
  assert.deepEqual(dashboard.campaigns.map((item) => item.campaignId), ["cmp-google-nonbrand"]);
  assert.deepEqual(latest.campaigns.map((item) => item.campaignId), ["cmp-google-nonbrand"]);
  assert.equal(dashboard.summary.cost, latest.current.totals.cost);
  assert.equal(dashboard.campaigns[0]?.cost, dashboard.summary.cost);
  assert.ok(unfiltered.summary.cost > dashboard.summary.cost);
});

test("agent chat rejects incomplete custom date context", async () => {
  const res = await app.request("/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...baseChatPayload,
      message: "CPAの変化を見て",
      context: { ...baseChatPayload.context, from: "2026-07-01" },
    }),
  });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, "invalid_date_range");
});

test("readiness splits mock Go and production No-Go scopes", async () => {
  const res = await app.request("/readiness?workspaceId=readiness-workspace");
  const body = (await res.json()) as {
    workspaceId: string;
    scopes: {
      mock: { decision: string; checks: Array<{ id: string; status: string }> };
      production: { decision: string; checks: Array<{ id: string; status: string }> };
    };
  };

  assert.equal(res.status, 200);
  assert.equal(body.workspaceId, "readiness-workspace");
  assert.equal(body.scopes.mock.decision, "Go");
  assert.equal(body.scopes.production.decision, "No-Go");
  assert.ok(body.scopes.mock.checks.every((check) => check.status === "pass"));
  assert.ok(body.scopes.production.checks.some((check) => check.status === "todo"));
  assert.ok(body.scopes.production.checks.some((check) => check.id === "agent-service-enabled"));
  assert.ok(body.scopes.production.checks.some((check) => check.id === "openai-agent-service-health"));
});

test("readiness passes OpenAI Agent Service checks when production env is configured", async () => {
  await withMockProductionEnv(async () => {
    process.env.APP_ENV = "production";
    process.env.AGENT_SERVICE_URL = "https://agent.example.test";
    process.env.USE_AGENT_SERVICE = "true";
    process.env.OPENAI_AGENT_STAGING_E2E_PASSED_AT = "2026-06-04T10:00:00+09:00";

    const { app: productionApp } = await importFreshIndex("readiness-openai-agent");
    const res = await productionApp.request("/readiness?workspaceId=readiness-workspace");
    const body = (await res.json()) as {
      scopes: {
        production: {
          checks: Array<{ id: string; status: string; evidence: string[] }>;
        };
      };
    };
    const checks = new Map(body.scopes.production.checks.map((check) => [check.id, check]));

    assert.equal(res.status, 200);
    assert.equal(checks.get("agent-service-enabled")?.status, "pass");
    assert.equal(checks.get("agent-service-modern-env")?.status, "pass");
    assert.equal(checks.get("agent-service-url")?.status, "pass");
    assert.equal(checks.get("openai-agent-service-health")?.status, "pass");
    assert.ok(checks.get("agent-service-url")?.evidence.some((item) => item.includes("agent.example.test")));
    assert.ok(checks.get("openai-agent-service-health")?.evidence.some((item) => item.includes("Agent Service env")));
  });
});

test("readiness rejects legacy ADK Agent aliases in production env", async () => {
  await withMockProductionEnv(async () => {
    process.env.APP_ENV = "production";
    process.env.AGENT_SERVICE_URL = "https://agent.example.test";
    process.env.USE_AGENT_SERVICE = "true";
    process.env.ADK_AGENT_URL = "https://legacy-agent.example.test";
    process.env.USE_ADK_AGENT = "true";
    process.env.ADK_AGENT_TIMEOUT_MS = "35000";
    process.env.OPENAI_AGENT_STAGING_E2E_PASSED_AT = "2026-06-04T10:00:00+09:00";

    const { app: productionApp } = await importFreshIndex("readiness-legacy-adk-alias");
    const res = await productionApp.request("/readiness?workspaceId=readiness-workspace");
    const body = (await res.json()) as {
      scopes: {
        production: {
          decision: string;
          checks: Array<{ id: string; status: string; evidence: string[] }>;
        };
      };
    };
    const checks = new Map(body.scopes.production.checks.map((check) => [check.id, check]));

    assert.equal(res.status, 200);
    assert.equal(body.scopes.production.decision, "No-Go");
    assert.equal(checks.get("agent-service-modern-env")?.status, "todo");
    assert.ok(checks.get("agent-service-modern-env")?.evidence.some((item) => item.includes("ADK_AGENT_URL")));
    assert.ok(checks.get("agent-service-modern-env")?.evidence.some((item) => item.includes("USE_ADK_AGENT")));
  });
});

test("production CORS only allows the configured web origin", async () => {
  await withMockProductionEnv(async () => {
    process.env.APP_ENV = "production";
    process.env.WEB_ORIGIN = "https://app.example.test";

    const { app: productionApp } = await importFreshIndex("production-cors");
    const allowedRes = await productionApp.request("/health", {
      headers: { Origin: "https://app.example.test" },
    });
    const blockedRes = await productionApp.request("/health", {
      headers: { Origin: "https://evil.example.test" },
    });
    const preflightRes = await productionApp.request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.example.test",
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "Authorization, Content-Type",
      },
    });

    assert.equal(allowedRes.status, 200);
    assert.equal(allowedRes.headers.get("Access-Control-Allow-Origin"), "https://app.example.test");
    assert.equal(blockedRes.status, 200);
    assert.equal(blockedRes.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(preflightRes.status, 204);
    assert.equal(preflightRes.headers.get("Access-Control-Allow-Origin"), "https://app.example.test");
    assert.ok(preflightRes.headers.get("Access-Control-Allow-Methods")?.includes("PATCH"));
    assert.ok(preflightRes.headers.get("Access-Control-Allow-Headers")?.includes("Authorization"));
  });
});

test("readiness requires staging E2E evidence before production Go", async () => {
  await withMockProductionEnv(async () => {
    process.env.APP_ENV = "production";
    process.env.WEB_ORIGIN = "https://app.example.test";
    process.env.API_PUBLIC_ORIGIN = "https://api.example.test";
    process.env.SUPABASE_AUTH_SITE_URL = "https://app.example.test";
    process.env.SUPABASE_AUTH_REDIRECT_URLS = "https://app.example.test/auth/callback";
    process.env.SUPABASE_AUTH_GOOGLE_CLIENT_ID = "login-client-id";
    process.env.SUPABASE_AUTH_GOOGLE_CLIENT_SECRET = "login-client-secret";
    process.env.AGENT_SERVICE_URL = "https://agent.example.test";
    process.env.USE_AGENT_SERVICE = "true";
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";

    const { app: missingEvidenceApp } = await importFreshIndex("readiness-e2e-missing");
    const missingRes = await missingEvidenceApp.request("/readiness?workspaceId=readiness-workspace");
    const missingBody = (await missingRes.json()) as {
      scopes: {
        production: {
          decision: string;
          checks: Array<{ id: string; status: string }>;
        };
      };
    };
    const missingChecks = new Map(missingBody.scopes.production.checks.map((check) => [check.id, check]));

    assert.equal(missingRes.status, 200);
    assert.equal(missingBody.scopes.production.decision, "No-Go");
    assert.equal(missingChecks.get("openai-agent-staging-e2e")?.status, "todo");
    assert.equal(missingChecks.get("real-media-apis")?.status, "todo");
    assert.equal(missingChecks.get("stripe-billing")?.status, "todo");
    assert.equal(missingChecks.get("deployment")?.status, "todo");

    process.env.OPENAI_AGENT_STAGING_E2E_PASSED_AT = "2026-06-04T10:00:00+09:00";
    process.env.GOOGLE_ADS_STAGING_E2E_PASSED_AT = "2026-06-04T10:10:00+09:00";
    process.env.STRIPE_STAGING_E2E_PASSED_AT = "2026-06-04T10:20:00+09:00";
    process.env.SUPABASE_STAGING_E2E_PASSED_AT = "2026-06-04T10:30:00+09:00";
    process.env.REPORT_EMAIL_STAGING_E2E_PASSED_AT = "2026-06-04T10:40:00+09:00";
    process.env.DEPLOYMENT_RUNBOOK_ACK = "true";

    const { app: readyApp } = await importFreshIndex("readiness-e2e-ready");
    const readyRes = await readyApp.request("/readiness?workspaceId=readiness-workspace");
    const readyBody = (await readyRes.json()) as {
      scopes: {
        production: {
          decision: string;
          checks: Array<{ id: string; status: string }>;
        };
      };
    };

    assert.equal(readyRes.status, 200);
    assert.equal(readyBody.scopes.production.decision, "Go");
    assert.ok(readyBody.scopes.production.checks.every((check) => check.status === "pass"));
  });
});

test("readiness rejects malformed staging E2E evidence timestamps", async () => {
  await withMockProductionEnv(async () => {
    process.env.APP_ENV = "production";
    process.env.WEB_ORIGIN = "https://app.example.test";
    process.env.API_PUBLIC_ORIGIN = "https://api.example.test";
    process.env.SUPABASE_AUTH_SITE_URL = "https://app.example.test";
    process.env.SUPABASE_AUTH_REDIRECT_URLS = "https://app.example.test/auth/callback";
    process.env.SUPABASE_AUTH_GOOGLE_CLIENT_ID = "login-client-id";
    process.env.SUPABASE_AUTH_GOOGLE_CLIENT_SECRET = "login-client-secret";
    process.env.AGENT_SERVICE_URL = "https://agent.example.test";
    process.env.USE_AGENT_SERVICE = "true";
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    process.env.OPENAI_AGENT_STAGING_E2E_PASSED_AT = "not-a-timestamp";
    process.env.GOOGLE_ADS_STAGING_E2E_PASSED_AT = new Date().toISOString();
    process.env.STRIPE_STAGING_E2E_PASSED_AT = new Date().toISOString();
    process.env.SUPABASE_STAGING_E2E_PASSED_AT = new Date().toISOString();
    process.env.REPORT_EMAIL_STAGING_E2E_PASSED_AT = new Date().toISOString();
    process.env.DEPLOYMENT_RUNBOOK_ACK = "true";

    const { app: malformedEvidenceApp } = await importFreshIndex("readiness-malformed-evidence");
    const res = await malformedEvidenceApp.request("/readiness?workspaceId=readiness-workspace");
    const body = (await res.json()) as {
      scopes: {
        production: {
          decision: string;
          checks: Array<{ id: string; status: string }>;
        };
      };
    };
    const checks = new Map(body.scopes.production.checks.map((check) => [check.id, check]));

    assert.equal(res.status, 200);
    assert.equal(body.scopes.production.decision, "No-Go");
    assert.equal(checks.get("openai-agent-staging-e2e")?.status, "todo");
    assert.equal(checks.get("staging-e2e-evidence-window")?.status, "todo");
  });
});

test("readiness rejects staging E2E evidence from different release windows", async () => {
  await withMockProductionEnv(async () => {
    process.env.APP_ENV = "production";
    process.env.WEB_ORIGIN = "https://app.example.test";
    process.env.API_PUBLIC_ORIGIN = "https://api.example.test";
    process.env.SUPABASE_AUTH_SITE_URL = "https://app.example.test";
    process.env.SUPABASE_AUTH_REDIRECT_URLS = "https://app.example.test/auth/callback";
    process.env.SUPABASE_AUTH_GOOGLE_CLIENT_ID = "login-client-id";
    process.env.SUPABASE_AUTH_GOOGLE_CLIENT_SECRET = "login-client-secret";
    process.env.AGENT_SERVICE_URL = "https://agent.example.test";
    process.env.USE_AGENT_SERVICE = "true";
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    process.env.OPENAI_AGENT_STAGING_E2E_PASSED_AT = new Date().toISOString();
    const oldGoogleEvidenceDate = new Date();
    oldGoogleEvidenceDate.setDate(oldGoogleEvidenceDate.getDate() - 8);
    process.env.GOOGLE_ADS_STAGING_E2E_PASSED_AT = oldGoogleEvidenceDate.toISOString();
    process.env.STRIPE_STAGING_E2E_PASSED_AT = new Date().toISOString();
    process.env.SUPABASE_STAGING_E2E_PASSED_AT = new Date().toISOString();
    process.env.REPORT_EMAIL_STAGING_E2E_PASSED_AT = new Date().toISOString();
    process.env.DEPLOYMENT_RUNBOOK_ACK = "true";

    const { app: mixedEvidenceApp } = await importFreshIndex("readiness-mixed-evidence-window");
    const res = await mixedEvidenceApp.request("/readiness?workspaceId=readiness-workspace");
    const body = (await res.json()) as {
      scopes: {
        production: {
          decision: string;
          checks: Array<{ id: string; status: string; evidence: string[] }>;
        };
      };
    };
    const checks = new Map(body.scopes.production.checks.map((check) => [check.id, check]));

    assert.equal(res.status, 200);
    assert.equal(body.scopes.production.decision, "No-Go");
    assert.equal(checks.get("openai-agent-staging-e2e")?.status, "pass");
    assert.equal(checks.get("real-media-apis")?.status, "pass");
    assert.equal(checks.get("stripe-billing")?.status, "pass");
    assert.equal(checks.get("staging-e2e-evidence-window")?.status, "todo");
    assert.ok(checks.get("staging-e2e-evidence-window")?.evidence.some((item) => item.includes("spread_more_than_7_days")));
  });
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

test("chat converts media write requests into approval-gated write steps", async () => {
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
        executableAfterApproval: boolean;
        executionRoutes: string[];
      };
    };

    assert.equal(res.status, 200);
    assert.equal(body.mode, "write-approval-required");
    assert.equal(body.policy.mediaWriteEnabled, false);
    assert.equal(body.policy.humanInTheLoopRequired, true);
    assert.equal(body.policy.platformMutationExecuted, false);
    assert.ok(body.policy.interceptedOperations.includes(item.operation));
    assert.ok(body.policy.executionRoutes.some((route) => route.includes("/google/customers/")));
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
  assert.equal(body.policy.access, "read-write-after-human-approval");
  assert.equal(body.policy.mediaWriteEnabled, false);
  assert.ok(body.accounts.length > 0);
  assert.ok(body.accounts.every((account) => account.status === "pending"));
  assert.ok(body.accounts.every((account) => account.lastFetchedAt === ""));
  assert.ok(body.nextConnectors.every((connector) => connector.status === "planned" && connector.oauthPath.startsWith("/oauth/")));
});

test("stream chat applies no-write guard before mock or Agent Service runtime", async () => {
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
  assert.equal(done?.payload?.mode, "write-approval-required");
  assert.equal(done?.payload?.policy.mediaWriteEnabled, false);
  assert.equal(done?.payload?.policy.platformMutationExecuted, false);
  assert.deepEqual(done?.payload?.policy.interceptedOperations.sort(), ["budget", "platform_mutation"]);
  assert.equal(events.some((event) => event.label === "mock_runtime" || event.label === "agent_service"), false);
});

test("health exposes production capability flags", async () => {
  const res = await app.request("/health");
  const body = (await res.json()) as {
    mediaWriteEnabled: boolean;
    billingConfigured: boolean;
    helpContentConfigured: boolean;
    supabaseConfigured: boolean;
  };

  assert.equal(res.status, 200);
  assert.equal(body.mediaWriteEnabled, false);
  assert.equal(body.billingConfigured, false);
  assert.equal(typeof body.helpContentConfigured, "boolean");
  assert.equal(typeof body.supabaseConfigured, "boolean");
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

test("greeting chat uses lightweight mock response without latest ad data", async () => {
  const res = await app.request("/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...baseChatPayload,
      workspaceId: "lightweight-greeting-workspace",
      threadId: "lightweight-greeting-thread",
      message: "こんにちは",
    }),
  });
  const body = (await res.json()) as {
    mode: string;
    latestAdData?: unknown;
    message: { content: string };
    policy: { mediaWriteEnabled: boolean };
  };

  assert.equal(res.status, 200);
  assert.equal(body.mode, "mock");
  assert.equal(body.latestAdData, undefined);
  assert.equal(body.policy.mediaWriteEnabled, false);
  assert.match(body.message.content, /広告データ分析/);
});

test("Agent Service greeting request omits latest ad data payload", async () => {
  const originalUseAgentService = process.env.USE_AGENT_SERVICE;
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;

  process.env.USE_AGENT_SERVICE = "true";
  globalThis.fetch = async (_input, init) => {
    capturedBody = JSON.parse(init?.body?.toString() ?? "{}") as Record<string, unknown>;
    return Response.json({
      message: { role: "assistant", content: "こんにちは。使い方を案内します。" },
      recommendation: { title: "使い方を確認する", confidence: "high", operatorSteps: ["相談内容を入力する"] },
      humanTaskDraft: { title: "相談内容を入力する", priority: "low", status: "suggested" },
    });
  };

  try {
    const { app: agentServiceApp } = await import(`./index.js?agent-service-greeting-${Date.now()}`);
    const res = await agentServiceApp.request("/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...baseChatPayload,
        workspaceId: "agent-service-lightweight-workspace",
        threadId: "agent-service-lightweight-thread",
        message: "使い方を教えて",
      }),
    });

    assert.equal(res.status, 200);
    assert.ok(capturedBody);
    assert.equal("latestAdData" in capturedBody, false);
  } finally {
    if (originalUseAgentService === undefined) {
      delete process.env.USE_AGENT_SERVICE;
    } else {
      process.env.USE_AGENT_SERVICE = originalUseAgentService;
    }
    globalThis.fetch = originalFetch;
  }
});

test("Agent Service setup request omits latest ad data payload", async () => {
  const originalUseAgentService = process.env.USE_AGENT_SERVICE;
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;

  process.env.USE_AGENT_SERVICE = "true";
  globalThis.fetch = async (_input, init) => {
    capturedBody = JSON.parse(init?.body?.toString() ?? "{}") as Record<string, unknown>;
    return Response.json({
      message: { role: "assistant", content: "CV地点の設計軸を整理します。" },
      recommendation: { title: "CV地点を設計する", confidence: "medium", operatorSteps: ["商談につながるCVを選ぶ"] },
      humanTaskDraft: { title: "CV地点を確認する", priority: "medium", status: "suggested" },
    });
  };

  try {
    const { app: agentServiceApp } = await import(`./index.js?agent-service-setup-${Date.now()}`);
    const res = await agentServiceApp.request("/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...baseChatPayload,
        workspaceId: "agent-service-setup-workspace",
        threadId: "agent-service-setup-thread",
        message: "どこをコンバージョンとして設定したらいいか",
      }),
    });

    assert.equal(res.status, 200);
    assert.ok(capturedBody);
    assert.equal("latestAdData" in capturedBody, false);
  } finally {
    if (originalUseAgentService === undefined) {
      delete process.env.USE_AGENT_SERVICE;
    } else {
      process.env.USE_AGENT_SERVICE = originalUseAgentService;
    }
    globalThis.fetch = originalFetch;
  }
});

test("Agent Service call can use Cloud Run Google ID token auth", async () => {
  const originalUseAgentService = process.env.USE_AGENT_SERVICE;
  const originalAuthMode = process.env.AGENT_SERVICE_AUTH_MODE;
  const originalAgentUrl = process.env.AGENT_SERVICE_URL;
  const originalAudience = process.env.AGENT_SERVICE_AUDIENCE;
  const originalFetch = globalThis.fetch;
  const seenAuthorizations: Array<string | null> = [];

  process.env.USE_AGENT_SERVICE = "true";
  process.env.AGENT_SERVICE_URL = "https://agent.example.test";
  process.env.AGENT_SERVICE_AUTH_MODE = "google_id_token";
  process.env.AGENT_SERVICE_AUDIENCE = "https://agent.example.test";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity")) {
      assert.equal((init?.headers as Record<string, string>)["Metadata-Flavor"], "Google");
      assert.match(url, /audience=https%3A%2F%2Fagent\.example\.test/);
      return new Response("metadata-id-token");
    }
    if (url === "https://agent.example.test/chat") {
      const headers = new Headers(init?.headers);
      seenAuthorizations.push(headers.get("Authorization"));
      return Response.json({
        message: { role: "assistant", content: "OpenAI Agent Serviceから回答します。" },
        recommendation: { title: "確認する", confidence: "medium", operatorSteps: ["次の指標を見る"] },
        humanTaskDraft: { title: "確認する", priority: "medium", status: "suggested" },
      });
    }
    throw new Error(`Unhandled fetch ${url}`);
  };

  try {
    const { app: agentServiceApp } = await importFreshIndex("agent-google-id-token");
    const res = await agentServiceApp.request("/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...baseChatPayload,
        workspaceId: "agent-auth-workspace",
        threadId: "agent-auth-thread",
        message: "使い方を教えて",
      }),
    });

    assert.equal(res.status, 200);
    assert.deepEqual(seenAuthorizations, ["Bearer metadata-id-token"]);
  } finally {
    restoreEnv("USE_AGENT_SERVICE", originalUseAgentService);
    restoreEnv("AGENT_SERVICE_AUTH_MODE", originalAuthMode);
    restoreEnv("AGENT_SERVICE_URL", originalAgentUrl);
    restoreEnv("AGENT_SERVICE_AUDIENCE", originalAudience);
    globalThis.fetch = originalFetch;
  }
});

test("Agent Service Google ID token auth failure does not call private Agent without auth", async () => {
  const originalUseAgentService = process.env.USE_AGENT_SERVICE;
  const originalAuthMode = process.env.AGENT_SERVICE_AUTH_MODE;
  const originalAgentUrl = process.env.AGENT_SERVICE_URL;
  const originalAudience = process.env.AGENT_SERVICE_AUDIENCE;
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  process.env.USE_AGENT_SERVICE = "true";
  process.env.AGENT_SERVICE_URL = "https://agent.example.test";
  process.env.AGENT_SERVICE_AUTH_MODE = "google_id_token";
  process.env.AGENT_SERVICE_AUDIENCE = "https://agent.example.test";
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity")) {
      return new Response("metadata unavailable", { status: 500 });
    }
    if (url === "https://agent.example.test/chat") {
      throw new Error("private Agent Service should not be called without an ID token");
    }
    throw new Error(`Unhandled fetch ${url}`);
  };

  try {
    const { app: agentServiceApp } = await importFreshIndex("agent-google-id-token-failure");
    const res = await agentServiceApp.request("/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...baseChatPayload,
        workspaceId: "agent-auth-workspace",
        threadId: "agent-auth-thread",
        message: "使い方を教えて",
      }),
    });
    const body = (await res.json()) as { code: string; detail: string };

    assert.equal(res.status, 502);
    assert.equal(body.code, "agent_service_auth_failed");
    assert.match(body.detail, /metadata identity token request failed/);
    assert.equal(calls.some((url) => url === "https://agent.example.test/chat"), false);
  } finally {
    restoreEnv("USE_AGENT_SERVICE", originalUseAgentService);
    restoreEnv("AGENT_SERVICE_AUTH_MODE", originalAuthMode);
    restoreEnv("AGENT_SERVICE_URL", originalAgentUrl);
    restoreEnv("AGENT_SERVICE_AUDIENCE", originalAudience);
    globalThis.fetch = originalFetch;
  }
});

test("authenticated Agent Service context is sanitized before prompt routing", async () => {
  await withMockProductionEnv(async () => {
    process.env.USE_AGENT_SERVICE = "true";
    process.env.AGENT_SERVICE_URL = "https://agent.example.test";
    const fetchMock = createProductionFetchMock({ billingSubscription: activeBillingSubscription() });
    let capturedBody: Record<string, unknown> | undefined;

    await withMockFetch(async (input, init) => {
      const url = String(input);
      if (url === "https://agent.example.test/chat") {
        capturedBody = JSON.parse(init?.body?.toString() ?? "{}") as Record<string, unknown>;
        return Response.json({
          message: { role: "assistant", content: "OpenAI Agent Serviceから回答します。" },
          recommendation: { title: "確認する", confidence: "medium", operatorSteps: ["次の指標を見る"] },
          humanTaskDraft: { title: "確認する", priority: "medium", status: "suggested" },
        });
      }
      return fetchMock.fetch(input, init);
    }, async () => {
      const { app: productionApp } = await importFreshIndex("agent-context-sanitized");
      const res = await productionApp.request("/agent/chat", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          ...baseChatPayload,
          workspaceId: testWorkspaceId,
          userId: testUserId,
          threadId: "agent-context-secret-thread",
          message: "使い方を教えて",
        }),
      });
      const serialized = JSON.stringify(capturedBody);

      assert.equal(res.status, 200);
      assert.ok(capturedBody);
      assert.match(serialized, /operatorFeedbackSummary/);
      assert.match(serialized, /\[REDACTED\]/);
      assert.doesNotMatch(serialized, /raw-refresh-token-value-forbidden/);
      assert.doesNotMatch(serialized, /client-secret-value-forbidden/);
      assert.doesNotMatch(serialized, /access_token_encrypted/);
      assert.doesNotMatch(serialized, /encrypted-token-value/);
    });
  });
});

test("setup intake fallback maps numbered answers and tracks active field", () => {
  const result = buildLocalSetupIntakeResult(
    [
      "1.資料請求のお問い合わせ獲得",
      "2.賃貸管理会社特化のAIエージェント",
      "3.従業員数30名以上、管理戸数3000戸以上、自社物の管理ではなくオーナー様の物件を管理している会社",
    ].join("\n"),
    {
      _intakeState: {
        lastAskedFields: ["goal", "product", "audience"],
        activeField: "goal",
      },
    },
  );

  assert.equal(result.extractedFacts.goal, "資料請求のお問い合わせ獲得");
  assert.equal(result.extractedFacts.product, "賃貸管理会社特化のAIエージェント");
  assert.match(String(result.extractedFacts.audience), /管理戸数3000戸以上/);
  assert.notEqual((result.extractedFacts._intakeState as { activeField?: string }).activeField, "audience");
});

test("setup intake fallback saves short answers to the active field", () => {
  const budgetResult = buildLocalSetupIntakeResult("200000くらい", {
    _intakeState: { activeField: "budget", lastAskedFields: ["budget"] },
  });
  const platformResult = buildLocalSetupIntakeResult("google", {
    _intakeState: { activeField: "platforms", lastAskedFields: ["platforms"] },
  });

  assert.equal(budgetResult.extractedFacts.budget, "200000くらい");
  assert.ok(budgetResult.dimensionScores.budget >= 10);
  assert.deepEqual(platformResult.extractedFacts.platforms, ["google"]);
  assert.equal(platformResult.dimensionScores.platforms, 10);
});

test("setup intake fallback normalizes conversational measurement for setup steps", () => {
  const result = buildLocalSetupIntakeResult("フォーム完了だね", {
    goal: "資料請求のお問い合わせ獲得",
    product: "賃貸管理会社特化のAIエージェント",
    audience: "従業員数30名以上、管理戸数3000戸以上の賃貸管理会社の決裁権者。自社物件のみの会社は追わない",
    budget: "200000くらい",
    platforms: ["Google"],
    _intakeState: { activeField: "measurement", lastAskedFields: ["measurement"] },
  });
  const joined = result.setupSteps.flatMap((step) => step.steps).join("\n");

  assert.equal(result.readyForSetupSteps, true);
  assert.match(joined, /フォーム送信完了|資料請求完了|問い合わせ完了/);
  assert.doesNotMatch(joined, /だね|名前に「フォーム完了だね」/);
  assert.doesNotMatch(joined, /Metaなら|Yahooなら|Google\/Yahoo検索広告|Meta広告マネージャ|Yahoo広告 管理画面/);
});

test("structured setup answers complete exactly one required question without chat inference", () => {
  const result = buildStructuredSetupAnswerResult({
    field: "audience",
    value: "年齢: 30代 / 40代\n家族構成: 夫婦＋子ども\n住宅検討状況: 工務店比較中",
    note: "土地探し中を優先",
    previousFacts: {
      basicInfo: "会社名: サンプル工務店\nホームページURL: https://example.com\n施工エリア: 東京都",
      product: "注文住宅",
      goal: "お問い合わせ獲得",
      area: "都道府県: 東京都\n市区町村: 世田谷区",
      strengths: "高気密・高断熱 / 自由設計",
      keyMessage: "高性能な家を適正価格で",
      budget: "10〜30万円",
      destination: "LP",
      assets: "写真: 十分ある\n動画: ある\nロゴ: ある\nLP: イベントページ",
      acquisitionMethods: "Instagram運用 / 紹介",
      _questionnaire: {
        version: "housing-v1",
        completedFields: ["basicInfo", "product", "goal", "area", "strengths", "keyMessage", "budget", "destination", "assets", "acquisitionMethods"],
      },
    },
    previousMissingFields: ["audience", "adExperience"],
  });

  assert.match(String(result.extractedFacts.audience), /夫婦＋子ども/);
  assert.deepEqual(result.missingFields, ["adExperience"]);
  assert.equal(result.dimensionScores.audience, 10);
  assert.equal(result.readyForSetupSteps, false);
  assert.equal(result.assistantMessage, "");
});

test("structured setup answers generate human setup steps only after every required answer", () => {
  const result = buildStructuredSetupAnswerResult({
    field: "adExperience",
    value: "両方運用している",
    previousFacts: {
      basicInfo: "会社名: サンプル工務店\nホームページURL: https://example.com\n施工エリア: 東京都",
      product: "注文住宅",
      goal: "モデルハウス来場予約",
      area: "都道府県: 東京都\n市区町村: 世田谷区",
      audience: "年齢: 30代\n家族構成: 夫婦＋子ども\n住宅検討状況: 具体的に検討中",
      strengths: "高気密・高断熱 / 自由設計",
      keyMessage: "高性能な家を適正価格で",
      budget: "10〜30万円",
      destination: "LP",
      assets: "写真: 十分ある\n動画: ある\nロゴ: ある\nLP: イベントページ",
      acquisitionMethods: "Google広告 / Meta広告",
      _questionnaire: {
        version: "housing-v1",
        completedFields: ["basicInfo", "product", "goal", "area", "audience", "strengths", "keyMessage", "budget", "destination", "assets", "acquisitionMethods"],
      },
    },
    previousMissingFields: ["adExperience"],
  });

  assert.deepEqual(result.missingFields, []);
  assert.equal(result.score, 10);
  assert.equal(result.readyForSetupSteps, true);
  assert.ok(result.setupSteps.length > 0);
  assert.match(result.setupSteps.flatMap((step) => step.steps).join("\n"), /Google広告/);
  assert.match(result.setupSteps.flatMap((step) => step.steps).join("\n"), /Meta/);
});

test("Agent Service chat fetch aborts on timeout", async () => {
  const originalUseAgentService = process.env.USE_AGENT_SERVICE;
  const originalTimeout = process.env.AGENT_SERVICE_TIMEOUT_MS;
  const originalFetch = globalThis.fetch;

  process.env.USE_AGENT_SERVICE = "true";
  process.env.AGENT_SERVICE_TIMEOUT_MS = "1";
  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });

  try {
    const { app: agentServiceApp } = await import(`./index.js?agent-service-timeout-${Date.now()}`);
    const res = await agentServiceApp.request("/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...baseChatPayload,
        workspaceId: "agent-service-timeout-workspace",
        threadId: "agent-service-timeout-thread",
        message: "CPAが悪化した理由を教えて",
      }),
    });
    const body = (await res.json()) as { error: string; detail: string };

    assert.equal(res.status, 502);
    assert.match(body.error, /タイムアウト/);
    assert.match(body.detail, /aborted/i);
  } finally {
    if (originalUseAgentService === undefined) {
      delete process.env.USE_AGENT_SERVICE;
    } else {
      process.env.USE_AGENT_SERVICE = originalUseAgentService;
    }
    if (originalTimeout === undefined) {
      delete process.env.AGENT_SERVICE_TIMEOUT_MS;
    } else {
      process.env.AGENT_SERVICE_TIMEOUT_MS = originalTimeout;
    }
    globalThis.fetch = originalFetch;
  }
});

test("billing status reports active subscription after login", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock({
      billingCustomer: {
        id: "billing-customer-row",
        workspace_id: testWorkspaceId,
        user_id: testUserId,
        stripe_customer_id: "cus_test_active",
        created_at: "2026-06-04T00:00:00.000Z",
        updated_at: "2026-06-04T00:00:00.000Z",
      },
      billingSubscription: {
        id: "billing-subscription-row",
        workspace_id: testWorkspaceId,
        stripe_customer_id: "cus_test_active",
        stripe_subscription_id: "sub_test_active",
        stripe_price_id: "price_standard_month",
        plan_id: "standard",
        billing_interval: "month",
        status: "active",
        current_period_end: "2026-07-04T00:00:00.000Z",
        cancel_at_period_end: false,
        raw: {},
        created_at: "2026-06-04T00:00:00.000Z",
        updated_at: "2026-06-04T00:00:00.000Z",
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("billing-status");
      const res = await productionApp.request("/billing/status", {
        headers: authHeaders(),
      });
      const body = (await res.json()) as {
        workspaceId: string;
        configured: boolean;
        access: string;
        customer: { stripeCustomerId: string } | null;
        subscription: { stripeSubscriptionId: string; status: string } | null;
      };

      assert.equal(res.status, 200);
      assert.equal(body.workspaceId, testWorkspaceId);
      assert.equal(body.configured, true);
      assert.equal(body.access, "active");
      assert.equal(body.customer?.stripeCustomerId, "cus_test_active");
      assert.equal(body.subscription?.stripeSubscriptionId, "sub_test_active");
      assert.equal(body.subscription?.status, "active");
    });
  });
});

test("premium billing status always exposes the fallback onboarding booking URL", async () => {
  await withMockProductionEnv(async () => {
    delete process.env.PREMIUM_ONBOARDING_BOOKING_URL;
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription({
        stripe_price_id: "price_premium_month",
        plan_id: "premium",
      }),
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("premium-booking-fallback");
      const res = await productionApp.request("/billing/status", { headers: authHeaders() });
      const body = await res.json() as { premiumOnboardingBookingUrl: string | null };

      assert.equal(res.status, 200);
      assert.equal(body.premiumOnboardingBookingUrl, "https://example.com");
    });
  });
});

test("google oauth callback stores encrypted tokens and audits connection without secrets", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_OAUTH_STATE_STORE = "memory";
    const { decryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({ billingSubscription: activeBillingSubscription() });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-oauth-callback");
      const startRes = await productionApp.request("/oauth/google/start-url", {
        headers: authHeaders(),
      });
      const startBody = (await startRes.json()) as { url: string };
      const authorizationUrl = new URL(startBody.url);
      const state = authorizationUrl.searchParams.get("state");

      assert.equal(startRes.status, 200);
      assert.ok(state);
      assert.equal(authorizationUrl.searchParams.get("redirect_uri"), "https://api.example.test/oauth/google/callback");

      const callbackRes = await productionApp.request(`/oauth/google/callback?code=oauth-code-test&state=${encodeURIComponent(state)}`);
      const connectionUpsert = fetchMock.calls.find((call) => call.kind === "supabase.google_connection_upsert");
      const auditCall = fetchMock.calls.find(
        (call) => call.kind === "supabase.audit" && call.json?.event_type === "google_ads.oauth_connected",
      );
      const auditBody = JSON.stringify(auditCall?.json ?? {});

      assert.equal(callbackRes.status, 302);
      assert.equal(callbackRes.headers.get("Location"), "https://app.example.test/?connection=google&status=connected");
      assert.equal(decryptToken(String(connectionUpsert?.json?.access_token_encrypted)), "google-oauth-access-token");
      assert.equal(decryptToken(String(connectionUpsert?.json?.refresh_token_encrypted)), "google-oauth-refresh-token");
      assert.deepEqual(connectionUpsert?.json?.scopes, ["https://www.googleapis.com/auth/adwords"]);
      assert.equal(auditCall?.json?.payload?.platform, "google");
      assert.equal(auditCall?.json?.payload?.refreshIssued, true);
      assert.deepEqual(auditCall?.json?.payload?.scopes, ["https://www.googleapis.com/auth/adwords"]);
      assert.doesNotMatch(auditBody, /google-oauth-access-token|google-oauth-refresh-token|oauth-code-test|client_secret|access_token|refresh_token/);
    });
  });
});

test("public app refuses a localhost Google Ads OAuth callback", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_REDIRECT_URI = "http://localhost:8787/oauth/google/callback";
    const fetchMock = createProductionFetchMock({ billingSubscription: activeBillingSubscription() });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-oauth-public-loopback-rejected");
      const res = await productionApp.request("/oauth/google/start-url", { headers: authHeaders() });
      const body = await res.json() as { error: string };

      assert.equal(res.status, 500);
      assert.match(body.error, /cannot use a localhost GOOGLE_ADS_REDIRECT_URI/);
    });
  });
});

test("google customer list provider errors are redacted before API response", async () => {
  await withMockProductionEnv(async () => {
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
      failGoogleCustomerList: true,
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-customers-redacted-error");
      const res = await productionApp.request(`/google/customers?workspaceId=${testWorkspaceId}`, {
        headers: authHeaders(),
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 500);
      assert.match(body.error, /Google Ads customer list取得に失敗/);
      assert.doesNotMatch(body.error, /raw-provider-token|google-access-token|developer-token-test|Authorization: Bearer/);
      assert.match(body.error, /access_token=\[REDACTED\]/);
      assert.match(body.error, /developer-token=\[REDACTED\]/);
    });
  });
});

test("google customer connect rejects an MCC before it can consume the ad-account limit", async () => {
  await withMockProductionEnv(async () => {
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
      googleCustomerManager: true,
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-connect-rejects-mcc");
      const res = await productionApp.request(`/google/customers/1234567890/connect?workspaceId=${testWorkspaceId}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ managerCustomerId: null }),
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 409);
      assert.match(body.error, /MCC（管理者アカウント）は広告アカウント上限へ算入せず/);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.ad_account_upsert"), false);
    });
  });
});

test("billing checkout session includes workspace metadata and audit log", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock();

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("billing-checkout");
      const res = await productionApp.request("/billing/checkout-session", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ planId: "standard", interval: "month" }),
      });
      const body = (await res.json()) as { id: string; url: string };
      const stripeCall = fetchMock.calls.find((call) => call.kind === "stripe.checkout");
      const auditCall = fetchMock.calls.find((call) => call.kind === "supabase.audit");

      assert.equal(res.status, 200);
      assert.equal(body.id, "cs_test_checkout");
      assert.equal(body.url, "https://checkout.stripe.test/session");
      assert.equal(stripeCall?.params?.get("client_reference_id"), testWorkspaceId);
      assert.equal(stripeCall?.params?.get("metadata[workspace_id]"), testWorkspaceId);
      assert.equal(stripeCall?.params?.get("metadata[user_id]"), testUserId);
      assert.equal(stripeCall?.params?.get("customer_email"), "operator@example.com");
      assert.equal(stripeCall?.params?.get("success_url"), "https://app.example.test/?billing=success&session_id={CHECKOUT_SESSION_ID}");
      assert.equal(stripeCall?.params?.get("line_items[0][price]"), "price_standard_month");
      assert.equal(stripeCall?.params?.get("line_items[1][price]"), "price_standard_setup");
      assert.equal(stripeCall?.params?.get("metadata[stripe_setup_fee_price_id]"), "price_standard_setup");
      assert.equal(stripeCall?.params?.has("payment_method_types[0]"), false);
      assert.equal(auditCall?.json?.event_type, "stripe.checkout_session_created");
      assert.equal(auditCall?.json?.workspace_id, testWorkspaceId);
    });
  });
});

test("billing checkout session reuses existing Stripe customer without customer_email", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock({
      billingCustomer: {
        id: "billing-customer-row",
        workspace_id: testWorkspaceId,
        user_id: testUserId,
        stripe_customer_id: "cus_existing_checkout",
        created_at: "2026-06-04T00:00:00.000Z",
        updated_at: "2026-06-04T00:00:00.000Z",
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("billing-checkout-existing-customer");
      const res = await productionApp.request("/billing/checkout-session", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ planId: "standard", interval: "month" }),
      });
      const stripeCall = fetchMock.calls.find((call) => call.kind === "stripe.checkout");

      assert.equal(res.status, 200);
      assert.equal(stripeCall?.params?.get("customer"), "cus_existing_checkout");
      assert.equal(stripeCall?.params?.has("customer_email"), false);
      assert.equal(stripeCall?.params?.get("metadata[workspace_id]"), testWorkspaceId);
    });
  });
});

test("billing checkout provider errors are redacted before API response", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock({ failStripeCheckout: true });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("billing-checkout-redacted-error");
      const res = await productionApp.request("/billing/checkout-session", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ planId: "standard", interval: "month" }),
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 500);
      assert.match(body.error, /Stripe API request failed/);
      assert.doesNotMatch(body.error, /sk_test_stripe|sk_live_raw_provider_secret|whsec_raw_provider_secret|https:\/\/checkout\.stripe\.test\/session|Authorization: Bearer/);
      assert.match(body.error, /\[REDACTED\]/);
      assert.match(body.error, /\[REDACTED_URL\]/);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.audit" && call.json?.event_type === "stripe.checkout_session_created"), false);
    });
  });
});

test("billing portal session uses existing customer and writes non-secret audit log", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock({
      billingCustomer: {
        id: "billing-customer-row",
        workspace_id: testWorkspaceId,
        user_id: testUserId,
        stripe_customer_id: "cus_test_active",
        created_at: "2026-06-04T00:00:00.000Z",
        updated_at: "2026-06-04T00:00:00.000Z",
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("billing-portal");
      const res = await productionApp.request("/billing/portal-session", {
        method: "POST",
        headers: authHeaders(),
      });
      const body = (await res.json()) as { id: string; url: string };
      const stripeCall = fetchMock.calls.find((call) => call.kind === "stripe.portal");
      const auditCall = fetchMock.calls.find(
        (call) => call.kind === "supabase.audit" && call.json?.event_type === "stripe.portal_session_created",
      );
      const auditBody = JSON.stringify(auditCall?.json ?? {});

      assert.equal(res.status, 200);
      assert.equal(body.id, "bps_test");
      assert.equal(body.url, "https://billing.stripe.test/session");
      assert.equal(stripeCall?.params?.get("customer"), "cus_test_active");
      assert.equal(stripeCall?.params?.get("return_url"), "https://app.example.test/?billing=portal-return");
      assert.equal(auditCall?.json?.workspace_id, testWorkspaceId);
      assert.equal(auditCall?.json?.user_id, testUserId);
      assert.equal(auditCall?.json?.payload?.sessionId, "bps_test");
      assert.equal(auditCall?.json?.payload?.stripeCustomerId, "cus_test_active");
      assert.doesNotMatch(auditBody, /sk_test_stripe|https:\/\/billing\.stripe\.test\/session/);
    });
  });
});

test("stripe webhook verifies signature and upserts billing records", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock();
    const rawBody = JSON.stringify({
      id: "evt_checkout_completed",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_webhook",
          subscription: "sub_webhook",
          client_reference_id: testWorkspaceId,
          metadata: {
            workspace_id: testWorkspaceId,
            user_id: testUserId,
            plan_id: "standard",
            billing_interval: "month",
            stripe_price_id: "price_standard_month",
            stripe_setup_fee_price_id: "price_standard_setup",
          },
        },
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("stripe-webhook");
      const res = await productionApp.request("/billing/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripeSignature(rawBody),
        },
        body: rawBody,
      });
      const body = (await res.json()) as { received: boolean };
      const customerUpsert = fetchMock.calls.find((call) => call.kind === "supabase.billing_customer_upsert");
      const subscriptionUpsert = fetchMock.calls.find((call) => call.kind === "supabase.billing_subscription_upsert");
      const claim = fetchMock.calls.find((call) => call.kind === "supabase.stripe_webhook_claim");
      const finish = fetchMock.calls.find((call) => call.kind === "supabase.stripe_webhook_finish");

      assert.equal(res.status, 200);
      assert.equal(body.received, true);
      assert.equal(customerUpsert?.json?.workspace_id, testWorkspaceId);
      assert.equal(customerUpsert?.json?.stripe_customer_id, "cus_webhook");
      assert.equal(subscriptionUpsert?.json?.stripe_subscription_id, "sub_webhook");
      assert.equal(subscriptionUpsert?.json?.status, "checkout_completed");
      assert.equal(claim?.json?.p_event_id, "evt_checkout_completed");
      assert.equal(finish?.json?.p_succeeded, true);
    });
  });
});

test("checkout completion repairs an existing active subscription missing plan metadata", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock({
      billingCustomer: {
        id: "billing-customer-row",
        workspace_id: testWorkspaceId,
        stripe_customer_id: "cus_webhook",
      },
      billingSubscription: activeBillingSubscription({
        stripe_customer_id: "cus_webhook",
        stripe_subscription_id: "sub_webhook",
        plan_id: null,
        billing_interval: null,
      }),
    });
    const rawBody = JSON.stringify({
      id: "evt_checkout_repairs_plan",
      type: "checkout.session.completed",
      created: 1_900_000_000,
      data: {
        object: {
          customer: "cus_webhook",
          subscription: "sub_webhook",
          client_reference_id: testWorkspaceId,
          metadata: {
            workspace_id: testWorkspaceId,
            user_id: testUserId,
            plan_id: "standard",
            billing_interval: "month",
            stripe_price_id: "price_standard_month",
            stripe_setup_fee_price_id: "price_standard_setup",
          },
        },
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("stripe-webhook-repair-plan");
      const res = await productionApp.request("/billing/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature(rawBody) },
        body: rawBody,
      });
      const subscriptionUpsert = fetchMock.calls.find((call) => call.kind === "supabase.billing_subscription_upsert");

      assert.equal(res.status, 200);
      assert.equal(subscriptionUpsert?.json?.status, "active");
      assert.equal(subscriptionUpsert?.json?.plan_id, "standard");
      assert.equal(subscriptionUpsert?.json?.billing_interval, "month");
    });
  });
});

test("subscription creation can link the signed Checkout customer before checkout completion arrives", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock();
    const rawBody = JSON.stringify({
      id: "evt_subscription_before_checkout",
      type: "customer.subscription.created",
      created: 1_900_000_000,
      data: {
        object: {
          id: "sub_webhook",
          customer: "cus_webhook",
          status: "active",
          metadata: {
            workspace_id: testWorkspaceId,
            user_id: testUserId,
            plan_id: "standard",
            billing_interval: "month",
          },
          items: { data: [{ price: { id: "price_standard_month" }, current_period_end: 1_910_000_000 }] },
        },
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("stripe-webhook-subscription-first");
      const res = await productionApp.request("/billing/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature(rawBody) },
        body: rawBody,
      });
      const customerUpsert = fetchMock.calls.find((call) => call.kind === "supabase.billing_customer_upsert");
      const subscriptionUpsert = fetchMock.calls.find((call) => call.kind === "supabase.billing_subscription_upsert");

      assert.equal(res.status, 200);
      assert.equal(customerUpsert?.json?.workspace_id, testWorkspaceId);
      assert.equal(customerUpsert?.json?.user_id, testUserId);
      assert.equal(subscriptionUpsert?.json?.status, "active");
      assert.equal(subscriptionUpsert?.json?.plan_id, "standard");
      assert.equal(subscriptionUpsert?.json?.current_period_end, new Date(1_910_000_000 * 1000).toISOString());
    });
  });
});

test("duplicate Stripe webhook deliveries return success without repeating mutations", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock({ stripeWebhookClaimed: false });
    const rawBody = JSON.stringify({
      id: "evt_duplicate",
      type: "checkout.session.completed",
      data: { object: { customer: "cus_duplicate", metadata: {} } },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("stripe-webhook-duplicate");
      const res = await productionApp.request("/billing/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature(rawBody) },
        body: rawBody,
      });
      const body = await res.json() as { duplicate: boolean };

      assert.equal(res.status, 200);
      assert.equal(body.duplicate, true);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_customer_upsert"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.stripe_webhook_finish"), false);
    });
  });
});

test("Stripe Portal plan changes use the current Price even when subscription metadata is stale", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock({
      billingCustomer: {
        id: "billing-customer-row",
        workspace_id: testWorkspaceId,
        stripe_customer_id: "cus_test_active",
      },
    });
    const rawBody = JSON.stringify({
      id: "evt_subscription_portal_change",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_test_active",
          customer: "cus_test_active",
          status: "active",
          current_period_end: 1_800_000_000,
          metadata: {
            workspace_id: testWorkspaceId,
            plan_id: "standard",
            billing_interval: "month",
          },
          items: { data: [{ price: { id: "price_premium_month" } }] },
        },
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("stripe-webhook-portal-plan-change");
      const res = await productionApp.request("/billing/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature(rawBody) },
        body: rawBody,
      });
      const upsert = fetchMock.calls.find((call) => call.kind === "supabase.billing_subscription_upsert");

      assert.equal(res.status, 200);
      assert.equal(upsert?.json?.plan_id, "premium");
      assert.equal(upsert?.json?.billing_interval, "month");
      assert.equal(upsert?.json?.stripe_price_id, "price_premium_month");
    });
  });
});

test("out-of-order Stripe subscription events cannot overwrite newer mirrored state", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock({
      billingCustomer: {
        id: "billing-customer-row",
        workspace_id: testWorkspaceId,
        stripe_customer_id: "cus_test_active",
      },
      billingSubscription: activeBillingSubscription({
        plan_id: "premium",
        billing_interval: "month",
        stripe_price_id: "price_premium_month",
        raw: { type: "customer.subscription.updated", stripeEventCreated: 2_000_000_000 },
      }),
    });
    const rawBody = JSON.stringify({
      id: "evt_stale_subscription",
      type: "customer.subscription.updated",
      created: 1_900_000_000,
      data: {
        object: {
          id: "sub_test_active",
          customer: "cus_test_active",
          status: "active",
          metadata: { workspace_id: testWorkspaceId },
          items: { data: [{ price: { id: "price_standard_month" } }] },
        },
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("stripe-webhook-stale-event");
      const res = await productionApp.request("/billing/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature(rawBody) },
        body: rawBody,
      });
      const body = await res.json() as { stale: boolean };

      assert.equal(res.status, 200);
      assert.equal(body.stale, true);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_subscription_upsert"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.workspace_update"), false);
    });
  });
});

test("stripe webhook rejects invalid signatures without mutating billing rows", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock();
    const rawBody = JSON.stringify({
      id: "evt_invalid_signature",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_webhook",
          subscription: "sub_webhook",
          client_reference_id: testWorkspaceId,
          metadata: { workspace_id: testWorkspaceId, user_id: testUserId },
        },
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("stripe-webhook-invalid-signature");
      const res = await productionApp.request("/billing/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=bad-signature`,
        },
        body: rawBody,
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400);
      assert.match(body.error, /signature/);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_customer_upsert"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_subscription_upsert"), false);
    });
  });
});

test("stripe webhook rejects handled events without workspace metadata", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock();
    const rawBody = JSON.stringify({
      id: "evt_checkout_missing_workspace",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_webhook",
          subscription: "sub_webhook",
          metadata: { user_id: testUserId },
        },
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("stripe-webhook-missing-workspace");
      const res = await productionApp.request("/billing/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripeSignature(rawBody),
        },
        body: rawBody,
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400);
      assert.match(body.error, /metadata\.workspace_id/);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_customer_upsert"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_subscription_upsert"), false);
    });
  });
});

test("stripe webhook rejects invalid workspace metadata before billing mutations", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock();
    const rawBody = JSON.stringify({
      id: "evt_checkout_invalid_workspace",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_webhook",
          subscription: "sub_webhook",
          metadata: { workspace_id: "not-a-workspace-uuid", user_id: testUserId },
        },
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("stripe-webhook-invalid-workspace-metadata");
      const res = await productionApp.request("/billing/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripeSignature(rawBody),
        },
        body: rawBody,
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400);
      assert.match(body.error, /metadata\.workspace_id.*UUID/);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_customer_upsert"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_subscription_upsert"), false);
    });
  });
});

test("stripe webhook rejects invalid user metadata before billing mutations", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock();
    const rawBody = JSON.stringify({
      id: "evt_checkout_invalid_user",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_webhook",
          subscription: "sub_webhook",
          metadata: { workspace_id: testWorkspaceId, user_id: "not-a-user-uuid" },
        },
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("stripe-webhook-invalid-user-metadata");
      const res = await productionApp.request("/billing/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripeSignature(rawBody),
        },
        body: rawBody,
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400);
      assert.match(body.error, /metadata\.user_id.*UUID/);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_customer_upsert"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_subscription_upsert"), false);
    });
  });
});

test("stripe webhook rejects mismatched workspace metadata before billing mutations", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock();
    const rawBody = JSON.stringify({
      id: "evt_checkout_mismatched_workspace",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_webhook",
          subscription: "sub_webhook",
          client_reference_id: "99999999-9999-4999-8999-999999999999",
          metadata: { workspace_id: testWorkspaceId, user_id: testUserId },
        },
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("stripe-webhook-mismatched-workspace-metadata");
      const res = await productionApp.request("/billing/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripeSignature(rawBody),
        },
        body: rawBody,
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400);
      assert.match(body.error, /metadata\.workspace_id.*client_reference_id/);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_customer_upsert"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_subscription_upsert"), false);
    });
  });
});

test("stripe webhook rejects customer already linked to another workspace", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock({
      billingCustomer: {
        id: "billing-customer-other-workspace",
        workspace_id: "99999999-9999-4999-8999-999999999999",
        stripe_customer_id: "cus_webhook",
      },
    });
    const rawBody = JSON.stringify({
      id: "evt_checkout_wrong_workspace",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_webhook",
          subscription: "sub_webhook",
          client_reference_id: testWorkspaceId,
          metadata: { workspace_id: testWorkspaceId, user_id: testUserId },
        },
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("stripe-webhook-customer-workspace-mismatch");
      const res = await productionApp.request("/billing/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripeSignature(rawBody),
        },
        body: rawBody,
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400);
      assert.match(body.error, /another workspace/);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_customer_upsert"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_subscription_upsert"), false);
    });
  });
});

test("stripe webhook ignores unsupported events without mutating billing rows", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock();
    const rawBody = JSON.stringify({
      id: "evt_invoice_paid",
      type: "invoice.paid",
      data: {
        object: {
          customer: "cus_webhook",
          metadata: { workspace_id: testWorkspaceId },
        },
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("stripe-webhook-unsupported-event");
      const res = await productionApp.request("/billing/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripeSignature(rawBody),
        },
        body: rawBody,
      });
      const body = (await res.json()) as { received: boolean; handled: boolean; ignored: boolean; eventType: string };

      assert.equal(res.status, 200);
      assert.equal(body.received, true);
      assert.equal(body.handled, false);
      assert.equal(body.ignored, true);
      assert.equal(body.eventType, "invoice.paid");
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_customer_upsert"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_subscription_upsert"), false);
    });
  });
});

test("google ads campaign write requires confirmation and enabled write flag", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "false";
    const fetchMock = createProductionFetchMock({ billingSubscription: activeBillingSubscription() });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-write-disabled");
      const res = await productionApp.request("/google/customers/1234567890/campaigns/987654321/status", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ status: "PAUSED", expectedCurrentStatus: "ENABLED", confirmed: true, approvalNote: "CPA悪化のため停止し、24時間後にCPA改善がなければ戻す。" }),
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 503);
      assert.match(body.error, /GOOGLE_ADS_WRITE_ENABLED=true/);
      assert.equal(fetchMock.calls.some((call) => call.kind === "google.campaign_status_mutate"), false);
    });
  });
});

test("google ads campaign write requires approval note for auditability", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-write-missing-approval-note");
      const res = await productionApp.request("/google/customers/1234567890/campaigns/987654321/status", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ status: "PAUSED", expectedCurrentStatus: "ENABLED", confirmed: true }),
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400);
      assert.match(body.error, /approvalNote is required/);
      assert.equal(fetchMock.calls.some((call) => call.kind === "google.campaign_status_mutate"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.audit"), false);
    });
  });
});

test("google ads campaign write requires rollback condition in approval note", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-write-approval-note-without-rollback");
      const res = await productionApp.request("/google/customers/1234567890/campaigns/987654321/status", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ status: "PAUSED", expectedCurrentStatus: "ENABLED", confirmed: true, approvalNote: "CPA悪化のため一時停止して様子を見る。" }),
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400);
      assert.match(body.error, /rollback condition/);
      assert.equal(fetchMock.calls.some((call) => call.kind === "google.campaign_status_mutate"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.audit"), false);
    });
  });
});

test("google ads campaign write requires connected customer in workspace", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
      googleAdAccount: null,
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-write-unconnected-customer");
      const res = await productionApp.request("/google/customers/1234567890/campaigns/987654321/status", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ status: "PAUSED", expectedCurrentStatus: "ENABLED", confirmed: true, approvalNote: "CPA悪化のため停止し、24時間後にCPA改善がなければ戻す。" }),
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400);
      assert.match(body.error, /not connected to this workspace/);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.ad_account_get"), true);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.google_token_get"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "google.campaign_status_mutate"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.audit"), false);
    });
  });
});

test("google ads campaign status write calls mutate only after explicit approval", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-write-executed");
      const res = await productionApp.request("/google/customers/123-456-7890/campaigns/987654321/status", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ status: "PAUSED", expectedCurrentStatus: "ENABLED", confirmed: true, approvalNote: "CPA悪化のため停止し、24時間後にCPA改善がなければ戻す。" }),
      });
      const body = (await res.json()) as {
        mode: string;
        customerId: string;
        campaignId: string;
        status: string;
        policy: { humanInTheLoopRequired: boolean; platformMutationExecuted: boolean };
      };
      const googleCall = fetchMock.calls.find((call) => call.kind === "google.campaign_status_mutate");
      const auditCall = fetchMock.calls.find((call) => call.kind === "supabase.audit");

      assert.equal(res.status, 200);
      assert.equal(body.mode, "executed");
      assert.equal(body.customerId, "1234567890");
      assert.equal(body.campaignId, "987654321");
      assert.equal(body.status, "PAUSED");
      assert.equal(body.policy.humanInTheLoopRequired, true);
      assert.equal(body.policy.platformMutationExecuted, true);
      assert.equal(googleCall?.authorization, "Bearer google-access-token");
      assert.equal(googleCall?.developerToken, "developer-token-test");
      assert.deepEqual(googleCall?.json, {
        operations: [
          {
            update: {
              resourceName: "customers/1234567890/campaigns/987654321",
              status: "PAUSED",
            },
            updateMask: "status",
          },
        ],
      });
      assert.equal(auditCall?.json?.event_type, "google_ads.campaign_status_updated");
      assert.equal(auditCall?.json?.payload?.status, "PAUSED");
      assert.match(auditCall?.json?.payload?.approvalNote, /CPA悪化/);
      assert.equal(auditCall?.json?.payload?.confirmed, true);
      assert.equal(auditCall?.json?.payload?.approvalType, "explicit_user_confirmation");
      assert.equal(auditCall?.json?.payload?.approvedByUserId, testUserId);
      assert.equal(Number.isNaN(Date.parse(String(auditCall?.json?.payload?.approvedAt))), false);
    });
  });
});

test("MCC child campaign preview and write reuse the connected manager customer header", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "9999999999";
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
      googleAdAccount: {
        id: "google-ad-account-row",
        status: "connected",
        manager_customer_id: "111-222-3333",
      },
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-write-mcc-header");
      const res = await productionApp.request("/google/customers/1234567890/campaigns/987654321/status", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ status: "PAUSED", expectedCurrentStatus: "ENABLED", confirmed: true, approvalNote: "CPA悪化のため停止し、24時間後に改善がなければ戻す。" }),
      });
      const search = fetchMock.calls.find((call) => call.kind === "google.campaign_budget_search");
      const mutate = fetchMock.calls.find((call) => call.kind === "google.campaign_status_mutate");

      assert.equal(res.status, 200);
      assert.equal(search?.loginCustomerId, "1112223333");
      assert.equal(mutate?.loginCustomerId, "1112223333");
    });
  });
});

test("google ads campaign status write redacts secret-like approval note before audit", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-write-approval-note-redaction");
      const res = await productionApp.request("/google/customers/1234567890/campaigns/987654321/status", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          status: "PAUSED",
          expectedCurrentStatus: "ENABLED",
          confirmed: true,
          approvalNote:
            "CPA悪化のため停止し、24時間後にCPA改善がなければ戻す。sk-test-secret-value-forbidden Authorization: Bearer google-access-token-forbidden client_secret=client-secret-value-forbidden",
        }),
      });
      const auditCall = fetchMock.calls.find((call) => call.kind === "supabase.audit");
      const approvalNote = String(auditCall?.json?.payload?.approvalNote ?? "");

      assert.equal(res.status, 200);
      assert.match(approvalNote, /CPA悪化/);
      assert.match(approvalNote, /戻す/);
      assert.match(approvalNote, /\[REDACTED\]/);
      assert.doesNotMatch(approvalNote, /sk-test-secret-value-forbidden/);
      assert.doesNotMatch(approvalNote, /google-access-token-forbidden/);
      assert.doesNotMatch(approvalNote, /client-secret-value-forbidden/);
      assert.doesNotMatch(approvalNote, /Authorization: Bearer/);
      assert.doesNotMatch(approvalNote, /client_secret=/);
    });
  });
});

test("google ads campaign status write audits provider failures without secrets", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
      failGoogleStatusMutate: true,
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-write-provider-failure");
      const res = await productionApp.request("/google/customers/1234567890/campaigns/987654321/status", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ status: "PAUSED", expectedCurrentStatus: "ENABLED", confirmed: true, approvalNote: "CPA悪化のため停止し、24時間後にCPA改善がなければ戻す。" }),
      });
      const body = (await res.json()) as { error: string };
      const failureAudit = fetchMock.calls.find(
        (call) => call.kind === "supabase.audit" && call.json?.event_type === "google_ads.campaign_status_update_failed",
      );
      const failureAuditBody = JSON.stringify(failureAudit?.json ?? {});

      assert.equal(res.status, 500);
      assert.match(body.error, /Google Ads writeに失敗/);
      assert.equal(failureAudit?.json?.level, "error");
      assert.equal(failureAudit?.json?.payload?.customerId, "1234567890");
      assert.equal(failureAudit?.json?.payload?.campaignId, "987654321");
      assert.equal(failureAudit?.json?.payload?.status, "PAUSED");
      assert.match(failureAudit?.json?.payload?.approvalNote, /CPA悪化/);
      assert.equal(failureAudit?.json?.payload?.confirmed, true);
      assert.equal(failureAudit?.json?.payload?.approvalType, "explicit_user_confirmation");
      assert.equal(failureAudit?.json?.payload?.approvedByUserId, testUserId);
      assert.equal(Number.isNaN(Date.parse(String(failureAudit?.json?.payload?.approvedAt))), false);
      assert.doesNotMatch(failureAuditBody, /google-access-token|developer-token-test|Authorization|access_token=raw-provider-token/);
    });
  });
});

test("google ads campaign status write rejects non-reversible REMOVED status", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-write-removed-rejected");
      const res = await productionApp.request("/google/customers/1234567890/campaigns/987654321/status", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ status: "REMOVED", expectedCurrentStatus: "ENABLED", confirmed: true, approvalNote: "削除相当の変更は不可逆なので、停止で代替して24時間後に戻す。" }),
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400);
      assert.match(body.error, /ENABLED or PAUSED/);
      assert.equal(fetchMock.calls.some((call) => call.kind.startsWith("google.")), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.audit"), false);
    });
  });
});

test("google ads campaign write refreshes expired access tokens before mutation", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    const { decryptToken, encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token-expired"),
      encryptedGoogleRefreshToken: encryptToken("google-refresh-token"),
      googleTokenExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-write-refresh-token");
      const res = await productionApp.request("/google/customers/1234567890/campaigns/987654321/status", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ status: "PAUSED", expectedCurrentStatus: "ENABLED", confirmed: true, approvalNote: "CPA悪化のため停止し、24時間後にCPA改善がなければ戻す。" }),
      });
      const refreshCall = fetchMock.calls.find((call) => call.kind === "google.oauth_token_refresh");
      const connectionUpsert = fetchMock.calls.find((call) => call.kind === "supabase.google_connection_upsert");
      const googleCall = fetchMock.calls.find((call) => call.kind === "google.campaign_status_mutate");
      const tokenRefreshAudit = fetchMock.calls.find(
        (call) => call.kind === "supabase.audit" && call.json?.event_type === "google_ads.oauth_token_refreshed",
      );
      const tokenRefreshAuditBody = JSON.stringify(tokenRefreshAudit?.json ?? {});

      assert.equal(res.status, 200);
      assert.equal(refreshCall?.params?.get("grant_type"), "refresh_token");
      assert.equal(refreshCall?.params?.get("refresh_token"), "google-refresh-token");
      assert.equal(googleCall?.authorization, "Bearer google-access-token-refreshed");
      assert.equal(decryptToken(String(connectionUpsert?.json?.access_token_encrypted)), "google-access-token-refreshed");
      assert.equal(decryptToken(String(connectionUpsert?.json?.refresh_token_encrypted)), "google-refresh-token");
      assert.equal(tokenRefreshAudit?.json?.event_type, "google_ads.oauth_token_refreshed");
      assert.equal(tokenRefreshAudit?.json?.payload?.platform, "google");
      assert.deepEqual(tokenRefreshAudit?.json?.payload?.scopes, ["https://www.googleapis.com/auth/adwords"]);
      assert.doesNotMatch(tokenRefreshAuditBody, /google-access-token-refreshed|google-refresh-token|google-access-token-expired/);
    });
  });
});

test("google ads campaign budget write resolves budget resource and audits execution", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-budget-write-executed");
      const res = await productionApp.request("/google/customers/1234567890/campaigns/987654321/budget", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ amount: 20000, expectedCurrentAmount: 10000, confirmed: true, approvalNote: "CPA改善見込みのため増額し、24時間後にCPA悪化なら戻す。" }),
      });
      const body = (await res.json()) as {
        mode: string;
        customerId: string;
        campaignId: string;
        amount: number;
        campaignBudgetResourceName: string;
      };
      const searchCall = fetchMock.calls.find((call) => call.kind === "google.campaign_budget_search");
      const mutateCall = fetchMock.calls.find((call) => call.kind === "google.campaign_budget_mutate");
      const auditCall = fetchMock.calls.find((call) => call.kind === "supabase.audit");

      assert.equal(res.status, 200);
      assert.equal(body.mode, "executed");
      assert.equal(body.customerId, "1234567890");
      assert.equal(body.campaignId, "987654321");
      assert.equal(body.amount, 20000);
      assert.equal(body.campaignBudgetResourceName, "customers/1234567890/campaignBudgets/555");
      assert.match(String(searchCall?.json?.query), /campaign\.campaign_budget/);
      assert.deepEqual(mutateCall?.json, {
        operations: [
          {
            update: {
              resourceName: "customers/1234567890/campaignBudgets/555",
              amountMicros: 20_000_000_000,
            },
            updateMask: "amount_micros",
          },
        ],
      });
      assert.equal(auditCall?.json?.event_type, "google_ads.campaign_budget_updated");
      assert.equal(auditCall?.json?.payload?.amount, 20000);
      assert.match(auditCall?.json?.payload?.approvalNote, /CPA改善/);
      assert.equal(auditCall?.json?.payload?.confirmed, true);
      assert.equal(auditCall?.json?.payload?.approvalType, "explicit_user_confirmation");
      assert.equal(auditCall?.json?.payload?.approvedByUserId, testUserId);
      assert.equal(Number.isNaN(Date.parse(String(auditCall?.json?.payload?.approvedAt))), false);
    });
  });
});

test("google ads campaign budget write rejects explicitly shared budgets", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
      googleBudgetExplicitlyShared: true,
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-budget-shared-rejected");
      const res = await productionApp.request("/google/customers/1234567890/campaigns/987654321/budget", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ amount: 20000, expectedCurrentAmount: 10000, confirmed: true, approvalNote: "CPA改善のため増額し、24時間後に悪化したら戻す。" }),
      });
      const audit = fetchMock.calls.find(
        (call) => call.kind === "supabase.audit" && call.json?.event_type === "google_ads.shared_campaign_budget_rejected",
      );

      assert.equal(res.status, 409);
      assert.match(String((await res.json() as { error: string }).error), /共有予算/);
      assert.equal(fetchMock.calls.some((call) => call.kind === "google.campaign_budget_mutate"), false);
      assert.ok(audit);
    });
  });
});

test("google ads campaign budget write rejects amounts above the configured safety cap", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    process.env.GOOGLE_ADS_MAX_BUDGET_AMOUNT = "30000";
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("google-budget-write-cap");
      const res = await productionApp.request("/google/customers/1234567890/campaigns/987654321/budget", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ amount: 30001, expectedCurrentAmount: 10000, confirmed: true, approvalNote: "CPA改善見込みのため増額し、24時間後にCPA悪化なら戻す。" }),
      });
      const body = (await res.json()) as { error: string };

      assert.equal(res.status, 400);
      assert.match(body.error, /GOOGLE_ADS_MAX_BUDGET_AMOUNT \(30000\) 以下/);
      assert.equal(fetchMock.calls.some((call) => call.kind.startsWith("google.")), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.audit"), false);
    });
  });
});

test("recent audit logs are workspace scoped for Google Ads write review", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock({ billingSubscription: activeBillingSubscription() });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("audit-log-read");
      const res = await productionApp.request(`/audit-logs/recent?workspaceId=${testWorkspaceId}&eventTypePrefix=google_ads.&limit=10`, {
        headers: authHeaders(),
      });
      const body = (await res.json()) as {
        workspaceId: string;
        logs: Array<{ event_type: string; payload: Record<string, unknown> }>;
      };
      const auditRead = fetchMock.calls.find((call) => call.kind === "supabase.audit_read");

      assert.equal(res.status, 200);
      assert.equal(body.workspaceId, testWorkspaceId);
      assert.equal(body.logs[0]?.event_type, "google_ads.campaign_status_updated");
      assert.equal(body.logs[0]?.payload?.campaignId, "987654321");
      assert.ok(auditRead?.url.includes("workspace_id=eq."));
      assert.ok(auditRead?.url.includes("event_type=like.google_ads."));
    });
  });
});

test("billing gate blocks authenticated product APIs before Google Ads write execution", async () => {
  await withMockProductionEnv(async () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = "true";
    const { encryptToken } = await import("./crypto.js");
    const fetchMock = createProductionFetchMock({
      billingSubscription: null,
      encryptedGoogleAccessToken: encryptToken("google-access-token"),
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("billing-gated-google-write");
      const res = await productionApp.request("/google/customers/1234567890/campaigns/987654321/status", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ status: "PAUSED", confirmed: true }),
      });
      const body = (await res.json()) as { code: string; access: string };

      assert.equal(res.status, 402);
      assert.equal(body.code, "billing_required");
      assert.equal(body.access, "billing_required");
      assert.equal(fetchMock.calls.some((call) => call.kind === "google.campaign_status_mutate"), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.audit"), false);
    });
  });
});

test("pending-payment workspaces cannot read product content or begin Google Ads OAuth", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock({ billingSubscription: null });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("billing-gated-product-reads");
      for (const path of ["/help/articles", "/columns", "/connections", "/oauth/google/start-url"]) {
        const res = await productionApp.request(path, { headers: authHeaders() });
        const body = (await res.json()) as { code: string };
        assert.equal(res.status, 402, path);
        assert.equal(body.code, "billing_required", path);
      }
      assert.equal(fetchMock.calls.some((call) => call.kind.startsWith("google.")), false);
    });
  });
});

test("billing gate blocks authenticated agent chat before assistant work", async () => {
  await withMockProductionEnv(async () => {
    const fetchMock = createProductionFetchMock({ billingSubscription: null });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("billing-gated-agent-chat");
      const res = await productionApp.request("/agent/chat", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          userId: testUserId,
          threadId: "billing-gated-thread",
          message: "今週のCPA悪化理由を分析して",
          context: { advisorMode: "experienced", platform: "google", range: 7 },
        }),
      });
      const body = (await res.json()) as { code: string; access: string };

      assert.equal(res.status, 402);
      assert.equal(body.code, "billing_required");
      assert.equal(body.access, "billing_required");
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.audit"), false);
    });
  });
});

test("production product APIs fail closed when Stripe is not configured", async () => {
  await withMockProductionEnv(async () => {
    process.env.APP_ENV = "production";
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_ID;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const fetchMock = createProductionFetchMock({ billingSubscription: activeBillingSubscription() });
    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("billing-unconfigured-production");
      const res = await productionApp.request("/agent/chat", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          ...baseChatPayload,
          workspaceId: testWorkspaceId,
          threadId: "billing-unconfigured-thread",
          message: "今週のCPAを分析して",
        }),
      });
      const body = (await res.json()) as { code: string; access: string };

      assert.equal(res.status, 503);
      assert.equal(body.code, "billing_not_configured");
      assert.equal(body.access, "billing_required");
      assert.equal(fetchMock.calls.some((call) => call.kind === "agent.chat"), false);
    });
  });
});

test("billing session APIs fail closed when Stripe is not configured", async () => {
  await withMockProductionEnv(async () => {
    process.env.APP_ENV = "production";
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_ID;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const fetchMock = createProductionFetchMock({ billingCustomer: { stripe_customer_id: "cus_test_active" } });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("billing-session-unconfigured");
      for (const path of ["/billing/checkout-session", "/billing/portal-session"]) {
        const res = await productionApp.request(path, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({}),
        });
        const body = (await res.json()) as { code: string; access: string; workspaceId: string };

        assert.equal(res.status, 503);
        assert.equal(body.code, "billing_not_configured");
        assert.equal(body.access, "billing_required");
        assert.equal(body.workspaceId, testWorkspaceId);
      }
      assert.equal(fetchMock.calls.some((call) => call.kind.startsWith("stripe.")), false);
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.billing_customer_get"), false);
    });
  });
});

test("production product APIs require login before mock fallback", async () => {
  await withMockProductionEnv(async () => {
    process.env.APP_ENV = "production";
    const fetchMock = createProductionFetchMock({ billingSubscription: activeBillingSubscription() });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("production-auth-required");
      const dashboardRes = await productionApp.request(`/dashboard?workspaceId=${testWorkspaceId}`);
      const chatRes = await productionApp.request("/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          userId: testUserId,
          threadId: "unauth-thread",
          message: "今週のCPA悪化理由を分析して",
        }),
      });
      const dashboardBody = (await dashboardRes.json()) as { code: string };
      const chatBody = (await chatRes.json()) as { code: string };

      assert.equal(dashboardRes.status, 401);
      assert.equal(chatRes.status, 401);
      assert.equal(dashboardBody.code, "authentication_required");
      assert.equal(chatBody.code, "authentication_required");
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.auth_user"), false);
    });
  });
});

test("configured staging product APIs require login before mock fallback", async () => {
  await withMockProductionEnv(async () => {
    process.env.APP_ENV = "staging";
    const fetchMock = createProductionFetchMock({ billingSubscription: activeBillingSubscription() });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: stagingApp } = await importFreshIndex("staging-auth-required");
      const res = await stagingApp.request(`/dashboard?workspaceId=${testWorkspaceId}`);
      const body = (await res.json()) as { code: string };

      assert.equal(res.status, 401);
      assert.equal(body.code, "authentication_required");
      assert.equal(fetchMock.calls.some((call) => call.kind === "supabase.auth_user"), false);
    });
  });
});

test("production dashboard hierarchy is workspace scoped and propagates every query filter to Supabase", async () => {
  await withMockProductionEnv(async () => {
    process.env.APP_ENV = "production";
    const fetchMock = createProductionFetchMock({
      billingSubscription: activeBillingSubscription(),
      dashboardHierarchy: true,
    });

    await withMockFetch(fetchMock.fetch, async () => {
      const { app: productionApp } = await importFreshIndex("dashboard-hierarchy-production");
      const hierarchyQuery = new URLSearchParams({
        platform: "google",
        adAccountId: "db-account",
        campaignId: "db-campaign",
        adGroupId: "db-group",
        adId: "db-ad",
      });
      const optionsRes = await productionApp.request(`/dashboard/filter-options?${hierarchyQuery}`, {
        headers: authHeaders(),
      });
      const optionsBody = (await optionsRes.json()) as {
        accounts: Array<{ id: string }>;
        campaigns: Array<{ id: string; adAccountId: string }>;
        adGroups: Array<{ id: string; campaignId: string }>;
        ads: Array<{ id: string; adGroupId: string }>;
      };
      assert.equal(optionsRes.status, 200);
      assert.deepEqual(optionsBody.accounts.map((item) => item.id), ["db-account"]);
      assert.deepEqual(optionsBody.campaigns, [{
        id: "db-campaign",
        name: "DB Campaign",
        adAccountId: "db-account",
        platform: "google",
        status: "ENABLED",
      }]);
      assert.equal(optionsBody.adGroups[0]?.campaignId, "db-campaign");
      assert.equal(optionsBody.ads[0]?.adGroupId, "db-group");

      const dashboardRes = await productionApp.request(
        `/dashboard?${hierarchyQuery}&from=2026-07-01&to=2026-07-07`,
        { headers: authHeaders() },
      );
      const dashboardBody = (await dashboardRes.json()) as {
        campaignId: string;
        adGroupId: string;
        adId: string;
        campaigns: Array<{ campaignId: string }>;
      };
      assert.equal(dashboardRes.status, 200);
      assert.equal(dashboardBody.campaignId, "db-campaign");
      assert.equal(dashboardBody.adGroupId, "db-group");
      assert.equal(dashboardBody.adId, "db-ad");
      assert.deepEqual(dashboardBody.campaigns.map((item) => item.campaignId), ["db-campaign"]);

      const metricCalls = fetchMock.calls.filter((call) => call.kind === "supabase.dashboard_metrics");
      assert.ok(metricCalls.length >= 3);
      for (const call of metricCalls) {
        const url = new URL(call.url);
        assert.equal(url.searchParams.get("workspace_id"), `eq.${testWorkspaceId}`);
        assert.equal(url.searchParams.get("ad_account_id"), "eq.db-account");
        assert.equal(url.searchParams.get("external_campaign_id"), "eq.db-campaign");
        assert.equal(url.searchParams.get("external_ad_group_id"), "eq.db-group");
        assert.equal(url.searchParams.get("external_ad_id"), "eq.db-ad");
      }

      const crossWorkspaceRes = await productionApp.request(
        "/dashboard/filter-options?platform=google&adAccountId=other-workspace-account",
        { headers: authHeaders() },
      );
      assert.equal(crossWorkspaceRes.status, 403);
    });
  });
});

const testUserId = "11111111-1111-4111-8111-111111111111";
const testWorkspaceId = "22222222-2222-4222-8222-222222222222";
const supabaseUrl = "https://supabase.test";
const stripeWebhookSecret = "whsec_test";
const productionEnvKeys = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_API_KEY",
  "STRIPE_PRICE_ID",
  "BILLING_PLANS_JSON",
  "MODEL_COST_CATALOG_JSON",
  "STRIPE_WEBHOOK_SECRET",
  "WEB_ORIGIN",
  "API_PUBLIC_ORIGIN",
  "SUPABASE_AUTH_SITE_URL",
  "SUPABASE_AUTH_REDIRECT_URLS",
  "SUPABASE_AUTH_GOOGLE_CLIENT_ID",
  "SUPABASE_AUTH_GOOGLE_CLIENT_SECRET",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REDIRECT_URI",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_API_VERSION",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "GOOGLE_ADS_WRITE_ENABLED",
  "GOOGLE_ADS_MAX_BUDGET_AMOUNT",
  "PREMIUM_ONBOARDING_BOOKING_URL",
  "GOOGLE_OAUTH_STATE_STORE",
  "TOKEN_ENCRYPTION_KEY",
  "TOKEN_ENCRYPTION_KEY_ID",
  "AGENT_SERVICE_AUTH_MODE",
  "AGENT_SERVICE_AUDIENCE",
  "AGENT_SERVICE_AUTH_TOKEN",
  "USE_AGENT_SERVICE",
  "ADK_AGENT_URL",
  "USE_ADK_AGENT",
  "ADK_AGENT_TIMEOUT_MS",
  "APP_ENV",
  "ADOPS_AGENT_RUNTIME",
  "OPENAI_API_KEY",
  "OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA",
  "OPENAI_AGENTS_DONT_LOG_MODEL_DATA",
  "OPENAI_AGENTS_DONT_LOG_TOOL_DATA",
  "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
  "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
  "STRIPE_STAGING_E2E_PASSED_AT",
  "SUPABASE_STAGING_E2E_PASSED_AT",
  "REPORT_EMAIL_STAGING_E2E_PASSED_AT",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_EMAIL_API_TOKEN",
  "REPORT_EMAIL_DOMAIN",
  "APP_PUBLIC_URL",
  "NOTIFICATION_SIGNING_SECRET",
  "DEPLOYMENT_RUNBOOK_ACK",
] as const;

type ProductionFetchCall = {
  kind: string;
  url: string;
  method: string;
  json?: Record<string, any>;
  params?: URLSearchParams;
  authorization?: string | null;
  developerToken?: string | null;
  loginCustomerId?: string | null;
};

type ProductionFetchMockOptions = {
  billingCustomer?: Record<string, unknown> | null;
  billingSubscription?: Record<string, unknown> | null;
  encryptedGoogleAccessToken?: string;
  encryptedGoogleRefreshToken?: string;
  googleTokenExpiresAt?: string | null;
  googleAdAccount?: Record<string, unknown> | null;
  googleCustomerManager?: boolean;
  googleBudgetExplicitlyShared?: boolean;
  failGoogleStatusMutate?: boolean;
  failGoogleCustomerList?: boolean;
  failStripeCheckout?: boolean;
  stripeWebhookClaimed?: boolean;
  dashboardHierarchy?: boolean;
};

function activeBillingSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "billing-subscription-active",
    workspace_id: testWorkspaceId,
    stripe_customer_id: "cus_test_active",
    stripe_subscription_id: "sub_test_active",
    stripe_price_id: "price_standard_month",
    plan_id: "standard",
    billing_interval: "month",
    status: "active",
    current_period_end: "2026-07-04T00:00:00.000Z",
    cancel_at_period_end: false,
    raw: {},
    created_at: "2026-06-04T00:00:00.000Z",
    updated_at: "2026-06-04T00:00:00.000Z",
    ...overrides,
  };
}

function authHeaders() {
  return {
    Authorization: "Bearer user-jwt",
    "Content-Type": "application/json",
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

async function importFreshIndex(label: string): Promise<IndexModule> {
  return (await import(`./index.js?${label}-${Date.now()}-${Math.random()}`)) as IndexModule;
}

async function withMockProductionEnv(run: () => Promise<void>) {
  const original = new Map<string, string | undefined>();
  for (const key of productionEnvKeys) original.set(key, process.env[key]);
  process.env.SUPABASE_URL = supabaseUrl;
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.STRIPE_SECRET_KEY = "sk_test_stripe";
  process.env.STRIPE_API_KEY = "rk_test_stripe";
  process.env.BILLING_PLANS_JSON = JSON.stringify([
    { id: "minimum", setupFee: { stripePriceId: "price_minimum_setup", amount: 50000, currency: "jpy" }, prices: { month: { stripePriceId: "price_minimum_month", amount: 9800, currency: "jpy" } } },
    { id: "standard", chatCreditLimit: 100, estimatedConsultations: 30, setupFee: { stripePriceId: "price_standard_setup", amount: 70000, currency: "jpy" }, prices: { month: { stripePriceId: "price_standard_month", amount: 49800, currency: "jpy" } } },
    { id: "premium", chatCreditLimit: 300, estimatedConsultations: 90, setupFee: { stripePriceId: "price_premium_setup", amount: 70000, currency: "jpy" }, prices: { month: { stripePriceId: "price_premium_month", amount: 69800, currency: "jpy" } } },
  ]);
  process.env.MODEL_COST_CATALOG_JSON = JSON.stringify({ version: "test-v1", currency: "usd", models: { "gpt-test": { inputPerMillion: 1, cachedInputPerMillion: 0.1, outputPerMillion: 2, reasoningPerMillion: 2 } } });
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-cloudflare-account";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN = "test-cloudflare-email-token";
  process.env.REPORT_EMAIL_DOMAIN = "mail.example.test";
  process.env.APP_PUBLIC_URL = "https://app.example.test";
  process.env.NOTIFICATION_SIGNING_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.STRIPE_WEBHOOK_SECRET = stripeWebhookSecret;
  process.env.WEB_ORIGIN = "https://app.example.test";
  process.env.API_PUBLIC_ORIGIN = "https://api.example.test";
  process.env.GOOGLE_ADS_CLIENT_ID = "google-ads-client-id";
  process.env.GOOGLE_ADS_CLIENT_SECRET = "google-ads-client-secret";
  process.env.GOOGLE_ADS_REDIRECT_URI = "https://api.example.test/oauth/google/callback";
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "developer-token-test";
  process.env.GOOGLE_ADS_API_VERSION = "v24.2";
  process.env.GOOGLE_ADS_WRITE_ENABLED = "false";
  process.env.PREMIUM_ONBOARDING_BOOKING_URL = "";
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
  process.env.TOKEN_ENCRYPTION_KEY_ID = "test-key";
  process.env.USE_AGENT_SERVICE = "false";
  process.env.ADK_AGENT_URL = "";
  process.env.USE_ADK_AGENT = "";
  process.env.ADK_AGENT_TIMEOUT_MS = "";
  for (const key of [
    "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
    "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
    "STRIPE_STAGING_E2E_PASSED_AT",
    "SUPABASE_STAGING_E2E_PASSED_AT",
    "REPORT_EMAIL_STAGING_E2E_PASSED_AT",
    "DEPLOYMENT_RUNBOOK_ACK",
  ]) {
    delete process.env[key];
  }
  try {
    await run();
  } finally {
    for (const [key, value] of original.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withMockFetch(fetch: typeof globalThis.fetch, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function createProductionFetchMock(options: ProductionFetchMockOptions = {}) {
  const calls: ProductionFetchCall[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const parsedUrl = new URL(url);
    const method = String(init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const bodyText = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : "";

    if (url === `${supabaseUrl}/auth/v1/user`) {
      calls.push({ kind: "supabase.auth_user", url, method });
      return Response.json({ id: testUserId, email: "operator@example.com" });
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/workspace_members") {
      calls.push({ kind: "supabase.workspace_members", url, method });
      return Response.json([{ workspace_id: testWorkspaceId, role: "owner", workspaces: { name: "Test Workspace" } }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/billing_customers" && method === "GET") {
      calls.push({ kind: "supabase.billing_customer_get", url, method });
      return Response.json(options.billingCustomer === undefined ? [] : options.billingCustomer ? [options.billingCustomer] : []);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/billing_subscriptions" && method === "GET") {
      calls.push({ kind: "supabase.billing_subscription_get", url, method });
      return Response.json(options.billingSubscription === undefined ? [] : options.billingSubscription ? [options.billingSubscription] : []);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/ai_usage_events") {
      const json = parseJsonBody(bodyText);
      calls.push({ kind: `supabase.ai_usage_${method.toLowerCase()}`, url, method, json });
      return Response.json(method === "GET" ? [] : [{ id: "usage-event", ...json }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/workspaces" && method === "PATCH") {
      const json = parseJsonBody(bodyText);
      calls.push({ kind: "supabase.workspace_update", url, method, json });
      return Response.json([{ id: testWorkspaceId, ...json }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/report_schedules") {
      const json = parseJsonBody(bodyText);
      calls.push({ kind: "supabase.report_schedule", url, method, json });
      return Response.json(method === "GET" ? [] : [{ workspace_id: testWorkspaceId, ...json }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/rpc/claim_stripe_webhook_event") {
      const json = parseJsonBody(bodyText);
      calls.push({ kind: "supabase.stripe_webhook_claim", url, method, json });
      return Response.json(options.stripeWebhookClaimed ?? true);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/rpc/finish_stripe_webhook_event") {
      const json = parseJsonBody(bodyText);
      calls.push({ kind: "supabase.stripe_webhook_finish", url, method, json });
      return new Response(null, { status: 204 });
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/workspace_profiles" && method === "GET") {
      calls.push({ kind: "supabase.workspace_profile_get", url, method });
      return Response.json([{ workspace_id: testWorkspaceId, company_name: "Field X", access_token_encrypted: "encrypted-token-value" }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/user_memories" && method === "GET") {
      calls.push({ kind: "supabase.user_memories_get", url, method });
      return Response.json([{ id: "memory-secret", memory_type: "preference", content: "refresh_token=raw-refresh-token-value-forbidden が混ざったメモ", confidence: 0.8 }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/operator_feedback" && method === "GET") {
      calls.push({ kind: "supabase.operator_feedback_get", url, method });
      return Response.json([{ id: "feedback-secret", outcome: "worked", comment: "client_secret=client-secret-value-forbidden が混ざったfeedback", created_at: "2026-06-04T00:00:00.000Z" }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/recommendations") {
      if (method === "GET") {
        calls.push({ kind: "supabase.recommendations_get", url, method });
        return Response.json([{ id: "rec-secret", title: "検索語句を見る", status: "suggested", confidence: "medium", created_at: "2026-06-04T00:00:00.000Z" }]);
      }
      const json = parseJsonBody(bodyText);
      calls.push({ kind: "supabase.recommendations_upsert", url, method, json });
      return Response.json([{ id: "rec-upsert", ...json }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/human_tasks") {
      if (method === "GET") {
        calls.push({ kind: "supabase.human_tasks_get", url, method });
        return Response.json([{ id: "task-secret", title: "検索語句確認", status: "suggested", priority: "medium", created_at: "2026-06-04T00:00:00.000Z" }]);
      }
      const json = parseJsonBody(bodyText);
      calls.push({ kind: "supabase.human_tasks_upsert", url, method, json });
      return Response.json([{ id: "task-upsert", ...json }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/agent_threads") {
      const json = parseJsonBody(bodyText);
      calls.push({ kind: "supabase.agent_threads", url, method, json });
      return Response.json([{ id: json.id ?? "agent-thread", workspace_id: testWorkspaceId, user_id: testUserId, title: json.title ?? "Thread", updated_at: "2026-06-04T00:00:00.000Z" }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/agent_messages") {
      const json = parseJsonBody(bodyText);
      calls.push({ kind: "supabase.agent_messages", url, method, json });
      return Response.json([{ id: "agent-message", ...json }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/ad_platform_connections") {
      if (method === "GET") {
        calls.push({ kind: "supabase.google_token_get", url, method });
        return Response.json(options.encryptedGoogleAccessToken ? [{
          access_token_encrypted: options.encryptedGoogleAccessToken,
          refresh_token_encrypted: options.encryptedGoogleRefreshToken ?? null,
          scopes: ["https://www.googleapis.com/auth/adwords"],
          expires_at: options.googleTokenExpiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }] : []);
      }
      const json = parseJsonBody(bodyText);
      calls.push({ kind: "supabase.google_connection_upsert", url, method, json });
      return Response.json([{ id: "google-connection", ...json }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/ad_accounts" && method === "GET") {
      calls.push({ kind: "supabase.ad_account_get", url, method });
      if (options.dashboardHierarchy) {
        const requestedId = parsedUrl.searchParams.get("id")?.replace(/^eq\./, "");
        if (requestedId === "other-workspace-account") {
          return Response.json([{ workspace_id: "33333333-3333-4333-8333-333333333333", platform: "google" }]);
        }
        if (requestedId) {
          return Response.json(requestedId === "db-account"
            ? [{ workspace_id: testWorkspaceId, platform: "google" }]
            : []);
        }
        return Response.json([{
          id: "db-account",
          external_account_id: "1234567890",
          platform: "google",
          name: "DB Google Account",
          currency: "JPY",
          timezone: "Asia/Tokyo",
          status: "connected",
          created_at: "2026-07-01T00:00:00.000Z",
          updated_at: "2026-07-20T00:00:00.000Z",
        }]);
      }
      if (options.googleAdAccount === null) return Response.json([]);
      return Response.json([
        options.googleAdAccount ?? {
          id: "google-ad-account-row",
          status: "connected",
        },
      ]);
    }

    if (options.dashboardHierarchy && parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/campaign_snapshots") {
      calls.push({ kind: "supabase.dashboard_campaigns", url, method });
      return Response.json([{
        id: "campaign-snapshot-row",
        ad_account_id: "db-account",
        external_campaign_id: "db-campaign",
        name: "DB Campaign",
        platform: "google",
        status: "ENABLED",
      }]);
    }

    if (options.dashboardHierarchy && parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/ad_group_snapshots") {
      calls.push({ kind: "supabase.dashboard_ad_groups", url, method });
      return Response.json([{
        ad_account_id: "db-account",
        campaign_snapshot_id: "campaign-snapshot-row",
        external_ad_group_id: "db-group",
        name: "DB Ad Group",
        platform: "google",
        status: "ENABLED",
      }]);
    }

    if (options.dashboardHierarchy && parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/ad_daily_metrics") {
      const isOptionQuery = parsedUrl.searchParams.get("select")?.includes("external_ad_id")
        && parsedUrl.searchParams.get("select") !== "*";
      calls.push({ kind: isOptionQuery ? "supabase.dashboard_ads" : "supabase.dashboard_metrics", url, method });
      return Response.json([{
        ad_account_id: "db-account",
        external_campaign_id: "db-campaign",
        campaign_name: "DB Campaign",
        external_ad_group_id: "db-group",
        ad_group_name: "DB Ad Group",
        external_ad_id: "db-ad",
        ad_name: "DB Ad",
        platform: "google",
        raw: { ad_status: "ENABLED" },
        date: "2026-07-07",
        impressions: 1000,
        clicks: 100,
        cost: 10000,
        conversions: 10,
        revenue: 30000,
      }]);
    }

    if (url === "https://oauth2.googleapis.com/token") {
      const params = new URLSearchParams(bodyText);
      const kind = params.get("grant_type") === "authorization_code" ? "google.oauth_token_exchange" : "google.oauth_token_refresh";
      calls.push({ kind, url, method, params });
      if (params.get("grant_type") === "authorization_code") {
        return Response.json({
          access_token: "google-oauth-access-token",
          refresh_token: "google-oauth-refresh-token",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/adwords",
        });
      }
      return Response.json({ access_token: "google-access-token-refreshed", expires_in: 3600, scope: "https://www.googleapis.com/auth/adwords" });
    }

    if (url === "https://googleads.googleapis.com/v24/customers:listAccessibleCustomers") {
      calls.push({
        kind: "google.customers_list",
        url,
        method,
        authorization: headers.get("Authorization"),
        developerToken: headers.get("developer-token"),
        loginCustomerId: headers.get("login-customer-id"),
      });
      if (options.failGoogleCustomerList) {
        return new Response("access_token=raw-provider-token Authorization: Bearer google-access-token developer-token=developer-token-test", { status: 403 });
      }
      return Response.json({ resourceNames: ["customers/1234567890"] });
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/audit_logs") {
      if (method === "GET") {
        calls.push({ kind: "supabase.audit_read", url, method });
        return Response.json([
          {
            id: "audit-row",
            workspace_id: testWorkspaceId,
            user_id: testUserId,
            event_type: "google_ads.campaign_status_updated",
            level: "info",
            payload: { campaignId: "987654321", status: "PAUSED" },
            created_at: "2026-06-04T00:00:00.000Z",
          },
        ]);
      }
      const json = parseJsonBody(bodyText);
      calls.push({ kind: "supabase.audit", url, method, json });
      return Response.json([{ id: "audit-row" }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/billing_customers" && method === "POST") {
      const json = parseJsonBody(bodyText);
      calls.push({ kind: "supabase.billing_customer_upsert", url, method, json });
      return Response.json([{ id: "billing-customer-upsert", ...json }]);
    }

    if (parsedUrl.origin === supabaseUrl && parsedUrl.pathname === "/rest/v1/billing_subscriptions" && method === "POST") {
      const json = parseJsonBody(bodyText);
      calls.push({ kind: "supabase.billing_subscription_upsert", url, method, json });
      return Response.json([{ id: "billing-subscription-upsert", ...json }]);
    }

    if (url === "https://api.stripe.com/v1/checkout/sessions") {
      const params = new URLSearchParams(bodyText);
      calls.push({ kind: "stripe.checkout", url, method, params, authorization: headers.get("Authorization") });
      if (options.failStripeCheckout) {
        return new Response("Stripe saw sk_live_raw_provider_secret whsec_raw_provider_secret Authorization: Bearer sk_test_stripe https://checkout.stripe.test/session", { status: 400 });
      }
      return Response.json({ id: "cs_test_checkout", url: "https://checkout.stripe.test/session" });
    }

    if (url === "https://api.stripe.com/v1/billing_portal/sessions") {
      const params = new URLSearchParams(bodyText);
      calls.push({ kind: "stripe.portal", url, method, params, authorization: headers.get("Authorization") });
      return Response.json({ id: "bps_test", url: "https://billing.stripe.test/session" });
    }

    if (url === "https://googleads.googleapis.com/v24/customers/1234567890/campaigns:mutate") {
      const json = parseJsonBody(bodyText);
      calls.push({
        kind: "google.campaign_status_mutate",
        url,
        method,
        json,
        authorization: headers.get("Authorization"),
        developerToken: headers.get("developer-token"),
        loginCustomerId: headers.get("login-customer-id"),
      });
      if (options.failGoogleStatusMutate) {
        return new Response("provider error access_token=raw-provider-token developer-token=developer-token-test", { status: 400 });
      }
      return Response.json({ results: [{ resourceName: "customers/1234567890/campaigns/987654321" }] });
    }

    if (url === "https://googleads.googleapis.com/v24/customers/1234567890/googleAds:searchStream") {
      const json = parseJsonBody(bodyText);
      if (/\bFROM\s+customer\s/i.test(String(json.query ?? ""))) {
        calls.push({
          kind: "google.customer_detail",
          url,
          method,
          json,
          authorization: headers.get("Authorization"),
          developerToken: headers.get("developer-token"),
          loginCustomerId: headers.get("login-customer-id"),
        });
        return Response.json([{ results: [{
          customer: {
            id: "1234567890",
            descriptiveName: "Test Google Ads Account",
            manager: options.googleCustomerManager ?? false,
            currencyCode: "JPY",
            timeZone: "Asia/Tokyo",
          },
        }] }]);
      }
      calls.push({
        kind: "google.campaign_budget_search",
        url,
        method,
        json,
        authorization: headers.get("Authorization"),
        developerToken: headers.get("developer-token"),
        loginCustomerId: headers.get("login-customer-id"),
      });
      return Response.json([{ results: [{
        customer: { currencyCode: "JPY", timeZone: "Asia/Tokyo" },
        campaign: { id: "987654321", name: "Test Campaign", status: "ENABLED", campaignBudget: "customers/1234567890/campaignBudgets/555" },
        campaignBudget: {
          resourceName: "customers/1234567890/campaignBudgets/555",
          amountMicros: 10_000_000_000,
          explicitlyShared: options.googleBudgetExplicitlyShared ?? false,
        },
      }] }]);
    }

    if (url === "https://googleads.googleapis.com/v24/customers/1234567890/campaignBudgets:mutate") {
      const json = parseJsonBody(bodyText);
      calls.push({
        kind: "google.campaign_budget_mutate",
        url,
        method,
        json,
        authorization: headers.get("Authorization"),
        developerToken: headers.get("developer-token"),
        loginCustomerId: headers.get("login-customer-id"),
      });
      return Response.json({ results: [{ resourceName: "customers/1234567890/campaignBudgets/555" }] });
    }

    throw new Error(`Unhandled mocked fetch: ${method} ${url}`);
  };

  return { fetch, calls };
}

function parseJsonBody(value: string): Record<string, any> {
  return value ? (JSON.parse(value) as Record<string, any>) : {};
}

function stripeSignature(rawBody: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", stripeWebhookSecret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}
