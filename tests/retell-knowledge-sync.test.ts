import assert from "node:assert/strict";
import test from "node:test";

import {
  handleRetellKnowledgeOperation,
  type KnowledgeDocumentRecord,
  type KnowledgeRepository,
  type RetellKnowledgeProvider,
} from "../supabase/functions/_shared/retell-knowledge.ts";

function fixture() {
  const documents = new Map<string, KnowledgeDocumentRecord>([["doc-1", {
    id: "doc-1",
    business_id: "business-1",
    business_name: "Acme Services",
    filename: "menu.pdf",
    file_type: "application/pdf",
    storage_path: "business-1/menu.pdf",
    retell_source_id: null,
    retell_status: "pending",
  }]]);
  let knowledgeBaseId: string | null = null;
  let knowledgeStatus = "pending";
  let claimed = false;
  const agents = [
    { business_id: "business-1", retell_llm_id: "llm-1" },
    { business_id: "business-1", retell_llm_id: "llm-2" },
  ];
  const providerCalls = {
    creates: 0,
    uploads: 0,
    deletes: [] as string[],
    updates: [] as string[],
  };

  const repository: KnowledgeRepository = {
    async getDocument(id) { return documents.get(id) ?? null; },
    async getUrlSource() { return null; },
    async getOrCreateKnowledgeBase(businessId, businessName) {
      return { business_id: businessId, business_name: businessName, retell_knowledge_base_id: knowledgeBaseId, status: knowledgeStatus };
    },
    async claimKnowledgeBaseCreation() {
      if (claimed || knowledgeBaseId) return false;
      claimed = true;
      knowledgeStatus = "syncing";
      return true;
    },
    async completeKnowledgeBaseCreation(_businessId, id) {
      knowledgeBaseId = id;
      knowledgeStatus = "syncing";
    },
    async failKnowledgeBaseCreation() { knowledgeStatus = "failed"; claimed = false; },
    async claimDocument(id) {
      const document = documents.get(id);
      if (!document || !["pending", "failed"].includes(document.retell_status)) return false;
      document.retell_status = "syncing";
      return true;
    },
    async updateDocument(id, patch) { Object.assign(documents.get(id)!, patch); },
    async claimUrlSource() { return false; },
    async updateUrlSource() {},
    async listBusinessSources() { return [...documents.values()]; },
    async listBusinessAgents(businessId) { return agents.filter((agent) => agent.business_id === businessId); },
  };
  const provider: RetellKnowledgeProvider = {
    async createKnowledgeBase() {
      providerCalls.creates += 1;
      return { knowledge_base_id: "kb-1", status: "in_progress", knowledge_base_sources: [] };
    },
    async addSources(_kb, sources) {
      providerCalls.uploads += 1;
      return {
        knowledge_base_id: "kb-1",
        status: "in_progress",
        knowledge_base_sources: [{
          type: "document",
          source_id: "source-1",
          filename: sources.files?.[0].filename,
        }],
      };
    },
    async getKnowledgeBase() {
      return {
        knowledge_base_id: "kb-1",
        status: "complete",
        knowledge_base_sources: [{ type: "document", source_id: "source-1", filename: "doc-1--menu.pdf" }],
      };
    },
    async deleteSource(_kb, sourceId) { providerCalls.deletes.push(sourceId); },
    async updateLlm(llmId) { providerCalls.updates.push(llmId); },
  };

  return {
    documents,
    repository,
    provider,
    providerCalls,
    storage: { async download() { return new Uint8Array([1, 2, 3]); } },
  };
}

test("document synchronization creates one business KB and is retry idempotent", async () => {
  const deps = fixture();
  await handleRetellKnowledgeOperation({ operation: "upload_document", document_id: "doc-1" }, deps);
  await handleRetellKnowledgeOperation({ operation: "upload_document", document_id: "doc-1" }, deps);

  assert.equal(deps.providerCalls.creates, 1);
  assert.equal(deps.providerCalls.uploads, 1);
  assert.equal(deps.documents.get("doc-1")?.retell_source_id, "source-1");
  assert.equal(deps.documents.get("doc-1")?.retell_status, "syncing");
});

test("reconciliation marks a provider-indexed document ready", async () => {
  const deps = fixture();
  await handleRetellKnowledgeOperation({ operation: "upload_document", document_id: "doc-1" }, deps);
  await handleRetellKnowledgeOperation({ operation: "reconcile", business_id: "business-1", business_name: "Acme Services" }, deps);

  assert.equal(deps.documents.get("doc-1")?.retell_status, "ready");
});

test("deletion calls Retell before confirming local cleanup", async () => {
  const deps = fixture();
  const document = deps.documents.get("doc-1")!;
  document.retell_source_id = "source-1";
  document.retell_status = "ready";

  const result = await handleRetellKnowledgeOperation({ operation: "delete_document", document_id: "doc-1" }, deps);

  assert.deepEqual(deps.providerCalls.deletes, ["source-1"]);
  assert.equal(deps.documents.get("doc-1")?.retell_status, "deleting");
  assert.equal(result.deleted, true);
});

test("deletion reconciles a missing provider source ID before confirming cleanup", async () => {
  const deps = fixture();
  const document = deps.documents.get("doc-1")!;
  document.retell_source_id = null;
  document.retell_status = "syncing";

  const result = await handleRetellKnowledgeOperation({ operation: "delete_document", document_id: "doc-1" }, deps);

  assert.deepEqual(deps.providerCalls.deletes, ["source-1"]);
  assert.equal(result.deleted, true);
});

test("agent attachment updates only LLMs returned for the business", async () => {
  const deps = fixture();
  await handleRetellKnowledgeOperation({ operation: "attach_agents", business_id: "business-1", business_name: "Acme Services" }, deps);
  assert.deepEqual(deps.providerCalls.updates, ["llm-1", "llm-2"]);
  assert.equal(deps.providerCalls.creates, 1);
});

test("ensure returns the reusable business knowledge base without attaching agents", async () => {
  const deps = fixture();
  const first = await handleRetellKnowledgeOperation({ operation: "ensure", business_id: "business-1", business_name: "Acme Services" }, deps);
  const second = await handleRetellKnowledgeOperation({ operation: "ensure", business_id: "business-1", business_name: "Acme Services" }, deps);
  assert.equal(first.knowledge_base_id, "kb-1");
  assert.equal(second.knowledge_base_id, "kb-1");
  assert.equal(deps.providerCalls.creates, 1);
  assert.deepEqual(deps.providerCalls.updates, []);
});
