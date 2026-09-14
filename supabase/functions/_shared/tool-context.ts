import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError, jsonResponse } from "./errors.ts";
import { type AgentRow, ensureCallStub } from "./conversations.ts";

/** Every mid-call ElevenLabs tool sends at least these two system variables. */
export type ToolRequestBody = {
  agent_id?: string;
  conversation_id?: string;
  caller_id?: string;
};

export interface ToolContext {
  agent: AgentRow & { elevenlabs_agent_id: string };
  business: {
    id: string;
    name: string;
    timezone: string;
    hours: Record<string, unknown>;
  };
  callId: string;
}

interface AgentLookupRow {
  id: string;
  business_id: string;
  phone_number: string | null;
  elevenlabs_agent_id: string;
  businesses: {
    id: string;
    name: string;
    timezone: string;
    hours: Record<string, unknown>;
  } | null;
}

/**
 * Resolves the tenant server-side from the ElevenLabs agent id — a mid-call tool body
 * must never be trusted with a caller-supplied business_id. Also ensures the in-progress
 * call row exists so the caller gets back a callId to attach bookings/qualification to.
 */
export async function resolveToolContext(
  supabase: SupabaseClient,
  body: ToolRequestBody,
): Promise<ToolContext> {
  const agentId = body.agent_id;
  const conversationId = body.conversation_id;

  if (
    typeof agentId !== "string" || agentId === "" ||
    typeof conversationId !== "string" || conversationId === ""
  ) {
    throw new AppError("agent_id and conversation_id are required", 400);
  }

  const { data, error } = await supabase
    .from("agents")
    .select(
      "id, business_id, phone_number, elevenlabs_agent_id, businesses(id, name, timezone, hours)",
    )
    .eq("elevenlabs_agent_id", agentId)
    .maybeSingle();

  if (error) {
    throw new AppError(`Failed to resolve agent: ${error.message}`, 500, "DB_ERROR");
  }

  const row = data as AgentLookupRow | null;
  if (!row || !row.businesses) {
    throw new AppError("Unknown agent", 404, "UNKNOWN_AGENT");
  }

  const agent: AgentRow & { elevenlabs_agent_id: string } = {
    id: row.id,
    business_id: row.business_id,
    phone_number: row.phone_number,
    elevenlabs_agent_id: row.elevenlabs_agent_id,
  };

  const { id: callId } = await ensureCallStub(supabase, agent, conversationId, body.caller_id);

  return { agent, business: row.businesses, callId };
}

/**
 * `result` is the sentence the ElevenLabs agent speaks/uses. Always a 200 — a business-logic
 * failure the caller should hear about (e.g. a slot just got taken) is still a successful tool
 * call from ElevenLabs' point of view, not a transport error.
 */
export function toolResponse(
  result: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ ...extra, result });
}

/** Validates that every required field is present and non-empty, and returns the body cast to T. */
export function parseToolBody<T>(
  body: Record<string, unknown>,
  required: string[],
): T {
  const missing = required.filter((key) => {
    const value = body[key];
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    throw new AppError(
      `Missing required field(s): ${missing.join(", ")}`,
      400,
      "MISSING_PARAMS",
    );
  }

  return body as unknown as T;
}

/** Rounds, then clamps to 0-100; anything that doesn't parse as a finite number becomes 0. */
export function clampScore(raw: unknown): number {
  const parsed = Math.round(Number(raw));
  if (Number.isNaN(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
}
