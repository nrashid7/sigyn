#!/usr/bin/env node
/**
 * Create (or update) the workspace-level ElevenLabs objects every Sigyn agent
 * depends on: the shared tool-auth secret, the three webhook tools
 * (check_availability, book_appointment, qualify_lead), and the post-call
 * webhook. Idempotent — every step finds existing objects by name first.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... SUPABASE_URL=https://xxx.supabase.co \
 *   node scripts/elevenlabs-setup.mjs
 *
 *   node scripts/elevenlabs-setup.mjs --dry-run   # print the plan, no network
 *   node scripts/elevenlabs-setup.mjs --rotate    # new secret + re-point tools
 */

import { randomBytes } from "node:crypto";

import {
  SECRET_NAME,
  TOOL_NAMES,
  WEBHOOK_EVENTS,
  WEBHOOK_NAME,
  toolDefinitions,
} from "./lib/tool-definitions.mjs";

const EL_BASE = "https://api.elevenlabs.io/v1";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const rotate = args.includes("--rotate");

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
if (!supabaseUrl) {
  console.error("Missing required env var: SUPABASE_URL");
  process.exit(1);
}

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey && !dryRun) {
  console.error("Missing required env var: ELEVENLABS_API_KEY (or pass --dry-run)");
  process.exit(1);
}

// --- HTTP + response-shape helpers -----------------------------------------

async function api(method, path, body) {
  const res = await fetch(`${EL_BASE}${path}`, {
    method,
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    console.error(`\n${method} ${path} → ${res.status}`);
    console.error(typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2));
    process.exit(1);
  }

  return parsed;
}

/** Defends against the "list shape is partly unverified" reality: never guess. */
function asList(response, key, context) {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response[key])) return response[key];
  console.error(`\nUnexpected response shape for ${context}.`);
  console.error(
    `Expected an array or an object with a "${key}" array — check the ElevenLabs API docs. Raw response:`,
  );
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}

function redactBody(body) {
  if (!body || typeof body !== "object") return body;
  const clone = { ...body };
  if ("value" in clone) clone.value = "<redacted>";
  return clone;
}

function logPlanned(method, path, body) {
  console.log(`  [DRY RUN] ${method} ${path}`);
  if (body !== undefined) {
    console.log(`    ${JSON.stringify(redactBody(body))}`);
  }
}

function nextRotationVersion(secrets) {
  const pattern = new RegExp(`^${SECRET_NAME}(?:_v(\\d+))?$`);
  let max = 0;
  for (const secret of secrets) {
    const match = typeof secret?.name === "string" ? secret.name.match(pattern) : null;
    if (!match) continue;
    max = Math.max(max, match[1] ? Number(match[1]) : 1);
  }
  return max + 1;
}

function secretNameForVersion(version) {
  return version <= 1 ? SECRET_NAME : `${SECRET_NAME}_v${version}`;
}

// --- Step 1: tool-auth secret ------------------------------------------------

async function ensureSecret() {
  console.log("1. Tool-auth secret");

  const suppliedValue = process.env.ELEVENLABS_TOOL_SECRET || null;

  if (dryRun) {
    const name = rotate ? secretNameForVersion(2) : SECRET_NAME;
    logPlanned("GET", "/convai/secrets");
    const value = suppliedValue ?? randomBytes(32).toString("hex");
    logPlanned("POST", "/convai/secrets", { type: "new", name, value });
    console.log(`  (dry run: assuming '${name}' does not exist yet)`);
    return { secretId: "dry-run-secret-id", value, knowValue: true };
  }

  const list = await api("GET", "/convai/secrets");
  const secrets = asList(list, "secrets", "GET /convai/secrets");

  if (rotate) {
    const version = nextRotationVersion(secrets);
    const name = secretNameForVersion(version);
    const value = suppliedValue ?? randomBytes(32).toString("hex");
    const created = await api("POST", "/convai/secrets", { type: "new", name, value });
    console.log(`  Created: ${name} (${created.secret_id})`);
    return { secretId: created.secret_id, value, knowValue: true };
  }

  const existing = secrets.find((secret) => secret?.name === SECRET_NAME);
  if (existing) {
    console.log(`  Found existing: ${SECRET_NAME} (${existing.secret_id})`);
    if (!suppliedValue) {
      console.log(
        `  WARNING: '${SECRET_NAME}' already exists and ElevenLabs never returns secret values.\n` +
          "           Set ELEVENLABS_TOOL_SECRET to the value used when it was created, or pass\n" +
          "           --rotate to create a new versioned secret and re-point the tools at it.",
      );
    }
    return {
      secretId: existing.secret_id,
      value: suppliedValue,
      knowValue: Boolean(suppliedValue),
    };
  }

  const value = suppliedValue ?? randomBytes(32).toString("hex");
  const created = await api("POST", "/convai/secrets", { type: "new", name: SECRET_NAME, value });
  console.log(`  Created: ${SECRET_NAME} (${created.secret_id})`);
  return { secretId: created.secret_id, value, knowValue: true };
}

