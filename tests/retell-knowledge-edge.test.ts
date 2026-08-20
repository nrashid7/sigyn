import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const functionUrl = new URL("../supabase/functions/retell-knowledge-sync/index.ts", import.meta.url);
const configUrl = new URL("../supabase/config.toml", import.meta.url);

test("Retell knowledge synchronization requires a service-role JWT", () => {
  assert.equal(existsSync(functionUrl), true, "sync Edge Function must exist");
  const source = readFileSync(functionUrl, "utf8");
  const config = readFileSync(configUrl, "utf8");

  assert.match(config, /\[functions\.retell-knowledge-sync\]\s+verify_jwt\s*=\s*true/i);
  assert.match(source, /assertServiceRole/i);
  assert.match(source, /payload\.role\s*!==\s*["']service_role["']/i);
  assert.match(source, /new AppError\(["']Service-role authorization is required["'],\s*401/);
  assert.doesNotMatch(source, /body\.(?:business_id|storage_path|retell_knowledge_base_id|retell_source_id)/i);
});
