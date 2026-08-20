import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
} from "../_shared/errors.ts";
import { readRawBody, verifyRetellSignature } from "../_shared/webhook.ts";

interface QualifyLeadRequest {
  call_id?: string;
  retell_call_id?: string;
  name?: string;
  email?: string;
  company?: string;
  need?: string;
  timeline?: string;
  budget?: string;
  lead_score?: number;
}

interface RetellToolRequest {
  args?: QualifyLeadRequest;
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
    const request = JSON.parse(rawBody) as RetellToolRequest;
    const body = request.args ?? {};
    if (!request.call?.agent_id) throw new AppError("Verified Retell call context is required", 401);

    const supabase = createServiceClient();
    const { data: agent } = await supabase.from("agents")
      .select("id, business_id")
      .eq("retell_agent_id", request.call.agent_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!agent) throw new AppError("Active Retell agent not found", 404);
    const qualificationData = {
      name: body.name,
      email: body.email,
      company: body.company,
      need: body.need,
      timeline: body.timeline,
      budget: body.budget,
      lead_score: body.lead_score ?? 50,
      qualified_at: new Date().toISOString(),
    };

    let callId: string | undefined;
    const retellCallId = request.call.call_id ?? body.retell_call_id;
    if (retellCallId) {
      const { data: call } = await supabase
        .from("calls")
        .select("id")
        .eq("retell_call_id", retellCallId)
        .maybeSingle();
      callId = call?.id;
    }

    if (callId) {
      await supabase.from("calls").update({
        lead_score: body.lead_score ?? 50,
        outcome: "qualified_lead",
        qualification_data: qualificationData,
      }).eq("id", callId);
    }

    return jsonResponse({
      success: true,
      message: "Lead qualification recorded",
      lead_score: body.lead_score ?? 50,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
