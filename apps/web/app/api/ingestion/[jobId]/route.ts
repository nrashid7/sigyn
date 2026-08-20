import { NextResponse } from "next/server";
import { getBusiness } from "@/lib/actions/business";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const business = await getBusiness();
  if (!business) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { jobId } = await params;
  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("ingestion_jobs")
    .select("id,status,attempts,started_at,completed_at,error_message,created_at,updated_at")
    .eq("id", jobId)
    .eq("business_id", business.id)
    .single();

  if (error || !job) return NextResponse.json({ error: "Ingestion job not found" }, { status: 404 });
  return NextResponse.json({ job });
}
