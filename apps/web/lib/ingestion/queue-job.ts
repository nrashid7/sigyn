import "server-only";
import { resolve4, resolve6 } from "node:dns/promises";
import { createAdminClient } from "@/lib/supabase/admin";
import { invokeRetellKnowledgeSync } from "@/lib/knowledge/retell-sync";
import { assertSafeSourceUrl } from "./safe-url";

async function resolveHost(hostname: string): Promise<string[]> {
  const [ipv4, ipv6] = await Promise.all([
    resolve4(hostname).catch(() => []), resolve6(hostname).catch(() => []),
  ]);
  return [...ipv4, ...ipv6];
}

export async function queueWebsiteIngestion(businessId: string, input: string) {
  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const website = await assertSafeSourceUrl(candidate, resolveHost);
  const admin = createAdminClient();
  const { data: source, error: sourceError } = await admin.from("business_sources").upsert({
    business_id: businessId, type: "website", url: website, status: "queued", error_message: null,
  }, { onConflict: "business_id,type,url" }).select("id,retell_status").single();
  if (sourceError || !source) throw new Error(sourceError?.message ?? "Could not queue source");

  let retellStatus = source.retell_status ?? "pending";
  try {
    const result = await invokeRetellKnowledgeSync({ operation: "add_url", source_id: source.id });
    retellStatus = String(result.status ?? "syncing");
  } catch (error) {
    const errorMessage = (error instanceof Error ? error.message : "Retell publication failed").slice(0, 500);
    retellStatus = "failed";
    await admin.from("business_sources").update({
      retell_status: "failed",
      retell_last_error: errorMessage,
    }).eq("id", source.id).eq("business_id", businessId);
  }

  const { data: job, error: jobError } = await admin.from("ingestion_jobs").insert({
    business_id: businessId, source_id: source.id, status: "queued",
  }).select("id,status,created_at").single();
  if (jobError || !job) throw new Error(jobError?.message ?? "Could not create ingestion job");
  return { ...job, source_id: source.id, retell_status: retellStatus };
}
