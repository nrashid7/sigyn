import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const retellShared = readFileSync("supabase/functions/_shared/retell.ts", "utf8");
const webhookShared = readFileSync("supabase/functions/_shared/webhook.ts", "utf8");
const knowledgeActionSource = readFileSync("apps/web/lib/actions/knowledge.ts", "utf8");
const n8nActionSource = readFileSync("apps/web/lib/actions/n8n.ts", "utf8");
const voicePreviewRouteSource = readFileSync("apps/web/app/api/voice-preview/route.ts", "utf8");
const stripeCheckoutRouteSource = readFileSync("apps/web/app/api/stripe/checkout/route.ts", "utf8");
const stripePortalRouteSource = readFileSync("apps/web/app/api/stripe/portal/route.ts", "utf8");
const googleOauthRouteSource = readFileSync("apps/web/app/api/oauth/google/route.ts", "utf8");
const googleOauthCallbackSource = readFileSync("apps/web/app/api/oauth/google/callback/route.ts", "utf8");
const templateSource = readFileSync("packages/shared/src/templates/index.ts", "utf8");
const voicesSource = readFileSync("packages/shared/src/templates/voices.ts", "utf8");
const crmSharedSource = readFileSync("supabase/functions/_shared/crm.ts", "utf8");
const seedSql = readFileSync("supabase/seed.sql", "utf8");
const initialSchema = readFileSync("supabase/migrations/20250524000001_initial_schema.sql", "utf8");
const n8nWorkflowFiles = [
  "n8n/workflows/retell-call-completed.json",
  "n8n/workflows/sms-follow-up.json",
  "n8n/workflows/hubspot-sync.json",
  "n8n/workflows/ghl-sync.json",
  "n8n/workflows/sheets-log.json",
];

test("Retell phone number creation binds the new agent with weighted inbound/outbound agents", () => {
  assert.match(retellShared, /inbound_agents:\s*\[\s*\{\s*agent_id:\s*agentId,\s*weight:\s*1\s*\}/s);
  assert.match(retellShared, /outbound_agents:\s*\[\s*\{\s*agent_id:\s*agentId,\s*weight:\s*1\s*\}/s);
  assert.doesNotMatch(retellShared, /JSON\.stringify\(\s*\{\s*agent_id:\s*agentId,/s);
});

test("Retell webhooks verify with the Retell API key when no dedicated webhook secret is set", () => {
  assert.match(webhookShared, /Deno\.env\.get\("RETELL_WEBHOOK_SECRET"\)\s*\?\?/);
  assert.match(webhookShared, /Deno\.env\.get\("RETELL_API_KEY"\)/);
});

test("Retell template voice IDs are available in the current Retell workspace", () => {
  const staleVoiceIds = ["11labs-Rachel", "11labs-Adam"];
  for (const staleVoiceId of staleVoiceIds) {
    assert.equal(templateSource.includes(staleVoiceId), false);
    assert.equal(voicesSource.includes(staleVoiceId), false);
    assert.equal(seedSql.includes(staleVoiceId), false);
  }
});

test("backend Edge Function callers require the service role key without falling back to anon", () => {
  const serverCallers = [
    knowledgeActionSource,
    n8nActionSource,
    voicePreviewRouteSource,
  ];

  for (const source of serverCallers) {
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY\s*\?\?\s*process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    assert.match(source, /getSupabaseServiceRoleKey\(\)/);
  }
});

test("database helper functions pin their search path", () => {
  const functions = [
    "is_business_member",
    "is_admin",
    "handle_new_user",
    "update_updated_at",
    "match_knowledge_chunks",
  ];

  for (const functionName of functions) {
    const pattern = new RegExp(`CREATE OR REPLACE FUNCTION ${functionName}[\\s\\S]*?SET search_path = public`, "i");
    assert.match(initialSchema, pattern);
  }
});

test("security definer helper functions are not broadly exposed to anonymous RPC callers", () => {
  assert.match(initialSchema, /REVOKE EXECUTE ON FUNCTION is_business_member\(UUID\) FROM PUBLIC/i);
  assert.match(initialSchema, /GRANT EXECUTE ON FUNCTION is_business_member\(UUID\) TO authenticated/i);
  assert.match(initialSchema, /REVOKE EXECUTE ON FUNCTION is_admin\(\) FROM PUBLIC/i);
  assert.match(initialSchema, /GRANT EXECUTE ON FUNCTION is_admin\(\) TO authenticated/i);
  assert.match(initialSchema, /REVOKE EXECUTE ON FUNCTION handle_new_user\(\) FROM PUBLIC/i);
});

test("RLS policies avoid per-row auth.uid re-evaluation and duplicate template select policies", () => {
  const policyLines = initialSchema
    .split("\n")
    .filter((line) => line.includes("CREATE POLICY"));

  for (const line of policyLines) {
    assert.doesNotMatch(line, /(?<!select )auth\.uid\(\)/i);
  }

  assert.doesNotMatch(initialSchema, /CREATE POLICY agent_templates_admin ON agent_templates FOR ALL/i);
  assert.match(initialSchema, /CREATE POLICY agent_templates_admin_insert/i);
  assert.match(initialSchema, /CREATE POLICY agent_templates_admin_update/i);
  assert.match(initialSchema, /CREATE POLICY agent_templates_admin_delete/i);
});

test("optional production integrations fail closed when provider secrets are missing", () => {
  assert.match(stripeCheckoutRouteSource, /requireServerEnv\("STRIPE_SECRET_KEY"\)/);
  assert.match(stripePortalRouteSource, /requireServerEnv\("STRIPE_SECRET_KEY"\)/);
  assert.match(stripeCheckoutRouteSource, /Billing is not configured for this plan/);
  assert.match(googleOauthRouteSource, /hasServerEnv\("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NEXT_PUBLIC_APP_URL", "OAUTH_STATE_SECRET"\)/);
  assert.match(googleOauthCallbackSource, /hasServerEnv\("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "OAUTH_STATE_SECRET", "INTEGRATION_ENCRYPTION_KEY"\)/);
  assert.match(googleOauthRouteSource, /google_not_configured/);
  assert.match(googleOauthCallbackSource, /google_not_configured/);
});

test("n8n workflow exports include side-effect-free beta readiness gates", () => {
  for (const file of n8nWorkflowFiles) {
    const workflow = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(
      workflow.nodes.some((node) => node.name === "Is Readiness Check"),
      `${file} is missing Is Readiness Check`,
    );
    assert.match(JSON.stringify(workflow), /beta_readiness_check/);
  }
});

test("n8n call completed router matches the app dispatch event name", () => {
  const workflow = JSON.parse(readFileSync("n8n/workflows/retell-call-completed.json", "utf8"));
  assert.match(JSON.stringify(workflow), /call_completed/);
  assert.doesNotMatch(JSON.stringify(workflow), /call\.completed/);
});

test("n8n dispatch payload preserves caller metadata for readiness and CRM context", () => {
  assert.match(crmSharedSource, /metadata\?: Record<string, unknown>/);
  assert.match(crmSharedSource, /\.\.\.\(options\.metadata \?\? \{\}\)/);
});
