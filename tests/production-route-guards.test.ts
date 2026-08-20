import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("signup requires an invitation and the signup control", () => {
  const auth = source("../apps/web/lib/actions/auth.ts");
  const signup = source("../apps/web/app/(auth)/signup/page.tsx");
  assert.match(auth, /requireProductionOperation\("signup"\)/);
  assert.match(auth, /validateBetaInvitation/);
  assert.match(auth, /invite_code/);
  assert.match(signup, /name="invite_code"/);
  assert.match(signup, /Controlled beta invitation/);
});

test("sensitive web routes use distributed rate limits and kill switches", () => {
  assert.match(source("../apps/web/app/api/demo/calls/route.ts"), /enforceRateLimit\("demo_ip"/);
  assert.match(source("../apps/web/app/api/demo/calls/route.ts"), /enforceRateLimit\("demo_phone"/);
  assert.match(source("../apps/web/app/api/ingestion/route.ts"), /enforceRateLimit\("ingestion"/);
  assert.match(source("../apps/web/app/api/oauth/google/route.ts"), /enforceRateLimit\("oauth"/);
  assert.match(source("../apps/web/app/api/stripe/checkout/route.ts"), /requireProductionOperation\("billing"\)/);
  assert.match(source("../apps/web/app/api/stripe/checkout/route.ts"), /enforceRateLimit\("billing_checkout"/);
  assert.match(source("../apps/web/app/api/stripe/portal/route.ts"), /enforceRateLimit\("billing_portal"/);
  assert.match(source("../apps/web/app/api/voice-preview/route.ts"), /enforceRateLimit\("voice_preview"/);
});

test("agent provisioning and automation dispatch honor emergency controls", () => {
  const provisioning = source("../supabase/functions/retell-create-agent/index.ts");
  const dispatch = source("../supabase/functions/n8n-dispatch/index.ts");
  assert.match(source("../apps/web/lib/actions/admin.ts"), /requireProductionOperation\("agent_provisioning"\)/);
  assert.match(provisioning, /assertServiceRole/);
  assert.match(provisioning, /agent_provisioning_enabled/);
  assert.match(dispatch, /assertServiceRole/);
  assert.match(dispatch, /automation_dispatch_enabled/);
});
