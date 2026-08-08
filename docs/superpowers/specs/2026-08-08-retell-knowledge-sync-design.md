# Retell-Native Knowledge Synchronization Design

**Date:** 2026-08-08
**Status:** Approved for planning

## Objective

Make Retell Knowledge the only knowledge-retrieval path used during Sigyn voice calls. Supabase remains the durable source of truth for each business, while customer files and website URLs are published to one shared Retell knowledge base per business immediately after submission, without a human approval gate.

The feature covers knowledge-base creation and reuse, source upload and deletion, agent attachment, background status reconciliation, retries, tenant isolation, dashboard feedback, and migration of existing agents away from the legacy `search_knowledge` call tool.

## Product Decisions

- A business owns exactly one active Retell knowledge base.
- Every Retell agent belonging to that business uses the same knowledge base.
- Files and URLs are submitted to Retell immediately. “Immediately” means that Sigyn initiates synchronization as part of the upload/import workflow; the content becomes callable when Retell finishes processing it.
- Customer approval is not required before publication to Retell.
- Supabase stores the original source, synchronization state, Retell identifiers, and errors.
- Retell performs retrieval during voice calls. The existing Supabase pgvector pipeline may remain available for future non-voice channels, but Retell agents do not call `search_knowledge`.
- Calendar, booking, qualification, transfer, and other action tools remain independent of knowledge retrieval.
- Existing unrelated in-progress launch work is outside this feature and must be preserved.

## Considered Approaches

### One Retell knowledge base per business — selected

All agents for a tenant share one current knowledge base. This minimizes duplicated sources, Retell billing exposure, synchronization work, and inconsistent answers across agent roles.

### One Retell knowledge base per agent

This isolates agent knowledge but duplicates every source and makes updates, deletes, and costs scale with agent count. Sigyn does not currently need role-specific knowledge isolation, so this approach is rejected.

### Create a new snapshot knowledge base for every deployment

This provides immutable deployment snapshots but produces stale and orphaned Retell resources whenever knowledge changes. Supabase deployment records can retain knowledge metadata without duplicating live Retell knowledge bases, so this approach is rejected.

## Architecture

### Ownership record

Add a tenant-scoped `business_knowledge_bases` table with a unique `business_id`. It stores the active `retell_knowledge_base_id`, Retell processing status, timestamps, and the latest synchronization error. A row can exist before Retell creation completes, allowing concurrent requests to converge on one resource.

Knowledge-base creation is performed only by trusted server code using the Retell API key. The operation acquires or creates the business row first, reuses a recorded Retell ID when present, and records failures for retry. A Retell KB is seeded with a short business-identity text source so agent provisioning can safely attach a KB even when no customer document has been submitted yet.

### Source records

Existing `knowledge_documents` rows remain the source of truth for uploaded files. They gain Retell-specific fields:

- `retell_source_id`
- `retell_status`
- `retell_last_error`
- `retell_synced_at`
- `retell_deleted_at`

Existing `business_sources` rows remain the source of truth for website URLs and gain the same Retell identifier/status fields where they are not already present. Website fact extraction may continue for Sigyn’s administrative workflows, but it neither gates nor replaces Retell URL ingestion.

The allowed Retell statuses are `pending`, `syncing`, `ready`, `failed`, and `deleting`. Local document parsing status remains separate because local pgvector ingestion and Retell processing are independent outcomes.

### Retell client boundary

The shared Retell client gains focused operations for:

- creating or retrieving a business KB;
- adding file, URL, and text sources;
- retrieving KB processing state and sources;
- deleting a single source;
- updating an LLM’s attached `knowledge_base_ids` and retrieval configuration.

Multipart request construction remains inside the Retell client. Business lookup, authorization, storage downloads, and database writes remain in the synchronization service or Edge Function. This keeps provider transport details separate from tenant orchestration.

### Synchronization entry point

A service-role-only `retell-knowledge-sync` Edge Function accepts explicit operations for `upload_document`, `add_url`, `delete_source`, `reconcile`, and `attach_agents`. It derives the business and source from Supabase records instead of trusting caller-provided Retell IDs or storage paths.

