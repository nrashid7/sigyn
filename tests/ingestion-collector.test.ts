import assert from "node:assert/strict";
import test from "node:test";

import { collectWebsiteFacts } from "../apps/web/lib/ingestion/collector.ts";

test("website collector follows bounded high-value same-origin pages", async () => {
  const pages: Record<string, string> = {
    "https://acme.example/": `<html><head><script type="application/ld+json">{"@type":"LocalBusiness","name":"Acme HVAC","telephone":"+15075550100"}</script></head><body><a href="/services">Services</a><a href="https://other.example/contact">Other</a></body></html>`,
    "https://acme.example/services": `<html><head><script type="application/ld+json">{"@type":"Service","name":"Furnace repair"}</script></head><body><a href="https://instagram.com/acmehvac">Instagram</a></body></html>`,
  };
  const requested: string[] = [];
  const facts = await collectWebsiteFacts({
    website: "https://acme.example",
    resolveHost: async () => ["93.184.216.34"],
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      const body = pages[url];
      return body
        ? new Response(body, { headers: { "content-type": "text/html" } })
        : new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
    },
    pageLimit: 5,
  });

  assert.deepEqual(requested, [
    "https://acme.example/",
    "https://acme.example/robots.txt",
    "https://acme.example/sitemap.xml",
    "https://acme.example/services",
  ]);
  assert.ok(facts.some((fact) => fact.factKey === "name" && fact.value === "Acme HVAC"));
  assert.ok(facts.some((fact) => fact.category === "social" && fact.value === "https://instagram.com/acmehvac"));
});
