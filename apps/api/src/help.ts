export type HelpArticle = {
  id: string;
  title: string;
  summary: string;
  category: string;
  difficulty: string;
  body: string;
  tags: string[];
  sortOrder: number;
};

type MicroCmsListResponse = {
  contents?: unknown[];
};

const defaultTimeoutMs = 4_000;

export function isMicroCmsConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(normalizeServiceDomain(env.MICROCMS_SERVICE_DOMAIN) && env.MICROCMS_API_KEY?.trim());
}

export async function fetchMicroCmsHelpArticles(
  tags: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): Promise<HelpArticle[] | null> {
  const serviceDomain = normalizeServiceDomain(env.MICROCMS_SERVICE_DOMAIN);
  const apiKey = env.MICROCMS_API_KEY?.trim();
  if (!serviceDomain || !apiKey) return null;

  const endpoint = new URL(`https://${serviceDomain}.microcms.io/api/v1/help`);
  endpoint.searchParams.set("limit", "100");
  const response = await requestMicroCms(endpoint, apiKey, env);
  const payload = await response.json() as MicroCmsListResponse;
  const articles = Array.isArray(payload.contents)
    ? payload.contents.map(parseHelpArticle).filter((article): article is HelpArticle => article !== null)
    : [];
  return filterHelpArticles(articles, tags).sort(compareHelpArticles);
}

export async function fetchMicroCmsHelpArticle(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HelpArticle | null> {
  const serviceDomain = normalizeServiceDomain(env.MICROCMS_SERVICE_DOMAIN);
  const apiKey = env.MICROCMS_API_KEY?.trim();
  const contentId = normalizeContentId(id);
  if (!serviceDomain || !apiKey || !contentId) return null;

  const endpoint = new URL(`https://${serviceDomain}.microcms.io/api/v1/help/${contentId}`);
  const response = await requestMicroCms(endpoint, apiKey, env);
  return parseHelpArticle(await response.json());
}

export function filterHelpArticles(articles: HelpArticle[], tags: string[]) {
  if (tags.length === 0) return articles;
  const normalized = new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  return articles.filter((article) => article.tags.some((tag) => normalized.has(tag.toLowerCase())));
}

function parseHelpArticle(value: unknown): HelpArticle | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = normalizeContentId(String(record.id ?? ""));
  const title = cleanText(record.title);
  const body = cleanText(record.body) || htmlToSafeMarkdown(cleanText(record.content));
  if (!id || !title || !body) return null;
  const rawTags = Array.isArray(record.tags) ? record.tags : [];
  const tags = rawTags
    .map((tag) => typeof tag === "string" ? tag : cleanText((tag as Record<string, unknown> | null)?.name))
    .map((tag) => tag.trim())
    .filter(Boolean);
  return {
    id,
    title,
    summary: cleanText(record.summary) || summarizeHelpBody(body),
    category: firstSelectedValue(record.category) || "使い方",
    body,
    difficulty: firstSelectedValue(record.difficulty) || "基本",
    tags,
    sortOrder: finiteNumber(record.sortOrder, 100),
  };
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function firstSelectedValue(value: unknown) {
  if (Array.isArray(value)) return value.map(selectedValueText).find(Boolean) ?? "";
  return selectedValueText(value);
}

function selectedValueText(value: unknown) {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return cleanText(record.name) || cleanText(record.title);
  }
  return cleanText(value);
}

function htmlToSafeMarkdown(value: string) {
  if (!value || !/<[a-z][\s\S]*>/i.test(value)) return value;
  const markdown = value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, content: string) => (
      `\n${"#".repeat(Number(level))} ${content}\n`
    ))
    .replace(/<a\b[^>]*href=["'](https:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<(strong|b)\b[^>]*>/gi, "**")
    .replace(/<\/(strong|b)>/gi, "**")
    .replace(/<(em|i)\b[^>]*>/gi, "*")
    .replace(/<\/(em|i)>/gi, "*")
    .replace(/<code\b[^>]*>/gi, "`")
    .replace(/<\/code>/gi, "`")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p\b[^>]*>/gi, "")
    .replace(/<\/?(ul|ol|div|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(markdown)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };
  return value
    .replace(/&([a-z]+);/gi, (match, name: string) => namedEntities[name.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (match, code: string) => {
      const numeric = Number(code);
      return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, code: string) => {
      const numeric = Number.parseInt(code, 16);
      return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : match;
    });
}

function summarizeHelpBody(body: string) {
  const text = body
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/[*_`[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function finiteNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function compareHelpArticles(left: HelpArticle, right: HelpArticle) {
  return left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, "ja");
}

function normalizeServiceDomain(value: string | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9-]+$/.test(normalized) ? normalized : "";
}

function normalizeContentId(value: string) {
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : "";
}

async function requestMicroCms(endpoint: URL, apiKey: string, env: NodeJS.ProcessEnv) {
  const timeoutMs = positiveInteger(env.MICROCMS_TIMEOUT_MS, defaultTimeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      headers: { "X-MICROCMS-API-KEY": apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`microCMS request failed with status ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
