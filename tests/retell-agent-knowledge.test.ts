import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../supabase/functions/retell-create-agent/index.ts", import.meta.url),
  "utf8",
);

test("agent provisioning reuses the shared business Retell knowledge base", () => {
  assert.doesNotMatch(source, /createRetellKnowledgeBase/);
  assert.doesNotMatch(source, /FACT_REVIEW_REQUIRED|Approve business facts before provisioning/);
  assert.match(source, /operation:\s*["']ensure["']/);
  assert.match(source, /local_agent_id/);
  assert.match(source, /knowledge_base_ids:\s*\[knowledgeBaseId\]/);
  assert.match(source, /retell_knowledge_base_id:\s*knowledgeBaseId/);
});
