import { AppError, requireEnv } from "./errors.ts";
import {
  type BusinessPromptData,
  buildSystemPrompt,
  mergeTemplateVariables,
  type TemplatePromptData,
} from "./prompts.ts";

const EL_BASE = "https://api.elevenlabs.io/v1";

async function elFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init;

  const requestHeaders = new Headers(headers);
  requestHeaders.set("xi-api-key", requireEnv("ELEVENLABS_API_KEY"));

  let body = rest.body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    requestHeaders.set("Content-Type", "application/json");
  }
  // A FormData body is left untouched so fetch sets its own multipart boundary.

  const response = await fetch(`${EL_BASE}${path}`, {
    ...rest,
    body,
    headers: requestHeaders,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new AppError(
      `ElevenLabs API error: ${text}`,
      response.status,
      "ELEVENLABS_ERROR",
    );
  }

  if (response.status === 204 || text.length === 0) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

// --- agents ---

export interface ElAgentConfig {
  name: string;
  conversation_config: Record<string, unknown>;
  platform_settings?: Record<string, unknown>;
}

export async function createAgent(
  config: ElAgentConfig,
): Promise<{ agent_id: string }> {
  return await elFetch("/convai/agents/create", { method: "POST", json: config });
}

export async function updateAgent(
  agentId: string,
  config: ElAgentConfig,
): Promise<void> {
  await elFetch(`/convai/agents/${agentId}`, { method: "PATCH", json: config });
}

export async function getAgent(agentId: string): Promise<Record<string, unknown>> {
  return await elFetch(`/convai/agents/${agentId}`);
}

export async function deleteAgent(agentId: string): Promise<void> {
  await elFetch(`/convai/agents/${agentId}`, { method: "DELETE" });
}

// --- phone numbers ---

export interface ElPhoneNumber {
  phone_number_id: string;
  phone_number: string;
  label?: string;
  provider?: string;
  assigned_agent?: { agent_id: string; agent_name?: string } | null;
}

export async function importTwilioNumber(
  input: { phoneNumber: string; label: string; agentId?: string },
): Promise<{ phone_number_id: string }> {
  return await elFetch("/convai/phone-numbers", {
    method: "POST",
    json: {
      provider: "twilio",
      phone_number: input.phoneNumber,
      label: input.label,
      sid: requireEnv("TWILIO_ACCOUNT_SID"),
      token: requireEnv("TWILIO_AUTH_TOKEN"),
      ...(input.agentId ? { agent_id: input.agentId } : {}),
    },
  });
}

export async function listPhoneNumbers(): Promise<ElPhoneNumber[]> {
  return await elFetch("/convai/phone-numbers");
}

export async function assignNumberToAgent(
  phoneNumberId: string,
  agentId: string,
): Promise<void> {
  await elFetch(`/convai/phone-numbers/${phoneNumberId}`, {
    method: "PATCH",
    json: { agent_id: agentId },
  });
}

export async function deletePhoneNumber(phoneNumberId: string): Promise<void> {
  await elFetch(`/convai/phone-numbers/${phoneNumberId}`, { method: "DELETE" });
}

// --- knowledge base ---

export async function createKbDocumentFromFile(
  file: Blob,
  filename: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("name", name);

  return await elFetch("/convai/knowledge-base/file", {
    method: "POST",
    body: form,
  });
}

export async function deleteKbDocument(
  documentId: string,
  force = true,
): Promise<void> {
  try {
    await elFetch(
      `/convai/knowledge-base/${documentId}?force=${force ? "true" : "false"}`,
      { method: "DELETE" },
    );
  } catch (error) {
    // Already gone is the state we wanted.
    if (error instanceof AppError && error.statusCode === 404) return;
    throw error;
  }
}

// --- conversations ---

export interface ElConversationSummary {
  conversation_id: string;
  agent_id: string;
  start_time_unix_secs: number;
  call_duration_secs: number;
  status: string;
  call_successful?: string;
}

export async function listConversations(
  query: {
    agentId: string;
    callStartAfterUnix?: number;
    cursor?: string;
    pageSize?: number;
  },
): Promise<{
  conversations: ElConversationSummary[];
  has_more: boolean;
  next_cursor?: string | null;
}> {
  const params = new URLSearchParams({ agent_id: query.agentId });
  if (query.callStartAfterUnix !== undefined) {
    params.set("call_start_after_unix", String(query.callStartAfterUnix));
  }
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  if (query.pageSize !== undefined) params.set("page_size", String(query.pageSize));

  return await elFetch(`/convai/conversations?${params.toString()}`);
}

export interface ElConversation {
  agent_id: string;
  conversation_id: string;
  /** initiated | in-progress | processing | done | failed */
  status: string;
  transcript?: Array<{
    role: string;
    message?: string | null;
    time_in_call_secs?: number;
    tool_calls?: unknown[];
    tool_results?: unknown[];
  }>;
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    cost?: number;
    termination_reason?: string;
    phone_call?: {
      type?: string;
      direction?: string;
      agent_number?: string;
      external_number?: string;
      call_sid?: string;
    };
    [k: string]: unknown;
  };
  analysis?: {
    transcript_summary?: string;
    call_successful?: string;
    data_collection_results?: Record<
      string,
      { data_collection_id?: string; value?: unknown; rationale?: string }
    >;
    evaluation_criteria_results?: Record<string, unknown>;
  };
  conversation_initiation_client_data?: {
    dynamic_variables?: Record<string, unknown>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export async function getConversation(
  conversationId: string,
): Promise<ElConversation> {
  return await elFetch(`/convai/conversations/${conversationId}`);
}

/** Returns the raw Response so the caller can stream the audio straight to Storage. */
export async function getConversationAudio(
  conversationId: string,
): Promise<Response> {
  const response = await fetch(
    `${EL_BASE}/convai/conversations/${conversationId}/audio`,
    { headers: { "xi-api-key": requireEnv("ELEVENLABS_API_KEY") } },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new AppError(
      `ElevenLabs API error: ${text}`,
      response.status,
      "ELEVENLABS_ERROR",
    );
  }

  return response;
}

// --- agent configuration ---

export const DEFAULT_DATA_COLLECTION = {
  customer_name: {
    type: "string",
    description: "Caller's full name if given, else empty string.",
  },
  customer_phone: {
    type: "string",
    description: "Best callback number in E.164 if given, else empty string.",
  },
  customer_email: {
    type: "string",
    description: "Caller's email if given, else empty string.",
  },
  intent: { type: "string", description: "One sentence: why the caller called." },
  outcome: {
    type: "string",
    description:
      "Exactly one of: answered, booked, qualified_lead, transferred, voicemail, missed, other.",
  },
  sentiment: {
    type: "string",
    description: "Exactly one of: positive, neutral, negative.",
  },
  lead_score: {
    type: "integer",
    description: "0-100 lead quality; 0 if not a sales inquiry.",
  },
  appointment_requested: {
    type: "boolean",
    description: "True if the caller asked to book, move or cancel an appointment.",
  },
} as const;

export interface TemplateConfig extends TemplatePromptData {
  agent_name?: string;
  first_message?: string;
  voice?: { elevenlabs_voice_id?: string };
  elevenlabs?: {
    llm?: string;
    temperature?: number;
    data_collection?: Record<string, { type: string; description: string }>;
  };
}

export interface CallPrefs {
  transfer_number?: string | null;
  emergency_number?: string | null;
  voicemail_enabled?: boolean | null;
  voicemail_message?: string | null;
  after_hours_message?: string | null;
}

export interface BuildAgentConfigInput {
  agentRowId: string;
  agentName: string;
  template: TemplateConfig;
  business: BusinessPromptData;
  callPrefs: CallPrefs | null;
  voiceId: string;
  kbDocs: Array<{ elevenlabs_document_id: string; filename: string }>;
  toolIds: {
    check_availability: string;
    book_appointment: string;
    qualify_lead: string;
  };
  includeCalendar: boolean;
}

const DEFAULT_FIRST_MESSAGE =
  "Hi, thanks for calling {{business_name}}. How can I help you today?";

const TRANSFER_CONDITION =
  "Caller asks for a person, is upset after two attempts, or has a request you cannot fulfil.";
const EMERGENCY_CONDITION = "Caller reports an emergency.";

/** Anything still wrapped in {{ }} other than an ElevenLabs system__ variable. */
const UNRENDERED_VARIABLE = /\{\{(?!system__)\w+\}\}/;

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

/** Pure: builds the ElevenLabs agent payload. No env reads, no network. */
export function buildAgentConfig(input: BuildAgentConfigInput): ElAgentConfig {
  const { template, business, callPrefs, toolIds, includeCalendar } = input;

  const firstMessage = mergeTemplateVariables(
    template.first_message ?? DEFAULT_FIRST_MESSAGE,
    business,
  );

  const transferNumber = normalizePhone(callPrefs?.transfer_number);
  const emergencyNumber = normalizePhone(callPrefs?.emergency_number);

  const transfers: Array<{
    transfer_destination: { type: string; phone_number: string };
    condition: string;
    transfer_type: string;
  }> = [];

  if (transferNumber) {
    transfers.push({
      transfer_destination: { type: "phone", phone_number: transferNumber },
      condition: TRANSFER_CONDITION,
      transfer_type: "conference",
    });
  }
  if (emergencyNumber && emergencyNumber !== transferNumber) {
    transfers.push({
      transfer_destination: { type: "phone", phone_number: emergencyNumber },
      // Without a general transfer number this is the only way to reach a human.
      condition: transferNumber ? EMERGENCY_CONDITION : TRANSFER_CONDITION,
      transfer_type: "conference",
    });
  }

  const sections: string[] = [buildSystemPrompt(template, business)];

  const toolLines = [
    "Use qualify_lead once the caller shows buying interest or asks for a quote.",
  ];
  if (includeCalendar) {
    toolLines.push(
      "Use check_availability before offering any appointment time. Use book_appointment only after the caller has confirmed their name, callback number and the exact time.",
    );
  }
  sections.push(`## Tools\n${toolLines.join("\n")}`);

  if (transfers.length > 0) {
    sections.push(
      "## Transfers\nTransfer to a human with transfer_to_number when the caller asks for a person, is upset after two attempts to help, or reports an emergency.",
    );
  }

  if (callPrefs?.after_hours_message) {
    sections.push(`## After hours\n${callPrefs.after_hours_message}`);
  }

  const prompt = sections.join("\n\n");

  const toolIdList = [toolIds.qualify_lead];
  if (includeCalendar) {
    toolIdList.push(toolIds.check_availability, toolIds.book_appointment);
  }

  const config: ElAgentConfig = {
    name: `${business.name} · ${input.agentName} · ${input.agentRowId}`,
    conversation_config: {
      agent: {
        first_message: firstMessage,
        language: "en",
        prompt: {
          prompt,
          llm: template.elevenlabs?.llm ?? "gpt-4o-mini",
          temperature: template.elevenlabs?.temperature ?? 0.5,
          tool_ids: toolIdList,
          built_in_tools: {
            end_call: {
              name: "end_call",
              description:
                "End the call when the caller says goodbye or the request is fully handled.",
              params: { system_tool_type: "end_call" },
            },
            transfer_to_number: transfers.length > 0
              ? {
                name: "transfer_to_number",
                description: "Transfer the caller to a human.",
                params: { system_tool_type: "transfer_to_number", transfers },
              }
              : null,
            voicemail_detection: callPrefs?.voicemail_enabled === false ? null : {
              name: "voicemail_detection",
              description: "Detect voicemail and end the call politely.",
              params: { system_tool_type: "voicemail_detection" },
            },
          },
          knowledge_base: input.kbDocs.map((doc) => ({
            type: "file",
            id: doc.elevenlabs_document_id,
            name: doc.filename,
            usage_mode: "auto",
          })),
          rag: { enabled: false },
        },
      },
      tts: { voice_id: input.voiceId },
      conversation: { max_duration_seconds: 900 },
    },
    platform_settings: {
      data_collection: {
        ...DEFAULT_DATA_COLLECTION,
        ...(template.elevenlabs?.data_collection ?? {}),
      },
    },
  };

  if (UNRENDERED_VARIABLE.test(prompt + firstMessage)) {
    throw new AppError(
      "Unrendered template variable in agent prompt",
      500,
      "TEMPLATE_ERROR",
    );
  }

  return config;
}
