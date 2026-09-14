/**
 * Source of truth for this tool's request body shape, kept in lockstep with
 * `check_availability` in scripts/lib/tool-definitions.mjs and asserted against
 * supabase/functions/tests/fixtures/expected_tool_params.json.
 */
export const REQUIRED_PARAMS: string[] = ["agent_id", "conversation_id", "start_date"];

export const ALL_PARAMS: string[] = [
  "agent_id",
  "conversation_id",
  "start_date",
  "end_date",
  "duration_minutes",
];
