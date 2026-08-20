import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../apps/web/lib/ingestion/queue-job.ts", import.meta.url),
  "utf8",
);

test("website queue immediately publishes the normalized source to Retell", () => {
  assert.match(source, /invokeRetellKnowledgeSync\(\{\s*operation:\s*["']add_url["'],\s*source_id:\s*source\.id/s);
  assert.match(source, /retell_status:\s*["']failed["']/);
  assert.match(source, /retell_last_error/);
  assert.match(source, /return\s*\{[\s\S]*source_id:\s*source\.id[\s\S]*retell_status/s);
});
