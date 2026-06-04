#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const jsonMode = args.has("--json");
const expectedGcpProject = cleanEnv(process.env.EXPECTED_GCP_PROJECT || process.env.GCP_PROJECT || "");
const expectedCloudflareAccount = cleanEnv(process.env.EXPECTED_CLOUDFLARE_ACCOUNT || "");
const expectedSupabaseProjectRef = cleanEnv(process.env.EXPECTED_SUPABASE_PROJECT_REF || process.env.SUPABASE_PROJECT_REF || "");
const expectedStripeAccount = cleanEnv(process.env.EXPECTED_STRIPE_ACCOUNT || "");

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

const dockerCli = commandCheck("docker", ["--version"], {
  label: "Docker CLI",
  required: true,
});
const gcloudCli = commandCheck("gcloud", ["--version"], {
  label: "Google Cloud CLI",
  required: true,
});
const wranglerCli = commandCheck("wrangler", ["--version"], {
  label: "Cloudflare Wrangler CLI",
  required: true,
});
const supabaseCli = commandCheck("supabase", ["--version"], {
  label: "Supabase CLI",
  required: true,
});
const stripeCli = commandCheck("stripe", ["--version"], {
  label: "Stripe CLI",
  required: true,
});

const checks = [
  dockerCli,
  dependentCommandCheck(dockerCli, "docker", ["info", "--format", "{{json .ServerVersion}}"], {
    label: "Docker daemon",
    required: true,
    emptyFails: true,
  }),
  expectedTargetCheck("Expected Google Cloud project", expectedGcpProject, "Set GCP_PROJECT or EXPECTED_GCP_PROJECT to the intended deployment project."),
  expectedTargetCheck("Expected Cloudflare account", expectedCloudflareAccount, "Set EXPECTED_CLOUDFLARE_ACCOUNT to the account that owns the Pages project."),
  expectedTargetCheck("Expected Supabase project ref", expectedSupabaseProjectRef, "Set SUPABASE_PROJECT_REF or EXPECTED_SUPABASE_PROJECT_REF to the target Supabase project ref."),
  expectedTargetCheck("Expected Stripe account", expectedStripeAccount, "Set EXPECTED_STRIPE_ACCOUNT to the Stripe account used for billing."),
  gcloudCli,
  dependentCommandCheck(gcloudCli, "gcloud", ["auth", "list", "--format=json"], {
    label: "Google Cloud CLI auth",
    required: true,
    validate: (stdout) => {
      const accounts = JSON.parse(stdout || "[]");
      return Array.isArray(accounts) && accounts.some((account) => account.status === "ACTIVE");
    },
    validateMessage: "no active gcloud account",
  }),
  dependentCommandCheck(gcloudCli, "gcloud", ["config", "get-value", "project"], {
    label: "Google Cloud project",
    required: true,
    validate: (stdout) => {
      const actual = stdout.trim();
      if (!actual || actual === "(unset)") return false;
      if (expectedGcpProject) return actual === expectedGcpProject;
      return true;
    },
    validateMessage: expectedGcpProject ? `gcloud project does not match expected project ${expectedGcpProject}` : "gcloud project is unset",
  }),
  wranglerCli,
  dependentCommandCheck(wranglerCli, "wrangler", ["whoami"], {
    label: "Cloudflare Wrangler auth",
    required: true,
    validate: (stdout) => (expectedCloudflareAccount ? stdout.includes(expectedCloudflareAccount) : true),
    validateMessage: expectedCloudflareAccount
      ? `Cloudflare account does not include expected account ${expectedCloudflareAccount}`
      : "wrangler account could not be confirmed",
  }),
  supabaseCli,
  dependentCommandCheck(supabaseCli, "supabase", ["projects", "list"], {
    label: "Supabase CLI auth",
    required: true,
    validate: (stdout) => (expectedSupabaseProjectRef ? stdout.includes(expectedSupabaseProjectRef) : true),
    validateMessage: expectedSupabaseProjectRef
      ? `Supabase projects list does not include expected project ${expectedSupabaseProjectRef}`
      : "supabase projects could not be confirmed",
  }),
  stripeCli,
  dependentCommandCheck(stripeCli, "stripe", ["whoami"], {
    label: "Stripe CLI auth",
    required: true,
    validate: (stdout) => (expectedStripeAccount ? stdout.includes(expectedStripeAccount) : true),
    validateMessage: expectedStripeAccount
      ? `Stripe account does not include expected account ${expectedStripeAccount}`
      : "stripe account could not be confirmed",
  }),
  commandCheck("gh", ["auth", "status"], {
    label: "GitHub CLI auth",
    required: false,
  }),
];

