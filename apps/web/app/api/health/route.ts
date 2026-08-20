import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateHealth, REQUIRED_PRODUCTION_ENV } from "@/lib/server/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = performance.now();
  let database = { ok: false, latency_ms: 0 };
  try {
    const { error } = await createAdminClient().from("system_controls").select("id").eq("id", true).single();
    database = { ok: !error, latency_ms: Math.round(performance.now() - started) };
  } catch {
    database = { ok: false, latency_ms: Math.round(performance.now() - started) };
  }
  const missing = REQUIRED_PRODUCTION_ENV.filter((name) => !process.env[name]);
  const result = evaluateHealth({
    version: process.env.VERCEL_GIT_COMMIT_SHA || process.env.RELEASE_VERSION || "development",
    database,
    configuration: missing.length ? { ok: false, missing: [...missing] } : { ok: true },
  });
  return NextResponse.json(result, {
    status: result.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
