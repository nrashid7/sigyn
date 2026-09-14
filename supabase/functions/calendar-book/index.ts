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
  formatInBusinessTimeZone,
  parseToolBody,
  resolveToolContext,
  toolResponse,
  type ToolRequestBody,
} from "../_shared/tool-context.ts";
import { REQUIRED_PARAMS } from "./params.ts";

const CONFIRMATION_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "long",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

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

    // Format the confirmation time BEFORE any write (appointment insert / calls
    // update) so a bad ctx.business.timezone can only ever fall back to UTC — it
    // can never throw after the booking has already been committed.
    const displayTime = formatInBusinessTimeZone(
      new Date(fields.scheduled_at),
      ctx.business.timezone,
      CONFIRMATION_TIME_FORMAT,
    );

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
        console.error(
          `[calendar-book] Booking failed for call ${ctx.callId}: ${error.message}`,
        );
        if (error.code === "SLOT_TAKEN") {
          return toolResponse(
            "That time is not available. Please offer another slot.",
            { success: false, code: error.code },
          );
        }
        return toolResponse(
          "I can't book that right now. Let me take your details and someone will call you back to confirm.",
          { success: false, code: error.code },
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

    return toolResponse(
      `Appointment confirmed for ${fields.customer_name} on ${displayTime}.`,
      { appointment_id: booking.appointmentId, success: true },
    );
  } catch (error) {
    return errorResponse(error);
  }
});
