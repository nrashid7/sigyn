import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const internalFunctions = ["call-analyze", "knowledge-ingest", "knowledge-search", "sync-n8n-workflows", "voice-preview"];

test("internal service-client Edge Functions require a verified service-role JWT", () => {
  for (const name of internalFunctions) {
    const source = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8");
    assert.match(source, /assertServiceRole\(req\)/, `${name} must require service role`);
  }
});
test("internal Edge Functions explicitly retain platform JWT verification", () => {
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  for (const name of internalFunctions) {
    assert.match(config, new RegExp(`\\[functions\\.${name}\\][\\s\\S]*?verify_jwt = true`));
  }
});
