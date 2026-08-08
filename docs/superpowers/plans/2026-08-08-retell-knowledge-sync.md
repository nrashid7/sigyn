# Retell-Native Knowledge Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish each business’s files and website URLs immediately to one shared Retell knowledge base, attach it to every Retell voice agent, and provide production-grade status, retry, deletion, security, and verification behavior.

**Architecture:** Supabase remains the source of truth. A tenant-scoped ownership table maps each business to one Retell KB, while existing document and website-source rows track provider source IDs and synchronization state. A service-role Edge Function orchestrates Retell operations; authenticated Next.js actions create local records and invoke that function. Native Retell retrieval replaces the legacy knowledge custom tool for calls.

**Tech Stack:** Next.js 15, TypeScript, Supabase Postgres/RLS/Storage/Edge Functions, Retell REST API, Node test runner, pgTAP.

## Global Constraints

- Customer files and valid public website URLs publish without a human approval gate.
- One active Retell knowledge base exists per business and is shared by all its agents.
- Supabase retains originals and synchronization history; provider failure must never discard customer data.
- Live Retell agents use native Retell Knowledge and never include `search_knowledge`.
- Existing calendar, booking, qualification, transfer, and end-call tools remain intact.
- Existing unrelated uncommitted launch work must be preserved.
- New production behavior is implemented test-first.

---

### Task 1: Add tenant-safe Retell knowledge persistence

**Files:**
- Create: `supabase/migrations/20260808210000_retell_knowledge_sync.sql`
- Create: `supabase/tests/retell_knowledge_sync.sql`
- Test: `tests/retell-knowledge-schema.test.ts`

**Interfaces:**
- Produces: `business_knowledge_bases`, `retell_sync_status`, and Retell synchronization columns on `knowledge_documents` and `business_sources`.
- Consumes: existing `businesses`, `knowledge_documents`, `business_sources`, `is_business_member`, and `is_admin` database objects.

- [ ] **Step 1: Write failing schema tests**

Create a Node schema test that reads the migration and asserts a unique business ownership record, RLS, tenant policies, source status fields, and service-role-only mutation grants. Add pgTAP assertions that a tenant can select only its own KB/source state and cannot set provider IDs directly.

```ts
test("Retell knowledge schema owns one provider KB per business", () => {
  assert.match(sql, /business_id uuid[^;]+UNIQUE/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /retell_source_id text/i);
  assert.match(sql, /retell_status retell_sync_status/i);
});
```

- [ ] **Step 2: Run tests and confirm the migration is missing**

Run: `npm test -- tests/retell-knowledge-schema.test.ts`

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Add the additive migration**

Define `retell_sync_status` as `pending`, `syncing`, `ready`, `failed`, and `deleting`. Create `business_knowledge_bases` with a unique `business_id`, provider ID, status, last error, sync timestamps, RLS, tenant read access, and service-role mutation. Add provider columns to both source tables, a partial uniqueness constraint for non-null source IDs within a KB, indexes for reconciliation, and column-level grants that prevent authenticated users from writing provider state.

- [ ] **Step 4: Run schema tests**

Run: `npm test -- tests/retell-knowledge-schema.test.ts`

Expected: PASS.

---

### Task 2: Build a testable Retell Knowledge API client

**Files:**
- Modify: `supabase/functions/_shared/retell.ts`
- Create: `tests/retell-knowledge-client.test.ts`

**Interfaces:**
- Produces: `createRetellKnowledgeBase`, `getRetellKnowledgeBase`, `addRetellKnowledgeSources`, `deleteRetellKnowledgeSource`, and existing `updateRetellLlm`.
- Consumes: injected `fetch` in exported pure request helpers; production wrappers use `RETELL_API_KEY`.

- [ ] **Step 1: Write failing client tests**

Assert exact endpoint, method, authentication behavior, multipart fields, unique provider filename, URL payload, 204 handling, and sanitized error classification using a recording fetch implementation.

```ts
const result = await addRetellKnowledgeSources("kb_1", {
  files: [{ filename: "doc-id--menu.pdf", type: "application/pdf", bytes }],
  urls: ["https://example.com/services"],
}, fakeFetch, "test-key");
assert.equal(request.url, "https://api.retellai.com/add-knowledge-base-sources/kb_1");
```

- [ ] **Step 2: Run and verify missing exports**

Run: `npm test -- tests/retell-knowledge-client.test.ts`

Expected: FAIL because the source operations are not implemented.

- [ ] **Step 3: Implement minimal provider operations**

Keep JSON and multipart construction inside the shared client. Allow a fetch/API-key dependency in tests without weakening production secret lookup. Return typed KB/source representations. Treat an empty 204 response as success. Translate provider bodies to `AppError` without exposing authorization headers or raw secrets.

- [ ] **Step 4: Run client and existing Retell tests**

Run: `npm test -- tests/retell-knowledge-client.test.ts tests/retell-tools.test.ts`

Expected: PASS.

---

