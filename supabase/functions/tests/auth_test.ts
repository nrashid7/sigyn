import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { AppError } from "../_shared/errors.ts";
import {
  requireServiceRole,
  requireToolSecret,
  timingSafeEqual,
} from "../_shared/auth.ts";

const SERVICE_ROLE_KEY = "test-service-role-key-12345";
const TOOL_SECRET = "test-tool-secret-67890";

function requestWithAuthHeader(headerValue: string | undefined): Request {
  const headers = new Headers();
  if (headerValue !== undefined) headers.set("authorization", headerValue);
  return new Request("https://example.com/fn", { method: "POST", headers });
}

function requestWithToolSecretHeader(headerValue: string | undefined): Request {
  const headers = new Headers();
  if (headerValue !== undefined) headers.set("x-sigyn-tool-secret", headerValue);
  return new Request("https://example.com/fn", { method: "POST", headers });
}

// --- timingSafeEqual ---

Deno.test("timingSafeEqual: equal strings return true", () => {
  assertEquals(timingSafeEqual("abc123", "abc123"), true);
});

Deno.test("timingSafeEqual: different strings of the same length return false", () => {
  assertEquals(timingSafeEqual("abc123", "abc124"), false);
});

Deno.test("timingSafeEqual: strings of different lengths return false", () => {
  assertEquals(timingSafeEqual("abc", "abcdef"), false);
});

// --- requireServiceRole ---

Deno.test("requireServiceRole: passes with the exact key", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
  const req = requestWithAuthHeader(`Bearer ${SERVICE_ROLE_KEY}`);
  requireServiceRole(req);
});

Deno.test("requireServiceRole: throws 403 for a wrong key", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
  const req = requestWithAuthHeader("Bearer wrong-key");
  const err = assertThrows(() => requireServiceRole(req), AppError);
  assertEquals(err.statusCode, 403);
  assertEquals(err.code, "FORBIDDEN");
});

Deno.test("requireServiceRole: throws 403 for a missing header", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
  const req = requestWithAuthHeader(undefined);
  const err = assertThrows(() => requireServiceRole(req), AppError);
  assertEquals(err.statusCode, 403);
  assertEquals(err.code, "FORBIDDEN");
});

Deno.test('requireServiceRole: throws 403 for "Bearer " with no token', () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
  const req = requestWithAuthHeader("Bearer ");
  const err = assertThrows(() => requireServiceRole(req), AppError);
  assertEquals(err.statusCode, 403);
  assertEquals(err.code, "FORBIDDEN");
});

Deno.test("requireServiceRole: throws 500 CONFIG_ERROR when SUPABASE_SERVICE_ROLE_KEY is unset", () => {
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  try {
    const req = requestWithAuthHeader(`Bearer ${SERVICE_ROLE_KEY}`);
    const err = assertThrows(() => requireServiceRole(req), AppError);
    assertEquals(err.statusCode, 500);
    assertEquals(err.code, "CONFIG_ERROR");
  } finally {
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
  }
});

// --- requireToolSecret ---

Deno.test("requireToolSecret: passes with the exact secret", () => {
  Deno.env.set("ELEVENLABS_TOOL_SECRET", TOOL_SECRET);
  const req = requestWithToolSecretHeader(TOOL_SECRET);
  requireToolSecret(req);
});

Deno.test("requireToolSecret: throws 401 for a wrong secret", () => {
  Deno.env.set("ELEVENLABS_TOOL_SECRET", TOOL_SECRET);
  const req = requestWithToolSecretHeader("wrong-secret");
  const err = assertThrows(() => requireToolSecret(req), AppError);
  assertEquals(err.statusCode, 401);
  assertEquals(err.code, "INVALID_TOOL_SECRET");
});

Deno.test("requireToolSecret: throws 401 for a missing header", () => {
  Deno.env.set("ELEVENLABS_TOOL_SECRET", TOOL_SECRET);
  const req = requestWithToolSecretHeader(undefined);
  const err = assertThrows(() => requireToolSecret(req), AppError);
  assertEquals(err.statusCode, 401);
  assertEquals(err.code, "INVALID_TOOL_SECRET");
});

Deno.test("requireToolSecret: throws 500 CONFIG_ERROR when ELEVENLABS_TOOL_SECRET is unset", () => {
  Deno.env.delete("ELEVENLABS_TOOL_SECRET");
  try {
    const req = requestWithToolSecretHeader(TOOL_SECRET);
    const err = assertThrows(() => requireToolSecret(req), AppError);
    assertEquals(err.statusCode, 500);
    assertEquals(err.code, "CONFIG_ERROR");
  } finally {
    Deno.env.set("ELEVENLABS_TOOL_SECRET", TOOL_SECRET);
  }
});
