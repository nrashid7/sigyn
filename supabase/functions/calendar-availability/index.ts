import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, errorResponse, jsonResponse, parseJsonBody } from "../_shared/errors.ts";
import { checkAvailability } from "../_shared/calendar.ts";
import { requireToolSecret } from "../_shared/auth.ts";
import {
  parseToolBody,
  resolveToolContext,
  toolResponse,
  type ToolRequestBody,
} from "../_shared/tool-context.ts";
import { REQUIRED_PARAMS } from "./params.ts";

interface AvailabilityBody {
  start_date: string;
  end_date?: string;
  duration_minutes?: number;
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

    const fields = parseToolBody<AvailabilityBody>(body, REQUIRED_PARAMS);

    const slots = await checkAvailability(supabase, {
      businessId: ctx.business.id,
      startDate: fields.start_date,
      endDate: fields.end_date,
      durationMinutes: fields.duration_minutes ?? 30,
    });

    const formatted = slots.map((s) => ({
      start: s.start,
      end: s.end,
      display: new Date(s.start).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: ctx.business.timezone,
      }),
    }));

    return toolResponse(
      formatted.length > 0
        ? `Available slots: ${formatted.map((s) => s.display).join(", ")}`
        : "No available slots in that range. Offer a different day.",
      { slots: formatted },
    );
  } catch (error) {
    return errorResponse(error);
  }
});
