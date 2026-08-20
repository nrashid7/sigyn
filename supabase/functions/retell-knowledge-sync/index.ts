import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../_shared/errors.ts";
import {
  handleRetellKnowledgeOperation,
  type KnowledgeDocumentRecord,
  type KnowledgeRepository,
  type KnowledgeUrlSourceRecord,
  type RetellKnowledgeOperation,
} from "../_shared/retell-knowledge.ts";
import {
  addRetellKnowledgeSources,
  createRetellKnowledgeBase,
  deleteRetellKnowledgeSource,
  getRetellKnowledgeBase,
  RetellProviderError,
} from "../_shared/retell-knowledge-client.ts";
import { updateRetellLlm } from "../_shared/retell.ts";

type EdgeRequest =
  | { operation: "upload_document" | "delete_document"; document_id: string }
  | { operation: "add_url" | "delete_url"; source_id: string }
  | { operation: "reconcile"; knowledge_base_record_id: string }
  | { operation: "ensure" | "attach_agents"; agent_id: string };

function unauthorized(): never {
  throw new AppError("Service-role authorization is required", 401, "SERVICE_ROLE_REQUIRED");
}

function assertServiceRole(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) unauthorized();
  try {
    const encoded = token.split(".")[1];
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized)) as { role?: string };
    if (payload.role !== "service_role") unauthorized();
  } catch {
    unauthorized();
  }
}

function nestedBusinessName(value: unknown): string {
  const business = Array.isArray(value) ? value[0] : value;
  if (!business || typeof business !== "object" || !("name" in business)) {
    throw new Error("Business not found for knowledge source");
  }
  return String((business as { name: unknown }).name);
}

