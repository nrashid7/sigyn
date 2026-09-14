import { assertEquals } from "jsr:@std/assert@1";
import type { ElConversation } from "../_shared/elevenlabs.ts";
import {
  minutesForConversation,
  shouldSendMissedCallSms,
  shouldStoreRecording,
} from "../_shared/call-side-effects.ts";

const RAW_FIXTURE = await Deno.readTextFile(
  new URL("./fixtures/post_call_transcription.json", import.meta.url),
);
const ENVELOPE = JSON.parse(RAW_FIXTURE) as { data: ElConversation };

/** Fresh deep clone per test so mutations never leak between cases. */
function conversation(): ElConversation {
  return structuredClone(ENVELOPE.data);
}

// --- minutesForConversation ---

Deno.test("minutesForConversation: ceils a partial minute up", () => {
  const conv = conversation();
  conv.metadata!.call_duration_secs = 95;
  assertEquals(minutesForConversation(conv), 2);
});

Deno.test("minutesForConversation: an exact minute is not rounded up further", () => {
  const conv = conversation();
  conv.metadata!.call_duration_secs = 60;
  assertEquals(minutesForConversation(conv), 1);
});

Deno.test("minutesForConversation: zero duration is zero minutes", () => {
  const conv = conversation();
  conv.metadata!.call_duration_secs = 0;
  assertEquals(minutesForConversation(conv), 0);
});

Deno.test("minutesForConversation: missing duration defaults to zero minutes", () => {
  const conv = conversation();
  delete conv.metadata!.call_duration_secs;
  assertEquals(minutesForConversation(conv), 0);
});

Deno.test("minutesForConversation: missing metadata defaults to zero minutes", () => {
  const conv = conversation();
  delete conv.metadata;
  assertEquals(minutesForConversation(conv), 0);
});

// --- shouldStoreRecording ---

Deno.test("shouldStoreRecording: true when done, duration>0, and no existing recording", () => {
  const conv = conversation();
  conv.status = "done";
  conv.metadata!.call_duration_secs = 95;
  assertEquals(shouldStoreRecording(conv, null), true);
});

Deno.test("shouldStoreRecording: true when the existing recording url is undefined", () => {
  const conv = conversation();
  conv.status = "done";
  conv.metadata!.call_duration_secs = 95;
  assertEquals(shouldStoreRecording(conv, undefined), true);
});

Deno.test("shouldStoreRecording: false when a recording is already stored", () => {
  const conv = conversation();
  conv.status = "done";
  conv.metadata!.call_duration_secs = 95;
  assertEquals(
    shouldStoreRecording(conv, "https://example.com/existing.mp3"),
    false,
  );
});

Deno.test("shouldStoreRecording: false when the conversation is not done", () => {
  const conv = conversation();
  conv.status = "processing";
  conv.metadata!.call_duration_secs = 95;
  assertEquals(shouldStoreRecording(conv, null), false);
});

Deno.test("shouldStoreRecording: false for a failed conversation even with a duration", () => {
  const conv = conversation();
  conv.status = "failed";
  conv.metadata!.call_duration_secs = 95;
  assertEquals(shouldStoreRecording(conv, null), false);
});

Deno.test("shouldStoreRecording: false when duration is zero", () => {
  const conv = conversation();
  conv.status = "done";
  conv.metadata!.call_duration_secs = 0;
  assertEquals(shouldStoreRecording(conv, null), false);
});

Deno.test("shouldStoreRecording: false when duration is missing", () => {
  const conv = conversation();
  conv.status = "done";
  delete conv.metadata!.call_duration_secs;
  assertEquals(shouldStoreRecording(conv, null), false);
});

// --- shouldSendMissedCallSms ---

Deno.test("shouldSendMissedCallSms: false for an answered call even with a caller number", () => {
  // The fixture's agent spoke, so this is not a missed call.
  assertEquals(shouldSendMissedCallSms(conversation()), false);
});

Deno.test("shouldSendMissedCallSms: true for a missed call with a caller number", () => {
  const conv = conversation();
  conv.status = "failed";
  assertEquals(shouldSendMissedCallSms(conv), true);
});

Deno.test("shouldSendMissedCallSms: false for a missed call with no caller number", () => {
  const conv = conversation();
  conv.status = "failed";
  delete conv.metadata!.phone_call;
  assertEquals(shouldSendMissedCallSms(conv), false);
});

Deno.test("shouldSendMissedCallSms: false when the external number is an empty string", () => {
  const conv = conversation();
  conv.status = "failed";
  conv.metadata!.phone_call!.external_number = "";
  assertEquals(shouldSendMissedCallSms(conv), false);
});

Deno.test("shouldSendMissedCallSms: true when only the caller ever spoke", () => {
  const conv = conversation();
  conv.transcript = [{ role: "user", message: "Hello?", time_in_call_secs: 0 }];
  assertEquals(shouldSendMissedCallSms(conv), true);
});
