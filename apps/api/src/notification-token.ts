import { createHmac, timingSafeEqual } from "node:crypto";

type UnsubscribePayload = {
  workspaceId: string;
  userId: string;
  expiresAt: number;
};

export function createUnsubscribeToken(workspaceId: string, userId: string) {
  const payload: UnsubscribePayload = {
    workspaceId,
    userId,
    expiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyUnsubscribeToken(token: string | null | undefined): UnsubscribePayload | null {
  const [encoded, signature] = String(token ?? "").split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as UnsubscribePayload;
    if (!payload.workspaceId || !payload.userId || !Number.isFinite(payload.expiresAt) || payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function sign(value: string) {
  const secret = process.env.NOTIFICATION_SIGNING_SECRET?.trim() || process.env.REPORT_UNSUBSCRIBE_SECRET?.trim();
  if (!secret) throw new Error("NOTIFICATION_SIGNING_SECRET is required");
  return createHmac("sha256", secret).update(value).digest("base64url");
}
