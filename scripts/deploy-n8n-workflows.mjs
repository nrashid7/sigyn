#!/usr/bin/env node
/**
 * Import and activate BusinessVoice workflows on a self-hosted n8n instance.
 *
 * Usage:
 *   N8N_API_URL=https://n8n-production-08c9.up.railway.app \
 *   N8N_API_KEY=your-api-key \
 *   node scripts/deploy-n8n-workflows.mjs
 *
 * Create API key: n8n → Settings → n8n API → Create API key
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WORKFLOWS_DIR = join(ROOT, "n8n", "workflows");

const baseUrl = (process.env.N8N_API_URL || "https://n8n-production-08c9.up.railway.app").replace(
  /\/$/,
  "",
);
const apiKey = process.env.N8N_API_KEY;

if (!apiKey) {
  console.error("Missing N8N_API_KEY. Create one in n8n → Settings → n8n API.");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "X-N8N-API-KEY": apiKey,
};

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${options.method || "GET"} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function findByName(name) {
  const list = await api("/workflows?limit=100");
  const workflows = list.data ?? list;
  return workflows.find((w) => w.name === name);
}

async function deployWorkflow(filePath) {
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  const { name, nodes, connections, settings } = raw;

  const existing = await findByName(name);
  // tags, active, id are read-only on the public API create/update body.
  const payload = { name, nodes, connections, settings: settings ?? {} };

  let workflow;
  if (existing?.id) {
    workflow = await api(`/workflows/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    console.log(`  Updated: ${name} (${existing.id})`);
  } else {
    workflow = await api("/workflows", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    console.log(`  Created: ${name} (${workflow.id})`);
  }

  const id = workflow.id ?? existing.id;
  await api(`/workflows/${id}/activate`, { method: "POST", body: "{}" });
  console.log(`  Activated: ${name}`);
  return id;
}

async function testWebhooks() {
  const paths = [
    "call-completed",
    "sms-follow-up",
    "hubspot-sync",
    "ghl-sync",
    "sheets-log",
  ];
  const payload = {
    event: "readiness_check",
    business_id: "00000000-0000-0000-0000-000000000001",
    contact: {
      name: "Beta Readiness",
      phone: "+15555550100",
      email: "beta-readiness@example.com",
    },
    call_summary: "Synthetic deployment smoke test.",
    lead_score: 80,
    pipeline_stage: "qualified_lead",
    type: "missed_call",
    phone: "+15555550100",
    metadata: { beta_readiness_check: true, source: "deploy-n8n-workflows.mjs" },
  };

  console.log("\nWebhook smoke test:");
  for (const path of paths) {
    const url = `${baseUrl}/webhook/${path}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const ok = res.status !== 404;
      console.log(`  [${res.status}] ${path}${ok ? "" : " (not registered — activate workflow)"}`);
    } catch (e) {
      console.log(`  [ERR] ${path}: ${e.message}`);
    }
  }
}

async function main() {
  console.log(`Deploying to ${baseUrl}\n`);

  const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files.sort()) {
    console.log(file);
    await deployWorkflow(join(WORKFLOWS_DIR, file));
  }

  await testWebhooks();
  console.log("\nDone. Set N8N_WEBHOOK_BASE_URL in Supabase secrets if not already.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
