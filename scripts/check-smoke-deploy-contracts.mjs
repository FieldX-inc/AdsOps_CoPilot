#!/usr/bin/env node

import http from "node:http";
import { spawn } from "node:child_process";

const issues = [];

await runContract("initial production Go passes only with media writes disabled", {
  apiHealth: productionApiHealth(),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth(),
  webHtml: productionWebHtml(),
  expectStatus: 0,
  mustIncludeStdout: ["Deploy smoke check passed.", "mediaWriteEnabled=false", "Production gate: initial-production-go", "supabase-auth-env: pass", "Web app: html=received", "Web assets: checked=2"],
});

await runContract("separate Google Ads write activation passes only with media writes enabled", {
  apiHealth: productionApiHealth({ mediaWriteEnabled: true }),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth(),
  webHtml: productionWebHtml(),
  extraEnv: {
    EXPECT_PRODUCTION_READY: "false",
    EXPECT_GOOGLE_ADS_WRITE_ACTIVATION: "true",
  },
  expectStatus: 0,
  mustIncludeStdout: ["Deploy smoke check passed.", "mediaWriteEnabled=true", "Production gate: google-ads-write-activation"],
});

await runContract("initial production Go rejects enabled media writes", {
  apiHealth: productionApiHealth({ mediaWriteEnabled: true }),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth(),
  webHtml: productionWebHtml(),
  expectStatus: 1,
  mustIncludeStderr: ["expected mediaWriteEnabled=false for initial production Go gate"],
});

await runContract("Google Ads write activation rejects disabled media writes", {
  apiHealth: productionApiHealth(),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth(),
  webHtml: productionWebHtml(),
  extraEnv: {
    EXPECT_PRODUCTION_READY: "false",
    EXPECT_GOOGLE_ADS_WRITE_ACTIVATION: "true",
  },
  expectStatus: 1,
  mustIncludeStderr: ["expected mediaWriteEnabled=true for Google Ads write activation gate"],
});

await runContract("production gate flags are mutually exclusive", {
  apiHealth: productionApiHealth({ mediaWriteEnabled: true }),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth(),
  webHtml: productionWebHtml(),
  extraEnv: {
    EXPECT_PRODUCTION_READY: "true",
    EXPECT_GOOGLE_ADS_WRITE_ACTIVATION: "true",
  },
  expectStatus: 1,
  mustIncludeStderr: ["Choose exactly one production gate"],
});

await runContract("fails when readiness is No-Go", {
  apiHealth: productionApiHealth(),
  readiness: productionReadiness("No-Go", { failingCheckId: "stripe-billing" }),
  agentHealth: productionAgentHealth(),
  webHtml: productionWebHtml(),
  expectStatus: 1,
  mustIncludeStderr: ["expected production decision Go", "stripe-billing is todo"],
});

await runContract("fails when readiness omits staging evidence window check", {
  apiHealth: productionApiHealth(),
  readiness: productionReadiness("Go", { omitCheckId: "staging-e2e-evidence-window" }),
  agentHealth: productionAgentHealth(),
  webHtml: productionWebHtml(),
  expectStatus: 1,
  mustIncludeStderr: ["missing production check staging-e2e-evidence-window"],
});

await runContract("fails when API health is still mock, write enabled, or billing disabled at initial Go", {
  apiHealth: productionApiHealth({
    mode: "mock",
    mediaWriteEnabled: true,
    billingConfigured: false,
  }),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth(),
  webHtml: productionWebHtml(),
  expectStatus: 1,
  mustIncludeStderr: ["mode=agent-proxy", "mediaWriteEnabled=false", "billingConfigured=true"],
});

await runContract("fails when Agent runtime or data safety is not production-ready", {
  apiHealth: productionApiHealth(),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth({
    mode: "mock",
    selectedRuntime: "mock",
    runtimeConfigured: false,
    dataSafetyConfigured: false,
    runtimeDiagnostics: {
      openaiApiKeyConfigured: true,
      openaiAgentsSdkImportable: false,
      openaiAgentsSdkAvailable: false,
      missingOpenaiAgentsSymbols: ["Agent", "RunConfig", "Runner"],
    },
  }),
  expectStatus: 1,
  webHtml: productionWebHtml(),
  mustIncludeStderr: [
    "expected OpenAI runtime mode",
    "expected selectedRuntime=openai/openai_agents",
    "runtimeConfigured=true",
    "dataSafetyConfigured=true",
    "Agent health runtime diagnostics",
    "openaiAgentsSdkImportable=false",
    "missingOpenaiAgentsSymbols=Agent,RunConfig,Runner",
  ],
});

await runContract("fails final production smoke when legacy ADK aliases are present", {
  apiHealth: productionApiHealth(),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth(),
  webHtml: productionWebHtml(),
  extraEnv: {
    ADK_AGENT_URL: "https://legacy-agent.example.com",
    USE_ADK_AGENT: "true",
    ADK_AGENT_TIMEOUT_MS: "35000",
  },
  expectStatus: 1,
  mustIncludeStderr: ["Production smoke must use AGENT_SERVICE_* env only", "ADK_AGENT_URL", "USE_ADK_AGENT", "ADK_AGENT_TIMEOUT_MS"],
});

await runContract("fails final production smoke when Web app HTML is missing", {
  apiHealth: productionApiHealth(),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth(),
  webHtml: "not html",
  expectStatus: 1,
  mustIncludeStderr: ["Web app: expected deployed app HTML with root element"],
});

await runContract("fails final production smoke when Web app asset is missing", {
  apiHealth: productionApiHealth(),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth(),
  webHtml: productionWebHtml(),
  webAssets: { "/assets/main.css": "body{}" },
  expectStatus: 1,
  mustIncludeStderr: ["Web app asset /assets/main.js: HTTP 404"],
});

