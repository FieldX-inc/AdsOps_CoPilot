#!/usr/bin/env node

import http from "node:http";
import { spawn } from "node:child_process";

const issues = [];

await runContract("prints non-secret evidence when health/readiness/smoke pass", {
  apiHealth: productionApiHealth(),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth(),
  expectStatus: 0,
  extraEnv: {
    EXPECT_PRODUCTION_READY: "true",
    RELEASE_SHA: "abc1234",
    EVIDENCE_OWNER: "release-owner",
    AUTH_TOKEN: "secret-auth-token-that-must-not-print",
    STRIPE_WEBHOOK_SECRET: "whsec-secret-that-must-not-print",
  },
  mustIncludeStdout: [
    "# Collected Release Evidence",
    "Release branch or commit SHA: abc1234",
    "Evidence owner: release-owner",
    "mode: agent-proxy",
    "selectedRuntime: openai",
    "runtimeConfigured: true",
    "runtimeDiagnostics: openaiApiKeyConfigured=true, openaiAgentsSdkImportable=true, openaiAgentsSdkAvailable=true, missingOpenaiAgentsSymbols=none",
    "Production decision: Go",
    "staging-e2e-evidence-window: pass",
    "EXPECT_PRODUCTION_READY=true npm run smoke:deploy: exit 0",
    "Web assets: checked=2",
    "existing customer reuse",
    "customer/workspace mismatch rejection evidence",
    "## Completion Audit Env Candidates",
    "export PRODUCTION_SMOKE_PASSED_AT=",
    "export RELEASE_EVIDENCE_COLLECTED_AT=",
    "export RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>",
  ],
  mustNotIncludeStdout: ["secret-auth-token-that-must-not-print", "whsec-secret-that-must-not-print"],
  mustNotIncludeStderr: ["secret-auth-token-that-must-not-print", "whsec-secret-that-must-not-print"],
});

await runContract("fails when final production smoke is requested but readiness is No-Go", {
  apiHealth: productionApiHealth(),
  readiness: productionReadiness("No-Go", { failingCheckId: "staging-e2e-evidence-window" }),
  agentHealth: productionAgentHealth(),
  expectStatus: 1,
  extraEnv: {
    EXPECT_PRODUCTION_READY: "true",
  },
  mustIncludeStdout: ["Production decision: No-Go", "staging-e2e-evidence-window: todo"],
  mustNotIncludeStdout: [
    "export PRODUCTION_SMOKE_PASSED_AT=",
    "export RELEASE_EVIDENCE_COLLECTED_AT=",
    "export RELEASE_EVIDENCE_NOTE_PATH=",
  ],
  mustIncludeStderr: [
    "Production evidence: readiness production decision expected Go",
    "Production evidence: readiness production check staging-e2e-evidence-window is todo.",
    "EXPECT_PRODUCTION_READY=true npm run smoke:deploy did not pass.",
  ],
});

await runContract("fails with named production evidence issues when health is incomplete", {
  apiHealth: productionApiHealth({ mediaWriteEnabled: false }),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth({
    selectedRuntime: "mock",
    runtimeConfigured: false,
    runtimeDiagnostics: {
      openaiApiKeyConfigured: true,
      openaiAgentsSdkImportable: false,
      openaiAgentsSdkAvailable: false,
      missingOpenaiAgentsSymbols: ["Runner"],
    },
  }),
  expectStatus: 1,
  extraEnv: {
    EXPECT_PRODUCTION_READY: "true",
  },
  mustIncludeStdout: ["mediaWriteEnabled: false", "selectedRuntime: mock", "runtimeConfigured: false", "Production decision: Go"],
  mustNotIncludeStdout: [
    "export PRODUCTION_SMOKE_PASSED_AT=",
    "export RELEASE_EVIDENCE_COLLECTED_AT=",
    "export RELEASE_EVIDENCE_NOTE_PATH=",
  ],
  mustIncludeStderr: [
    "Production evidence: API health mediaWriteEnabled expected true, got false.",
    "Production evidence: Agent health selectedRuntime expected OpenAI runtime",
    "Production evidence: Agent health runtimeConfigured expected true.",
    "Production evidence: Agent runtime diagnostics: openaiApiKeyConfigured=true, openaiAgentsSdkImportable=false, openaiAgentsSdkAvailable=false, missingOpenaiAgentsSymbols=Runner",
    "EXPECT_PRODUCTION_READY=true npm run smoke:deploy did not pass.",
  ],
});