### Task 3: Implement idempotent synchronization orchestration

**Files:**
- Create: `supabase/functions/_shared/retell-knowledge.ts`
- Create: `supabase/functions/retell-knowledge-sync/index.ts`
- Modify: `supabase/config.toml`
- Create: `tests/retell-knowledge-sync.test.ts`

**Interfaces:**
- Consumes: local record IDs and operation names `upload_document`, `add_url`, `delete_document`, `delete_url`, `reconcile`, `attach_agents`.
- Produces: `handleRetellKnowledgeOperation(request, dependencies)` for unit tests and a service-role-authenticated Edge Function adapter.

- [ ] **Step 1: Write failing orchestration tests**

Cover one-KB reuse, source retry without duplicate creation, trusted storage lookup, safe URL lookup, conditional state changes, deletion ordering, already-absent deletion, reconciliation, and tenant-bounded LLM attachment. Use an in-memory repository dependency rather than mocking Supabase query chains.

```ts
await handleRetellKnowledgeOperation({ operation: "upload_document", document_id: "doc-1" }, deps);
assert.equal(deps.provider.createdKnowledgeBases.length, 1);
assert.equal(repo.document("doc-1").retell_status, "syncing");
```

- [ ] **Step 2: Run and verify missing orchestration module**

Run: `npm test -- tests/retell-knowledge-sync.test.ts`

Expected: FAIL because the orchestrator does not exist.

- [ ] **Step 3: Implement the domain orchestrator**

Use narrow repository, provider, and storage interfaces. Ensure the KB before any source or attachment operation. Seed creation with business identity and a strict unknown-information instruction. Prefix provider file names with the document UUID. Never accept business, storage, KB, or Retell source IDs from an untrusted request.

- [ ] **Step 4: Implement the Edge Function adapter**

Require a valid service-role JWT through Supabase gateway verification, parse the operation/local ID union, instantiate the service client, and adapt repository calls to conditional Supabase updates. Register the function with `verify_jwt = true`.

- [ ] **Step 5: Run orchestrator tests**

Run: `npm test -- tests/retell-knowledge-sync.test.ts`

Expected: PASS.

---

### Task 4: Connect document upload, retry, reconciliation, and deletion

**Files:**
- Modify: `apps/web/lib/actions/knowledge.ts`
- Create: `apps/web/lib/knowledge/retell-sync.ts`
- Create: `tests/knowledge-actions.test.ts`

**Interfaces:**
- Produces: `invokeRetellKnowledgeSync`, `retryKnowledgeDocument`, `reconcileBusinessKnowledge`, and deletion results that distinguish accepted/removing/failed.
- Consumes: existing authenticated `getBusiness`, Supabase client, service-role function invocation, and private storage bucket.

- [ ] **Step 1: Write failing action-helper tests**

Test request payloads, no swallowed invocation failure, retained local data on provider failure, storage cleanup after confirmed deletion, and business-scoped document selection.

- [ ] **Step 2: Run and verify failures**

Run: `npm test -- tests/knowledge-actions.test.ts`

Expected: FAIL because the helper and retry behavior do not exist.

- [ ] **Step 3: Implement the service invocation helper and actions**

After local insert, invoke local ingestion and Retell upload independently and return the resulting provider status. Retry changes only failed sources. Delete invokes Retell first and removes storage/local rows only after confirmation. Reconciliation is business-scoped and callable by the dashboard. Remove every `.catch(() => null)` from knowledge synchronization.

- [ ] **Step 4: Run action tests**

Run: `npm test -- tests/knowledge-actions.test.ts`

Expected: PASS.

---

### Task 5: Publish website URLs immediately

**Files:**
- Modify: `apps/web/lib/ingestion/queue-job.ts`
- Modify: `apps/web/app/api/ingestion/route.ts`
- Modify: `tests/ingestion-url.test.ts`
- Modify: `tests/ingestion-persistence.test.ts`

**Interfaces:**
- Produces: normalized URL source rows with immediate Retell synchronization alongside the existing extraction job.
- Consumes: `assertSafeSourceUrl`, `invokeRetellKnowledgeSync`, and `business_sources`.

- [ ] **Step 1: Add failing immediate-publication tests**

Assert HTTPS normalization, private-target rejection, duplicate source reuse, one Retell invocation for a new URL, retry for a failed URL, and independence between Retell publication and fact extraction.

- [ ] **Step 2: Run the focused ingestion tests**

Run: `npm test -- tests/ingestion-url.test.ts tests/ingestion-persistence.test.ts`

Expected: FAIL because queueing does not invoke Retell.

- [ ] **Step 3: Add Retell URL publication**

Return `source_id` from queueing, trigger `add_url` immediately after the safe normalized row exists, and keep `processIngestionJob` in the existing background `after` callback. A Retell failure records failed status but does not cancel the extraction job.

- [ ] **Step 4: Run ingestion tests**

Run: `npm test -- tests/ingestion-url.test.ts tests/ingestion-persistence.test.ts`

