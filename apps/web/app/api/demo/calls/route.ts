import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeUsPhone, isDemoQuietHour } from "@/lib/demo/request-policy";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireServerEnv } from "@/lib/server/env";
import { enforceRateLimit, requestIp } from "@/lib/server/production-service";

const AGENT_ENV: Record<string, string> = {
  Dexter: "RETELL_DEMO_AGENT_GENERAL_RECEPTIONIST",
  Zia: "RETELL_DEMO_AGENT_APPOINTMENT_BOOKING",
  Sparky: "RETELL_DEMO_AGENT_HOME_SERVICES_DISPATCHER",
  Bella: "RETELL_DEMO_AGENT_LEAD_QUALIFICATION",
};

function hash(value: string): string {
  return createHmac("sha256", requireServerEnv("DEMO_HASH_SECRET")).update(value).digest("hex");
}

export async function POST(request: Request) {
  let body: { phone?: unknown; agent?: unknown; business?: unknown; consent?: unknown; time_zone?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.consent !== true) return NextResponse.json({ error: "Explicit AI, recording, and callback consent is required" }, { status: 400 });
  if (typeof body.phone !== "string" || typeof body.agent !== "string" || !AGENT_ENV[body.agent]) {
    return NextResponse.json({ error: "A valid phone and demo agent are required" }, { status: 400 });
  }
  let phone: string;
  try { phone = normalizeUsPhone(body.phone); } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid phone" }, { status: 400 });
  }
  const timeZone = typeof body.time_zone === "string" && /^[A-Za-z_]+\/[A-Za-z_]+$/.test(body.time_zone)
    ? body.time_zone : "America/Chicago";
  try {
    if (isDemoQuietHour(new Date(), timeZone)) {
      return NextResponse.json({ error: "Demo callbacks are available from 8 AM to 8 PM local time" }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid time zone" }, { status: 400 });
  }

  const forwarded = requestIp(request);
  try {
    await Promise.all([
      enforceRateLimit("demo_ip", forwarded),
      enforceRateLimit("demo_phone", phone),
    ]);
  } catch (error) {
    const retryAfter = (error as Error & { retryAfterSeconds?: number }).retryAfterSeconds ?? 3600;
    return NextResponse.json({ error: "Demo callback limit reached; please try again later" }, {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    });
  }
  const ipHash = hash(forwarded);
  const phoneHash = hash(phone);
  const admin = createAdminClient();
  const { data: demo, error: insertError } = await admin.from("demo_requests").insert({
    agent_template_slug: body.agent, phone_hash: phoneHash, ip_hash: ipHash,
    consented_at: new Date().toISOString(), status: "requested",
  }).select("id").single();
  if (insertError || !demo) return NextResponse.json({ error: "Could not record demo request" }, { status: 500 });

  const agentId = requireServerEnv(AGENT_ENV[body.agent]);
  const retell = await fetch("https://api.retellai.com/v2/create-phone-call", {
    method: "POST",
    headers: { Authorization: `Bearer ${requireServerEnv("RETELL_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from_number: requireServerEnv("RETELL_DEMO_FROM_NUMBER"), to_number: phone,
      override_agent_id: agentId,
      metadata: { demo_request_id: demo.id },
      retell_llm_dynamic_variables: { business_name: typeof body.business === "string" ? body.business.slice(0, 100) : "your business" },
    }),
  });
  const result = await retell.json().catch(() => ({})) as { call_id?: string; message?: string };
  if (!retell.ok || !result.call_id) {
    await admin.from("demo_requests").update({ status: "failed", error_message: "Retell callback could not be started" }).eq("id", demo.id);
    return NextResponse.json({ error: "The live demo is temporarily unavailable" }, { status: 503 });
  }
  await admin.from("demo_requests").update({ status: "calling", retell_call_id: result.call_id }).eq("id", demo.id);
  return NextResponse.json({ status: "calling", request_id: demo.id }, { status: 202 });
}