Web server actions authenticate the user through Supabase, verify business membership through existing tenant-scoped queries, create the local source record, and invoke the Edge Function with only the local record ID and requested operation.

## Data Flow

### File upload

1. The authenticated server action validates extension, MIME type, non-empty size, and the Sigyn 10 MB product limit.
2. It stores the original file in the private `knowledge` bucket under the business ID.
3. It inserts a `knowledge_documents` row with local processing status `pending` and Retell status `pending`.
4. It invokes local `knowledge-ingest` and Retell `upload_document` synchronization independently. Neither pipeline blocks the other.
5. The Retell synchronization service ensures the business KB exists, downloads the trusted storage object, assigns a provider filename containing the document UUID, and calls Retell’s add-source endpoint.
6. The service records the Retell source identifier when available and sets status to `syncing` until Retell reports the source ready.
7. Reconciliation updates the row to `ready` or `failed`. The dashboard polls while any item is pending, syncing, or deleting.

The HTTP upload response confirms that the source was accepted by Sigyn, not that Retell has finished indexing it. UI copy must state this distinction.

### Website import

1. The authenticated route normalizes and validates an HTTPS URL, rejects private/local network targets, and inserts or reuses a tenant-scoped `business_sources` row.
2. It immediately requests `add_url` synchronization to the business KB with Retell auto-refresh enabled.
3. Existing Sigyn website extraction can run independently and may populate proposed facts, but Retell publication does not wait for review.
4. Duplicate normalized URLs reuse the existing source row and do not create duplicate Retell sources.

### Agent provisioning and migration

Agent provisioning calls the same ensure operation and attaches the returned business KB ID to the new Retell LLM. It must not create a new KB per deployment.

`buildCustomToolsConfig` stops adding `search_knowledge`. It continues returning action tools such as qualification, calendar, booking, and transfer. The legacy search endpoint and pgvector data are not deleted because other product channels may use them later.

An idempotent `attach_agents` operation updates every current Retell LLM for the business to use exactly the active business KB ID with `top_k: 3` and `filter_score: 0.6`. It is used for existing agents and safe retries. Deployment rows record the shared KB ID but do not own it.

### Deletion

1. The user requests deletion of a local source they are authorized to manage.
2. If no Retell source was created, Sigyn deletes the storage object and local row normally.
3. If a Retell source exists, the row enters `deleting` and Retell deletion runs first.
4. After Retell confirms deletion or reports the source already absent, Sigyn deletes the storage object and local row.
5. A transient Retell failure preserves the source row and file, records the error, and exposes Retry. This prevents the UI from claiming removal while the live voice agent can still retrieve the content.

Deleting a business or replacing its active KB is an administrative lifecycle concern. It must not be triggered by deleting the last source.

## Concurrency and Idempotency

- `business_knowledge_bases.business_id` is unique.
- Source upload requests reuse the local source record ID as the idempotency identity.
- The provider filename contains the source UUID so reconciliation can distinguish files with identical user-facing names.
- Status transitions use conditional updates so a stale worker cannot overwrite a later deletion.
- Duplicate URL submissions resolve to one normalized tenant URL record.
- Agent attachment sends the complete intended KB ID list, making retries converge on the same state.
- Reconciliation treats provider “already absent” responses as successful deletion.

## Error Handling and Recovery

Retell errors are translated into stable Sigyn error categories while retaining a sanitized provider message for administrators. Customer-facing messages distinguish configuration errors, unsupported sources, provider rejection, processing failure, and temporary provider unavailability.

No server action silently swallows a Retell invocation failure. A source accepted into Supabase can still return success with `retell_status: failed` when the provider is unavailable, because the original upload is safely retained and retryable. The dashboard displays the failed state and a Retry action.

Knowledge-base creation, source synchronization, deletion, reconciliation, and agent attachment are individually retryable. Retrying a failed source must not create a second business KB or duplicate an already-linked source.

If agent provisioning cannot obtain a reusable business KB, provisioning stops before creating the Retell LLM or agent and records the failure. Sigyn never provisions a live agent with an untracked one-off KB.

## Security and Privacy

