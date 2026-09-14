#!/usr/bin/env node
/**
 * Smoke-test the deployed ElevenLabs-facing Supabase functions from a Mac.
 * Hits real, already-deployed functions — never run this in CI, and never
 * run it without knowing exactly which project SUPABASE_URL points at.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   ELEVENLABS_WEBHOOK_SECRET=... \
 *   ELEVENLABS_TOOL_SECRET=... \
 *   [AGENT_ID=agent_xxx] \
 *   node scripts/smoke-elevenlabs.mjs \
 *     [--fixture post_call_transcription|missed-call] \
 *     [--to +15551234567] \
 *     [--provision <business_id>]
 *
 * Without AGENT_ID, the webhook + tool checks that need a real agent row are
 * skipped rather than failed (there is no agent to look up).
 */

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TOOL_HEADER } from "./lib/tool-definitions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");

function parseArgs(argv) {
  const parsed = { fixture: "post_call_transcription", to: null, provision: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--fixture") parsed.fixture = argv[++i];
    else if (argv[i] === "--to") parsed.to = argv[++i];
    else if (argv[i] === "--provision") parsed.provision = argv[++i];
  }
  return parsed;
}

const { fixture, to, provision } = parseArgs(process.argv.slice(2));

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/$/, "");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const webhookSecret = requireEnv("ELEVENLABS_WEBHOOK_SECRET");
const toolSecret = requireEnv("ELEVENLABS_TOOL_SECRET");
const agentId = process.env.AGENT_ID || null;

// --- PASS/FAIL harness ---------------------------------------------------------

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, pass: false });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

function assertStatus(res, expected, context) {
  if (res.status !== expected) {
    throw new Error(`${context}: expected ${expected}, got ${res.status}`);
  }
}

// --- fixtures + signing ---------------------------------------------------------

function loadFixture(name) {
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf8");
  return JSON.parse(raw);
}

/** Matches supabase/functions/_shared/webhook.ts: hmac_sha256_hex(secret, "t.body"), unprefixed. */
function signBody(body, secret, atSecs = Math.floor(Date.now() / 1000)) {
  const v0 = createHmac("sha256", secret).update(`${atSecs}.${body}`).digest("hex");
  return { t: atSecs, v0, header: `t=${atSecs},v0=${v0}` };
}

// --- 1. Signed webhook -----------------------------------------------------------

async function checkSignedWebhook() {
  const fixtureObj = loadFixture(fixture);
  fixtureObj.data.agent_id = agentId ?? "agent_test";
  if (to) {
    fixtureObj.data.metadata.phone_call.external_number = to;
  }
  const conversationId = fixtureObj.data.conversation_id;
  const body = JSON.stringify(fixtureObj);
  const { header } = signBody(body, webhookSecret);
  const url = `${supabaseUrl}/functions/v1/elevenlabs-webhook`;

  await check("elevenlabs-webhook: valid signature returns 200", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "elevenlabs-signature": header },
      body,
    });
    assertStatus(res, 200, "POST elevenlabs-webhook (valid signature)");
    const json = await res.json();

    if (agentId) {
      if (json.received !== true) {
        throw new Error(`Expected { received: true }, got ${JSON.stringify(json)}`);
      }
    } else if (json.skipped !== true) {
      throw new Error(`Expected { skipped: true } without AGENT_ID, got ${JSON.stringify(json)}`);
    }
  });

  if (agentId) {
    await check("elevenlabs-webhook: writes a matching calls row", async () => {
      const restUrl =
        `${supabaseUrl}/rest/v1/calls?elevenlabs_conversation_id=eq.${encodeURIComponent(conversationId)}` +
        "&select=id,status,outcome";
      const res = await fetch(restUrl, {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      });
      assertStatus(res, 200, "GET rest/v1/calls");
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(`No calls row found for elevenlabs_conversation_id=${conversationId}`);
      }
    });
  }

  await check("elevenlabs-webhook: tampered body returns 401", async () => {
    const tampered = body.replace(
      /"call_duration_secs":(\d+)/,
      (_match, digits) => `"call_duration_secs":${Number(digits) + 1}`,
    );
    if (tampered === body) {
      throw new Error("fixture has no call_duration_secs field to tamper with");
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "elevenlabs-signature": header },
      body: tampered,
    });
    assertStatus(res, 401, "POST elevenlabs-webhook (tampered body)");
  });
}

// --- 2. Tool auth matrix on qualify-lead ------------------------------------------

async function checkToolAuthMatrix() {
  const url = `${supabaseUrl}/functions/v1/qualify-lead`;
  const baseBody = {
    conversation_id: "conv_smoke_test",
    name: "Smoke Test Caller",
    lead_score: 42,
  };

  await check("qualify-lead: missing tool secret returns 401", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...baseBody, agent_id: "agent_test" }),
    });
    assertStatus(res, 401, "POST qualify-lead (no header)");
  });

  await check("qualify-lead: unknown agent_id returns 404", async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [TOOL_HEADER]: toolSecret },
      body: JSON.stringify({ ...baseBody, agent_id: "bogus" }),
    });
    assertStatus(res, 404, "POST qualify-lead (bogus agent_id)");
  });

  if (agentId) {
    await check("qualify-lead: real agent_id returns 200 with a result string", async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", [TOOL_HEADER]: toolSecret },
        body: JSON.stringify({ ...baseBody, agent_id: agentId }),
      });
      assertStatus(res, 200, "POST qualify-lead (real agent_id)");
      const json = await res.json();
      if (typeof json.result !== "string") {
        throw new Error(`Expected { result: string }, got ${JSON.stringify(json)}`);
      }
    });
  }
}

// --- 3. calls-reconcile ------------------------------------------------------------

async function checkCallsReconcile() {
  await check("calls-reconcile: returns 200 with an agents key", async () => {
    const res = await fetch(`${supabaseUrl}/functions/v1/calls-reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ since_hours: 1 }),
    });
    assertStatus(res, 200, "POST calls-reconcile");
    const json = await res.json();
    if (!("agents" in json)) {
      throw new Error(`Expected an "agents" key, got ${JSON.stringify(json)}`);
    }
  });
}

// --- 4. --provision (opt-in; may buy a Twilio number) -------------------------------

async function checkProvision() {
  await check(`agent-provision: provisions business ${provision}`, async () => {
    const res = await fetch(`${supabaseUrl}/functions/v1/agent-provision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({
        business_id: provision,
        template_slug: "dexter",
        include_calendar: true,
      }),
    });
    assertStatus(res, 200, "POST agent-provision");
    const json = await res.json();
    console.log(`        ${JSON.stringify(json)}`);
  });
}

async function main() {
  console.log(`Smoke test against ${supabaseUrl}`);
  console.log(
    `Fixture: ${fixture}${to ? `  --to ${to}` : ""}` +
      (agentId ? `  AGENT_ID=${agentId}` : "  (no AGENT_ID — some checks will be skipped)"),
  );

  console.log("\n1. Signed webhook");
  await checkSignedWebhook();

  console.log("\n2. Tool auth matrix (qualify-lead)");
  await checkToolAuthMatrix();

  console.log("\n3. calls-reconcile");
  await checkCallsReconcile();

  if (provision) {
    console.log("\n4. Provisioning (--provision passed — this may buy a Twilio number)");
    await checkProvision();
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
