"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseServiceRoleKey } from "@/lib/supabase/admin";
import { getBusiness } from "./business";

// Mirrors supabase/functions/_shared/knowledge.ts's SUPPORTED_EXTENSIONS. Duplicated here
// because Next can't import Deno edge function code.
const SUPPORTED_KNOWLEDGE_EXTENSIONS = ["pdf", "docx", "txt", "md", "html", "epub", "csv"];

function knowledgeFileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === filename.length - 1) return "";
  return filename.slice(dotIndex + 1).toLowerCase();
}

function isSupportedKnowledgeFile(filename: string): boolean {
  return SUPPORTED_KNOWLEDGE_EXTENSIONS.includes(knowledgeFileExtension(filename));
}

export async function getKnowledgeDocuments() {
  const business = await getBusiness();
  if (!business) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("knowledge_documents")
    .select("*")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false });

  return data || [];
}

export async function uploadKnowledgeDocument(formData: FormData) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const file = formData.get("file") as File;
  if (!file) return { error: "No file provided" };

  if (!isSupportedKnowledgeFile(file.name)) {
    return {
      error: `Unsupported file type: .${
        knowledgeFileExtension(file.name)
      }. Upload PDF, DOCX, TXT, MD, HTML, EPUB or CSV.`,
    };
  }

  const supabase = await createClient();
  const path = `${business.id}/${Date.now()}-${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from("knowledge")
    .upload(path, file);

  if (uploadError) return { error: uploadError.message };

  const { data: doc, error } = await supabase.from("knowledge_documents").insert({
    business_id: business.id,
    filename: file.name,
    file_type: file.type,
    storage_path: path,
    status: "pending",
    chunk_count: 0,
  }).select().single();

  if (error) return { error: error.message };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = getSupabaseServiceRoleKey();
  await fetch(`${supabaseUrl}/functions/v1/knowledge-ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      business_id: business.id,
      document_id: doc.id,
      storage_path: path,
    }),
  }).catch(() => null);

  revalidatePath("/dashboard/knowledge");
  revalidatePath("/onboarding/knowledge");
  return { success: true };
}

export async function deleteKnowledgeDocument(id: string) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const supabase = await createClient();

  // The knowledge-delete function runs with the service role and bypasses RLS, so the
  // ownership check that used to happen implicitly (RLS-scoped delete) is done explicitly here.
  const { data: existing } = await supabase
    .from("knowledge_documents")
    .select("id")
    .eq("id", id)
    .eq("business_id", business.id)
    .single();

  if (!existing) return { error: "Document not found" };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = getSupabaseServiceRoleKey();
  const response = await fetch(`${supabaseUrl}/functions/v1/knowledge-delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ document_id: id }),
  });

  if (!response.ok) {
    const json = await response.json().catch(() => ({}) as { error?: string });
    return { error: json.error ?? "Failed to delete document" };
  }

  revalidatePath("/dashboard/knowledge");
  return { success: true };
}