- Browser clients never receive `RETELL_API_KEY`, service-role credentials, storage paths belonging to other tenants, or arbitrary Retell resource IDs.
- User-facing mutations authenticate through Supabase and operate through existing business membership rules.
- The Edge Function looks up business ownership and provider IDs server-side.
- Storage downloads use the private tenant path already protected by storage policies.
- Website ingestion retains existing SSRF defenses and accepts public HTTPS targets only.
- Retell error bodies are sanitized before customer display and analytics capture.
- Immediate publication is explicit product behavior. The UI warns customers not to upload secrets or regulated data that the voice agent should not use.

## User Experience

The Knowledge dashboard shows one status for Retell voice availability per source:

- **Publishing** for pending or syncing;
- **Available to calls** for ready;
- **Publish failed** with a concise error and Retry action;
- **Removing** while deletion is in progress.

The page explains that newly uploaded content is sent directly to Retell and may take a short time to index. Upload success does not display “Available to calls” until reconciliation confirms readiness.

Deleting an available source uses a confirmation dialog explaining that callers will lose access. The row remains visible as Removing until Retell confirms deletion.

Website imports show their normalized URL and Retell availability separately from Sigyn’s optional fact-extraction/review status.

## Observability

Business events are captured for KB creation, source submission, source ready, source failure, source deletion, retry, and agent attachment. Events contain local business/source IDs and Retell resource IDs but never file contents, extracted text, API keys, or raw provider error bodies.

Administrative views can inspect the active business KB ID, aggregate source states, last reconciliation time, and sanitized last error. Reconciliation logs include correlation IDs sufficient to trace a local document through Retell without logging its content.

## Testing Strategy

Tests follow red-green-refactor and cover behavior rather than only matching source strings.

### Unit tests

- Retell multipart construction for text, URL, and file sources.
- URL normalization, duplicate detection, and public-HTTPS validation.
- Source-state transitions, including stale-worker protection.
- Custom tool construction proves that action tools remain and `search_knowledge` is absent.
- Provider error classification and sanitization.

### Service tests

- Concurrent ensure calls create or reuse one business KB.
- Upload synchronization uses the trusted storage record and records provider state.
- Duplicate retries do not create a second KB or source.
- Deletion preserves local content on provider failure and completes after retry.
- Reconciliation maps Retell sources to local rows and marks ready/failed correctly.
- Agent attachment updates all and only the business’s Retell LLMs.

### Integration and regression tests

- A document uploaded before agent creation is attached through the shared KB when the agent is provisioned.
- A document uploaded after agent creation becomes available without recreating the agent.
- Two businesses cannot read, modify, attach, or delete each other’s sources or KB IDs.
- Existing Retell integration checks, build, lint, type checking, beta-launch readiness, and Supabase database tests remain green.
- A Retell catalog or sandbox smoke test verifies one approved question and one unknown question without fabricating an answer.

## Rollout

1. Apply additive database changes and deploy the synchronization code while the legacy custom knowledge tool still exists in code.
2. Create or reuse one business KB and synchronize existing sources.
3. Attach the shared KB to existing Retell LLMs.
4. Verify source readiness and run Retell knowledge/unknown-answer tests.
5. Stop including `search_knowledge` in all new and existing live Retell LLM configurations.
6. Monitor failures and retry queues. Keep the legacy pgvector endpoint available but outside the voice path.

Rollback restores `search_knowledge` to Retell tool configurations while leaving the shared Retell KB records intact. Additive database fields and Retell sources do not need destructive rollback.

## Acceptance Criteria

- Uploading a supported customer file creates or reuses exactly one business Retell KB and starts publication without approval.
- Adding a valid public website URL starts Retell publication without approval and does not duplicate an existing normalized URL.
- Every Retell LLM for the business references the same active KB ID.
- No live Retell configuration includes the `search_knowledge` custom tool.
- The dashboard accurately distinguishes publishing, ready, failed, and deleting states and supports retry.
- Retell deletion is confirmed before Sigyn removes the corresponding local source.
- Provider outages retain customer data and produce retryable, visible failures.
- Tenant isolation prevents cross-business knowledge operations.
- Automated tests, type checking, linting, production build, database tests, and beta-launch verification pass.
