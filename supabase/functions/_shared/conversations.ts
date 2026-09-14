import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./errors.ts";
import { type ElConversation, normalizePhone } from "./elevenlabs.ts";

export interface AgentRow {
  id: string;
  business_id: string;
  phone_number?: string | null;
}

export interface ExistingCall {
  id: string;
  status?: string | null;
  outcome?: string | null;
  lead_score?: number | null;
  qualification_data?: Record<string, unknown> | null;
  caller_number?: string | null;
  has_appointment?: boolean;
}

export interface CallRowUpsert {
  elevenlabs_conversation_id: string;
  business_id: string;
  agent_id: string;
  caller_number: string | null;
  duration_seconds: number;
  status: "in_progress" | "completed" | "no_answer" | "failed" | "transferred";
  outcome:
    | "answered"
    | "booked"
    | "qualified_lead"
    | "transferred"
    | "voicemail"
    | "missed"
    | "other"
    | null;
  sentiment: string | null;
  lead_score: number | null;
  qualification_data: Record<string, unknown>;
  started_at: string | null;
  ended_at: string | null;
  provider_metadata: Record<string, unknown>;
}

type CallOutcome = NonNullable<CallRowUpsert["outcome"]>;

const CALL_OUTCOMES: readonly CallOutcome[] = [
  "answered",
  "booked",
  "qualified_lead",
  "transferred",
  "voicemail",
  "missed",
  "other",
];

const SENTIMENTS = ["positive", "neutral", "negative"];

/** { data_collection_id: value } for every entry that actually collected something. */
export function flattenDataCollection(
  conv: ElConversation,
): Record<string, unknown> {
  const results = conv.analysis?.data_collection_results ?? {};
  const flattened: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(results)) {
    const value = entry?.value;
    if (value === null || value === undefined) continue;
    flattened[entry?.data_collection_id ?? key] = value;
  }

  return flattened;
}

export function mapTranscript(
  conv: ElConversation,
): Array<{ role: "agent" | "user"; content: string; timestamp: number }> {
  return (conv.transcript ?? [])
    .filter((turn) => typeof turn.message === "string" && turn.message.length > 0)
    .map((turn) => ({
      role: turn.role === "agent" ? "agent" as const : "user" as const,
      content: turn.message as string,
      timestamp: turn.time_in_call_secs ?? 0,
    }));
}

/** A call the agent never spoke on — nobody was served. */
export function isMissedCall(conv: ElConversation): boolean {
  if (conv.status === "failed") return true;

  return !(conv.transcript ?? []).some(
    (turn) =>
      turn.role === "agent" &&
      typeof turn.message === "string" &&
      turn.message.length > 0,
  );
}

export function mapConversationToCallRow(
  conv: ElConversation,
  agent: AgentRow,
  existing?: ExistingCall,
): CallRowUpsert {
  const collected = flattenDataCollection(conv);
  const phoneCall = conv.metadata?.phone_call;
  const terminationReason = conv.metadata?.termination_reason;

  // caller_number: live payload, then the dynamic variable, then what we already had.
  const dynamicCallerId = conv.conversation_initiation_client_data
    ?.dynamic_variables?.system__caller_id;
  let callerNumber: string | null;
  if (typeof phoneCall?.external_number === "string" && phoneCall.external_number) {
    callerNumber = phoneCall.external_number;
  } else if (typeof dynamicCallerId === "string" && dynamicCallerId) {
    callerNumber = dynamicCallerId;
  } else {
    callerNumber = existing?.caller_number ?? null;
  }

  const rawDuration = conv.metadata?.call_duration_secs;
  const durationSeconds =
    typeof rawDuration === "number" && Number.isFinite(rawDuration)
      ? Math.trunc(rawDuration)
      : 0;

  const startUnix = conv.metadata?.start_time_unix_secs;
  const hasStart = typeof startUnix === "number" && Number.isFinite(startUnix) &&
    startUnix > 0;
  const startedAt = hasStart ? new Date(startUnix * 1000).toISOString() : null;
  const endedAt = hasStart
    ? new Date((startUnix + durationSeconds) * 1000).toISOString()
    : null;

  let status: CallRowUpsert["status"];
  if (typeof terminationReason === "string" && /transfer/i.test(terminationReason)) {
    status = "transferred";
  } else if (conv.status === "failed") {
    status = "failed";
  } else if (conv.status === "done") {
    status = durationSeconds === 0 ? "no_answer" : "completed";
  } else {
    status = "in_progress";
  }

  const collectedOutcome = collected.outcome;
  let outcome: CallRowUpsert["outcome"];
  if (existing?.has_appointment) {
    outcome = "booked";
  } else if (existing?.outcome === "qualified_lead") {
    outcome = "qualified_lead";
  } else if (status === "transferred") {
    outcome = "transferred";
  } else if (
    typeof collectedOutcome === "string" &&
    (CALL_OUTCOMES as readonly string[]).includes(collectedOutcome)
  ) {
    outcome = collectedOutcome as CallOutcome;
  } else if (status === "failed" || status === "no_answer") {
    outcome = "missed";
  } else if (status === "completed") {
    outcome = "answered";
  } else {
    outcome = null;
  }

  const collectedSentiment = collected.sentiment;
  const sentiment = typeof collectedSentiment === "string" &&
      SENTIMENTS.includes(collectedSentiment)
    ? collectedSentiment
    : null;

  let leadScore: number | null = null;
  if (typeof existing?.lead_score === "number") {
    leadScore = existing.lead_score;
  } else if (collected.lead_score !== undefined) {
    const parsed = Number(collected.lead_score);
    leadScore = Number.isNaN(parsed)
      ? null
      : Math.min(100, Math.max(0, Math.round(parsed)));
  }

  const providerMetadata: Record<string, unknown> = { status: conv.status };
  if (terminationReason !== undefined) {
    providerMetadata.termination_reason = terminationReason;
  }
  if (conv.analysis?.call_successful !== undefined) {
    providerMetadata.call_successful = conv.analysis.call_successful;
  }
  if (conv.metadata?.cost !== undefined) {
    providerMetadata.cost = conv.metadata.cost;
  }
  if (phoneCall !== undefined) {
    providerMetadata.phone_call = phoneCall;
  }

  return {
    elevenlabs_conversation_id: conv.conversation_id,
    business_id: agent.business_id,
    agent_id: agent.id,
    caller_number: callerNumber,
    duration_seconds: durationSeconds,
    status,
    outcome,
    sentiment,
    lead_score: leadScore,
    qualification_data: {
      ...(existing?.qualification_data ?? {}),
      ...collected,
    },
    started_at: startedAt,
    ended_at: endedAt,
    provider_metadata: providerMetadata,
  };
}

