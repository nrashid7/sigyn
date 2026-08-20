import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260808210000_retell_knowledge_sync.sql",
  import.meta.url,
);

test("Retell knowledge schema owns one provider KB per business", () => {
  assert.equal(existsSync(migrationUrl), true, "Retell knowledge migration must exist");
  const sql = readFileSync(migrationUrl, "utf8");

  assert.match(sql, /CREATE TYPE retell_sync_status AS ENUM[\s\S]*?'pending'[\s\S]*?'syncing'[\s\S]*?'ready'[\s\S]*?'failed'[\s\S]*?'deleting'/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.business_knowledge_bases/i);
  assert.match(sql, /business_id uuid NOT NULL UNIQUE REFERENCES public\.businesses\(id\) ON DELETE CASCADE/i);
  assert.match(sql, /ALTER TABLE public\.business_knowledge_bases ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /CREATE POLICY business_knowledge_bases_tenant_select[\s\S]*?FOR SELECT TO authenticated[\s\S]*?is_business_member\(business_id\)/i);
});

test("Retell provider state is service managed on documents and URLs", () => {
  assert.equal(existsSync(migrationUrl), true, "Retell knowledge migration must exist");
  const sql = readFileSync(migrationUrl, "utf8");

  for (const table of ["knowledge_documents", "business_sources"]) {
    const alteration = new RegExp(
      `ALTER TABLE public\\.${table}[\\s\\S]*?retell_source_id text[\\s\\S]*?retell_status retell_sync_status[\\s\\S]*?retell_last_error text[\\s\\S]*?retell_synced_at timestamptz[\\s\\S]*?retell_deleted_at timestamptz`,
      "i",
    );
    assert.match(sql, alteration);
  }

  assert.match(sql, /REVOKE ALL ON public\.business_knowledge_bases FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT ALL ON public\.business_knowledge_bases TO service_role/i);
  assert.doesNotMatch(sql, /GRANT UPDATE \([^)]*retell_(?:source_id|status|last_error|synced_at|deleted_at)/i);
});
