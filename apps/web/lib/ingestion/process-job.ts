import "server-only";

import { resolve4, resolve6 } from "node:dns/promises";
import { createAdminClient } from "@/lib/supabase/admin";
import { collectWebsiteFacts } from "./collector.ts";
import { findMatchingGooglePlace } from "./google-places.ts";
import { prepareFactRows } from "./persistence.ts";

async function resolvePublicHost(hostname: string): Promise<string[]> {
  const [ipv4, ipv6] = await Promise.all([
    resolve4(hostname).catch(() => []),
    resolve6(hostname).catch(() => []),
  ]);
  return [...ipv4, ...ipv6];
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Ingestion failed";
  return message.replace(/(?:api[_-]?key|token|secret)=?\s*[^\s&]+/gi, "$1=[redacted]").slice(0, 500);
}

export async function processIngestionJob(jobId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: job, error: jobError } = await admin
    .from("ingestion_jobs")
    .select("id,business_id,source_id,business_sources!inner(url)")
    .eq("id", jobId)
    .single();

  if (jobError || !job) throw new Error(jobError?.message ?? "Ingestion job not found");
  const source = Array.isArray(job.business_sources)
    ? job.business_sources[0]
    : job.business_sources;
  const website = source?.url;
  if (!website) throw new Error("Website source is missing its URL");

  await Promise.all([
    admin.from("ingestion_jobs").update({
      status: "running",
      started_at: new Date().toISOString(),
      attempts: 1,
      error_message: null,
    }).eq("id", job.id),
    admin.from("business_sources").update({ status: "running", error_message: null }).eq("id", job.source_id),
  ]);

  try {
    const facts = await collectWebsiteFacts({ website, resolveHost: resolvePublicHost });

    const { data: business } = await admin
      .from("businesses")
      .select("name,website,phone")
      .eq("id", job.business_id)
      .single();
    const placesKey = process.env.GOOGLE_MAPS_API_KEY;
    if (placesKey && business) {
      const match = await findMatchingGooglePlace({
        name: business.name,
        website: business.website,
        phone: business.phone,
      }, placesKey);
      if (match) {
        const placeUrl = `https://places.google.com/?q=place_id:${match.place.id ?? ""}`;
        const fields: Array<[string, unknown]> = [
          ["name", match.place.displayName?.text],
          ["website", match.place.websiteUri],
          ["phone", match.place.nationalPhoneNumber],
          ["address", match.place.formattedAddress],
          ["opening_hours", match.place.regularOpeningHours],
          ["rating", match.place.rating],
        ];
        for (const [factKey, value] of fields) {
          if (value !== undefined && value !== null) facts.push({
            category: factKey === "rating" ? "reputation" : "google_place",
            factKey,
            value,
            confidence: match.confidence,
            sourceUrl: placeUrl,
          });
        }
        await admin.from("business_sources").upsert({
          business_id: job.business_id,
          type: "google_place",
          url: placeUrl,
          external_id: match.place.id,
          status: "needs_review",
          metadata: { confidence: match.confidence },
          last_synced_at: new Date().toISOString(),
        }, { onConflict: "business_id,type,url" });
      }
    }

    if (facts.length > 0) {
      const { error } = await admin.from("business_facts").insert(
        prepareFactRows(job.business_id, job.source_id, facts),
      );
      if (error) throw new Error(error.message);
    }

    const completedAt = new Date().toISOString();
    await Promise.all([
      admin.from("ingestion_jobs").update({ status: "needs_review", completed_at: completedAt }).eq("id", job.id),
      admin.from("business_sources").update({ status: "needs_review", last_synced_at: completedAt }).eq("id", job.source_id),
    ]);
  } catch (error) {
    const errorMessage = safeError(error);
    await Promise.all([
      admin.from("ingestion_jobs").update({ status: "failed", error_message: errorMessage }).eq("id", job.id),
      admin.from("business_sources").update({ status: "failed", error_message: errorMessage }).eq("id", job.source_id),
    ]);
    throw error;
  }
}
