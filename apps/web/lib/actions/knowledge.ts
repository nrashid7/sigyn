"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, getSupabaseServiceRoleKey } from "@/lib/supabase/admin";
import { invokeRetellKnowledgeSync } from "@/lib/knowledge/retell-sync";
import { getBusiness } from "./business";

function safeMessage(error: unknown, fallback: string) {
  return (error instanceof Error ? error.message : fallback).slice(0, 500);
}

async function invokeLocalKnowledgeIngest(documentId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Supabase is not configured");
  const response = await fetch(`${supabaseUrl}/functions/v1/knowledge-ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getSupabaseServiceRoleKey()}`,
    },
    body: JSON.stringify({ document_id: documentId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    throw new Error(typeof body.error === "string" ? body.error.slice(0, 500) : "Local knowledge processing failed");
  }
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

export async function getIngestionOverview() {
  const business = await getBusiness();
  if (!business) return { jobs: [], sources: [], proposedFacts: 0, approvedFacts: 0 };
  const supabase = await createClient();
  const [jobs, sources, proposed, approved] = await Promise.all([
    supabase.from("ingestion_jobs")
      .select("id,status,created_at,completed_at,error_message,business_sources(url)")
      .eq("business_id", business.id).order("created_at", { ascending: false }).limit(10),
    supabase.from("business_sources")
      .select("id,url,retell_status,retell_last_error,retell_synced_at,created_at")
      .eq("business_id", business.id).eq("type", "website")
      .order("created_at", { ascending: false }),
    supabase.from("business_facts").select("id", { count: "exact", head: true })
      .eq("business_id", business.id).eq("review_status", "proposed"),
    supabase.from("business_facts").select("id", { count: "exact", head: true })
      .eq("business_id", business.id).eq("review_status", "approved"),
  ]);
  return {
    jobs: jobs.data ?? [],
    sources: sources.data ?? [],
    proposedFacts: proposed.count ?? 0,
    approvedFacts: approved.count ?? 0,
  };
}

export async function uploadKnowledgeDocument(formData: FormData) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const file = formData.get("file") as File;
  if (!file) return { error: "No file provided" };
  const allowedTypes = new Set([
    "application/pdf", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain", "text/markdown",
  ]);
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !["pdf", "doc", "docx", "txt", "md"].includes(extension) || !allowedTypes.has(file.type)) {
    return { error: "Unsupported knowledge file type" };
  }
  if (file.size < 1 || file.size > 10 * 1024 * 1024) {
    return { error: "Knowledge files must be between 1 byte and 10MB" };
  }

  const supabase = await createClient();
  const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-160);
  const path = `${business.id}/${crypto.randomUUID()}-${safeFilename}`;

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

  if (error) {
    await supabase.storage.from("knowledge").remove([path]);
    return { error: error.message };
  }

  const [localResult, retellResult] = await Promise.allSettled([
    invokeLocalKnowledgeIngest(doc.id),
    invokeRetellKnowledgeSync({ operation: "upload_document", document_id: doc.id }),
  ]);
  const admin = createAdminClient();
  if (localResult.status === "rejected") {
    await admin.from("knowledge_documents").update({
      status: "failed",
      error_message: safeMessage(localResult.reason, "Local knowledge processing failed"),
    }).eq("id", doc.id).eq("business_id", business.id);
  }
  if (retellResult.status === "rejected") {
    await admin.from("knowledge_documents").update({
      retell_status: "failed",
      retell_last_error: safeMessage(retellResult.reason, "Retell publication failed"),
    }).eq("id", doc.id).eq("business_id", business.id);
  }

  revalidatePath("/dashboard/knowledge");
  revalidatePath("/onboarding/knowledge");
  return {
    success: true,
    documentId: doc.id,
    retellStatus: retellResult.status === "fulfilled"
      ? String(retellResult.value.status ?? "syncing")
      : "failed",
    warning: retellResult.status === "rejected"
      ? "The file was saved, but publishing to calls failed. Retry from Knowledge."
      : undefined,
  };
}

export async function deleteKnowledgeDocument(id: string) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };
  const supabase = await createClient();
  const { data: document, error: selectError } = await supabase
    .from("knowledge_documents")
    .select("id,storage_path")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (selectError || !document) return { error: selectError?.message ?? "Knowledge document not found" };

  try {
    await invokeRetellKnowledgeSync({ operation: "delete_document", document_id: document.id });
  } catch (error) {
    return { error: safeMessage(error, "Could not remove the source from Retell") };
  }

  const { error: storageError } = await supabase.storage.from("knowledge").remove([document.storage_path]);
  if (storageError) return { error: storageError.message };

  const { error } = await supabase.from("knowledge_documents").delete()
    .eq("id", document.id).eq("business_id", business.id);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/knowledge");
  return { success: true };
}

export async function retryKnowledgeDocument(id: string) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };
  const supabase = await createClient();
  const { data } = await supabase.from("knowledge_documents")
    .select("id,retell_status").eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!data) return { error: "Knowledge document not found" };
  if (data.retell_status !== "failed") return { error: "Only failed publications can be retried" };
  try {
    const result = await invokeRetellKnowledgeSync({ operation: "upload_document", document_id: data.id });
    revalidatePath("/dashboard/knowledge");
    return { success: true, status: result.status ?? "syncing" };
  } catch (error) {
    return { error: safeMessage(error, "Retell publication failed") };
  }
}

export async function reconcileBusinessKnowledge() {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };
  const supabase = await createClient();
  const { data } = await supabase.from("business_knowledge_bases")
    .select("id").eq("business_id", business.id).maybeSingle();
  if (!data) return { success: true, status: "pending" };
  try {
    const result = await invokeRetellKnowledgeSync({
      operation: "reconcile",
      knowledge_base_record_id: data.id,
    });
    revalidatePath("/dashboard/knowledge");
    return { success: true, ...result };
  } catch (error) {
    return { error: safeMessage(error, "Could not refresh Retell publication status") };
  }
}

export async function retryKnowledgeUrl(id: string) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };
  const supabase = await createClient();
  const { data } = await supabase.from("business_sources")
    .select("id,retell_status").eq("id", id).eq("business_id", business.id)
    .eq("type", "website").maybeSingle();
  if (!data) return { error: "Website source not found" };
  if (data.retell_status !== "failed") return { error: "Only failed publications can be retried" };
  try {
    const result = await invokeRetellKnowledgeSync({ operation: "add_url", source_id: data.id });
    revalidatePath("/dashboard/knowledge");
    return { success: true, status: result.status ?? "syncing" };
  } catch (error) {
    return { error: safeMessage(error, "Retell publication failed") };
  }
}

export async function deleteKnowledgeUrl(id: string) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };
  const supabase = await createClient();
  const { data } = await supabase.from("business_sources")
    .select("id").eq("id", id).eq("business_id", business.id)
    .eq("type", "website").maybeSingle();
  if (!data) return { error: "Website source not found" };
  try {
    await invokeRetellKnowledgeSync({ operation: "delete_url", source_id: data.id });
  } catch (error) {
    return { error: safeMessage(error, "Could not remove the website from Retell") };
  }
  const { error } = await supabase.from("business_sources").delete()
    .eq("id", data.id).eq("business_id", business.id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/knowledge");
  return { success: true };
}
