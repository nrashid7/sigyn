import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../_shared/errors.ts";
import { createBooking } from "../_shared/calendar.ts";
import { requireToolSecret } from "../_shared/auth.ts";
import { normalizePhone } from "../_shared/elevenlabs.ts";
import { captureBusinessEvent } from "../_shared/analytics.ts";
import {
  parseToolBody,
  resolveToolContext,
  toolResponse,
  type ToolRequestBody,
} from "../_shared/tool-context.ts";
import { ALL_PARAMS, REQUIRED_PARAMS } from "./params.ts";

export { ALL_PARAMS, REQUIRED_PARAMS };

interface BookBody {
  caller_id?: string;
  scheduled_at: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  duration_minutes?: number;
  notes?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type, x-sigyn-tool-secret",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    requireToolSecret(req);

    const body = await parseJsonBody<Record<string, unknown>>(req);
    const supabase = createServiceClient();
    const ctx = await resolveToolContext(supabase, body as ToolRequestBody);

    const fields = parseToolBody<BookBody>(body, REQUIRED_PARAMS);

    const customerPhone = normalizePhone(fields.customer_phone) ??
      normalizePhone(fields.caller_id) ??
      fields.customer_phone;

    let booking: { appointmentId: string; externalId?: string };
    try {
      booking = await createBooking(supabase, {
        businessId: ctx.business.id,
        callId: ctx.callId,
        agentId: ctx.agent.id,
        scheduledAt: fields.scheduled_at,
        customerName: fields.customer_name,
        customerPhone,
        customerEmail: fields.customer_email,
        durationMinutes: fields.duration_minutes ?? 30,
        notes: fields.notes,
      });
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) {
        return toolResponse(
          "That time is not available. Please offer another slot.",
          { success: false },
        );
      }
      throw error;
    }

    const { error: updateError } = await supabase
      .from("calls")
      .update({ outcome: "booked" })
      .eq("id", ctx.callId);

    if (updateError) {
      console.error(
        `[calendar-book] Failed to mark call ${ctx.callId} as booked: ${updateError.message}`,
      );
    }

    try {
      await captureBusinessEvent(ctx.business.id, "appointment_booked", {
        appointment_id: booking.appointmentId,
        call_id: ctx.callId,
      });
    } catch (error) {
      console.warn("[calendar-book] Analytics capture failed:", error);
    }

    const displayTime = new Date(fields.scheduled_at).toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: ctx.business.timezone,
    });

    return toolResponse(
      `Appointment confirmed for ${fields.customer_name} on ${displayTime}.`,
      { appointment_id: booking.appointmentId, success: true },
    );
  } catch (error) {
    return errorResponse(error);
  }
});
