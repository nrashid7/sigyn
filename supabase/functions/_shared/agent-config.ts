import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError, requireEnv } from "./errors.ts";
import {
  buildAgentConfig,
  type CallPrefs,
  type ElAgentConfig,
  type TemplateConfig,
} from "./elevenlabs.ts";
import type { BusinessPromptData } from "./prompts.ts";

/** ElevenLabs's own default voice, used when neither the agent nor its template names one. */
export const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export interface BusinessRow {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  timezone: string | null;
  hours: Record<string, { open: string; close: string; closed?: boolean }> | null;
  industry: string | null;
}

export interface TemplateRow {
  id: string;
  slug: string;
  name: string;
  /** jsonb: a `TemplateConfig` plus display-only fields the agent never sees. */
  config: TemplateConfig;
}

export interface KnowledgeDocRow {
  elevenlabs_document_id: string;
  filename: string;
}

/** The `agents` columns needed to rebuild an ElevenLabs config. */
export interface AgentConfigRow {
  id: string;
  name: string;
  voice_id: string | null;
  config: Record<string, unknown>;
}

/** The `agents` columns both `agent-provision` and `agent-sync` work with. */
export interface AgentRow extends AgentConfigRow {
  business_id: string;
  template_id: string;
  type: string;
  elevenlabs_agent_id: string | null;
  elevenlabs_phone_number_id: string | null;
  twilio_phone_sid: string | null;
  phone_number: string | null;
  voice_provider: string;
  is_active: boolean;
  provision_status: string;
  provision_error: string | null;
  updated_at: string | null;
}

export interface AgentConfigSources {
  business: BusinessRow;
  template: TemplateRow;
  callPrefs: CallPrefs | null;
  kbDocs: KnowledgeDocRow[];
}

export interface ToolIds {
  check_availability: string;
  book_appointment: string;
  qualify_lead: string;
}

const TOOL_ID_KEYS = [
  "check_availability",
  "book_appointment",
  "qualify_lead",
] as const;

/**
 * Everything an agent's prompt is built from: the business, its template, the owner's
 * call preferences and the knowledge base documents ElevenLabs already holds.
 */
export async function loadAgentConfigSources(
  supabase: SupabaseClient,
  businessId: string,
  templateId: string,
): Promise<AgentConfigSources> {
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", businessId)
    .single();

  if (businessError || !business) {
    throw new AppError("Business not found", 404, "NOT_FOUND");
  }

  const { data: template, error: templateError } = await supabase
    .from("agent_templates")
    .select("*")
    .eq("id", templateId)
    .single();

  if (templateError || !template) {
    throw new AppError("Agent template not found", 404, "NOT_FOUND");
  }

  const { data: callPrefs, error: callPrefsError } = await supabase
    .from("call_preferences")
    .select(
      "transfer_number, emergency_number, voicemail_enabled, voicemail_message, after_hours_message",
    )
    .eq("business_id", businessId)
    .maybeSingle();

  if (callPrefsError) {
    throw new AppError(
      `Failed to load call preferences: ${callPrefsError.message}`,
      500,
      "DB_ERROR",
    );
  }

  const { data: kbDocs, error: kbError } = await supabase
    .from("knowledge_documents")
    .select("elevenlabs_document_id, filename")
    .eq("business_id", businessId)
    .eq("status", "ready")
    .not("elevenlabs_document_id", "is", null);

  if (kbError) {
    throw new AppError(
      `Failed to load knowledge documents: ${kbError.message}`,
      500,
      "DB_ERROR",
    );
  }

  return {
    business: business as BusinessRow,
    template: template as TemplateRow,
    callPrefs: (callPrefs as CallPrefs | null) ?? null,
    kbDocs: (kbDocs ?? []) as KnowledgeDocRow[],
  };
}

/** The workspace tool ids created by `scripts/elevenlabs-setup.mjs`, from a JSON secret. */
export function loadToolIds(): ToolIds {
  const raw = requireEnv("ELEVENLABS_TOOL_IDS");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError(
      "ELEVENLABS_TOOL_IDS is missing tool ids",
      500,
      "CONFIG_ERROR",
    );
  }

  const record = parsed as Record<string, unknown>;
  const toolIds = {} as ToolIds;

  for (const key of TOOL_ID_KEYS) {
    const value = record[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new AppError(
        "ELEVENLABS_TOOL_IDS is missing tool ids",
        500,
        "CONFIG_ERROR",
      );
    }
    toolIds[key] = value;
  }

  return toolIds;
}

export function toBusinessPromptData(business: BusinessRow): BusinessPromptData {
  return {
    name: business.name,
    website: business.website,
    phone: business.phone,
    timezone: business.timezone ?? undefined,
    hours: business.hours ?? undefined,
    industry: business.industry ?? undefined,
  };
}

/**
 * The full ElevenLabs config for one agent row. `agent-provision` and `agent-sync` both
 * go through here so a re-push is byte-for-byte what the hire flow would have sent.
 */
export function buildConfigForAgent(
  agentRow: AgentConfigRow,
  sources: AgentConfigSources,
  includeCalendar: boolean,
  toolIds: ToolIds = loadToolIds(),
): ElAgentConfig {
  const template = sources.template.config;

  return buildAgentConfig({
    agentRowId: agentRow.id,
    agentName: agentRow.name,
    template,
    business: toBusinessPromptData(sources.business),
    callPrefs: sources.callPrefs,
    voiceId: agentRow.voice_id ?? template.voice?.elevenlabs_voice_id ??
      DEFAULT_VOICE_ID,
    kbDocs: sources.kbDocs,
    toolIds,
    includeCalendar,
  });
}

/**
 * The calendar choice made at hire time, so a re-sync rebuilds the same config. A JSON `null`
 * (as well as a missing key) means "not set yet" and defaults to `true`, same as `undefined`.
 */
export function includeCalendarOf(config: Record<string, unknown>): boolean {
  return (config.include_calendar ?? true) === true;
}
