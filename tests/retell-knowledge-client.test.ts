import assert from "node:assert/strict";
import test from "node:test";

import {
  addRetellKnowledgeSources,
  deleteRetellKnowledgeSource,
  getRetellKnowledgeBase,
} from "../supabase/functions/_shared/retell-knowledge-client.ts";

type RecordedRequest = { url: string; init: RequestInit };

function recordingFetch(
  response: Response,
  requests: RecordedRequest[],
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    return response;
  }) as typeof fetch;
}

test("Retell source upload uses the documented multipart endpoint", async () => {
  const requests: RecordedRequest[] = [];
  const payload = {
    knowledge_base_id: "kb_1",
    knowledge_base_name: "Acme",
    status: "in_progress",
    knowledge_base_sources: [{
      type: "document",
      source_id: "source_1",
      filename: "doc-1--menu.pdf",
    }],
  };

  const result = await addRetellKnowledgeSources("kb_1", {
    files: [{
      filename: "doc-1--menu.pdf",
      type: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
    }],
    urls: ["https://example.com/services"],
  }, {
    apiKey: "test-key",
    fetchImpl: recordingFetch(Response.json(payload, { status: 201 }), requests),
  });

  assert.equal(result.knowledge_base_id, "kb_1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.retellai.com/add-knowledge-base-sources/kb_1");
  assert.equal(requests[0].init.method, "POST");
  assert.equal((requests[0].init.headers as Record<string, string>).Authorization, "Bearer test-key");
  assert.equal("Content-Type" in (requests[0].init.headers as Record<string, string>), false);

  const form = requests[0].init.body as FormData;
  assert.equal(form.get("knowledge_base_urls"), '["https://example.com/services"]');
  const file = form.get("knowledge_base_files") as File;
  assert.equal(file.name, "doc-1--menu.pdf");
  assert.equal(file.type, "application/pdf");
});

test("Retell knowledge retrieval and source deletion use provider resource paths", async () => {
  const getRequests: RecordedRequest[] = [];
  const knowledge = await getRetellKnowledgeBase("kb_1", {
    apiKey: "test-key",
    fetchImpl: recordingFetch(Response.json({
      knowledge_base_id: "kb_1",
      knowledge_base_name: "Acme",
      status: "complete",
      knowledge_base_sources: [],
    }), getRequests),
  });
  assert.equal(knowledge.status, "complete");
  assert.equal(getRequests[0].url, "https://api.retellai.com/get-knowledge-base/kb_1");
  assert.equal(getRequests[0].init.method, "GET");

  const deleteRequests: RecordedRequest[] = [];
  await deleteRetellKnowledgeSource("kb_1", "source_1", {
    apiKey: "test-key",
    fetchImpl: recordingFetch(new Response(null, { status: 204 }), deleteRequests),
  });
  assert.equal(
    deleteRequests[0].url,
    "https://api.retellai.com/delete-knowledge-base-source/kb_1/source/source_1",
  );
  assert.equal(deleteRequests[0].init.method, "DELETE");
});

test("Retell API errors are bounded and never include credentials", async () => {
  const secret = "retell-secret-value";
  const providerBody = `provider rejected token ${secret} ${"x".repeat(2_000)}`;

  await assert.rejects(
    () => getRetellKnowledgeBase("kb_1", {
      apiKey: secret,
      fetchImpl: recordingFetch(new Response(providerBody, { status: 429 }), []),
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(secret), false);
      assert.ok(error.message.length < 700);
      assert.match(error.message, /temporarily unavailable|rate limit/i);
      return true;
    },
  );
});
