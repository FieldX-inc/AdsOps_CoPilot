import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type TokenEnvelope = {
  v: 1;
  kid: string;
  alg: "A256GCM";
  iv: string;
  tag: string;
  ciphertext: string;
};

export function encryptToken(plaintext: string) {
  const key = tokenKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const envelope: TokenEnvelope = {
    v: 1,
    kid: process.env.TOKEN_ENCRYPTION_KEY_ID || "local-v1",
    alg: "A256GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

export function decryptToken(encodedEnvelope: string) {
  const envelope = JSON.parse(Buffer.from(encodedEnvelope, "base64").toString("utf8")) as TokenEnvelope;
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function tokenKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is required");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes base64");
  return key;
}