/** Creates the in-progress call row a live tool call can attach to. */
export async function ensureCallStub(
  supabase: SupabaseClient,
  agent: AgentRow,
  conversationId: string,
  callerId?: string | null,
): Promise<{ id: string }> {
  const { data: existing } = await supabase
    .from("calls")
    .select("id")
    .eq("elevenlabs_conversation_id", conversationId)
    .maybeSingle();

  if (existing) return { id: existing.id };

  const { data: inserted, error } = await supabase
    .from("calls")
    .insert({
      elevenlabs_conversation_id: conversationId,
      business_id: agent.business_id,
      agent_id: agent.id,
      status: "in_progress",
      started_at: new Date().toISOString(),
      caller_number: normalizePhone(callerId) ?? callerId ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // Another concurrent tool call won the race.
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("calls")
        .select("id")
        .eq("elevenlabs_conversation_id", conversationId)
        .maybeSingle();
      if (raced) return { id: raced.id };
    }
    throw new AppError(
      `Failed to create call record: ${error.message}`,
      500,
      "DB_ERROR",
    );
  }

  return { id: inserted.id };
}

export async function persistConversation(
  supabase: SupabaseClient,
  agent: AgentRow,
  conv: ElConversation,
): Promise<{ callId: string; firstCompletion: boolean }> {
  const { data: existingRow } = await supabase
    .from("calls")
    .select("id, status, outcome, lead_score, qualification_data, caller_number")
    .eq("elevenlabs_conversation_id", conv.conversation_id)
    .maybeSingle();

  let existing: ExistingCall | undefined;
  if (existingRow) {
    const { count } = await supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("call_id", existingRow.id);
    existing = { ...existingRow, has_appointment: (count ?? 0) > 0 };
  }

  const row = mapConversationToCallRow(conv, agent, existing);

  const { data: upserted, error } = await supabase
    .from("calls")
    .upsert(row, { onConflict: "elevenlabs_conversation_id" })
    .select("id")
    .single();

  if (error || !upserted) {
    throw new AppError(
      `Failed to persist call record: ${error?.message ?? "no row returned"}`,
      500,
      "DB_ERROR",
    );
  }

  const { error: transcriptError } = await supabase
    .from("call_transcripts")
    .upsert({
      call_id: upserted.id,
      transcript: mapTranscript(conv),
      summary: conv.analysis?.transcript_summary ?? null,
      extracted_entities: flattenDataCollection(conv),
    }, { onConflict: "call_id" });

  if (transcriptError) {
    // The call row is the source of truth; a transcript failure must not lose it.
    console.error(
      `[conversations] Failed to store transcript for ${conv.conversation_id}: ${transcriptError.message}`,
    );
  }

  const firstCompletion = !existing || existing.status === "in_progress" ||
    existing.status === "ringing";

  return { callId: upserted.id, firstCompletion };
}
