type EmailDeliveryResult = {
  delivered: string[];
  permanent_bounces: string[];
  queued: string[];
};

export class EmailDeliveryError extends Error {
  retryable: boolean;
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.retryable = isRetryableEmailStatus(status);
  }
}

export function isRetryableEmailStatus(status: number) {
  return status === 429 || status >= 500;
}

export function emailConfigurationIssues() {
  return [
    ["CLOUDFLARE_ACCOUNT_ID", process.env.CLOUDFLARE_ACCOUNT_ID],
    ["CLOUDFLARE_EMAIL_API_TOKEN", process.env.CLOUDFLARE_EMAIL_API_TOKEN],
    ["REPORT_EMAIL_DOMAIN", process.env.REPORT_EMAIL_DOMAIN],
    ["APP_PUBLIC_URL", process.env.APP_PUBLIC_URL || process.env.WEB_ORIGIN],
    ["API_PUBLIC_ORIGIN", process.env.API_PUBLIC_ORIGIN],
    ["NOTIFICATION_SIGNING_SECRET", process.env.NOTIFICATION_SIGNING_SECRET || process.env.REPORT_UNSUBSCRIBE_SECRET],
  ].filter(([, value]) => !String(value ?? "").trim()).map(([key]) => `${key} is required`);
}

export async function sendReportEmail(input: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl?: string | null;
}) {
  const issues = emailConfigurationIssues();
  if (issues.length) throw new EmailDeliveryError(issues.join(", "), 400);
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const token = required("CLOUDFLARE_EMAIL_API_TOKEN");
  const domain = required("REPORT_EMAIL_DOMAIN").replace(/^@/, "");
  const localPart = (process.env.REPORT_EMAIL_FROM_LOCAL_PART?.trim() || "reports").replace(/[^a-zA-Z0-9._+-]/g, "");
  const fromName = process.env.REPORT_EMAIL_FROM_NAME?.trim() || "ちょこっとインハウス";
  if (!localPart || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    throw new EmailDeliveryError("REPORT_EMAIL_DOMAIN or sender local part is invalid", 400);
  }
  const headers: Record<string, string> = {};
  if (input.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${input.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  let lastError: EmailDeliveryError | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: input.to,
          from: { address: `${localPart}@${domain}`, name: fromName },
          subject: input.subject,
          html: input.html,
          text: input.text,
          ...(Object.keys(headers).length ? { headers } : {}),
        }),
      },
    );
    const body = await response.json().catch(() => null) as {
      success?: boolean;
      result?: EmailDeliveryResult;
      errors?: Array<{ code?: number; message?: string }>;
    } | null;
    if (response.ok && body?.success && body.result) return body.result;
    const safeMessage = body?.errors?.map((error) => error.message).filter(Boolean).join(", ") || `HTTP ${response.status}`;
    lastError = new EmailDeliveryError(`Cloudflare Email Service rejected the message: ${safeMessage.slice(0, 180)}`, response.status);
    if (!lastError.retryable || attempt === 2) throw lastError;
    await delay(250 * (2 ** attempt));
  }
  throw lastError ?? new EmailDeliveryError("Cloudflare Email Service failed.", 500);
}

function required(key: string) {
  const value = process.env[key]?.trim();
  if (!value) throw new EmailDeliveryError(`${key} is required`, 400);
  return value;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
