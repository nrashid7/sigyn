export type RetellSyncStatus = "pending" | "syncing" | "ready" | "failed" | "deleting";

export interface KnowledgeBaseRecord {
  business_id: string;
  business_name: string;
  retell_knowledge_base_id: string | null;
  status: string;
}

export interface KnowledgeDocumentRecord {
  id: string;
  business_id: string;
  business_name: string;
  filename: string;
  file_type: string;
  storage_path: string;
  retell_source_id: string | null;
  retell_status: RetellSyncStatus;
}

export interface KnowledgeUrlSourceRecord {
  id: string;
  business_id: string;
  business_name: string;
  url: string;
  retell_source_id: string | null;
  retell_status: RetellSyncStatus;
}

export interface ProviderKnowledgeSource {
  type: "document" | "url" | "text";
  source_id: string;
  filename?: string;
  url?: string;
}

export interface ProviderKnowledgeBase {
  knowledge_base_id: string;
  status: string;
  knowledge_base_sources?: ProviderKnowledgeSource[];
}

export interface KnowledgeRepository {
  getDocument(id: string): Promise<KnowledgeDocumentRecord | null>;
  getUrlSource(id: string): Promise<KnowledgeUrlSourceRecord | null>;
  getOrCreateKnowledgeBase(businessId: string, businessName: string): Promise<KnowledgeBaseRecord>;
  claimKnowledgeBaseCreation(businessId: string): Promise<boolean>;
  completeKnowledgeBaseCreation(businessId: string, knowledgeBaseId: string): Promise<void>;
  failKnowledgeBaseCreation(businessId: string, message: string): Promise<void>;
  claimDocument(id: string): Promise<boolean>;
  updateDocument(id: string, patch: Partial<Pick<KnowledgeDocumentRecord, "retell_source_id" | "retell_status">> & {
    retell_last_error?: string | null;
    retell_synced_at?: string | null;
    retell_deleted_at?: string | null;
  }): Promise<void>;
  claimUrlSource(id: string): Promise<boolean>;
  updateUrlSource(id: string, patch: Partial<Pick<KnowledgeUrlSourceRecord, "retell_source_id" | "retell_status">> & {
    retell_last_error?: string | null;
    retell_synced_at?: string | null;
    retell_deleted_at?: string | null;
  }): Promise<void>;
  listBusinessSources(businessId: string): Promise<Array<KnowledgeDocumentRecord | KnowledgeUrlSourceRecord>>;
  listBusinessAgents(businessId: string): Promise<Array<{ business_id: string; retell_llm_id: string }>>;
}

export interface RetellKnowledgeProvider {
  createKnowledgeBase(config: { name: string; markdown: string }): Promise<ProviderKnowledgeBase>;
  addSources(knowledgeBaseId: string, sources: {
    files?: Array<{ filename: string; type: string; bytes: Uint8Array }>;
    urls?: string[];
  }): Promise<ProviderKnowledgeBase>;
  getKnowledgeBase(knowledgeBaseId: string): Promise<ProviderKnowledgeBase>;
  deleteSource(knowledgeBaseId: string, sourceId: string): Promise<void>;
  updateLlm(llmId: string, config: {
    knowledge_base_ids: string[];
    kb_config: { top_k: number; filter_score: number };
  }): Promise<unknown>;
}

export interface KnowledgeStorage {
  download(path: string): Promise<Uint8Array>;
}

export interface RetellKnowledgeDependencies {
  repository: KnowledgeRepository;
  provider: RetellKnowledgeProvider;
  storage: KnowledgeStorage;
  now?: () => string;
}

export type RetellKnowledgeOperation =
  | { operation: "upload_document" | "delete_document"; document_id: string }
  | { operation: "add_url" | "delete_url"; source_id: string }
  | { operation: "ensure" | "reconcile" | "attach_agents"; business_id: string; business_name: string };

function message(error: unknown): string {
  const value = error instanceof Error ? error.message : "Retell synchronization failed";
  return value.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500);
}

function providerFilename(document: KnowledgeDocumentRecord): string {
  const safe = document.filename.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120);
  return `${document.id}--${safe}`;
}

