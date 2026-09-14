/**
 * Source of truth for this tool's request body shape, kept in lockstep with
 * `qualify_lead` in scripts/lib/tool-definitions.mjs and asserted against
 * supabase/functions/tests/fixtures/expected_tool_params.json.
 */
export const REQUIRED_PARAMS: string[] = [
  "agent_id",
  "conversation_id",
  "name",
  "lead_score",
];

export const ALL_PARAMS: string[] = [
  "agent_id",
  "conversation_id",
  "caller_id",
  "name",
  "email",
  "company",
  "need",
  "timeline",
  "budget",
  "lead_score",
];
