import assert from "node:assert/strict";
import test from "node:test";

import { createUnsubscribeToken, verifyUnsubscribeToken } from "./notification-token.js";

test("notification unsubscribe tokens are signed, scoped and reject tampering", () => {
  const original = process.env.NOTIFICATION_SIGNING_SECRET;
  process.env.NOTIFICATION_SIGNING_SECRET = "0123456789abcdef0123456789abcdef";
  try {
    const token = createUnsubscribeToken("workspace-1", "user-1");
    const payload = verifyUnsubscribeToken(token);
    assert.equal(payload?.workspaceId, "workspace-1");
    assert.equal(payload?.userId, "user-1");
    assert.ok(Number(payload?.expiresAt) > Date.now());
    assert.equal(verifyUnsubscribeToken(`${token}tampered`), null);
  } finally {
    if (original === undefined) delete process.env.NOTIFICATION_SIGNING_SECRET;
    else process.env.NOTIFICATION_SIGNING_SECRET = original;
  }
});
