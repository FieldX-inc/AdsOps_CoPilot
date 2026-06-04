#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const goal = runNode(["scripts/check-production-goal.mjs"]);
const verify = args.has("--with-verify") ? runNpm(["run", "verify"]) : null;
const preflight = loadPreflight();
const maxStagingEvidenceAgeMs = 90 * 24 * 60 * 60 * 1000;
const maxStagingEvidenceSpreadMs = 7 * 24 * 60 * 60 * 1000;
const maxFinalSmokeAgeMs = 7 * 24 * 60 * 60 * 1000;
const maxFinalSmokeSpreadMs = 24 * 60 * 60 * 1000;
const maxFutureEvidenceMs = 24 * 60 * 60 * 1000;

const repositoryStatus = goal.status === 0 ? "proven" : "missing";
const verifyStatus = verify ? (verify.status === 0 ? "proven" : "missing") : "missing";
const preflightStatus = preflight.overallStatus === "pass" ? "proven" : "missing";
const stagingEvidenceStatus = stagingEvidenceIsCurrent() ? "proven" : "missing";
const finalSmokeStatus = finalSmokeEvidenceIsCurrent() && releaseEvidenceNoteIsCurrent() ? "proven" : "missing";

const requirements = [
  {
    id: "openai_agents_sdk_runtime",
    requirement: "Agent framework is switched to OpenAI Agents SDK and production uses OpenAI APIs.",
    status: repositoryStatus,
    evidence: [
      "scripts/check-production-goal.mjs",
      "services/adk-agent/pyproject.toml",
      "services/adk-agent/ad_ops_advisor/openai_agents_runtime.py",
      "services/adk-agent/Dockerfile",
    ],
    nextActions: repositoryStatus === "proven" ? [] : ["npm run check:goal"],
  },
  {
    id: "google_ads_read_write",
    requirement: "Google Ads is the first connected ads platform and supports read plus human-approved write.",
    status: repositoryStatus,
    evidence: [
      "scripts/check-production-goal.mjs",
      "apps/api/src/google-ads.ts",
      "apps/api/src/index.test.ts",
      "supabase/migrations/20260604_openai_google_write_stripe.sql",
    ],
    nextActions: repositoryStatus === "proven" ? [] : ["npm run check:goal"],
  },
  {
    id: "stripe_billing",
    requirement: "Stripe billing supports checkout, portal, webhook, subscription mirror, and product billing gates.",
    status: repositoryStatus,
    evidence: [
      "scripts/check-production-goal.mjs",
      "apps/api/src/index.ts",
      "apps/api/src/index.test.ts",
      "supabase/migrations/20260604_openai_google_write_stripe.sql",
    ],
    nextActions: repositoryStatus === "proven" ? [] : ["npm run check:goal"],
  },
  {
    id: "local_repository_verification",
    requirement: "Local repository verification passes after the production changes.",
    status: verifyStatus,
    evidence: ["npm run verify"],
    nextActions: verifyStatus === "proven" ? [] : ["npm run audit:completion -- --with-verify"],
  },
  {
    id: "operator_deploy_prerequisites",
    requirement: "Deployment operator machine has Docker daemon, cloud CLIs, provider CLIs, and auth ready.",
    status: preflightStatus,
    evidence: ["npm run deploy:preflight -- --json"],
    missing: (preflight.failures ?? []).map((failure) => failure.label),
    nextActions: preflightStatus === "proven" ? [] : preflightNextActions(preflight),
  },
  {
    id: "staging_provider_evidence",
    requirement: "Staging evidence proves OpenAI Agent, Google Ads read/write/restore/audit, Stripe checkout/webhook/gate, and production env readiness.",
    status: stagingEvidenceStatus,
    evidence: [
      "OPENAI_AGENT_STAGING_E2E_PASSED_AT",
      "GOOGLE_ADS_STAGING_E2E_PASSED_AT",
      "STRIPE_STAGING_E2E_PASSED_AT",
      "DEPLOYMENT_RUNBOOK_ACK=true",
    ],
    missing: missingStagingEvidence(),
    nextActions: stagingEvidenceStatus === "proven" ? [] : stagingEvidenceNextActions(),
  },
  {
    id: "final_production_smoke",
    requirement: "Final production smoke and release evidence collection passed against deployed API, Agent, and Web origins.",
    status: finalSmokeStatus,
    evidence: [
      "PRODUCTION_SMOKE_PASSED_AT",
      "RELEASE_EVIDENCE_COLLECTED_AT",
      "RELEASE_EVIDENCE_NOTE_PATH",
      "EXPECT_PRODUCTION_READY=true npm run smoke:deploy",
      "EXPECT_PRODUCTION_READY=true npm run collect:release-evidence",
    ],
    missing: missingFinalSmokeEvidence(),
    nextActions: finalSmokeStatus === "proven" ? [] : finalSmokeNextActions(),
  },
];