async function ensureKnowledgeBase(
  businessId: string,
  businessName: string,
  dependencies: RetellKnowledgeDependencies,
): Promise<string> {
  const { repository, provider } = dependencies;
  const current = await repository.getOrCreateKnowledgeBase(businessId, businessName);
  if (current.retell_knowledge_base_id) return current.retell_knowledge_base_id;

  const claimed = await repository.claimKnowledgeBaseCreation(businessId);
  if (!claimed) {
    const reread = await repository.getOrCreateKnowledgeBase(businessId, businessName);
    if (reread.retell_knowledge_base_id) return reread.retell_knowledge_base_id;
    throw new Error("Retell knowledge base creation is already in progress");
  }

  try {
    const created = await provider.createKnowledgeBase({
      name: `${businessName} knowledge`.slice(0, 39),
      markdown: `# ${businessName}\n\nUse uploaded business sources for factual answers. If the sources do not contain an answer, say you do not know and offer human follow-up.`,
    });
    await repository.completeKnowledgeBaseCreation(businessId, created.knowledge_base_id);
    return created.knowledge_base_id;
  } catch (error) {
    await repository.failKnowledgeBaseCreation(businessId, message(error));
    throw error;
  }
}

async function uploadDocument(
  documentId: string,
  dependencies: RetellKnowledgeDependencies,
) {
  const { repository, provider, storage } = dependencies;
  const document = await repository.getDocument(documentId);
  if (!document) throw new Error("Knowledge document not found");
  if (document.retell_source_id && ["syncing", "ready"].includes(document.retell_status)) {
    return { status: document.retell_status, source_id: document.retell_source_id };
  }
  if (!await repository.claimDocument(document.id)) {
    return { status: document.retell_status, source_id: document.retell_source_id };
  }

  try {
    const knowledgeBaseId = await ensureKnowledgeBase(document.business_id, document.business_name, dependencies);
    const filename = providerFilename(document);
    const bytes = await storage.download(document.storage_path);
    const knowledge = await provider.addSources(knowledgeBaseId, {
      files: [{ filename, type: document.file_type, bytes }],
    });
    const source = knowledge.knowledge_base_sources?.find((item) =>
      item.type === "document" && item.filename === filename
    );
    await repository.updateDocument(document.id, {
      retell_source_id: source?.source_id ?? null,
      retell_status: "syncing",
      retell_last_error: null,
    });
    return { status: "syncing", source_id: source?.source_id ?? null, knowledge_base_id: knowledgeBaseId };
  } catch (error) {
    await repository.updateDocument(document.id, {
      retell_status: "failed",
      retell_last_error: message(error),
    });
    throw error;
  }
}

async function addUrl(sourceId: string, dependencies: RetellKnowledgeDependencies) {
  const { repository, provider } = dependencies;
  const sourceRecord = await repository.getUrlSource(sourceId);
  if (!sourceRecord) throw new Error("Website source not found");
  if (sourceRecord.retell_source_id && ["syncing", "ready"].includes(sourceRecord.retell_status)) {
    return { status: sourceRecord.retell_status, source_id: sourceRecord.retell_source_id };
  }
  if (!await repository.claimUrlSource(sourceRecord.id)) {
    return { status: sourceRecord.retell_status, source_id: sourceRecord.retell_source_id };
  }

  try {
    const knowledgeBaseId = await ensureKnowledgeBase(sourceRecord.business_id, sourceRecord.business_name, dependencies);
    const knowledge = await provider.addSources(knowledgeBaseId, { urls: [sourceRecord.url] });
    const providerSource = knowledge.knowledge_base_sources?.find((item) =>
      item.type === "url" && item.url === sourceRecord.url
    );
    await repository.updateUrlSource(sourceRecord.id, {
      retell_source_id: providerSource?.source_id ?? null,
      retell_status: "syncing",
      retell_last_error: null,
    });
    return { status: "syncing", source_id: providerSource?.source_id ?? null, knowledge_base_id: knowledgeBaseId };
  } catch (error) {
    await repository.updateUrlSource(sourceRecord.id, {
      retell_status: "failed",
      retell_last_error: message(error),
    });
    throw error;
  }
}

