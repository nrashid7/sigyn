import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const scriptUrl = new URL("../scripts/sync-retell-knowledge.mjs", import.meta.url);
const readinessUrl = new URL("../scripts/beta-launch-readiness.mjs", import.meta.url);

test("Retell knowledge backfill is dry-run by default and apply is explicit", () => {
  assert.equal(existsSync(scriptUrl), true, "backfill script must exist");
  const source = readFileSync(scriptUrl, "utf8");
  assert.match(source, /const apply = process\.argv\.includes\(["']--apply["']\)/);
  assert.match(source, /if \(!apply\)[\s\S]*dry_run/s);
  assert.match(source, /operation:\s*["']upload_document["']/);
  assert.match(source, /operation:\s*["']add_url["']/);
  assert.match(source, /operation:\s*["']attach_agents["']/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:SERVICE_ROLE|RETELL_API_KEY|apiKey|serviceKey)/i);
});

test("beta readiness checks the Retell knowledge migration and function", () => {
  const source = readFileSync(readinessUrl, "utf8");
  assert.match(source, /20260808210000_retell_knowledge_sync\.sql/);
  assert.match(source, /retell-knowledge-sync/);
});
