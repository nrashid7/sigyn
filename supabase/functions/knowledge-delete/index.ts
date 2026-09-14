import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../_shared/errors.ts";
import { requireServiceRole } from "../_shared/auth.ts";
import { deleteKbDocument } from "../_shared/elevenlabs.ts";
import { invokeFunction } from "../_shared/invoke.ts";
import { isNotFoundError } from "../_shared/knowledge.ts";

interface DeleteRequest {
  document_id: string;
}

interface KnowledgeDocumentRow {
  id: string;
  business_id: string;
  storage_path: string;
  elevenlabs_document_id: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    requireServiceRole(req);

    const body = await parseJsonBody<DeleteRequest>(req);
    const documentId = body.document_id;
    if (!documentId) {
      throw new AppError("document_id is required", 400, "INVALID_REQUEST");
    }

    const supabase = createServiceClient();

    const { data, error: docError } = await supabase
      .from("knowledge_documents")
      .select("id, business_id, storage_path, elevenlabs_document_id")
      .eq("id", documentId)
      .single();

    if (docError && !isNotFoundError(docError)) {
      throw new AppError(`Failed to load document: ${docError.message}`, 500, "DB_ERROR");
    }

    // No row left to delete is the state we wanted.
    if (docError || !data) {
      return jsonResponse({ deleted: true, already: true });
    }

    const doc = data as KnowledgeDocumentRow;

    if (doc.elevenlabs_document_id) {
      await deleteKbDocument(doc.elevenlabs_document_id, true);
    }

    const { error: removeError } = await supabase.storage
      .from("knowledge")
      .remove([doc.storage_path]);

    if (removeError) {
      console.error(
        `[knowledge-delete] Failed to remove storage object ${doc.storage_path}: ${removeError.message}`,
      );
    }

    const { error: deleteError } = await supabase
      .from("knowledge_documents")
      .delete()
      .eq("id", documentId);

    if (deleteError) {
      throw new AppError(`Failed to delete document: ${deleteError.message}`, 500, "DB_ERROR");
    }

    await invokeFunction("agent-sync", { business_id: doc.business_id });

    return jsonResponse({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
});
