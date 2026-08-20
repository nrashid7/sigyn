import { after, NextResponse } from "next/server";
import { getBusiness } from "@/lib/actions/business";
import { processIngestionJob } from "@/lib/ingestion/process-job";
import { queueWebsiteIngestion } from "@/lib/ingestion/queue-job";
import { enforceRateLimit } from "@/lib/server/production-service";

export const maxDuration = 300;

export async function POST(request: Request) {
  const business = await getBusiness();
  if (!business) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await enforceRateLimit("ingestion", business.id);
  } catch (error) {
    const retryAfter = (error as Error & { retryAfterSeconds?: number }).retryAfterSeconds ?? 3600;
    return NextResponse.json({ error: "Ingestion limit reached; please try again later" }, {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    });
  }

  let body: { website?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.website !== "string" || !body.website.trim()) {
    return NextResponse.json({ error: "website is required" }, { status: 400 });
  }

  let job;
  try {
    job = await queueWebsiteIngestion(business.id, body.website);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Invalid website",
    }, { status: 400 });
  }

  after(async () => {
    try {
      await processIngestionJob(job.id);
    } catch (error) {
      console.error("Ingestion job failed", { jobId: job.id, error });
    }
  });

  return NextResponse.json({ job }, { status: 202 });
}