function createRepository(supabase: ReturnType<typeof createServiceClient>): KnowledgeRepository {
  return {
    async getDocument(id) {
      const { data, error } = await supabase.from("knowledge_documents")
        .select("id,business_id,filename,file_type,storage_path,retell_source_id,retell_status,businesses!inner(name)")
        .eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ...data,
        business_name: nestedBusinessName(data.businesses),
      } as KnowledgeDocumentRecord;
    },
    async getUrlSource(id) {
      const { data, error } = await supabase.from("business_sources")
        .select("id,business_id,url,retell_source_id,retell_status,businesses!inner(name)")
        .eq("id", id).eq("type", "website").maybeSingle();
      if (error) throw error;
      if (!data?.url) return null;
      return {
        ...data,
        business_name: nestedBusinessName(data.businesses),
      } as KnowledgeUrlSourceRecord;
    },
    async getOrCreateKnowledgeBase(businessId, businessName) {
      const { error: insertError } = await supabase.from("business_knowledge_bases").upsert({
        business_id: businessId,
        status: "pending",
      }, { onConflict: "business_id", ignoreDuplicates: true });
      if (insertError) throw insertError;
      const { data, error } = await supabase.from("business_knowledge_bases")
        .select("business_id,retell_knowledge_base_id,status")
        .eq("business_id", businessId).single();
      if (error || !data) throw error ?? new Error("Could not create knowledge ownership record");
      return { ...data, business_name: businessName };
    },
    async claimKnowledgeBaseCreation(businessId) {
      const { data, error } = await supabase.from("business_knowledge_bases")
        .update({ status: "syncing", last_error: null })
        .eq("business_id", businessId).in("status", ["pending", "failed"])
        .is("retell_knowledge_base_id", null).select("id").maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async completeKnowledgeBaseCreation(businessId, knowledgeBaseId) {
      const { error } = await supabase.from("business_knowledge_bases").update({
        retell_knowledge_base_id: knowledgeBaseId,
        status: "syncing",
        last_error: null,
        last_synced_at: new Date().toISOString(),
      }).eq("business_id", businessId);
      if (error) throw error;
    },
    async failKnowledgeBaseCreation(businessId, errorMessage) {
      await supabase.from("business_knowledge_bases").update({ status: "failed", last_error: errorMessage })
        .eq("business_id", businessId);
    },
    async claimDocument(id) {
      const { data, error } = await supabase.from("knowledge_documents")
        .update({ retell_status: "syncing", retell_last_error: null })
        .eq("id", id).in("retell_status", ["pending", "failed"])
        .select("id").maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async updateDocument(id, values) {
      const { error } = await supabase.from("knowledge_documents").update(values).eq("id", id);
      if (error) throw error;
    },
    async claimUrlSource(id) {
      const { data, error } = await supabase.from("business_sources")
        .update({ retell_status: "syncing", retell_last_error: null })
        .eq("id", id).in("retell_status", ["pending", "failed"])
        .select("id").maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async updateUrlSource(id, values) {
      const { error } = await supabase.from("business_sources").update(values).eq("id", id);
      if (error) throw error;
    },
    async listBusinessSources(businessId) {
      const [documents, urls] = await Promise.all([
        supabase.from("knowledge_documents")
          .select("id,business_id,filename,file_type,storage_path,retell_source_id,retell_status,businesses!inner(name)")
          .eq("business_id", businessId).is("retell_deleted_at", null),
        supabase.from("business_sources")
          .select("id,business_id,url,retell_source_id,retell_status,businesses!inner(name)")
          .eq("business_id", businessId).eq("type", "website").is("retell_deleted_at", null),
      ]);
      if (documents.error) throw documents.error;
      if (urls.error) throw urls.error;
      return [
        ...(documents.data ?? []).map((item) => ({ ...item, business_name: nestedBusinessName(item.businesses) }) as KnowledgeDocumentRecord),
        ...(urls.data ?? []).filter((item) => item.url).map((item) => ({ ...item, business_name: nestedBusinessName(item.businesses) }) as KnowledgeUrlSourceRecord),
      ];
    },
    async listBusinessAgents(businessId) {
      const { data, error } = await supabase.from("agents").select("business_id,retell_llm_id")
        .eq("business_id", businessId).not("retell_llm_id", "is", null);
      if (error) throw error;
      return (data ?? []).filter((item) => item.retell_llm_id) as Array<{ business_id: string; retell_llm_id: string }>;
    },
  };
}

async function expandOperation(
  body: EdgeRequest,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<RetellKnowledgeOperation> {
  if ("document_id" in body || "source_id" in body) return body;
  const table = "knowledge_base_record_id" in body ? "business_knowledge_bases" : "agents";
  const id = "knowledge_base_record_id" in body ? body.knowledge_base_record_id : body.agent_id;
  const { data, error } = await supabase.from(table)
    .select("business_id,businesses!inner(name)").eq("id", id).single();
  if (error || !data) throw error ?? new Error("Business context not found");
  return {
    operation: body.operation,
    business_id: data.business_id,
    business_name: nestedBusinessName(data.businesses),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    assertServiceRole(req);
    const body = await parseJsonBody<EdgeRequest>(req);
    const supabase = createServiceClient();
    const repository = createRepository(supabase);
    const operation = await expandOperation(body, supabase);
    const result = await handleRetellKnowledgeOperation(operation, {
      repository,
      storage: {
        async download(path) {
          const { data, error } = await supabase.storage.from("knowledge").download(path);
          if (error || !data) throw error ?? new Error("Knowledge file not found");
          return new Uint8Array(await data.arrayBuffer());
        },
      },
      provider: {
        createKnowledgeBase: (config) => createRetellKnowledgeBase(config),
        addSources: (knowledgeBaseId, sources) => addRetellKnowledgeSources(knowledgeBaseId, sources),
        getKnowledgeBase: (knowledgeBaseId) => getRetellKnowledgeBase(knowledgeBaseId),
        async deleteSource(knowledgeBaseId, sourceId) {
          try {
            await deleteRetellKnowledgeSource(knowledgeBaseId, sourceId);
          } catch (error) {
            if (!(error instanceof RetellProviderError) || error.statusCode !== 404) throw error;
          }
        },
        updateLlm: (llmId, config) => updateRetellLlm(llmId, config),
      },
    });
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
});
