import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
} from "../_shared/errors.ts";
import { readRawBody, verifyElevenLabsSignature } from "../_shared/webhook.ts";
import { type ElConversation, normalizePhone } from "../_shared/elevenlabs.ts";
import { type AgentRow, persistConversation } from "../_shared/conversations.ts";
import { runPostCallSideEffects } from "../_shared/call-side-effects.ts";
import { sendMissedCallSms } from "../_shared/missed-call.ts";

interface ElWebhookPayload {
  type: string;
  event_timestamp?: number;
  data: ElConversation & Record<string, unknown>;
}

/** The Twilio-shaped body ElevenLabs echoes back on a `call_initiation_failure` event. */
interface FailureMetadata {
  body?: { From?: string };
  phone_call?: { external_number?: string };
  failure_reason?: unknown;
}

function failureCallerNumber(metadata: FailureMetadata | undefined): string | null {
  return normalizePhone(
    metadata?.body?.From ?? metadata?.phone_call?.external_number ?? null,
  );
}

async function handleTranscription(
  supabase: SupabaseClient,
  agent: AgentRow,
  conv: ElConversation,
): Promise<void> {
  const { callId, firstCompletion } = await persistConversation(supabase, agent, conv);
  await runPostCallSideEffects(supabase, agent, conv, { callId, firstCompletion });
}

async function handleInitiationFailure(
  supabase: SupabaseClient,
  agent: AgentRow,
  payload: ElWebhookPayload,
): Promise<void> {
  const data = payload.data;
  const metadata = data.metadata as FailureMetadata | undefined;
  const callerNumber = failureCallerNumber(metadata);
  const startedAt = new Date(
    (payload.event_timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
  ).toISOString();

  const { data: call, error } = await supabase
    .from("calls")
    .upsert({
      elevenlabs_conversation_id: data.conversation_id,
      business_id: agent.business_id,
      agent_id: agent.id,
      status: "failed",
      outcome: "missed",
      duration_seconds: 0,
      started_at: startedAt,
      caller_number: callerNumber,
      provider_metadata: {
        failure_reason: data.failure_reason ?? metadata?.failure_reason,
      },
    }, { onConflict: "elevenlabs_conversation_id" })
    .select("id")
    .single();

  if (error || !call) {
    throw new AppError(
      `Failed to persist failed call: ${error?.message ?? "no row returned"}`,
      500,
      "DB_ERROR",
    );
  }

  if (callerNumber) {
    try {
      await sendMissedCallSms(supabase, agent, call.id, callerNumber);
    } catch (smsError) {
      console.error("[elevenlabs-webhook] missed-call SMS failed:", smsError);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "elevenlabs-signature, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const rawBody = await readRawBody(req);
    await verifyElevenLabsSignature(req, rawBody);

    const payload = JSON.parse(rawBody) as ElWebhookPayload;
    if (!payload.type || !payload.data?.agent_id) {
      throw new AppError("Invalid ElevenLabs webhook payload", 400);
    }

    const supabase = createServiceClient();

    const { data: agent } = await supabase
      .from("agents")
      .select("id, business_id, phone_number")
      .eq("elevenlabs_agent_id", payload.data.agent_id)
      .maybeSingle();

    if (!agent) {
      console.warn(`[elevenlabs-webhook] Unknown agent: ${payload.data.agent_id}`);
      return jsonResponse({ received: true, skipped: true });
    }

    switch (payload.type) {
      case "post_call_transcription":
        await handleTranscription(supabase, agent, payload.data);
        break;

      case "call_initiation_failure":
        await handleInitiationFailure(supabase, agent, payload);
        break;

      case "post_call_audio":
        // We fetch audio on demand (see _shared/recordings.ts) instead of storing it here.
        return jsonResponse({ received: true, ignored: true });

      default:
        return jsonResponse({ received: true, ignored: true, type: payload.type });
    }

    return jsonResponse({ received: true, type: payload.type });
  } catch (error) {
    return errorResponse(error);
  }
});