await runContract("fails with named production evidence issues when health ok flags are false", {
  apiHealth: productionApiHealth({ ok: false }),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth({ ok: false }),
  expectStatus: 1,
  extraEnv: {
    EXPECT_PRODUCTION_READY: "true",
  },
  mustIncludeStdout: ["ok: false", "Production decision: Go"],
  mustNotIncludeStdout: [
    "export PRODUCTION_SMOKE_PASSED_AT=",
    "export RELEASE_EVIDENCE_COLLECTED_AT=",
    "export RELEASE_EVIDENCE_NOTE_PATH=",
  ],
  mustIncludeStderr: [
    "Production evidence: API health ok expected true, got false.",
    "Production evidence: Agent health ok expected true.",
    "EXPECT_PRODUCTION_READY=true npm run smoke:deploy did not pass.",
  ],
});

await runContract("fails production release evidence when legacy ADK aliases are present", {
  apiHealth: productionApiHealth(),
  readiness: productionReadiness("Go"),
  agentHealth: productionAgentHealth(),
  expectStatus: 1,
  extraEnv: {
    EXPECT_PRODUCTION_READY: "true",
    ADK_AGENT_URL: "https://legacy-agent.example.test",
    USE_ADK_AGENT: "true",
    ADK_AGENT_TIMEOUT_MS: "35000",
  },
  mustIncludeStderr: [
    "Remove legacy ADK agent aliases before collecting production release evidence",
    "ADK_AGENT_URL",
    "USE_ADK_AGENT",
    "ADK_AGENT_TIMEOUT_MS",
  ],
});

await runContract("allows partial evidence when explicitly requested", {
  apiHealth: productionApiHealth(),
  readiness: productionReadiness("No-Go", { failingCheckId: "stripe-billing" }),
  agentHealth: productionAgentHealth(),
  expectStatus: 0,
  extraEnv: {
    EXPECT_PRODUCTION_READY: "true",
    ALLOW_INCOMPLETE_EVIDENCE: "true",
  },
  mustIncludeStdout: ["Production decision: No-Go", "stripe-billing: todo"],
  mustNotIncludeStdout: [
    "export PRODUCTION_SMOKE_PASSED_AT=",
    "export RELEASE_EVIDENCE_COLLECTED_AT=",
    "export RELEASE_EVIDENCE_NOTE_PATH=",
  ],
  mustIncludeStderr: ["Release evidence collection completed with incomplete evidence"],
});

if (issues.length) {
  console.error("Release evidence collector contract check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Release evidence collector contract check passed.");

async function runContract(name, contract) {
  const api = await createJsonServer((path) => (path === "/readiness" ? contract.readiness : contract.apiHealth));
  const agent = await createJsonServer(() => contract.agentHealth);
  const web = await createWebServer(productionWebHtml());
  try {
    const result = await runCollector({
      API_ORIGIN: origin(api),
      AGENT_SERVICE_URL: origin(agent),
      ...contract.extraEnv,
      WEB_ORIGIN: contract.noWeb ? "" : origin(web),
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
    for (const snippet of contract.mustNotIncludeStdout ?? []) {
      if (result.stdout.includes(snippet)) {
        issues.push(`${name}: stdout must not include "${snippet}"`);
      }
    }
    for (const snippet of contract.mustNotIncludeStderr ?? []) {
      if (result.stderr.includes(snippet)) {
        issues.push(`${name}: stderr must not include "${snippet}"`);
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

function createWebServer(html) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = req.url ?? "/";
      if (path === "/assets/main.css") {
        res.writeHead(200, { "Content-Type": "text/css" });
        res.end("body{}");
        return;
      }
      if (path === "/assets/main.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end("console.log('ok');");
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

function runCollector(extraEnv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/collect-release-evidence.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ADK_AGENT_URL: "",
        USE_ADK_AGENT: "",
        ADK_AGENT_TIMEOUT_MS: "",
        ...extraEnv,
      },
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
    mediaWriteEnabled: true,
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
        checks: requiredIds.map((id) => ({
          id,
          status: id === options.failingCheckId ? "todo" : "pass",
        })),
      },
    },
  };
}