const failures = checks.filter((check) => check.status === "fail" && check.required);

if (jsonMode) {
  console.log(JSON.stringify(preflightResult(checks, failures), null, 2));
  process.exit(failures.length ? 1 : 0);
}

console.log("Deploy preflight summary:");
for (const check of checks) {
  const marker = check.status === "pass" ? "pass" : check.status === "skip" ? "skip" : check.required ? "fail" : "warn";
  console.log(`- ${marker}: ${check.label}${check.detail ? ` (${check.detail})` : ""}`);
}

if (failures.length) {
  console.error("Deploy preflight failed:");
  for (const failure of failures) {
    console.error(`- ${failure.label}: ${failure.detail || "required check failed"}`);
  }
  console.error("\nRecommended remediation:");
  for (const failure of failures) {
    const steps = remediationSteps(failure.label);
    if (!steps.length) continue;
    console.error(`\n${failure.label}:`);
    for (const step of steps) console.error(`- ${step}`);
  }
  process.exit(1);
}

console.log("Deploy preflight passed.");

function preflightResult(checks, failures) {
  const remediation = {};
  for (const failure of failures) {
    const steps = remediationSteps(failure.label);
    if (steps.length) remediation[failure.label] = steps;
  }
  return {
    overallStatus: failures.length ? "fail" : "pass",
    checks: checks.map((check) => ({
      label: check.label,
      required: check.required,
      status: check.status,
      detail: check.detail || "",
    })),
    failures: failures.map((failure) => ({
      label: failure.label,
      detail: failure.detail || "required check failed",
    })),
    remediation,
  };
}

