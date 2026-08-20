import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: purged, error: purgeError } = await admin.rpc("purge_expired_records");
  if (purgeError) return NextResponse.json({ error: "Retention cleanup failed" }, { status: 500 });

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: abandoned, error: queryError } = await admin.from("knowledge_documents")
    .select("id,storage_path").eq("status", "failed").lt("created_at", cutoff).limit(100);
  if (queryError) return NextResponse.json({ error: "Retention cleanup failed" }, { status: 500 });
  const paths = (abandoned ?? []).map((row) => row.storage_path).filter(Boolean) as string[];
  if (paths.length) {
    const { error: storageError } = await admin.storage.from("knowledge").remove(paths);
    if (storageError) return NextResponse.json({ error: "Retention cleanup failed" }, { status: 500 });
    await admin.from("knowledge_documents").delete().in("id", (abandoned ?? []).map((row) => row.id));
  }
  return NextResponse.json({ ok: true, purged, abandoned_documents_deleted: paths.length });
}
