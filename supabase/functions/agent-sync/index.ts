import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../_shared/errors.ts";
import { requireServiceRole } from "../_shared/auth.ts";
import { updateAgent } from "../_shared/elevenlabs.ts";
import {
  type AgentRow,
  buildConfigForAgent,
  includeCalendarOf,
  loadAgentConfigSources,
} from "../_shared/agent-config.ts";

interface SyncRequest {
  business_id?: string;
  agent_id?: string;
}

interface SyncResult {
  agent_id: string;
  ok: boolean;
  error?: string;
}

/**
 * Re-pushes the whole config for one agent. ElevenLabs's PATCH merge semantics are not
 * documented, so a sync always sends the complete payload rather than a delta.
 */
async function syncAgent(supabase: SupabaseClient, row: AgentRow): Promise<void> {
  const sources = await loadAgentConfigSources(supabase, row.business_id, row.template_id);
  const config = buildConfigForAgent(row, sources, includeCalendarOf(row.config));

  // Non-null by the query below: only rows with an ElevenLabs agent are selected.
  await updateAgent(row.elevenlabs_agent_id!, config);

  const { error } = await supabase
    .from("agents")
    .update({ config: { ...row.config, last_synced_at: new Date().toISOString() } })
    .eq("id", row.id);

  if (error) {
    throw new AppError(
      `Failed to record the sync: ${error.message}`,
      500,
      "DB_ERROR",
    );
  }
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

    const body = await parseJsonBody<SyncRequest>(req);
    if (!body.business_id && !body.agent_id) {
      throw new AppError(
        "business_id or agent_id is required",
        400,
        "INVALID_REQUEST",
      );
    }

    const supabase = createServiceClient();

    // Only live agents can be synced: anything else has no ElevenLabs agent to push to.
    let query = supabase
      .from("agents")
      .select("*")
      .eq("provision_status", "ready")
      .not("elevenlabs_agent_id", "is", null);

    query = body.agent_id
      ? query.eq("id", body.agent_id)
      : query.eq("business_id", body.business_id);

    const { data, error } = await query;
    if (error) {
      throw new AppError(`Failed to load agents: ${error.message}`, 500, "DB_ERROR");
    }

    const results: SyncResult[] = [];

    for (const row of (data ?? []) as AgentRow[]) {
      try {
        await syncAgent(supabase, row);
        results.push({ agent_id: row.id, ok: true });
      } catch (agentError) {
        // One broken agent must not block the rest of the business's agents.
        console.error(`[agent-sync] Agent ${row.id} failed:`, agentError);
        results.push({
          agent_id: row.id,
          ok: false,
          error: agentError instanceof Error ? agentError.message : String(agentError),
        });
      }
    }

    return jsonResponse({
      synced: results.filter((result) => result.ok).length,
      agents: results,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
