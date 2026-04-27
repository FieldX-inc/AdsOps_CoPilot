import { randomBytes, createHash } from "node:crypto";

import { decryptToken, encryptToken } from "./crypto.js";
import {
  type AuthContext,
  readEncryptedAccessToken,
  upsertPlatformConnection,
} from "./supabase.js";

const googleOAuthStates = new Map<string, {
  workspaceId: string;
  userId: string;
  codeVerifier: string;
  expiresAt: number;
}>();

const googleAdsScope = "https://www.googleapis.com/auth/adwords";

export function buildGoogleOAuthUrl(auth: AuthContext) {
  const state = randomBytes(24).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  googleOAuthStates.set(state, {
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", requiredEnv("GOOGLE_ADS_CLIENT_ID"));
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", googleAdsScope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function handleGoogleOAuthCallback(code: string | null, state: string | null) {
  if (!code || !state) throw new Error("OAuth code/stateが不足しています。");
  const saved = googleOAuthStates.get(state);
  googleOAuthStates.delete(state);
  if (!saved || saved.expiresAt < Date.now()) throw new Error("OAuth stateが無効または期限切れです。");

  const token = await exchangeCodeForToken(code, saved.codeVerifier);
  const accessTokenEncrypted = encryptToken(token.access_token);
  const refreshTokenEncrypted = token.refresh_token ? encryptToken(token.refresh_token) : null;
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;

  await upsertPlatformConnection({
    workspaceId: saved.workspaceId,
    userId: saved.userId,
    platform: "google",
    providerAccountId: null,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [googleAdsScope],
    expiresAt,
  });

  return { workspaceId: saved.workspaceId };
}

export async function listAccessibleGoogleCustomers(auth: AuthContext) {
  const encrypted = await readEncryptedAccessToken(auth.workspace.id, auth.user.id, "google");
  if (!encrypted) throw new Error("Google Ads連携が見つかりません。先にOAuth連携してください。");
  const accessToken = decryptToken(encrypted);
  const res = await fetch("https://googleads.googleapis.com/v18/customers:listAccessibleCustomers", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": requiredEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
    },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google Ads customer list取得に失敗しました: ${detail.slice(0, 240)}`);
  }
  const data = (await res.json()) as { resourceNames?: string[] };
  return (data.resourceNames ?? []).map((resourceName) => ({
    resourceName,
    customerId: resourceName.replace("customers/", ""),
  }));
}

async function exchangeCodeForToken(code: string, codeVerifier: string) {
  const params = new URLSearchParams({
    code,
    client_id: requiredEnv("GOOGLE_ADS_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_ADS_CLIENT_SECRET"),
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google OAuth token exchangeに失敗しました: ${detail.slice(0, 240)}`);
  }
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
}

function googleRedirectUri() {
  return process.env.GOOGLE_ADS_REDIRECT_URI || "http://localhost:8787/oauth/google/callback";
}

function requiredEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}