Expected: PASS.

---

### Task 6: Make agent provisioning reuse and attach the business KB

**Files:**
- Modify: `supabase/functions/retell-create-agent/index.ts`
- Modify: `supabase/functions/_shared/retell-tools.ts`
- Modify: `scripts/retell-integration.test.mjs`
- Modify: `tests/retell-tools.test.ts`
- Create: `tests/retell-agent-knowledge.test.ts`

**Interfaces:**
- Consumes: `ensureBusinessKnowledgeBase` and existing action-tool builder.
- Produces: new and existing business LLMs attached to the same KB with `{ top_k: 3, filter_score: 0.6 }`.

- [ ] **Step 1: Write failing provisioning tests**

Assert that provisioning does not call `createRetellKnowledgeBase` directly, reuses the business ownership record, attaches the shared ID, records it on agent/deployment, and never includes `search_knowledge`.

- [ ] **Step 2: Run focused tests**

Run: `npm test -- tests/retell-agent-knowledge.test.ts tests/retell-tools.test.ts`

Expected: FAIL while provisioning creates a snapshot KB.

- [ ] **Step 3: Replace snapshot creation with ensure/reuse**

Remove the approved-facts provisioning gate and one-off snapshot construction. Keep billing and lifecycle gates. Obtain the business KB through the shared orchestration service and attach it to the LLM. Record the shared ID and a compact source-state snapshot in the deployment row.

- [ ] **Step 4: Run all Retell tests**

Run: `npm test -- tests/retell-agent-knowledge.test.ts tests/retell-tools.test.ts && node --test scripts/retell-integration.test.mjs`

Expected: PASS.

---

### Task 7: Expose accurate production states and recovery controls

**Files:**
- Modify: `apps/web/app/(dashboard)/dashboard/knowledge/page.tsx`
- Modify: `apps/web/app/(dashboard)/onboarding/knowledge/page.tsx`
- Modify: `apps/web/lib/actions/knowledge.ts`
- Modify: `packages/shared/src/types/index.ts`
- Create: `tests/knowledge-presentation.test.ts`

**Interfaces:**
- Consumes: document/source Retell status, retry/delete/reconcile actions.
- Produces: Publishing, Available to calls, Publish failed, and Removing states with errors and Retry.

- [ ] **Step 1: Write failing presentation tests**

Extract a pure status presentation helper and test all provider states, including failed status with a retry affordance and distinct local chunking state.

- [ ] **Step 2: Run and verify missing status helper**

Run: `npm test -- tests/knowledge-presentation.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement dashboard and onboarding behavior**

Poll while sources are nonterminal, show customer-safe errors, confirm deletion, keep removing rows visible, and state that uploads go directly to the live-call KB after Retell indexing. Align accepted file types between validation, input copy, and onboarding.

- [ ] **Step 4: Run presentation tests and web checks**

Run: `npm test -- tests/knowledge-presentation.test.ts && npm run typecheck`

Expected: PASS.

---

### Task 8: Add reconciliation/backfill operations and production documentation

**Files:**
- Create: `scripts/sync-retell-knowledge.mjs`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/SMOKE_TEST.md`
- Modify: `scripts/beta-launch-readiness.mjs`
- Create: `tests/retell-knowledge-operations.test.ts`

**Interfaces:**
- Produces: dry-run-by-default backfill reporting, explicit `--apply`, business filter, and non-secret operational output.
- Consumes: Supabase service credentials and Retell API credentials from environment.

- [ ] **Step 1: Write failing operational tests**

Assert dry-run default, explicit apply guard, no secret printing, source/agent counts, and beta readiness checks for migration/function registration.

- [ ] **Step 2: Run and verify missing script/checks**

Run: `npm test -- tests/retell-knowledge-operations.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement backfill and documentation**

The script discovers businesses, ensures/reconciles their KBs, syncs unsynchronized sources, and attaches agents only with `--apply`. Document migration, Edge Function deployment, first sync, smoke test, rollback, and monitoring events.

- [ ] **Step 4: Run operational tests**

Run: `npm test -- tests/retell-knowledge-operations.test.ts`

Expected: PASS.

---

### Task 9: Full verification and cleanup

**Files:**
- Modify only files required to fix failures introduced by Tasks 1–8.

**Interfaces:**
- Produces: verified production-ready implementation with no unintended file changes.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests pass with no warnings caused by this feature.

- [ ] **Step 2: Run static and production checks**

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run verify:beta-launch`

Expected: all commands succeed.

- [ ] **Step 3: Run database tests when the local Supabase runtime is available**

Run: `supabase test db`

Expected: tenant isolation and Retell knowledge pgTAP suites pass. If Docker/local Supabase is unavailable, report that environmental limitation explicitly and retain the static schema tests.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check`

Run: `git status --short`

Confirm the implementation preserves pre-existing unrelated edits, contains no credentials, and matches every acceptance criterion in the approved design.
