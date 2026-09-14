import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { AppError } from "../_shared/errors.ts";
import {
  parseElevenLabsSignature,
  verifyElevenLabsSignature,
} from "../_shared/webhook.ts";

const WEBHOOK_SECRET = "whsec_test_secret";
const TIMESTAMP = 1757800000;
const V0 = "b4036d51d5b22b6e5613e2f8952f0a9a443b116d067a88bfd346d4359caf18fe";
const GOOD_HEADER = `t=${TIMESTAMP},v0=${V0}`;
/** 5 seconds after the signed timestamp — comfortably inside the 1800s window. */
const NOW_MS = 1757800005000;

const RAW_BODY = await Deno.readTextFile(
  new URL("./fixtures/post_call_transcription.json", import.meta.url),
);

function webhookRequest(signature: string | undefined, body: string): Request {
  const headers = new Headers();
  if (signature !== undefined) headers.set("elevenlabs-signature", signature);
  return new Request("https://x/elevenlabs-webhook", {
    method: "POST",
    headers,
    body,
  });
}

// --- parseElevenLabsSignature ---

Deno.test("parseElevenLabsSignature: parses a well-formed header", () => {
  assertEquals(parseElevenLabsSignature(GOOD_HEADER), {
    t: TIMESTAMP,
    v0: V0,
  });
});

Deno.test("parseElevenLabsSignature: returns null for a null header", () => {
  assertEquals(parseElevenLabsSignature(null), null);
});

Deno.test("parseElevenLabsSignature: returns null for garbage", () => {
  assertEquals(parseElevenLabsSignature("garbage"), null);
  assertEquals(parseElevenLabsSignature(""), null);
  assertEquals(parseElevenLabsSignature(`v0=${V0}`), null);
  assertEquals(parseElevenLabsSignature(`t=${TIMESTAMP}`), null);
  assertEquals(parseElevenLabsSignature(`t=not-a-number,v0=${V0}`), null);
  assertEquals(parseElevenLabsSignature(`t=${TIMESTAMP},v0=`), null);
});

// --- verifyElevenLabsSignature ---

Deno.test("verifyElevenLabsSignature: resolves for a valid signature", async () => {
  Deno.env.set("ELEVENLABS_WEBHOOK_SECRET", WEBHOOK_SECRET);
  const req = webhookRequest(GOOD_HEADER, RAW_BODY);
  await verifyElevenLabsSignature(req, RAW_BODY, NOW_MS);
});

Deno.test("verifyElevenLabsSignature: rejects a body with one byte changed", async () => {
  Deno.env.set("ELEVENLABS_WEBHOOK_SECRET", WEBHOOK_SECRET);
  const tampered = RAW_BODY.replace(
    '"call_duration_secs":95',
    '"call_duration_secs":96',
  );
  // Exactly one byte differs, so this isolates the HMAC and not the length.
  assertEquals(tampered.length, RAW_BODY.length);
  assertEquals(tampered === RAW_BODY, false);

  const req = webhookRequest(GOOD_HEADER, tampered);
  const err = await assertRejects(
    () => verifyElevenLabsSignature(req, tampered, NOW_MS),
    AppError,
  );
  assertEquals(err.statusCode, 401);
  assertEquals(err.code, "INVALID_SIGNATURE");
});

Deno.test("verifyElevenLabsSignature: rejects a stale timestamp", async () => {
  Deno.env.set("ELEVENLABS_WEBHOOK_SECRET", WEBHOOK_SECRET);
  const req = webhookRequest(GOOD_HEADER, RAW_BODY);
  const err = await assertRejects(
    () =>
      verifyElevenLabsSignature(req, RAW_BODY, (TIMESTAMP + 1801) * 1000),
    AppError,
  );
  assertEquals(err.statusCode, 401);
  assertEquals(err.code, "STALE_SIGNATURE");
});

Deno.test("verifyElevenLabsSignature: accepts a timestamp at the edge of the window", async () => {
  Deno.env.set("ELEVENLABS_WEBHOOK_SECRET", WEBHOOK_SECRET);
  const req = webhookRequest(GOOD_HEADER, RAW_BODY);
  await verifyElevenLabsSignature(req, RAW_BODY, (TIMESTAMP + 1800) * 1000);
});

Deno.test("verifyElevenLabsSignature: rejects a timestamp too far in the past", async () => {
  Deno.env.set("ELEVENLABS_WEBHOOK_SECRET", WEBHOOK_SECRET);
  const req = webhookRequest(GOOD_HEADER, RAW_BODY);
  const err = await assertRejects(
    () =>
      verifyElevenLabsSignature(req, RAW_BODY, (TIMESTAMP - 1801) * 1000),
    AppError,
  );
  assertEquals(err.statusCode, 401);
  assertEquals(err.code, "STALE_SIGNATURE");
});

Deno.test("verifyElevenLabsSignature: rejects a missing header", async () => {
  Deno.env.set("ELEVENLABS_WEBHOOK_SECRET", WEBHOOK_SECRET);
  const req = webhookRequest(undefined, RAW_BODY);
  const err = await assertRejects(
    () => verifyElevenLabsSignature(req, RAW_BODY, NOW_MS),
    AppError,
  );
  assertEquals(err.statusCode, 401);
  assertEquals(err.code, "INVALID_SIGNATURE");
});

Deno.test("verifyElevenLabsSignature: rejects a signature signed with another secret", async () => {
  Deno.env.set("ELEVENLABS_WEBHOOK_SECRET", "whsec_a_different_secret");
  try {
    const req = webhookRequest(GOOD_HEADER, RAW_BODY);
    const err = await assertRejects(
      () => verifyElevenLabsSignature(req, RAW_BODY, NOW_MS),
      AppError,
    );
    assertEquals(err.statusCode, 401);
    assertEquals(err.code, "INVALID_SIGNATURE");
  } finally {
    Deno.env.set("ELEVENLABS_WEBHOOK_SECRET", WEBHOOK_SECRET);
  }
});

Deno.test("verifyElevenLabsSignature: throws 500 CONFIG_ERROR when the secret is unset", async () => {
  Deno.env.delete("ELEVENLABS_WEBHOOK_SECRET");
  try {
    const req = webhookRequest(GOOD_HEADER, RAW_BODY);
    const err = await assertRejects(
      () => verifyElevenLabsSignature(req, RAW_BODY, NOW_MS),
      AppError,
    );
    assertEquals(err.statusCode, 500);
    assertEquals(err.code, "CONFIG_ERROR");
  } finally {
    Deno.env.set("ELEVENLABS_WEBHOOK_SECRET", WEBHOOK_SECRET);
  }
});
