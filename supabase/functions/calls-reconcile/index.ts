import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
} from "../_shared/errors.ts";
import { requireServiceRole } from "../_shared/auth.ts";
import { getConversation, listConversations } from "../_shared/elevenlabs.ts";
import { persistConversation } from "../_shared/conversations.ts";
import { runPostCallSideEffects } from "../_shared/call-side-effects.ts";
import { storeRecording } from "../_shared/recordings.ts";

interface ReconcileBody {
  agent_id?: string;
  since_hours?: number;
}

interface ReconcileAgent {
  id: string;
  business_id: string;
  phone_number: string | null;
  elevenlabs_agent_id: string;
}

interface AgentResult {
  checked: number;
  imported: number;
  recordingsFilled: number;
}

/** ElevenLabs paginates 100 conversations at a time; cap the fan-out per run. */
const PAGE_SIZE = 100;
const MAX_PAGES = 3;
/** No prior call for this agent: look back a full day on the first ever run. */
const DEFAULT_LOOKBACK_HOURS = 24;
/** Re-check the hour before the last known call, in case a webhook arrived out of order. */
const CATCH_UP_BUFFER_MS = 60 * 60 * 1000;

/** Millis since epoch to start reconciling from for this agent. */
async function sinceForAgent(
  supabase: SupabaseClient,
  agent: ReconcileAgent,
  sinceHours: number | undefined,
): Promise<number> {
  if (typeof sinceHours === "number") {
    return Date.now() - sinceHours * 60 * 60 * 1000;
  }

  const { data: lastCall } = await supabase
    .from("calls")
    .select("started_at")
    .eq("agent_id", agent.id)
    .not("started_at", "is", null)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (lastCall?.started_at) {
    return new Date(lastCall.started_at).getTime() - CATCH_UP_BUFFER_MS;
  }

  return Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000;
}

async function reconcileAgent(
  supabase: SupabaseClient,
  agent: ReconcileAgent,
  sinceHours: number | undefined,
): Promise<AgentResult> {
  const since = await sinceForAgent(supabase, agent, sinceHours);
  const callStartAfterUnix = Math.floor(since / 1000);

  let checked = 0;
  let imported = 0;
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listConversations({
      agentId: agent.elevenlabs_agent_id,
      callStartAfterUnix,
      pageSize: PAGE_SIZE,
      cursor,
    });

    for (const summary of result.conversations) {
      if (summary.status !== "done" && summary.status !== "failed") continue;
      checked++;

      const { data: existing } = await supabase
        .from("calls")
        .select("id, status, recording_url")
        .eq("elevenlabs_conversation_id", summary.conversation_id)
        .maybeSingle();

      if (existing && existing.status !== "in_progress") continue;

      const conv = await getConversation(summary.conversation_id);
      const { callId, firstCompletion } = await persistConversation(supabase, agent, conv);
      await runPostCallSideEffects(supabase, agent, conv, { callId, firstCompletion });
      imported++;
    }

    if (!result.next_cursor) break;
    cursor = result.next_cursor;
  }

  const { data: unrecorded } = await supabase
    .from("calls")
    .select("elevenlabs_conversation_id")
    .eq("agent_id", agent.id)
    .eq("status", "completed")
    .is("recording_url", null)
    .gte("started_at", new Date(since).toISOString());

  let recordingsFilled = 0;
  for (const call of unrecorded ?? []) {
    if (!call.elevenlabs_conversation_id) continue;
    const url = await storeRecording(supabase, agent, call.elevenlabs_conversation_id);
    if (url) recordingsFilled++;
  }

  return { checked, imported, recordingsFilled };
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
    requireServiceRole(req);

    const rawBody = await req.text();
    let body: ReconcileBody = {};
    if (rawBody) {
      try {
        body = JSON.parse(rawBody) as ReconcileBody;
      } catch {
        body = {};
      }
    }

    const supabase = createServiceClient();

    let query = supabase
      .from("agents")
      .select("id, business_id, phone_number, elevenlabs_agent_id")
      .eq("provision_status", "ready")
      .not("elevenlabs_agent_id", "is", null);

    if (body.agent_id) {
      query = query.eq("id", body.agent_id);
    }

    const { data: agents, error } = await query;
    if (error) {
      throw new AppError(`Failed to load agents: ${error.message}`, 500, "DB_ERROR");
    }

    let checked = 0;
    let imported = 0;
    let recordingsFilled = 0;
    let errors = 0;

    for (const agent of (agents ?? []) as ReconcileAgent[]) {
      try {
        const result = await reconcileAgent(supabase, agent, body.since_hours);
        checked += result.checked;
        imported += result.imported;
        recordingsFilled += result.recordingsFilled;
      } catch (agentError) {
        errors++;
        console.error(`[calls-reconcile] Agent ${agent.id} failed:`, agentError);
      }
    }

    return jsonResponse({
      agents: (agents ?? []).length,
      checked,
      imported,
      recordings_filled: recordingsFilled,
      errors,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
