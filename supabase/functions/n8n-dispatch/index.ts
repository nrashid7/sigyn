import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../_shared/errors.ts";
import { buildN8nDispatchPayload } from "../_shared/crm.ts";
import { captureBusinessEvent } from "../_shared/analytics.ts";
import { assertServiceRole } from "../_shared/auth.ts";
import {
  getDispatchWebhookUrl,
  postToN8nWebhook,
  selectDispatchTargets,
} from "../_shared/n8n.ts";

interface DispatchRequest {
  event: string;
  business_id: string;
  call_id?: string;
  workflow_id?: string;
  metadata?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    assertServiceRole(req);
    const body = await parseJsonBody<DispatchRequest>(req);
    const { event, business_id, call_id, workflow_id } = body;

    if (!event || !business_id) {
      throw new AppError("event and business_id are required", 400);
    }

    const supabase = createServiceClient();

    const { data: controls, error: controlsError } = await supabase.from("system_controls")
      .select("automation_dispatch_enabled").eq("id", true).single();
    if (controlsError || controls?.automation_dispatch_enabled !== true) {
      throw new AppError("Automation dispatch is temporarily paused", 503, "AUTOMATION_PAUSED");
    }

    let callData: Record<string, unknown> | null = null;
    let transcriptSummary: string | undefined;
    let extractedEntities: Record<string, unknown> = {};

    if (call_id) {
      const { data: call } = await supabase
        .from("calls")
        .select("*, call_transcripts(*)")
        .eq("id", call_id)
        .maybeSingle();

      if (call) {
        callData = call;
        const transcriptRow = Array.isArray(call.call_transcripts)
          ? call.call_transcripts[0]
          : call.call_transcripts;

        transcriptSummary = transcriptRow?.summary ?? undefined;
        extractedEntities = transcriptRow?.extracted_entities ?? {};
      }
    }

    const payload = buildN8nDispatchPayload({
      event,
      businessId: business_id,
      callId: call_id,
      contact: {
        name: extractedEntities.customer_name as string | undefined,
        phone: (extractedEntities.customer_phone as string) ??
          (callData?.caller_number as string | undefined),
        email: extractedEntities.customer_email as string | undefined,
      },
      callSummary: transcriptSummary,
      leadScore: callData?.lead_score as number | undefined,
      sentiment: callData?.sentiment as string | undefined,
      outcome: callData?.outcome as string | undefined,
      extractedEntities,
      metadata: body.metadata,
    });

    const secret = Deno.env.get("N8N_WEBHOOK_SECRET") ?? "";

    let webhookQuery = supabase
      .from("workflows")
      .select("id, webhook_url, config, name")
      .eq("is_active", true);

    if (workflow_id) {
      webhookQuery = webhookQuery.eq("id", workflow_id);
    } else {
      webhookQuery = webhookQuery.or(`business_id.eq.${business_id},business_id.is.null`);
    }

    const { data: allWorkflows } = await webhookQuery;
    const targets = selectDispatchTargets(allWorkflows ?? [], workflow_id);

    const envFallbackUrl = getDispatchWebhookUrl();

    if (!targets.length && !envFallbackUrl) {
      return jsonResponse({ dispatched: false, reason: "no_active_workflows" });
    }

    const results = await Promise.allSettled(
      targets.length > 0
        ? targets.map(async (workflow) => {
          if (!workflow.webhook_url) {
            return { id: workflow.id, skipped: true, reason: "no_webhook_url" };
          }
          const response = await postToN8nWebhook(workflow.webhook_url, payload, secret);
          if (!response.ok) {
            throw new Error(`Webhook ${workflow.id} failed: ${response.status}`);
          }
          return { id: workflow.id, status: response.status, source: "database" };
        })
        : [
          (async () => {
            const response = await postToN8nWebhook(envFallbackUrl!, payload, secret);
            if (!response.ok) {
              throw new Error(`Env webhook failed: ${response.status}`);
            }
            return { id: "env", status: response.status, source: "env", url: envFallbackUrl };
          })(),
        ],
    );

    const dispatched = results.filter((r) => r.status === "fulfilled").length;

    await captureBusinessEvent(business_id, "n8n_dispatched", {
      event,
      call_id,
      workflow_count: targets.length || 1,
      dispatched,
      used_env_fallback: targets.length === 0,
    });

    return jsonResponse({
      dispatched,
      total: targets.length || 1,
      payload,
      results: results.map((r) =>
        r.status === "fulfilled" ? r.value : { error: String(r.reason) }
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
});