async function deleteSource(
  source: KnowledgeDocumentRecord | KnowledgeUrlSourceRecord,
  update: KnowledgeRepository["updateDocument"] | KnowledgeRepository["updateUrlSource"],
  dependencies: RetellKnowledgeDependencies,
) {
  const { repository, provider } = dependencies;
  await update.call(repository, source.id, { retell_status: "deleting", retell_last_error: null });

  try {
    const knowledgeBaseId = await ensureKnowledgeBase(source.business_id, source.business_name, dependencies);
    let providerSourceId = source.retell_source_id;
    if (!providerSourceId) {
      const knowledge = await provider.getKnowledgeBase(knowledgeBaseId);
      const expectedFilename = "storage_path" in source ? providerFilename(source) : undefined;
      const matched = knowledge.knowledge_base_sources?.find((item) =>
        (expectedFilename && item.filename === expectedFilename) ||
        ("url" in source && item.url === source.url)
      );
      providerSourceId = matched?.source_id ?? null;
      if (!providerSourceId && knowledge.status !== "complete") {
        throw new Error("Retell is still indexing this source; retry removal shortly");
      }
    }
    if (providerSourceId) await provider.deleteSource(knowledgeBaseId, providerSourceId);
    await update.call(repository, source.id, {
      retell_status: "deleting",
      retell_deleted_at: (dependencies.now ?? (() => new Date().toISOString()))(),
    });
    return { deleted: true };
  } catch (error) {
    await update.call(repository, source.id, { retell_status: "failed", retell_last_error: message(error) });
    throw error;
  }
}

async function reconcile(
  businessId: string,
  businessName: string,
  dependencies: RetellKnowledgeDependencies,
) {
  const { repository, provider } = dependencies;
  const knowledgeBaseId = await ensureKnowledgeBase(businessId, businessName, dependencies);
  const knowledge = await provider.getKnowledgeBase(knowledgeBaseId);
  const sources = await repository.listBusinessSources(businessId);
  const now = (dependencies.now ?? (() => new Date().toISOString()))();

  for (const local of sources) {
    if (local.retell_status === "deleting") continue;
    const expectedFilename = "storage_path" in local ? providerFilename(local) : undefined;
    const providerSource = knowledge.knowledge_base_sources?.find((source) =>
      (local.retell_source_id && source.source_id === local.retell_source_id) ||
      (expectedFilename && source.filename === expectedFilename) ||
      ("url" in local && source.url === local.url)
    );
    const patch = knowledge.status === "error"
      ? { retell_status: "failed" as const, retell_last_error: "Retell could not process this knowledge source" }
      : knowledge.status === "complete" && providerSource
      ? { retell_status: "ready" as const, retell_source_id: providerSource.source_id, retell_synced_at: now, retell_last_error: null }
      : { retell_status: "syncing" as const };
    if ("storage_path" in local) await repository.updateDocument(local.id, patch);
    else await repository.updateUrlSource(local.id, patch);
  }
  return { status: knowledge.status, source_count: sources.length };
}

export async function handleRetellKnowledgeOperation(
  operation: RetellKnowledgeOperation,
  dependencies: RetellKnowledgeDependencies,
): Promise<Record<string, unknown>> {
  switch (operation.operation) {
    case "ensure": {
      const knowledgeBaseId = await ensureKnowledgeBase(operation.business_id, operation.business_name, dependencies);
      return { knowledge_base_id: knowledgeBaseId };
    }
    case "upload_document":
      return await uploadDocument(operation.document_id, dependencies);
    case "add_url":
      return await addUrl(operation.source_id, dependencies);
    case "delete_document": {
      const document = await dependencies.repository.getDocument(operation.document_id);
      if (!document) throw new Error("Knowledge document not found");
      return await deleteSource(document, dependencies.repository.updateDocument, dependencies);
    }
    case "delete_url": {
      const source = await dependencies.repository.getUrlSource(operation.source_id);
      if (!source) throw new Error("Website source not found");
      return await deleteSource(source, dependencies.repository.updateUrlSource, dependencies);
    }
    case "reconcile":
      return await reconcile(operation.business_id, operation.business_name, dependencies);
    case "attach_agents": {
      const knowledgeBaseId = await ensureKnowledgeBase(operation.business_id, operation.business_name, dependencies);
      const agents = await dependencies.repository.listBusinessAgents(operation.business_id);
      for (const agent of agents) {
        await dependencies.provider.updateLlm(agent.retell_llm_id, {
          knowledge_base_ids: [knowledgeBaseId],
          kb_config: { top_k: 3, filter_score: 0.6 },
        });
      }
      return { attached: agents.length, knowledge_base_id: knowledgeBaseId };
    }
  }
}
