import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchMicroCmsHelpArticle,
  fetchMicroCmsHelpArticles,
  filterHelpArticles,
  isMicroCmsConfigured,
  type HelpArticle,
} from "./help.js";

const configuredEnv = {
  MICROCMS_SERVICE_DOMAIN: "adops-help",
  MICROCMS_API_KEY: "server-only-test-key",
  MICROCMS_TIMEOUT_MS: "1000",
} as NodeJS.ProcessEnv;

test("microCMS configuration requires a safe service domain and server API key", () => {
  assert.equal(isMicroCmsConfigured(configuredEnv), true);
  assert.equal(isMicroCmsConfigured({ MICROCMS_SERVICE_DOMAIN: "https://invalid.example", MICROCMS_API_KEY: "key" }), false);
  assert.equal(isMicroCmsConfigured({ MICROCMS_SERVICE_DOMAIN: "valid-domain" }), false);
});

test("microCMS list adapter normalizes published Help content and filters tags locally", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedKey = "";
  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedKey = String(new Headers(init?.headers).get("X-MICROCMS-API-KEY") ?? "");
    return Response.json({
      contents: [
        {
          id: "cpa-guide",
          title: " CPA guide ",
          summary: " CPAを確認する ",
          body: " Check CVR first. ",
          category: ["指標の見方"],
          difficulty: ["初級"],
          tags: ["CPA", { name: "CVR" }],
          sortOrder: 20,
        },
        { id: "billing", title: "Billing", body: "Open settings.", tags: ["billing"] },
        { id: "draft-without-body", title: "Invalid" },
      ],
    });
  }) as typeof fetch;
  try {
    const result = await fetchMicroCmsHelpArticles(["cvr"], configuredEnv);
    assert.equal(capturedUrl, "https://adops-help.microcms.io/api/v1/help?limit=100");
    assert.equal(capturedKey, configuredEnv.MICROCMS_API_KEY);
    assert.deepEqual(result, [{
      id: "cpa-guide",
      title: "CPA guide",
      summary: "CPAを確認する",
      category: "指標の見方",
      body: "Check CVR first.",
      difficulty: "初級",
      tags: ["CPA", "CVR"],
      sortOrder: 20,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("microCMS detail adapter rejects unsafe content ids before making a request", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({
      id: "safe",
      title: "Safe",
      content: "<h2>Start</h2><p>Body<br>Next</p>",
      category: { id: "news", name: "更新情報" },
    });
  }) as typeof fetch;
  try {
    assert.equal(await fetchMicroCmsHelpArticle("../../secret", configuredEnv), null);
    assert.equal(calls, 0);
    assert.deepEqual(await fetchMicroCmsHelpArticle("safe", configuredEnv), {
      id: "safe",
      title: "Safe",
      summary: "Start Body Next",
      category: "更新情報",
      body: "## Start\nBody\nNext",
      difficulty: "基本",
      tags: [],
      sortOrder: 100,
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Help tag filtering is deterministic and does not mutate the source list", () => {
  const articles: HelpArticle[] = [
    { id: "one", title: "One", summary: "One", category: "使い方", body: "Body", difficulty: "基本", tags: ["CPA"], sortOrder: 10 },
    { id: "two", title: "Two", summary: "Two", category: "使い方", body: "Body", difficulty: "基本", tags: ["CVR"], sortOrder: 20 },
  ];
  assert.deepEqual(filterHelpArticles(articles, ["cpa"]), [articles[0]]);
  assert.equal(articles.length, 2);
});