// --- Step 2: tools ------------------------------------------------------------

async function ensureTools(secretId) {
  console.log("\n2. Tools");

  const definitions = toolDefinitions(supabaseUrl, secretId);
  const toolIds = {};

  if (dryRun) {
    logPlanned("GET", "/convai/tools");
    for (const def of definitions) {
      logPlanned("POST", "/convai/tools", def);
      toolIds[def.tool_config.name] = `dry-run-${def.tool_config.name}-id`;
    }
    return toolIds;
  }

  const list = await api("GET", "/convai/tools");
  const existingTools = asList(list, "tools", "GET /convai/tools");

  for (const def of definitions) {
    const name = def.tool_config.name;
    const existing = existingTools.find((tool) => tool?.tool_config?.name === name);

    if (existing) {
      await api("PATCH", `/convai/tools/${existing.id}`, def);
      console.log(`  Updated: ${name} (${existing.id})`);
      toolIds[name] = existing.id;
    } else {
      const created = await api("POST", "/convai/tools", def);
      console.log(`  Created: ${name} (${created.id})`);
      toolIds[name] = created.id;
    }
  }

  return toolIds;
}

// --- Step 3: post-call webhook ------------------------------------------------

async function ensureWebhook() {
  console.log("\n3. Post-call webhook");

  const webhookUrl = `${supabaseUrl}/functions/v1/elevenlabs-webhook`;

  if (dryRun) {
    logPlanned("GET", "/workspace/webhooks");
    logPlanned("POST", "/workspace/webhooks", {
      name: WEBHOOK_NAME,
      webhook_url: webhookUrl,
      auth_type: "hmac",
    });
    logPlanned("PATCH", "/workspace/webhooks/dry-run-webhook-id", {
      name: WEBHOOK_NAME,
      is_disabled: false,
      retry_enabled: true,
    });
    logPlanned("PATCH", "/convai/settings", {
      webhooks: { post_call_webhook_id: "dry-run-webhook-id", events: WEBHOOK_EVENTS },
    });
    return { webhookId: "dry-run-webhook-id", webhookSecret: null };
  }

  const list = await api("GET", "/workspace/webhooks");
  const webhooks = asList(list, "webhooks", "GET /workspace/webhooks");
  const existing = webhooks.find((hook) => hook?.name === WEBHOOK_NAME);

  let webhookId;
  let webhookSecret = null;

  if (existing) {
    webhookId = existing.webhook_id;
    console.log(`  Found existing: ${WEBHOOK_NAME} (${webhookId})`);
    console.log(
      `  WARNING: '${WEBHOOK_NAME}' already exists and ElevenLabs never returns webhook secrets again.\n` +
        "           Reuse the stored ELEVENLABS_WEBHOOK_SECRET, or delete the webhook in\n" +
        "           Settings → Webhooks and re-run this script to get a fresh one.",
    );
  } else {
    const created = await api("POST", "/workspace/webhooks", {
      name: WEBHOOK_NAME,
      webhook_url: webhookUrl,
      auth_type: "hmac",
    });
    webhookId = created.webhook_id;
    webhookSecret = created.webhook_secret;
    console.log(`  Created: ${WEBHOOK_NAME} (${webhookId})`);
  }

  await api("PATCH", `/workspace/webhooks/${webhookId}`, {
    name: WEBHOOK_NAME,
    is_disabled: false,
    retry_enabled: true,
  });
  console.log("  Enabled, retries on");

  await api("PATCH", "/convai/settings", {
    webhooks: { post_call_webhook_id: webhookId, events: WEBHOOK_EVENTS },
  });
  console.log("  Linked in /convai/settings");

  return { webhookId, webhookSecret };
}

