import assert from "node:assert/strict";
import test from "node:test";

import { invokeRetellKnowledgeSync } from "../apps/web/lib/knowledge/retell-sync.ts";

test("knowledge synchronization invokes the service-role Edge Function", async () => {
  let request: { input: string; init: RequestInit } | undefined;
  const result = await invokeRetellKnowledgeSync(
    { operation: "upload_document", document_id: "doc-1" },
    {
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "service-role-jwt",
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        request = { input: String(input), init: init ?? {} };
        return Response.json({ status: "syncing", source_id: "source-1" });
      }) as typeof fetch,
    },
  );

  assert.equal(request?.input, "https://project.supabase.co/functions/v1/retell-knowledge-sync");
  assert.equal((request?.init.headers as Record<string, string>).Authorization, "Bearer service-role-jwt");
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    operation: "upload_document",
    document_id: "doc-1",
  });
  assert.equal(result.status, "syncing");
});

test("knowledge synchronization surfaces bounded provider failures", async () => {
  await assert.rejects(
    () => invokeRetellKnowledgeSync(
      { operation: "delete_document", document_id: "doc-1" },
      {
        supabaseUrl: "https://project.supabase.co",
        serviceRoleKey: "service-role-jwt",
        fetchImpl: (async () => Response.json({ error: "Retell unavailable", internal: "secret" }, { status: 503 })) as typeof fetch,
      },
    ),
    /Retell unavailable/,
  );
});

test("knowledge synchronization requires production server configuration", async () => {
  await assert.rejects(
    () => invokeRetellKnowledgeSync(
      { operation: "upload_document", document_id: "doc-1" },
      { supabaseUrl: "", serviceRoleKey: "" },
    ),
    /not configured/,
  );
});
