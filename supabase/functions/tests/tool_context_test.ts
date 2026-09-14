import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { AppError } from "../_shared/errors.ts";
import { clampScore, parseToolBody, toolResponse } from "../_shared/tool-context.ts";
import {
  ALL_PARAMS as AVAILABILITY_ALL,
  REQUIRED_PARAMS as AVAILABILITY_REQUIRED,
} from "../calendar-availability/params.ts";
import {
  ALL_PARAMS as BOOK_ALL,
  REQUIRED_PARAMS as BOOK_REQUIRED,
} from "../calendar-book/params.ts";
import {
  ALL_PARAMS as QUALIFY_ALL,
  REQUIRED_PARAMS as QUALIFY_REQUIRED,
} from "../qualify-lead/params.ts";
import expected from "./fixtures/expected_tool_params.json" with { type: "json" };

// --- parseToolBody ---

Deno.test("parseToolBody: returns the body typed when every required field is present", () => {
  const body = { agent_id: "a1", conversation_id: "c1", start_date: "2026-09-20" };
  const result = parseToolBody<
    { agent_id: string; conversation_id: string; start_date: string }
  >(body, ["agent_id", "conversation_id", "start_date"]);
  assertEquals(result, body);
});

Deno.test("parseToolBody: throws 400 listing the missing field names", () => {
  const body = { agent_id: "a1" };
  const err = assertThrows(
    () => parseToolBody(body, ["agent_id", "conversation_id", "start_date"]),
    AppError,
  );
  assertEquals(err.statusCode, 400);
  assertEquals(err.message.includes("conversation_id"), true);
  assertEquals(err.message.includes("start_date"), true);
  assertEquals(err.message.includes("agent_id"), false);
});

Deno.test("parseToolBody: treats an empty string and null as missing, not just undefined", () => {
  const body = { agent_id: "", conversation_id: null };
  const err = assertThrows(
    () => parseToolBody(body, ["agent_id", "conversation_id"]),
    AppError,
  );
  assertEquals(err.statusCode, 400);
  assertEquals(err.message.includes("agent_id"), true);
  assertEquals(err.message.includes("conversation_id"), true);
});

// --- clampScore ---

Deno.test("clampScore: clamps a numeric string above 100 down to 100", () => {
  assertEquals(clampScore("150"), 100);
});

Deno.test("clampScore: a non-numeric value becomes 0", () => {
  assertEquals(clampScore("abc"), 0);
});

Deno.test("clampScore: clamps a negative number up to 0", () => {
  assertEquals(clampScore(-20), 0);
});

Deno.test("clampScore: rounds a fractional value to the nearest integer", () => {
  assertEquals(clampScore(72.6), 73);
});

// --- toolResponse ---

Deno.test("toolResponse: sets the result key, preserves extra keys, and returns 200", async () => {
  const response = toolResponse("Lead recorded with score 80.", {
    success: true,
    lead_score: 80,
  });
  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload, {
    success: true,
    lead_score: 80,
    result: "Lead recorded with score 80.",
  });
});

Deno.test("toolResponse: defaults extra to an empty object", async () => {
  const response = toolResponse(
    "No available slots in that range. Offer a different day.",
  );
  const payload = await response.json();
  assertEquals(payload, {
    result: "No available slots in that range. Offer a different day.",
  });
});

// --- REQUIRED_PARAMS / ALL_PARAMS match the shared ElevenLabs tool fixture ---
// (supabase/functions/tests/fixtures/expected_tool_params.json, owned by Task 9 — not modified here)

Deno.test("calendar-availability params match expected_tool_params.json's check_availability entry", () => {
  assertEquals(AVAILABILITY_REQUIRED, expected.check_availability.required);
  assertEquals(
    [...AVAILABILITY_ALL].sort(),
    Object.keys(expected.check_availability.properties).sort(),
  );
});

Deno.test("calendar-book params match expected_tool_params.json's book_appointment entry", () => {
  assertEquals(BOOK_REQUIRED, expected.book_appointment.required);
  assertEquals(
    [...BOOK_ALL].sort(),
    Object.keys(expected.book_appointment.properties).sort(),
  );
});

Deno.test("qualify-lead params match expected_tool_params.json's qualify_lead entry", () => {
  assertEquals(QUALIFY_REQUIRED, expected.qualify_lead.required);
  assertEquals(
    [...QUALIFY_ALL].sort(),
    Object.keys(expected.qualify_lead.properties).sort(),
  );
});
