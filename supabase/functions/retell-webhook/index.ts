import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AppError, createServiceClient, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { readRawBody, verifyRetellSignature } from "../_shared/webhook.ts";
import { captureCallEvent } from "../_shared/analytics.ts";
import { recordUsageMinutes } from "../_shared/stripe.ts";
import { buildN8nDispatchPayload } from "../_shared/crm.ts";

declare const EdgeRuntime: { waitUntil<T>(promise: Promise<T>): Promise<T> };

interface RetellCall {
  call_id: string; agent_id: string; from_number?: string; call_status?: string;
  start_timestamp?: number; end_timestamp?: number; duration_ms?: number; recording_url?: string;
  transcript?: Array<{ role: string; content: string }>;
  transcript_object?: Array<{ role: string; content: string }>;
  call_analysis?: { call_summary?: string; user_sentiment?: string; custom_analysis_data?: Record<string, unknown> };
}
interface RetellWebhookEvent { event: string; call: RetellCall }

async function invokeFunction(name: string, body: unknown): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return;
  const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${name} failed: ${await response.text()}`);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function callStatus(status?: string): string {
  if (status === "ended") return "completed";
  if (status === "error") return "failed";
  if (status === "registered" || status === "ongoing") return "in_progress";
  return "ringing";
}

async function processEvent(payload: RetellWebhookEvent, eventRowId: string) {
  const supabase = createServiceClient();
  const { event, call } = payload;
  try {
    await supabase.from("webhook_events").update({ status: "processing", attempts: 1 }).eq("id", eventRowId);
    const { data: agent } = await supabase.from("agents").select("id,business_id")
      .eq("retell_agent_id", call.agent_id).maybeSingle();
    if (!agent) throw new Error(`Unknown Retell agent ${call.agent_id}`);
    const durationSeconds = call.duration_ms ? Math.round(call.duration_ms / 1000) : 0;

    if (event === "call_started") {
      await supabase.from("calls").upsert({
        business_id: agent.business_id, agent_id: agent.id, retell_call_id: call.call_id,
        caller_number: call.from_number ?? null, status: "in_progress",
        started_at: call.start_timestamp ? new Date(call.start_timestamp).toISOString() : new Date().toISOString(),
      }, { onConflict: "retell_call_id" });
      await captureCallEvent(agent.business_id, call.call_id, "call_started", { agent_id: agent.id });
    }

    if (event === "call_ended") {
      const { data: savedCall, error } = await supabase.from("calls").upsert({
        business_id: agent.business_id, agent_id: agent.id, retell_call_id: call.call_id,
        caller_number: call.from_number ?? null, duration_seconds: durationSeconds,
        status: callStatus(call.call_status), recording_url: call.recording_url ?? null,
        ended_at: call.end_timestamp ? new Date(call.end_timestamp).toISOString() : new Date().toISOString(),
      }, { onConflict: "retell_call_id" }).select("id").single();
      if (error || !savedCall) throw new Error(error?.message ?? "Could not persist call");
      const transcript = call.transcript ?? call.transcript_object ?? [];
      if (transcript.length) await supabase.from("call_transcripts").upsert({
        call_id: savedCall.id, transcript,
      }, { onConflict: "call_id" });
      if (durationSeconds > 0) {
        await recordUsageMinutes(supabase, agent.business_id, savedCall.id, Math.ceil(durationSeconds / 60));
      }
      await captureCallEvent(agent.business_id, call.call_id, "call_ended", {
        duration_seconds: durationSeconds, call_id: savedCall.id,
      });
      await invokeFunction("call-analyze", { call_id: savedCall.id });
      await invokeFunction("n8n-dispatch", buildN8nDispatchPayload({
        event: "call_completed", businessId: agent.business_id, callId: savedCall.id,
        contact: { phone: call.from_number }, pipelineStage: "new_lead",
      }));
    }

    if (event === "call_analyzed") {
      const { data: savedCall } = await supabase.from("calls").select("id")
        .eq("retell_call_id", call.call_id).maybeSingle();
      if (savedCall && call.call_analysis) {
        await supabase.from("calls").update({
          sentiment: call.call_analysis.user_sentiment ?? null,
          qualification_data: call.call_analysis.custom_analysis_data ?? {},
        }).eq("id", savedCall.id);
        if (call.call_analysis.call_summary) await supabase.from("call_transcripts").upsert({
          call_id: savedCall.id, summary: call.call_analysis.call_summary,
        }, { onConflict: "call_id" });
        await invokeFunction("n8n-dispatch", {
          event: "call_analyzed", business_id: agent.business_id, call_id: savedCall.id,
        });
      }
      await captureCallEvent(agent.business_id, call.call_id, "call_analyzed");
    }
    await supabase.from("webhook_events").update({
      status: "completed", processed_at: new Date().toISOString(),
    }).eq("id", eventRowId);
  } catch (error) {
    console.error("[retell-webhook] processing failed", error);
    await supabase.from("webhook_events").update({
      status: "failed",
      error_message: (error instanceof Error ? error.message : "Processing failed").slice(0, 500),
    }).eq("id", eventRowId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-retell-signature, content-type",
  } });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    const rawBody = await readRawBody(req);
    await verifyRetellSignature(req, rawBody);
    const payload = JSON.parse(rawBody) as RetellWebhookEvent;
    if (!payload.event || !payload.call?.call_id || !payload.call.agent_id) {
      throw new AppError("Invalid Retell webhook payload", 400);
    }
    const supabase = createServiceClient();
    const { data: eventRow, error } = await supabase.from("webhook_events").insert({
      provider: "retell", provider_event_id: `${payload.event}:${payload.call.call_id}`,
      payload_hash: await sha256(rawBody), status: "received",
    }).select("id").single();
    if (error?.code === "23505") return jsonResponse({ received: true, duplicate: true });
    if (error || !eventRow) throw new AppError("Could not record webhook event", 500);
    EdgeRuntime.waitUntil(processEvent(payload, eventRow.id));
    return jsonResponse({ received: true, event: payload.event }, 202);
  } catch (error) {
    return errorResponse(error);
  }
});
