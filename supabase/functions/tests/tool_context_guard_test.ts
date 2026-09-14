import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "../_shared/errors.ts";
import {
  type AgentRow,
  assertCallOwnership,
  ensureCallStub,
} from "../_shared/conversations.ts";
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

// --- ensureCallStub wired to a fake client: the guard above has to actually run on
// both existing-row paths, not just exist. The fake reproduces only the two query
// chains ensureCallStub uses:
//   .from("calls").select(...).eq(...).maybeSingle()   — the lookup, and the re-select
//   .from("calls").insert(...).select(...).single()    — the create ---

type CallRow = { id: string; business_id: string };

interface FakeCallsOptions {
  /** Row returned by the first lookup (null = no row yet, so the insert runs). */
  existing?: CallRow | null;
  /** Error the insert fails with; `{ code: "23505" }` triggers the re-select path. */
  insertError?: { code?: string; message: string } | null;
  /** Row returned by the re-select after a unique violation. */
  raced?: CallRow | null;
}

function fakeCallsClient(options: FakeCallsOptions): SupabaseClient {
  let lookups = 0;

  return {
    from(table: string) {
      assertEquals(table, "calls");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => {
              lookups += 1;
              const data = lookups === 1
                ? options.existing ?? null
                : options.raced ?? null;
              return Promise.resolve({ data, error: null });
            },
          }),
        }),
        insert: () => ({
          select: () => ({
            single: () =>
              Promise.resolve(
                options.insertError
                  ? { data: null, error: options.insertError }
                  : { data: { id: "call-inserted" }, error: null },
              ),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

Deno.test("ensureCallStub: rejects an existing call row owned by another business", async () => {
  const client = fakeCallsClient({
    existing: { id: "call-foreign", business_id: "business-b" },
  });

  const err = await assertRejects(
    () => ensureCallStub(client, agent, "conv_x"),
    AppError,
  );
  assertEquals(err.statusCode, 409);
  assertEquals(err.code, "CONVERSATION_MISMATCH");
});

Deno.test("ensureCallStub: rejects a foreign row found by the unique-violation re-select", async () => {
  const client = fakeCallsClient({
    existing: null,
    insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
    raced: { id: "call-foreign", business_id: "business-b" },
  });

  const err = await assertRejects(
    () => ensureCallStub(client, agent, "conv_x"),
    AppError,
  );
  assertEquals(err.statusCode, 409);
  assertEquals(err.code, "CONVERSATION_MISMATCH");
});

Deno.test("ensureCallStub: returns the existing call row when it belongs to the same business", async () => {
  const client = fakeCallsClient({
    existing: { id: "call-own", business_id: "business-a" },
  });

  assertEquals(await ensureCallStub(client, agent, "conv_x"), { id: "call-own" });
});

Deno.test("ensureCallStub: returns the row it just inserted when there is none yet", async () => {
  const client = fakeCallsClient({ existing: null });

  assertEquals(await ensureCallStub(client, agent, "conv_x"), { id: "call-inserted" });
});
