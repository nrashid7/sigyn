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
import { REQUIRED_PARAMS } from "./params.ts";

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

    // Only fields actually provided on this call overwrite what's already stored —
    // an omitted (undefined) field must never clobber existing qualification data.
    const definedUpdates: Record<string, unknown> = { name: fields.name };
    if (fields.email !== undefined) definedUpdates.email = fields.email;
    if (fields.company !== undefined) definedUpdates.company = fields.company;
    if (fields.need !== undefined) definedUpdates.need = fields.need;
    if (fields.timeline !== undefined) definedUpdates.timeline = fields.timeline;
    if (fields.budget !== undefined) definedUpdates.budget = fields.budget;

    const normalizedPhone = normalizePhone(fields.caller_id);
    if (normalizedPhone !== null) definedUpdates.phone = normalizedPhone;

    const qualificationData = {
      ...(existingCall?.qualification_data ?? {}),
      ...definedUpdates,
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