// --- Step 4: verify ------------------------------------------------------------

async function verify(toolIds, webhookId) {
  console.log("\n4. Verify");

  const rows = [];
  for (const name of TOOL_NAMES) {
    const id = toolIds[name];
    if (dryRun) {
      logPlanned("GET", `/convai/tools/${id}`);
      rows.push([name, id, "(dry run)"]);
      continue;
    }
    const tool = await api("GET", `/convai/tools/${id}`);
    rows.push([name, id, tool?.tool_config?.name === name ? "ok" : "MISMATCH"]);
  }

  if (dryRun) {
    logPlanned("GET", "/convai/settings");
  } else {
    const settings = await api("GET", "/convai/settings");
    const configured = settings?.webhooks?.post_call_webhook_id;
    if (configured !== webhookId) {
      console.error(
        "\nUnexpected /convai/settings shape (post_call_webhook_id did not match). Raw response:",
      );
      console.error(JSON.stringify(settings, null, 2));
      process.exit(1);
    }
  }

  const nameWidth = Math.max(4, ...rows.map(([name]) => name.length));
  const idWidth = Math.max(2, ...rows.map(([, id]) => String(id).length));
  console.log(`\n  ${"tool".padEnd(nameWidth)}  ${"id".padEnd(idWidth)}  status`);
  for (const [name, id, status] of rows) {
    console.log(`  ${name.padEnd(nameWidth)}  ${String(id).padEnd(idWidth)}  ${status}`);
  }

  // A MISMATCH means the id we are about to print into ELEVENLABS_TOOL_IDS points at a
  // tool with a different name — agents would be wired to the wrong endpoint. Fail like
  // the /convai/settings check above rather than printing a broken secrets line.
  const mismatched = rows.filter(([, , status]) => status === "MISMATCH").map(([name]) => name);
  if (mismatched.length > 0) {
    console.error(
      `\nTool name mismatch for: ${mismatched.join(", ")}. ` +
        "The tool id resolves to a differently-named tool — inspect these in the ElevenLabs dashboard before storing any ids.",
    );
    process.exit(1);
  }
}

// --- Step 5: print the command, never run it ----------------------------------

function printSecretsSetLine(toolIds, secret, webhookSecret) {
  console.log("\n5. Store these in Supabase\n");

  const parts = [`ELEVENLABS_TOOL_IDS='${JSON.stringify(toolIds)}'`];

  if (secret.knowValue && secret.value) {
    parts.push(`ELEVENLABS_TOOL_SECRET=${secret.value}`);
  }
  if (webhookSecret) {
    parts.push(`ELEVENLABS_WEBHOOK_SECRET=${webhookSecret}`);
  }

  console.log(`  supabase secrets set ${parts.join(" ")}`);

  if (!secret.knowValue || !secret.value) {
    console.log(
      "\n  ELEVENLABS_TOOL_SECRET omitted: the existing secret's value cannot be read back from\n" +
        "  ElevenLabs. Supply ELEVENLABS_TOOL_SECRET yourself, or re-run with --rotate.",
    );
  }
  if (!webhookSecret) {
    console.log(
      `\n  ELEVENLABS_WEBHOOK_SECRET omitted: ${
        dryRun
          ? "this is a dry run, no webhook was created."
          : "the existing webhook's secret cannot be read back from ElevenLabs. Reuse the stored value, or delete the webhook in Settings → Webhooks and re-run."
      }`,
    );
  }
}

async function main() {
  console.log(
    `ElevenLabs workspace setup${dryRun ? " — DRY RUN" : ""}${rotate ? " (rotating secret)" : ""}`,
  );
  console.log(`Supabase URL: ${supabaseUrl}\n`);

  const secret = await ensureSecret();
  const toolIds = await ensureTools(secret.secretId);
  const { webhookId, webhookSecret } = await ensureWebhook();
  await verify(toolIds, webhookId);
  printSecretsSetLine(toolIds, secret, webhookSecret);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
