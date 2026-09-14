import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "../_shared/errors.ts";
import { type AgentRow, assertCallOwnership } from "../_shared/conversations.ts";
import { resolveToolContext } from "../_shared/tool-context.ts";

// --- resolveToolContext: the agent_id/conversation_id guard must run before any
// database access, so a missing or malformed request never even reaches a query. ---

function supabaseThatMustNotBeQueried(): SupabaseClient {
  return {
    from() {
      throw new Error(
        "resolveToolContext queried the database before validating agent_id/conversation_id",
      );
    },
  } as unknown as SupabaseClient;
}

Deno.test("resolveToolContext: rejects a missing agent_id before touching the database", async () => {
  const err = await assertRejects(
    () =>
      resolveToolContext(supabaseThatMustNotBeQueried(), {
        conversation_id: "c1",
      }),
    AppError,
  );
  assertEquals(err.statusCode, 400);
});

Deno.test("resolveToolContext: rejects a missing conversation_id before touching the database", async () => {
  const err = await assertRejects(
    () => resolveToolContext(supabaseThatMustNotBeQueried(), { agent_id: "a1" }),
    AppError,
  );
  assertEquals(err.statusCode, 400);
});

Deno.test("resolveToolContext: rejects a non-string agent_id before touching the database", async () => {
  const err = await assertRejects(
    () =>
      resolveToolContext(supabaseThatMustNotBeQueried(), {
        agent_id: 123 as unknown as string,
        conversation_id: "c1",
      }),
    AppError,
  );
  assertEquals(err.statusCode, 400);
});

Deno.test("resolveToolContext: rejects an empty-string conversation_id before touching the database", async () => {
  const err = await assertRejects(
    () =>
      resolveToolContext(supabaseThatMustNotBeQueried(), {
        agent_id: "a1",
        conversation_id: "",
      }),
    AppError,
  );
  assertEquals(err.statusCode, 400);
});

// --- assertCallOwnership: the guard ensureCallStub applies on every existing-row
// path (fresh lookup and the unique-violation re-select), so a forged/replayed
// conversation_id can never attach a mid-call write to another tenant's call row. ---

const agent: AgentRow = { id: "agent-1", business_id: "business-a" };

Deno.test("assertCallOwnership: allows a call row that belongs to the resolved agent's business", () => {
  assertCallOwnership({ business_id: "business-a" }, agent);
});

Deno.test("assertCallOwnership: rejects a call row owned by a different business", () => {
  const err = assertThrows(
    () => assertCallOwnership({ business_id: "business-b" }, agent),
    AppError,
  );
  assertEquals(err.statusCode, 409);
  assertEquals(err.code, "CONVERSATION_MISMATCH");
});
