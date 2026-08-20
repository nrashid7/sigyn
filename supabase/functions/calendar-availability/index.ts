import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
} from "../_shared/errors.ts";
import { checkAvailability } from "../_shared/calendar.ts";
import { readRawBody, verifyRetellSignature } from "../_shared/webhook.ts";

interface AvailabilityRequest {
  start_date: string;
  end_date?: string;
  duration_minutes?: number;
}

interface RetellToolRequest {
  name?: string;
  args?: AvailabilityRequest;
  call?: { agent_id?: string };
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
    const agentId = raw.call?.agent_id;
    if (!agentId) throw new AppError("Verified Retell call context is required", 401);

    const supabase = createServiceClient();
    const { data: agent } = await supabase.from("agents")
      .select("business_id")
      .eq("retell_agent_id", agentId)
      .eq("is_active", true)
      .maybeSingle();
    if (!agent) throw new AppError("Active Retell agent not found", 404);

    const businessId = agent.business_id as string;

    const startDate = raw.args?.start_date;
    const endDate = raw.args?.end_date;
    const durationMinutes = raw.args?.duration_minutes;

    if (!startDate) {
      throw new AppError("start_date is required", 400);
    }

    const slots = await checkAvailability(supabase, {
      businessId,
      startDate,
      endDate,
      durationMinutes,
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
      }),
    }));

    return jsonResponse({
      slots: formatted,
      result: formatted.length > 0
        ? `Available slots: ${formatted.map((s) => s.display).join(", ")}`
        : "No available slots found for the requested dates.",
    });
  } catch (error) {
    return errorResponse(error);
  }
});
