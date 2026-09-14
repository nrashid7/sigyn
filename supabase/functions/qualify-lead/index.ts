import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../_shared/errors.ts";
import { requireToolSecret } from "../_shared/auth.ts";
import { normalizePhone } from "../_shared/elevenlabs.ts";
import {
  clampScore,
  parseToolBody,
  resolveToolContext,
  toolResponse,
  type ToolRequestBody,
} from "../_shared/tool-context.ts";
import { ALL_PARAMS, REQUIRED_PARAMS } from "./params.ts";

export { ALL_PARAMS, REQUIRED_PARAMS };

interface QualifyLeadBody {
  caller_id?: string;
  name: string;
  email?: string;
  company?: string;
  need?: string;
  timeline?: string;
  budget?: string;
  lead_score: unknown;
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

    const fields = parseToolBody<QualifyLeadBody>(body, REQUIRED_PARAMS);
    const score = clampScore(fields.lead_score);

    const { data: existingCall, error: fetchError } = await supabase
      .from("calls")
      .select("qualification_data")
      .eq("id", ctx.callId)
      .maybeSingle();

    if (fetchError) {
      throw new AppError(`Failed to load call: ${fetchError.message}`, 500, "DB_ERROR");
    }

    const qualificationData = {
      ...(existingCall?.qualification_data ?? {}),
      name: fields.name,
      email: fields.email,
      company: fields.company,
      need: fields.need,
      timeline: fields.timeline,
      budget: fields.budget,
      phone: normalizePhone(fields.caller_id),
    };

    const { error: updateError } = await supabase
      .from("calls")
      .update({
        lead_score: score,
        outcome: "qualified_lead",
        qualification_data: qualificationData,
      })
      .eq("id", ctx.callId);

    if (updateError) {
      throw new AppError(`Failed to update call: ${updateError.message}`, 500, "DB_ERROR");
    }

    return toolResponse(`Lead recorded with score ${score}.`, {
      success: true,
      lead_score: score,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