await runContract("fails final production smoke when Web asset path returns HTML fallback", {
  apiHealth: productionApiHealth(),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth(),
  webHtml: productionWebHtml(),
  webAssets: {
    "/assets/main.css": "body{}",
    "/assets/main.js": productionWebHtml(),
  },
  expectStatus: 1,
  mustIncludeStderr: ["Web app asset /assets/main.js: expected JS/CSS asset, got HTML"],
});

await runLegacyAliasContract();

if (issues.length) {
  console.error("Smoke deploy contract check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Smoke deploy contract check passed.");

async function runContract(name, contract) {
  const api = await createJsonServer((path) => (path === "/readiness" ? contract.readiness : contract.apiHealth));
  const agent = await createJsonServer(() => contract.agentHealth);
  const web = await createWebServer(contract.webHtml ?? productionWebHtml(), contract.webAssets);
  try {
    const result = await runSmokeDeploy({
      API_ORIGIN: origin(api),
      AGENT_SERVICE_URL: origin(agent),
      WEB_ORIGIN: origin(web),
      EXPECT_PRODUCTION_READY: "true",
      EXPECT_GOOGLE_ADS_WRITE_ACTIVATION: "false",
      ADK_AGENT_URL: "",
      USE_ADK_AGENT: "",
      ADK_AGENT_TIMEOUT_MS: "",
      ...(contract.extraEnv ?? {}),
    });
    if (result.status !== contract.expectStatus) {
      issues.push(`${name}: expected exit ${contract.expectStatus}, got ${result.status}. stdout=${result.stdout} stderr=${result.stderr}`);
    }
    for (const snippet of contract.mustIncludeStdout ?? []) {
      if (!result.stdout.includes(snippet)) {
        issues.push(`${name}: stdout missing "${snippet}"`);
      }
    }
    for (const snippet of contract.mustIncludeStderr ?? []) {
      if (!result.stderr.includes(snippet)) {
        issues.push(`${name}: stderr missing "${snippet}"`);
      }
    }
  } finally {
    await Promise.all([closeServer(api), closeServer(agent), closeServer(web)]);
  }
}

async function runLegacyAliasContract() {
  const api = await createJsonServer((path) => (path === "/readiness" ? productionReadiness("Go") : productionApiHealth()));
  const agent = await createJsonServer(() => productionAgentHealth());
  const web = await createWebServer(productionWebHtml());
  try {
    const result = await runSmokeDeploy({
      API_ORIGIN: origin(api),
      WEB_ORIGIN: origin(web),
      ADK_AGENT_URL: origin(agent),
      EXPECT_PRODUCTION_READY: "true",
      AGENT_SERVICE_URL: "",
    });
    if (result.status !== 1) {
      issues.push(`fails final production smoke without AGENT_SERVICE_URL: expected exit 1, got ${result.status}. stdout=${result.stdout} stderr=${result.stderr}`);
    }
    for (const snippet of ["Set AGENT_SERVICE_URL", "Production smoke must use AGENT_SERVICE_* env only", "ADK_AGENT_URL"]) {
      if (!result.stderr.includes(snippet)) {
        issues.push(`fails final production smoke without AGENT_SERVICE_URL: stderr missing "${snippet}"`);
      }
    }
  } finally {
    await Promise.all([closeServer(api), closeServer(agent), closeServer(web)]);
  }
}

function createJsonServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const body = handler(req.url ?? "/");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function createWebServer(html, assets = defaultWebAssets()) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = req.url ?? "/";
      if (path.startsWith("/assets/")) {
        if (!(path in assets)) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("not found");
          return;
        }
        const contentType = path.endsWith(".css") ? "text/css" : "application/javascript";
        res.writeHead(200, { "Content-Type": contentType });
        res.end(assets[path]);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function origin(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function runSmokeDeploy(extraEnv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/smoke-deploy.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function productionApiHealth(overrides = {}) {
  return {
    ok: true,
    service: "adops-api",
    mode: "agent-proxy",
    mediaWriteEnabled: false,
    billingConfigured: true,
    supabaseConfigured: true,
    authConfigured: true,
    ...overrides,
  };
}

function productionAgentHealth(overrides = {}) {
  return {
    ok: true,
    service: "openai-agent",
    mode: "openai",
    selectedRuntime: "openai",
    runtimeConfigured: true,
    dataSafetyConfigured: true,
    runtimeDiagnostics: {
      openaiApiKeyConfigured: true,
      openaiAgentsSdkImportable: true,
      openaiAgentsSdkAvailable: true,
      missingOpenaiAgentsSymbols: [],
    },
    ...overrides,
  };
}

function productionWebHtml() {
  return '<!doctype html><html lang="ja"><head><link rel="stylesheet" href="/assets/main.css"></head><body><div id="root"></div><script type="module" src="/assets/main.js"></script></body></html>';
}

function defaultWebAssets() {
  return {
    "/assets/main.css": "body{}",
    "/assets/main.js": "console.log('ok');",
  };
}

function productionReadiness(decision, options = {}) {
  const requiredIds = [
    "supabase-auth-env",
    "agent-service-enabled",
    "agent-service-modern-env",
    "openai-agent-service-health",
    "openai-agent-staging-e2e",
    "real-media-apis",
    "stripe-billing",
    "staging-e2e-evidence-window",
    "deployment",
  ];
  return {
    scopes: {
      production: {
        decision,
        checks: requiredIds
          .filter((id) => id !== options.omitCheckId)
          .map((id) => ({
            id,
            status: id === options.failingCheckId ? "todo" : "pass",
          })),
      },
    },
  };
}
