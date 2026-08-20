import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hashBetaInvite, normalizeInviteEmail } from "../apps/web/lib/server/beta-invitations.ts";
import { evaluateControl, type ProductionControls } from "../apps/web/lib/server/production-controls.ts";
import { hashRateLimitKey, RATE_LIMIT_POLICIES } from "../apps/web/lib/server/rate-limit.ts";
import {
  assertBetaInvitation,
  consumeDistributedRateLimit,
  readProductionControls,
} from "../apps/web/lib/server/production-runtime.ts";

test("beta invitation identifiers are normalized and secret-keyed", () => {
  const secret = "invite-secret-with-32-bytes-minimum";
  const alternate = "another-secret-with-32-bytes-min";
  assert.equal(normalizeInviteEmail("  Owner@Example.COM "), "owner@example.com");
  assert.equal(
    hashBetaInvite("beta-code", secret),
    hashBetaInvite("beta-code", secret),
  );
  assert.notEqual(
    hashBetaInvite("beta-code", secret),
    hashBetaInvite("beta-code", alternate),
  );
  assert.equal(hashBetaInvite("beta-code", secret).includes("beta-code"), false);
});

test("operational controls fail closed when unavailable or disabled", () => {
  const enabled: ProductionControls = {
    signup_enabled: true,
    agent_provisioning_enabled: true,
    billing_enabled: true,
    automation_dispatch_enabled: true,
  };

  assert.deepEqual(evaluateControl("billing", enabled), { enabled: true });
  assert.deepEqual(evaluateControl("signup", { ...enabled, signup_enabled: false }), {
    enabled: false,
    message: "New beta signups are temporarily paused",
  });
  assert.equal(evaluateControl("automation_dispatch", null).enabled, false);
});

test("rate-limit keys are secret-keyed and production policies cover every sensitive flow", () => {
  const secret = "rate-limit-secret-with-32-bytes-min";
  const first = hashRateLimitKey("203.0.113.5", secret);
  assert.equal(first, hashRateLimitKey("203.0.113.5", secret));
  assert.notEqual(first, hashRateLimitKey("203.0.113.6", secret));
  assert.equal(first.includes("203.0.113.5"), false);
  assert.deepEqual(Object.keys(RATE_LIMIT_POLICIES).sort(), [
    "agent_provisioning",
    "billing_checkout",
    "billing_portal",
    "demo_ip",
    "demo_phone",
    "ingestion",
    "oauth",
    "voice_preview",
  ]);
});

test("production controls migration enforces invite-only signup, a ten-account cap, and atomic limits", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20260808220000_controlled_beta_readiness.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.beta_invitations/i);
  assert.match(sql, /hook_restrict_beta_signup/i);
  assert.match(sql, /consumed_at IS NOT NULL[\s\S]*>= 10/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /consume_rate_limit/i);
  assert.match(sql, /signup_enabled/i);
  assert.match(sql, /automation_dispatch_enabled/i);
  assert.doesNotMatch(sql, /pg_catalog\.extract\s*\(/i);
  assert.match(sql, /EXTRACT\s*\(\s*epoch\s+FROM/i);
  assert.doesNotMatch(sql, /pg_catalog\.greatest\s*\(/i);
  assert.match(sql, /GREATEST\s*\(/i);
});

test("database hardening relocates pgvector and indexes every production foreign key", () => {
  const hardening = readFileSync(
    new URL("../supabase/migrations/20260820160000_database_advisor_hardening.sql", import.meta.url),
    "utf8",
  );

  assert.match(hardening, /ALTER EXTENSION vector SET SCHEMA extensions/i);
  for (const columns of [
    "agents(template_id)",
    "appointments(agent_id)",
    "appointments(call_id)",
    "beta_invitations(created_by)",
    "calls(agent_id)",
    "sms_messages(business_id)",
    "sms_messages(call_id)",
    "system_controls(updated_by)",
    "usage_records(call_id)",
    "workflows(business_id)",
  ]) {
    assert.ok(hardening.replaceAll(/\s+/g, "").includes(`ONpublic.${columns}`));
  }
});

test("production runtime validates invitations and consumes database-backed limits", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown> = {}) {
      calls.push({ name, args });
      if (name === "validate_beta_invitation") return { data: true, error: null };
      if (name === "get_system_controls") return { data: [{ signup_enabled: true, agent_provisioning_enabled: true, billing_enabled: true, automation_dispatch_enabled: true }], error: null };
      return { data: [{ allowed: false, remaining: 0, retry_after_seconds: 42 }], error: null };
    },
  };
  await assertBetaInvitation(client, "Owner@Example.com", "a".repeat(64));
  assert.equal((await readProductionControls(client)).signup_enabled, true);
  assert.deepEqual(await consumeDistributedRateLimit(client, "ingestion", "tenant-1", "rate-limit-secret-with-32-bytes-min"), {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 42,
  });
  assert.equal(calls[0]?.name, "validate_beta_invitation");
  assert.equal(calls[2]?.name, "consume_rate_limit");
});

test("beta invitations are issued by an explicit server-side operator command", () => {
  const script = readFileSync(new URL("../scripts/create-beta-invite.mjs", import.meta.url), "utf8");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["create:beta-invite"], "node scripts/create-beta-invite.mjs");
  assert.match(script, /--email/);
  assert.match(script, /BETA_INVITE_SECRET/);
  assert.match(script, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(script, /randomBytes/);
  assert.doesNotMatch(script, /process\.env\.BETA_INVITE_CODE/);
});

test("operational kill switches have an explicit production-safe operator command", () => {
  const script = readFileSync(new URL("../scripts/set-production-controls.mjs", import.meta.url), "utf8");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["set:production-controls"], "node scripts/set-production-controls.mjs");
  assert.match(script, /--confirm-production/);
  assert.match(script, /signup_enabled/);
  assert.match(script, /agent_provisioning_enabled/);
  assert.match(script, /billing_enabled/);
  assert.match(script, /automation_dispatch_enabled/);
});
