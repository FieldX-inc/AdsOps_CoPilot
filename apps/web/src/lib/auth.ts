import { cookies } from "next/headers";

import { env } from "@/lib/env";

export type SessionPayload = {
  sub: string;
  exp: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.authSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return toBase64Url(new Uint8Array(signature));
}

export async function createSessionToken(sub: string): Promise<string> {
  const payload: SessionPayload = {
    sub,
    exp: Math.floor(Date.now() / 1000) + env.sessionMaxAgeSeconds,
  };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  if ((await sign(encodedPayload)) !== signature) {
    return null;
  }

  try {
    const payload = JSON.parse(decoder.decode(fromBase64Url(encodedPayload))) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(env.sessionCookieName)?.value;
  return verifySessionToken(token);
}
