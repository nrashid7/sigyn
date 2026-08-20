import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
} from "../_shared/errors.ts";
import { createBooking } from "../_shared/calendar.ts";
import { captureBusinessEvent } from "../_shared/analytics.ts";
import { readRawBody, verifyRetellSignature } from "../_shared/webhook.ts";

interface BookRequest {
  scheduled_at: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  duration_minutes?: number;
  notes?: string;
  call_id?: string;
  agent_id?: string;
}

interface RetellToolRequest {
  name?: string;
  args?: BookRequest;
  call?: { agent_id?: string; call_id?: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type, x-retell-signature",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const rawBody = await readRawBody(req);
    await verifyRetellSignature(req, rawBody);
    const raw = JSON.parse(rawBody) as RetellToolRequest;
    const args = raw.args;
    if (!raw.call?.agent_id) throw new AppError("Verified Retell call context is required", 401);

    if (!args?.scheduled_at || !args.customer_name || !args.customer_phone) {
      throw new AppError(
        "scheduled_at, customer_name, and customer_phone are required",
        400,
      );
    }

    const supabase = createServiceClient();
    const { data: agent } = await supabase.from("agents")
      .select("id, business_id")
      .eq("retell_agent_id", raw.call.agent_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!agent) throw new AppError("Active Retell agent not found", 404);
    const { data: call } = raw.call.call_id
      ? await supabase.from("calls").select("id").eq("retell_call_id", raw.call.call_id).maybeSingle()
      : { data: null };

    const result = await createBooking(supabase, {
      businessId: agent.business_id,
      scheduledAt: args.scheduled_at,
      customerName: args.customer_name,
      customerPhone: args.customer_phone,
      customerEmail: args.customer_email,
      durationMinutes: args.duration_minutes,
      notes: args.notes,
      callId: call?.id ?? undefined,
      agentId: agent.id,
    });

    if (call?.id) {
      await supabase.from("calls").update({ outcome: "booked" }).eq("id", call.id);
    }

    await captureBusinessEvent(agent.business_id, "appointment_booked", {
      appointment_id: result.appointmentId,
      call_id: call?.id,
    });

    const displayTime = new Date(args.scheduled_at).toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    return jsonResponse({
      appointment_id: result.appointmentId,
      external_id: result.externalId,
      result: `Appointment confirmed for ${args.customer_name} on ${displayTime}.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