function commandCheck(command, commandArgs, options) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  if (result.error) {
    return {
      label: options.label,
      required: options.required,
      status: "fail",
      detail: result.error.code === "ENOENT" ? `${command} not found` : result.error.message,
    };
  }

  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (result.status !== 0) {
    return {
      label: options.label,
      required: options.required,
      status: "fail",
      detail: truncate(stderr || stdout || `exit ${result.status}`, 120),
    };
  }

  if (options.emptyFails && !stdout) {
    return {
      label: options.label,
      required: options.required,
      status: "fail",
      detail: "empty output",
    };
  }

  if (options.validate) {
    try {
      if (!options.validate(stdout)) {
        return {
          label: options.label,
          required: options.required,
          status: "fail",
          detail: options.validateMessage,
        };
      }
    } catch (error) {
      return {
        label: options.label,
        required: options.required,
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    label: options.label,
    required: options.required,
    status: "pass",
    detail: summarize(command, stdout),
  };
}

function dependentCommandCheck(prerequisite, command, commandArgs, options) {
  if (prerequisite.status !== "pass") {
    return {
      label: options.label,
      required: false,
      status: "skip",
      detail: `skipped until ${prerequisite.label} passes`,
    };
  }
  return commandCheck(command, commandArgs, options);
}

function expectedTargetCheck(label, value, detail) {
  return {
    label,
    required: true,
    status: value ? "pass" : "fail",
    detail: value ? value : detail,
  };
}

function summarize(command, stdout) {
  if (!stdout) return "";
  if (command === "gcloud" && stdout.startsWith("[")) return "active account found";
  return truncate(stdout.split(/\r?\n/)[0] ?? "", 100);
}

function truncate(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function cleanEnv(value) {
  return String(value ?? "").trim();
}

function remediationSteps(label) {
  switch (label) {
    case "Docker daemon":
      return [
        "Start Docker Desktop, then rerun `docker info` until it returns server details.",
        "macOS/Homebrew example if Docker Desktop is missing: `brew install --cask docker`, then `open -a Docker`.",
        "If Docker uses a non-default socket, confirm the local shell can reach it before rerunning this preflight.",
      ];
    case "Google Cloud CLI":
      return [
        "Install the Google Cloud CLI.",
        "macOS/Homebrew example: `brew install --cask google-cloud-sdk`.",
        "Run `gcloud auth login` and `gcloud config set project <gcp-project-id>` after installation.",
      ];
    case "Expected Google Cloud project":
      return [
        "Set `GCP_PROJECT=<gcp-project-id>` or `EXPECTED_GCP_PROJECT=<gcp-project-id>` in the operator shell.",
        "Run `gcloud config set project <gcp-project-id>` and rerun `npm run deploy:preflight -- --json`.",
      ];
    case "Google Cloud CLI auth":
      return [
        "Run `gcloud auth login` and confirm `gcloud auth list --format=json` shows an ACTIVE account.",
      ];
    case "Google Cloud project":
      return [
        "Run `gcloud config set project <gcp-project-id>`.",
        "Confirm `gcloud config get-value project` returns the staging or production project.",
        "Set GCP_PROJECT or EXPECTED_GCP_PROJECT and confirm it matches the active gcloud project exactly.",
      ];
    case "Cloudflare Wrangler CLI":
      return [
        "Install Wrangler for the deployment operator environment.",
        "Node/npm example: `npm install -g wrangler`.",
        "Run `wrangler login` before deploying Cloudflare Pages.",
      ];
    case "Expected Cloudflare account":
      return [
        "Set `EXPECTED_CLOUDFLARE_ACCOUNT=<account-marker>` to a non-secret account name/id visible in `wrangler whoami`.",
        "Run `wrangler whoami` and confirm the expected account marker appears.",
      ];
    case "Cloudflare Wrangler auth":
      return [
        "Run `wrangler login`.",
        "Confirm `wrangler whoami` returns the Cloudflare account that owns the Pages project.",
        "Set EXPECTED_CLOUDFLARE_ACCOUNT and confirm it appears in `wrangler whoami` output.",
      ];
    case "Supabase CLI":
      return [
        "Install the Supabase CLI.",
        "macOS/Homebrew example: `brew install supabase/tap/supabase`.",
        "Run `supabase login` before applying or inspecting remote migrations.",
      ];
    case "Expected Supabase project ref":
      return [
        "Set `SUPABASE_PROJECT_REF=<project-ref>` or `EXPECTED_SUPABASE_PROJECT_REF=<project-ref>` for the target Supabase project.",
        "Run `supabase projects list` and confirm the expected project ref appears.",
      ];
    case "Supabase CLI auth":
      return [
        "Run `supabase login`.",
        "Confirm `supabase projects list` can read the staging and production projects.",
        "Set SUPABASE_PROJECT_REF or EXPECTED_SUPABASE_PROJECT_REF and confirm it appears in `supabase projects list` output.",
      ];
    case "Stripe CLI":
      return [
        "Install the Stripe CLI.",
        "macOS/Homebrew example: `brew install stripe/stripe-cli/stripe`.",
        "Run `stripe login` before webhook forwarding or webhook E2E checks.",
      ];
    case "Expected Stripe account":
      return [
        "Set `EXPECTED_STRIPE_ACCOUNT=<account-marker>` to a non-secret account name/id visible in `stripe whoami`.",
        "Run `stripe whoami` and confirm the expected account marker appears.",
      ];
    case "Stripe CLI auth":
      return [
        "Run `stripe login`.",
        "Confirm `stripe whoami` returns the Stripe account used for staging/prod billing.",
        "Set EXPECTED_STRIPE_ACCOUNT and confirm it appears in `stripe whoami` output.",
      ];
    default:
      return [];
  }
}

function printHelp() {
  console.log(`Usage:
  npm run deploy:preflight
  npm run deploy:preflight -- --json

Checks:
  Docker CLI and daemon
  Google Cloud CLI, auth, and project
  Expected GCP project, Cloudflare account, Supabase project ref, and Stripe account markers
  Cloudflare Wrangler CLI
  Cloudflare Wrangler auth
  Supabase CLI and auth
  Stripe CLI and auth
  GitHub CLI auth

Set GCP_PROJECT or EXPECTED_GCP_PROJECT, EXPECTED_CLOUDFLARE_ACCOUNT, SUPABASE_PROJECT_REF or
EXPECTED_SUPABASE_PROJECT_REF, and EXPECTED_STRIPE_ACCOUNT before running this gate.
On failure, this command prints the missing prerequisite and the next operator action.
Use --json when copying a machine-readable non-secret result into release evidence.

This command is intentionally not part of npm run verify because it depends on local operator tooling and cloud authentication.`);
}
