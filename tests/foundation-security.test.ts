import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  verifyRetellSignatureValue,
} from "../supabase/functions/_shared/retell-signature.ts";
import {
  createOAuthState,
  verifyOAuthState,
} from "../apps/web/lib/server/oauth-state.ts";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "../apps/web/lib/server/integration-crypto.ts";

function retellSignature(body: string, secret: string, timestamp: number) {
  const digest = createHmac("sha256", secret)
    .update(`${body}${timestamp}`)
    .digest("hex");
  return `v=${timestamp},d=${digest}`;
}

test("Retell signature verification accepts a current authentic payload", async () => {
  const now = 1_800_000_000_000;
  const body = JSON.stringify({ event: "call_started", call: { call_id: "call_1" } });
  const signature = retellSignature(body, "retell-secret", now - 1_000);

  assert.equal(
    await verifyRetellSignatureValue(body, signature, "retell-secret", now),
    true,
  );
});

test("Retell signature verification rejects replayed and modified payloads", async () => {
  const now = 1_800_000_000_000;
  const body = "{\"event\":\"call_started\"}";

  assert.equal(
    await verifyRetellSignatureValue(
      body,
      retellSignature(body, "retell-secret", now - 300_001),
      "retell-secret",
      now,
    ),
    false,
  );
  assert.equal(
    await verifyRetellSignatureValue(
      `${body} `,
      retellSignature(body, "retell-secret", now),
      "retell-secret",
      now,
    ),
    false,
  );
});

test("OAuth state is bound to its user, purpose, and expiry", async () => {
  const secret = "oauth-state-secret-with-sufficient-length";
  const state = await createOAuthState(
    { userId: "user-1", purpose: "google_calendar", returnTo: "/onboarding/calendar" },
    secret,
    1_800_000_000_000,
  );

  assert.deepEqual(
    await verifyOAuthState(state, secret, "google_calendar", 1_800_000_100_000),
    {
      userId: "user-1",
      purpose: "google_calendar",
      returnTo: "/onboarding/calendar",
    },
  );
  assert.equal(
    await verifyOAuthState(state, secret, "google_business_profile", 1_800_000_100_000),
    null,
  );
  assert.equal(
    await verifyOAuthState(`${state}x`, secret, "google_calendar", 1_800_000_100_000),
    null,
  );
  assert.equal(
    await verifyOAuthState(state, secret, "google_calendar", 1_800_000_901_000),
    null,
  );
});

test("integration credentials are encrypted and authenticated", async () => {
  const key = randomBytes(32).toString("base64");
  const encrypted = await encryptIntegrationSecret("refresh-token-value", key);

  assert.equal(encrypted.includes("refresh-token-value"), false);
  assert.equal(await decryptIntegrationSecret(encrypted, key), "refresh-token-value");

  const tampered = `${encrypted.slice(0, -2)}AA`;
  await assert.rejects(() => decryptIntegrationSecret(tampered, key));
});

test("production migration schema-qualifies extension UUID functions", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20260808133154_production_launch_foundation.sql", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(sql, /DEFAULT\s+uuid_generate_v4\(\)/i);
});
