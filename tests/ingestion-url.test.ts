import assert from "node:assert/strict";
import test from "node:test";

import { assertSafeSourceUrl, fetchSafeHtml } from "../apps/web/lib/ingestion/safe-url.ts";

test("safe source URL normalization removes fragments and credentials", async () => {
  const result = await assertSafeSourceUrl(
    "https://Example.com/services/#pricing",
    async () => ["93.184.216.34"],
  );

  assert.equal(result, "https://example.com/services/");
});

test("safe source URL validation rejects private and credential-bearing targets", async () => {
  await assert.rejects(
    () => assertSafeSourceUrl("http://127.0.0.1/admin", async () => ["127.0.0.1"]),
    /public internet host/,
  );
  await assert.rejects(
    () => assertSafeSourceUrl("https://user:pass@example.com", async () => ["93.184.216.34"]),
    /credentials/,
  );
  await assert.rejects(
    () => assertSafeSourceUrl("https://example.com", async () => ["10.0.0.8"]),
    /public internet host/,
  );
});

test("safe fetch validates every redirect target before following it", async () => {
  const requested: string[] = [];
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    return new Response(null, { status: 302, headers: { location: "http://10.0.0.8/admin" } });
  };

  await assert.rejects(
    () => fetchSafeHtml(
      "https://example.com",
      async (host) => host === "example.com" ? ["93.184.216.34"] : ["10.0.0.8"],
      fakeFetch,
    ),
    /public internet host/,
  );
  assert.deepEqual(requested, ["https://example.com/"]);
});

test("safe fetch accepts bounded HTML and rejects non-HTML content", async () => {
  const resolver = async () => ["93.184.216.34"];
  const html = await fetchSafeHtml(
    "https://example.com",
    resolver,
    async () => new Response("<h1>Hello</h1>", { headers: { "content-type": "text/html" } }),
  );
  assert.equal(html.body, "<h1>Hello</h1>");

  await assert.rejects(
    () => fetchSafeHtml(
      "https://example.com/file.zip",
      resolver,
      async () => new Response("zip", { headers: { "content-type": "application/zip" } }),
    ),
    /HTML or XML/,
  );
});