const overallStatus = requirements.every((requirement) => requirement.status === "proven")
  ? "complete"
  : "incomplete";

if (args.has("--json")) {
  console.log(JSON.stringify({ overallStatus, requirements }, null, 2));
  process.exit(overallStatus === "complete" ? 0 : 1);
}

console.log("# Completion Audit");
console.log("");
console.log(`Overall status: ${overallStatus}`);
console.log("");
for (const requirement of requirements) {
  console.log(`- ${requirement.status}: ${requirement.id}`);
  console.log(`  requirement: ${requirement.requirement}`);
  console.log(`  evidence: ${requirement.evidence.join(", ")}`);
  if (requirement.missing?.length) console.log(`  missing: ${requirement.missing.join(", ")}`);
  if (requirement.nextActions?.length) console.log(`  next: ${requirement.nextActions.join(" | ")}`);
}
console.log("");
console.log("This command intentionally exits non-zero until every original goal requirement has direct current evidence.");

process.exit(overallStatus === "complete" ? 0 : 1);

function runNode(commandArgs) {
  return spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function runNpm(commandArgs) {
  if (process.env.COMPLETION_AUDIT_VERIFY_STATUS) {
    return { status: process.env.COMPLETION_AUDIT_VERIFY_STATUS === "pass" ? 0 : 1 };
  }
  return spawnSync("npm", commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function loadPreflight() {
  if (process.env.DEPLOY_PREFLIGHT_JSON) return JSON.parse(process.env.DEPLOY_PREFLIGHT_JSON);
  const result = runNode(["scripts/deploy-preflight.mjs", "--json"]);
  try {
    return JSON.parse(result.stdout || "{}");
  } catch (error) {
    throw new Error(`Could not parse deploy preflight JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stagingEvidenceIsCurrent() {
  if (process.env.DEPLOYMENT_RUNBOOK_ACK !== "true") return false;
  return timestampValidationIssues(stagingEvidenceEntries(), {
    label: "staging evidence",
    maxAgeMs: maxStagingEvidenceAgeMs,
    maxSpreadMs: maxStagingEvidenceSpreadMs,
  }).length === 0;
}

function stagingEvidenceEntries() {
  return [
    timestampEntry("OPENAI_AGENT_STAGING_E2E_PASSED_AT"),
    timestampEntry("GOOGLE_ADS_STAGING_E2E_PASSED_AT"),
    timestampEntry("STRIPE_STAGING_E2E_PASSED_AT"),
  ];
}

function missingStagingEvidence() {
  const missing = [];
  if (!process.env.OPENAI_AGENT_STAGING_E2E_PASSED_AT) missing.push("OPENAI_AGENT_STAGING_E2E_PASSED_AT");
  if (!process.env.GOOGLE_ADS_STAGING_E2E_PASSED_AT) missing.push("GOOGLE_ADS_STAGING_E2E_PASSED_AT");
  if (!process.env.STRIPE_STAGING_E2E_PASSED_AT) missing.push("STRIPE_STAGING_E2E_PASSED_AT");
  if (process.env.DEPLOYMENT_RUNBOOK_ACK !== "true") missing.push("DEPLOYMENT_RUNBOOK_ACK=true");
  if (!missing.length) {
    missing.push(
      ...timestampValidationIssues(stagingEvidenceEntries(), {
        label: "staging evidence",
        maxAgeMs: maxStagingEvidenceAgeMs,
        maxSpreadMs: maxStagingEvidenceSpreadMs,
      }),
    );
  }
  return missing;
}

function finalSmokeEvidenceIsCurrent() {
  return timestampValidationIssues(finalSmokeEntries(), {
    label: "production smoke and release evidence",
    maxAgeMs: maxFinalSmokeAgeMs,
    maxSpreadMs: maxFinalSmokeSpreadMs,
  }).length === 0;
}

function finalSmokeEntries() {
  return [
    timestampEntry("PRODUCTION_SMOKE_PASSED_AT"),
    timestampEntry("RELEASE_EVIDENCE_COLLECTED_AT"),
  ];
}

function missingFinalSmokeEvidence() {
  const missing = [];
  if (!process.env.PRODUCTION_SMOKE_PASSED_AT) missing.push("PRODUCTION_SMOKE_PASSED_AT");
  if (!process.env.RELEASE_EVIDENCE_COLLECTED_AT) missing.push("RELEASE_EVIDENCE_COLLECTED_AT");
  if (!process.env.RELEASE_EVIDENCE_NOTE_PATH) missing.push("RELEASE_EVIDENCE_NOTE_PATH");
  if (process.env.PRODUCTION_SMOKE_PASSED_AT && process.env.RELEASE_EVIDENCE_COLLECTED_AT) {
    missing.push(
      ...timestampValidationIssues(finalSmokeEntries(), {
        label: "production smoke and release evidence",
        maxAgeMs: maxFinalSmokeAgeMs,
        maxSpreadMs: maxFinalSmokeSpreadMs,
      }),
    );
  }
  if (process.env.RELEASE_EVIDENCE_NOTE_PATH) missing.push(...releaseEvidenceNoteIssues());
  return missing;
}

function releaseEvidenceNoteIsCurrent() {
  return releaseEvidenceNoteIssues().length === 0;
}

function releaseEvidenceNoteIssues() {
  const notePath = String(process.env.RELEASE_EVIDENCE_NOTE_PATH || "").trim();
  if (!notePath) return ["RELEASE_EVIDENCE_NOTE_PATH must point to the filled operator-owned release evidence note"];
  if (!existsSync(notePath)) return [`RELEASE_EVIDENCE_NOTE_PATH does not exist: ${notePath}`];
  const content = readFileSync(notePath, "utf8");
  const issues = [];
  const productionSmokeAt = String(process.env.PRODUCTION_SMOKE_PASSED_AT || "").trim();
  const releaseEvidenceAt = String(process.env.RELEASE_EVIDENCE_COLLECTED_AT || "").trim();
  const requiredSnippets = [
    "EXPECT_PRODUCTION_READY=true",
    "npm run smoke:deploy",
    "npm run collect:release-evidence",
    "WEB_ORIGIN",
    "API `/readiness` production decision was `Go`",
  ];
  for (const snippet of requiredSnippets) {
    if (!content.includes(snippet)) issues.push(`release evidence note must include ${snippet}`);
  }
  if (productionSmokeAt && !content.includes(productionSmokeAt)) {
    issues.push("release evidence note must include PRODUCTION_SMOKE_PASSED_AT value");
  }
  if (releaseEvidenceAt && !content.includes(releaseEvidenceAt)) {
    issues.push("release evidence note must include RELEASE_EVIDENCE_COLLECTED_AT value");
  }
  const forbiddenSecretPatterns = [
    /\bsk_(?:live|test)_[A-Za-z0-9_]+/,
    /\bwhsec_[A-Za-z0-9_]+/,
    /\bSUPABASE_SERVICE_ROLE_KEY\s*=/,
    /\bAUTH_TOKEN\s*=/,
    /\bOPENAI_API_KEY\s*=/,
    /\bGOOGLE_ADS_DEVELOPER_TOKEN\s*=/,
  ];
  if (forbiddenSecretPatterns.some((pattern) => pattern.test(content))) {
    issues.push("release evidence note must not contain secret-like values");
  }
  return issues;
}

function timestampEntry(key) {
  const value = String(process.env[key] || "").trim();
  return {
    key,
    value,
    parsed: Date.parse(value),
  };
}

function timestampValidationIssues(entries, { label, maxAgeMs, maxSpreadMs }) {
  const issues = [];
  const parsedEntries = [];
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.value || Number.isNaN(entry.parsed)) {
      issues.push(`${entry.key} must be an ISO timestamp`);
      continue;
    }
    if (entry.parsed > now + maxFutureEvidenceMs) {
      issues.push(`${entry.key} must not be more than 24 hours in the future`);
    }
    if (now - entry.parsed > maxAgeMs) {
      issues.push(`${entry.key} must be refreshed before completion audit`);
    }
    parsedEntries.push(entry);
  }
  if (parsedEntries.length === entries.length) {
    const oldest = parsedEntries.reduce((current, candidate) => (candidate.parsed < current.parsed ? candidate : current));
    const newest = parsedEntries.reduce((current, candidate) => (candidate.parsed > current.parsed ? candidate : current));
    if (newest.parsed - oldest.parsed > maxSpreadMs) {
      issues.push(`${label} timestamps within ${humanDuration(maxSpreadMs)}`);
    }
  }
  return issues;
}

function humanDuration(ms) {
  if (ms === maxStagingEvidenceSpreadMs) return "7 days";
  if (ms === maxFinalSmokeSpreadMs) return "24 hours";
  return `${Math.round(ms / (60 * 60 * 1000))} hours`;
}

function preflightNextActions(preflightResult) {
  const actions = [];
  for (const failure of preflightResult.failures ?? []) {
    const remediation = preflightResult.remediation?.[failure.label] ?? [];
    if (remediation.length) actions.push(...remediation);
  }
  actions.push("npm run deploy:preflight -- --json");
  return dedupe(actions);
}

function stagingEvidenceNextActions() {
  return [
    "npm run deploy:next",
    "node scripts/check-env.mjs .env.staging.api .env.staging.agent .env.staging.web",
    "supabase link --project-ref <staging-supabase-project-ref>",
    "supabase db push",
    "SUPABASE_URL=https://your-staging-project.supabase.co npm run e2e:supabase # requires SUPABASE service role in operator env",
    "npm run deploy:commands -- --target=staging",
    "API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging # requires AUTH_TOKEN in operator env",
    "CHECK_GOOGLE_WRITE=true CONFIRM_GOOGLE_WRITE=true GOOGLE_CUSTOMER_ID=<customer-id> GOOGLE_CAMPAIGN_ID=<campaign-id> GOOGLE_WRITE_KIND=status GOOGLE_WRITE_STATUS=PAUSED GOOGLE_RESTORE_STATUS=ENABLED GOOGLE_WRITE_ROLLBACK=\"restore campaign status to ENABLED after audit observation\" API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging # reversible Google Ads write evidence; requires AUTH_TOKEN in operator env",
    "Confirm the web Data Connection audit review panel shows the Google write and restore rows with approval metadata before setting GOOGLE_ADS_STAGING_E2E_PASSED_AT",
    "CONFIRM_STRIPE_WEBHOOK_TEST=true npm run e2e:stripe-webhook # requires STRIPE_WEBHOOK_SECRET and AUTH_TOKEN in operator env",
    "CONFIRM_STRIPE_FULL_E2E=true STRIPE_FULL_E2E_CONFIRMATION=\"checkout existing customer reuse webhook billing gate customer/workspace mismatch rejection confirmed\" API_ORIGIN=https://api.staging.example.com AGENT_SERVICE_URL=https://agent.staging.example.com WORKSPACE_ID=<workspace-id> npm run e2e:staging # set only after hosted Stripe evidence is recorded; requires AUTH_TOKEN and UNPAID_AUTH_TOKEN in operator env",
    "node scripts/check-env.mjs .env.production.api .env.production.agent .env.production.web",
    "Set OPENAI_AGENT_STAGING_E2E_PASSED_AT, GOOGLE_ADS_STAGING_E2E_PASSED_AT, STRIPE_STAGING_E2E_PASSED_AT, and DEPLOYMENT_RUNBOOK_ACK=true only after evidence is complete",
    "npm run audit:completion -- --with-verify",
  ];
}

function finalSmokeNextActions() {
  return [
    "node scripts/check-env.mjs .env.production.api .env.production.agent .env.production.web",
    "npm run deploy:commands -- --target=production",
    "EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com npm run smoke:deploy",
    "EXPECT_PRODUCTION_READY=true API_ORIGIN=https://api.example.com AGENT_SERVICE_URL=https://agent.example.com WEB_ORIGIN=https://app.example.com RELEASE_SHA=<git-sha> EVIDENCE_OWNER=<operator-name> npm run collect:release-evidence",
    "Copy export PRODUCTION_SMOKE_PASSED_AT and export RELEASE_EVIDENCE_COLLECTED_AT from the successful collector output after recording the release evidence note",
    "Set RELEASE_EVIDENCE_NOTE_PATH=<path-to-filled-release-evidence-note>",
    "npm run audit:completion -- --with-verify",
  ];
}

function dedupe(values) {
  return [...new Set(values)];
}

function printHelp() {
  console.log(`Usage:
  npm run audit:completion
  npm run audit:completion -- --json
  npm run audit:completion -- --with-verify

Audits the original user goal requirement by requirement. This command exits non-zero until repository contracts, local verify, deploy preflight, and staging/provider evidence are all proven.
For contract tests only, DEPLOY_PREFLIGHT_JSON and COMPLETION_AUDIT_VERIFY_STATUS may provide mocked statuses.`);
}
