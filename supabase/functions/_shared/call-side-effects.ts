import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type AgentRow, isMissedCall } from "./conversations.ts";
import type { ElConversation } from "./elevenlabs.ts";
import { recordUsageMinutes } from "./stripe.ts";
import { sendMissedCallSms } from "./missed-call.ts";
import { storeRecording } from "./recordings.ts";
import { captureCallEvent } from "./analytics.ts";
import { invokeFunction } from "./invoke.ts";

// --- pure decision helpers (unit-tested without a Supabase client) ---

/** Minutes to bill for a conversation, rounded up; 0 when duration is missing or zero. */
export function minutesForConversation(conv: ElConversation): number {
  return Math.ceil((conv.metadata?.call_duration_secs ?? 0) / 60);
}

/** Fetch and store the recording once: conversation finished, had audio, nothing stored yet. */
export function shouldStoreRecording(
  conv: ElConversation,
  existingRecordingUrl: string | null | undefined,
): boolean {
  const duration = conv.metadata?.call_duration_secs;
  return (
    conv.status === "done" &&
    typeof duration === "number" &&
    duration > 0 &&
    (existingRecordingUrl === null || existingRecordingUrl === undefined)
  );
}

/**
 * The SMS only makes sense for a missed call, only when we know who to text back, and only
 * the first time this conversation is ever recorded as complete — a redelivered webhook or a
 * reconcile run finalizing an already-texted conversation must not send it again.
 */
export function shouldSendMissedCallSms(
  conv: ElConversation,
  firstCompletion: boolean,
): boolean {
  return (
    firstCompletion &&
    isMissedCall(conv) &&
    Boolean(conv.metadata?.phone_call?.external_number)
  );
}

// --- shared post-persist orchestration (webhook + reconcile) ---

export interface PostCallContext {
  callId: string;
  firstCompletion: boolean;
}

/**
 * Runs every side effect that follows persisting a finished conversation: usage metering,
 * recording capture, the missed-call SMS, analytics, and (once) the n8n fan-out.
 * Shared by `elevenlabs-webhook` and `calls-reconcile`. Each step is independently
 * try/caught and logged so one failure never blocks the others.
 */
export async function runPostCallSideEffects(
  supabase: SupabaseClient,
  agent: AgentRow,
  conv: ElConversation,
  { callId, firstCompletion }: PostCallContext,
): Promise<void> {
  const minutes = minutesForConversation(conv);
  if (minutes > 0) {
    try {
      await recordUsageMinutes(supabase, agent.business_id, callId, minutes);
    } catch (error) {
      console.error("[call-side-effects] usage recording failed:", error);
    }
  }

  try {
    const { data: callRow } = await supabase
      .from("calls")
      .select("recording_url")
      .eq("id", callId)
      .maybeSingle();

    if (shouldStoreRecording(conv, callRow?.recording_url ?? null)) {
      await storeRecording(supabase, agent, conv.conversation_id);
    }
  } catch (error) {
    console.error("[call-side-effects] recording capture failed:", error);
  }

  try {
    const callerNumber = conv.metadata?.phone_call?.external_number;
    if (shouldSendMissedCallSms(conv, firstCompletion) && callerNumber) {
      await sendMissedCallSms(supabase, agent, callId, callerNumber);
    }
  } catch (error) {
    console.error("[call-side-effects] missed-call SMS failed:", error);
  }

  try {
    await captureCallEvent(agent.business_id, conv.conversation_id, "call_ended", {
      duration_seconds: conv.metadata?.call_duration_secs ?? 0,
      call_id: callId,
      status: conv.status,
    });
  } catch (error) {
    console.error("[call-side-effects] analytics capture failed:", error);
  }

  if (firstCompletion) {
    try {
      await invokeFunction("n8n-dispatch", {
        event: "call_completed",
        business_id: agent.business_id,
        call_id: callId,
      });
    } catch (error) {
      console.error("[call-side-effects] n8n dispatch failed:", error);
    }
  }
}
