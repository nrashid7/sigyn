/**
 * Source of truth for this tool's request body shape, kept in lockstep with
 * `book_appointment` in scripts/lib/tool-definitions.mjs and asserted against
 * supabase/functions/tests/fixtures/expected_tool_params.json.
 */
export const REQUIRED_PARAMS: string[] = [
  "agent_id",
  "conversation_id",
  "scheduled_at",
  "customer_name",
  "customer_phone",
];

export const ALL_PARAMS: string[] = [
  "agent_id",
  "conversation_id",
  "caller_id",
  "scheduled_at",
  "customer_name",
  "customer_phone",
  "customer_email",
  "duration_minutes",
  "notes",
];
