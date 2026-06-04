#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const checks = [
  {
    file: "apps/api/Dockerfile",
    required: [
      "FROM node:22-slim AS build",
      "FROM node:22-slim AS runtime",
      "WORKDIR /app",
      "COPY package.json package-lock.json ./",
      "COPY apps/api/package.json apps/api/package.json",
      "RUN npm ci --workspace @adops/api --include-workspace-root",
      "RUN npm --workspace @adops/api run build",
      "RUN npm ci --workspace @adops/api --include-workspace-root --omit=dev",
      "COPY --from=build /app/apps/api/dist apps/api/dist",
      "ENV PORT=8787",
      "EXPOSE 8787",
      "HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3",
      "/health",
      "CMD [\"node\", \"apps/api/dist/index.js\"]",
    ],
  },
  {
    file: "services/adk-agent/Dockerfile",
    required: [
      "FROM python:3.11-slim",
      "COPY services/adk-agent/pyproject.toml services/adk-agent/pyproject.toml",
      "COPY services/adk-agent/ad_ops_advisor services/adk-agent/ad_ops_advisor",
      "python -m pip install --no-cache-dir .",
      "ENV PORT=8000",
      "EXPOSE 8000",
      "HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3",
      "/health",
      "CMD [\"python\", \"-m\", \"ad_ops_advisor.http_server\"]",
    ],
    forbidden: [
      ".[dev]",
      ".[gemini]",
      "google-adk",
      "GEMINI_API_KEY",
    ],
  },
  {
    file: ".dockerignore",
    required: [
      "node_modules",
      ".git",
      ".env",
      ".env.*",
      "__pycache__",
      "*.pyc",
    ],
  },
];

const issues = [];

for (const check of checks) {
  if (!existsSync(check.file)) {
    issues.push(`missing ${check.file}`);
    continue;
  }
  const content = readFileSync(check.file, "utf8");
  for (const snippet of check.required) {
    if (!content.includes(snippet)) {
      issues.push(`${check.file}: missing "${snippet}"`);
    }
  }
  for (const snippet of check.forbidden ?? []) {
    if (content.includes(snippet)) {
      issues.push(`${check.file}: production image must not include "${snippet}"`);
    }
  }
}

const pyproject = readFileSync("services/adk-agent/pyproject.toml", "utf8");
for (const snippet of ["[tool.setuptools.package-data]", "\"prompts/*.md\"", "\"evals/*.json\""]) {
  if (!pyproject.includes(snippet)) {
    issues.push(`services/adk-agent/pyproject.toml: missing ${snippet} for Docker pip install package data`);
  }
}
for (const snippet of ["\"openai-agents\"", "\"psycopg[binary]>=3.2\"", "\"pydantic>=2\""]) {
  if (!pyproject.includes(snippet)) {
    issues.push(`services/adk-agent/pyproject.toml: missing runtime dependency ${snippet}`);
  }
}
const pyprojectRuntimeDependencies = sectionBetween(pyproject, "dependencies = [", "]", "runtime dependencies");
for (const snippet of ["google-adk", "google-generativeai", "GEMINI_API_KEY"]) {
  if (pyprojectRuntimeDependencies.includes(snippet)) {
    issues.push(`services/adk-agent/pyproject.toml: production runtime dependencies must not include ${snippet}`);
  }
}
const pyprojectOptionalDependencies = sectionBetween(pyproject, "[project.optional-dependencies]", "[tool.setuptools.packages.find]", "optional dependencies");
if (!pyprojectOptionalDependencies.includes("gemini") || !pyprojectOptionalDependencies.includes("google-adk")) {
  issues.push("services/adk-agent/pyproject.toml: google-adk must remain optional-only for local/dev compatibility");
}

if (issues.length) {
  console.error("Dockerfile check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Dockerfile check passed.");

function sectionBetween(content, start, end, label) {
  const startIndex = content.indexOf(start);
  if (startIndex === -1) {
    issues.push(`services/adk-agent/pyproject.toml: missing ${label} section start ${start}`);
    return "";
  }
  const bodyStart = startIndex + start.length;
  const endIndex = content.indexOf(end, bodyStart);
  if (endIndex === -1) {
    issues.push(`services/adk-agent/pyproject.toml: missing ${label} section end ${end}`);
    return "";
  }
  return content.slice(bodyStart, endIndex);
}
