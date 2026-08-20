import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../_shared/errors.ts";
import { chunkText, embedTexts } from "../_shared/embeddings.ts";
import { captureBusinessEvent } from "../_shared/analytics.ts";
import { assertServiceRole } from "../_shared/auth.ts";

interface IngestRequest {
  document_id: string;
}

async function extractText(bytes: Uint8Array, fileType: string): Promise<string> {
  const lower = fileType.toLowerCase();

  if (lower === "txt" || lower === "text/plain") {
    return new TextDecoder().decode(bytes);
  }

  if (lower === "csv" || lower === "text/csv") {
    return new TextDecoder().decode(bytes);
  }

  if (lower === "pdf" || lower === "application/pdf") {
    return extractPdfText(bytes);
  }

  if (
    lower === "docx" ||
    lower === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return await extractDocxText(bytes);
  }

  throw new AppError(`Unsupported file type: ${fileType}`, 400, "UNSUPPORTED_TYPE");
}

function extractPdfText(bytes: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(bytes);
  const streams = raw.match(/stream[\s\S]*?endstream/g) ?? [];
  const textParts: string[] = [];

  for (const stream of streams) {
    const btMatches = stream.match(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g) ?? [];
    for (const match of btMatches) {
      const text = match.slice(1, -1).replace(/\\n/g, "\n").replace(/\\r/g, "");
      if (text.trim()) textParts.push(text);
    }
  }

  if (textParts.length === 0) {
    const fallback = raw.match(/\(([^)]+)\)/g)?.map((m) => m.slice(1, -1)).join(" ") ?? "";
    if (!fallback.trim()) {
      throw new AppError("Could not extract text from PDF", 422, "PARSE_ERROR");
    }
    return fallback;
  }

  return textParts.join("\n");
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const { unzipSync } = await import("npm:fflate@0.8.2");
  const files = unzipSync(bytes);
  const docXml = files["word/document.xml"];

  if (!docXml) {
    throw new AppError("Invalid DOCX: missing document.xml", 422, "PARSE_ERROR");
  }

  const xml = new TextDecoder().decode(docXml);
  const paragraphs = xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [];
  const text = paragraphs
    .map((p) => p.replace(/<[^>]+>/g, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    throw new AppError("Could not extract text from DOCX", 422, "PARSE_ERROR");
  }

  return text;
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

  let documentId: string | undefined;

  try {
    assertServiceRole(req);
    const body = await parseJsonBody<IngestRequest>(req);
    documentId = body.document_id;
    if (!documentId) {
      throw new AppError("document_id is required", 400);
    }

    const supabase = createServiceClient();

    const { data: doc, error: docError } = await supabase
      .from("knowledge_documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docError || !doc) {
      throw new AppError("Document not found", 404);
    }

    await supabase
      .from("knowledge_documents")
      .update({ status: "processing", error_message: null })
      .eq("id", documentId);

    const { data: fileData, error: downloadError } = await supabase.storage
      .from("knowledge")
      .download(doc.storage_path);

    if (downloadError || !fileData) {
      throw new AppError(`Failed to download file: ${downloadError?.message}`, 500);
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer());
    const text = await extractText(bytes, doc.file_type);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      throw new AppError("No content extracted from document", 422);
    }

    await supabase
      .from("knowledge_chunks")
      .delete()
      .eq("document_id", documentId);

    const embeddings = await embedTexts(chunks);

    const rows = chunks.map((content, index) => ({
      business_id: doc.business_id,
      document_id: documentId,
      content,
      metadata: { chunk_index: index, filename: doc.filename },
      embedding: embeddings[index],
    }));

    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error: insertError } = await supabase
        .from("knowledge_chunks")
        .insert(batch);

      if (insertError) {
        throw new AppError(`Failed to store chunks: ${insertError.message}`, 500);
      }
    }

    await supabase
      .from("knowledge_documents")
      .update({ status: "ready", chunk_count: chunks.length })
      .eq("id", documentId);

    await captureBusinessEvent(doc.business_id, "knowledge_ingested", {
      document_id: documentId,
      chunk_count: chunks.length,
      filename: doc.filename,
    });

    return jsonResponse({
      document_id: documentId,
      chunk_count: chunks.length,
      status: "ready",
    });
  } catch (error) {
    if (documentId) {
      try {
        const supabase = createServiceClient();
        await supabase
          .from("knowledge_documents")
          .update({
            status: "failed",
            error_message: error instanceof Error ? error.message : "Unknown error",
          })
          .eq("id", documentId);
      } catch {
        // ignore cleanup errors
      }
    }
    return errorResponse(error);
  }
});
