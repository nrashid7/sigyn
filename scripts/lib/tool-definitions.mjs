/**
 * Single source of truth for the three ElevenLabs workspace tools every Sigyn
 * agent shares. `scripts/elevenlabs-setup.mjs` posts/patches these bodies;
 * `scripts/elevenlabs-setup.test.mjs` and the Deno-side tests both check
 * requests/params against them (via `expected_tool_params.json`).
 */

export const TOOL_HEADER = "x-sigyn-tool-secret";
export const SECRET_NAME = "sigyn_tool_secret";
export const WEBHOOK_NAME = "sigyn-post-call";
export const WEBHOOK_EVENTS = ["transcript", "call_initiation_failure"];
export const TOOL_NAMES = ["check_availability", "book_appointment", "qualify_lead"];

/** A property whose value ElevenLabs fills from a system/session variable. */
function dynamicVariable(name) {
  return { type: "string", dynamic_variable: name };
}

/** Every tool call carries these two so the target function can attribute the call. */
function agentAndConversationProperties() {
  return {
    agent_id: dynamicVariable("system__agent_id"),
    conversation_id: dynamicVariable("system__conversation_id"),
  };
}

const TOOL_SPECS = [
  {
    name: "check_availability",
    fn: "calendar-availability",
    description:
      "Check open appointment slots for the business. Call this before offering any appointment time.",
    properties: {
      ...agentAndConversationProperties(),
      start_date: {
        type: "string",
        description: "First day to search, ISO date YYYY-MM-DD, in the business timezone.",
      },
      end_date: { type: "string", description: "Optional last day to search, ISO date." },
      duration_minutes: {
        type: "integer",
        description: "Appointment length in minutes. Default 30.",
      },
    },
    required: ["agent_id", "conversation_id", "start_date"],
  },
  {
    name: "book_appointment",
    fn: "calendar-book",
    description:
      "Book an appointment after the caller confirms name, callback number and exact time.",
    properties: {
      ...agentAndConversationProperties(),
      caller_id: dynamicVariable("system__caller_id"),
      scheduled_at: {
        type: "string",
        description: "Confirmed start time as ISO 8601 with timezone offset.",
      },
      customer_name: {
        type: "string",
        description: "Caller's full name, confirmed back to them.",
      },
      customer_phone: {
        type: "string",
        description: "Callback number confirmed with the caller.",
      },
      customer_email: { type: "string", description: "Optional email." },
      duration_minutes: { type: "integer", description: "Default 30." },
      notes: { type: "string", description: "Service requested and any details." },
    },
    required: ["agent_id", "conversation_id", "scheduled_at", "customer_name", "customer_phone"],
  },
  {
    name: "qualify_lead",
    fn: "qualify-lead",
    description:
      "Record the caller's details and a 0-100 lead score once they show buying interest or ask for a quote.",
    properties: {
      ...agentAndConversationProperties(),
      caller_id: dynamicVariable("system__caller_id"),
      name: { type: "string", description: "Caller's full name." },
      email: { type: "string", description: "Email if given." },
      company: { type: "string", description: "Company if given." },
      need: { type: "string", description: "What they need, one sentence." },
      timeline: { type: "string", description: "When they need it." },
      budget: { type: "string", description: "Budget if mentioned." },
      lead_score: { type: "integer", description: "0-100 lead quality." },
    },
    required: ["agent_id", "conversation_id", "name", "lead_score"],
  },
];

/**
 * Builds the `{ tool_config }` request bodies for POST/PATCH `/convai/tools`.
 * Pure — no env reads, no network.
 */
export function toolDefinitions(supabaseUrl, secretId) {
  return TOOL_SPECS.map((spec) => ({
    tool_config: {
      type: "webhook",
      name: spec.name,
      description: spec.description,
      response_timeout_secs: 20,
      api_schema: {
        url: `${supabaseUrl}/functions/v1/${spec.fn}`,
        method: "POST",
        request_body_schema: {
          type: "object",
          required: spec.required,
          properties: spec.properties,
        },
        request_headers: {
          [TOOL_HEADER]: { secret_id: secretId },
        },
      },
    },
  }));
}
