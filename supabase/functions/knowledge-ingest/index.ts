import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../_shared/errors.ts";
import { requireServiceRole } from "../_shared/auth.ts";
import { createKbDocumentFromFile } from "../_shared/elevenlabs.ts";
import { invokeFunction } from "../_shared/invoke.ts";
import { fileExtension, isSupportedKnowledgeFile, kbDocumentName, toKbUpload } from "../_shared/knowledge.ts";

interface IngestRequest {
  document_id: string;
  // Accepted for backward compatibility; the knowledge_documents row is the source of truth.
  business_id?: string;
  storage_path?: string;
}

interface KnowledgeDocumentRow {
  id: string;
  business_id: string;
  filename: string;
  file_type: string;
  storage_path: string;
  status: "pending" | "processing" | "ready" | "failed";
  chunk_count: number;
  error_message: string | null;
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

    const body = await parseJsonBody<IngestRequest>(req);
    const documentId = body.document_id;
    if (!documentId) {
      throw new AppError("document_id is required", 400, "INVALID_REQUEST");
    }

    const supabase = createServiceClient();

    const { data, error: docError } = await supabase
      .from("knowledge_documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docError || !data) {
      throw new AppError("Document not found", 404, "NOT_FOUND");
    }

    const doc = data as KnowledgeDocumentRow;

    // Idempotent re-ingest: the file is already on ElevenLabs, just make sure it's wired up.
    if (doc.elevenlabs_document_id) {
      await supabase
        .from("knowledge_documents")
        .update({ status: "ready" })
        .eq("id", documentId);

      await invokeFunction("agent-sync", { business_id: doc.business_id });

      return jsonResponse({
        document_id: documentId,
        status: "ready",
        already_ingested: true,
      });
    }

    try {
      await supabase
        .from("knowledge_documents")
        .update({ status: "processing" })
        .eq("id", documentId);

      if (!isSupportedKnowledgeFile(doc.filename)) {
        const error = `Unsupported file type: .${
          fileExtension(doc.filename)
        }. Upload PDF, DOCX, TXT, MD, HTML, EPUB or CSV.`;

        await supabase
          .from("knowledge_documents")
          .update({ status: "failed", error_message: error })
          .eq("id", documentId);

        return jsonResponse({ document_id: documentId, status: "failed", error });
      }

      const { data: fileData, error: downloadError } = await supabase.storage
        .from("knowledge")
        .download(doc.storage_path);

      if (downloadError || !fileData) {
        throw new AppError(
          `Failed to download file: ${downloadError?.message ?? "unknown error"}`,
          500,
          "DOWNLOAD_ERROR",
        );
      }

      const bytes = new Uint8Array(await fileData.arrayBuffer());
      const { blob, uploadFilename } = toKbUpload(doc.filename, bytes);

      const kbDocument = await createKbDocumentFromFile(
        blob,
        uploadFilename,
        kbDocumentName(doc.business_id, documentId, doc.filename),
      );

      await supabase
        .from("knowledge_documents")
        .update({
          elevenlabs_document_id: kbDocument.id,
          status: "ready",
          error_message: null,
        })
        .eq("id", documentId);

      await invokeFunction("agent-sync", { business_id: doc.business_id });

      return jsonResponse({
        document_id: documentId,
        status: "ready",
        elevenlabs_document_id: kbDocument.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase
        .from("knowledge_documents")
        .update({ status: "failed", error_message: String(message).slice(0, 500) })
        .eq("id", documentId);

      return errorResponse(error);
    }
  } catch (error) {
    return errorResponse(error);
  }
});
