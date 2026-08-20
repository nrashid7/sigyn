#!/usr/bin/env node
import { existsSync } from "node:fs";
/**
 * Beta launch gate for BusinessVoice AI.
 *
 * Checks the live n8n instance for required workflows, required credentials,
 * and optional webhook readiness responses that do not send SMS or write CRM data.
 */

const DEFAULT_N8N_API_URL = "https://n8n-production-08c9.up.railway.app";
const RETELL_KNOWLEDGE_MIGRATION = "supabase/migrations/20260808210000_retell_knowledge_sync.sql";
const RETELL_KNOWLEDGE_FUNCTION = "supabase/functions/retell-knowledge-sync/index.ts";

const REQUIRED_WORKFLOWS = [
  {
    name: "BusinessVoice - Call Completed Router",
    path: "call-completed",
  },
  {
    name: "BusinessVoice - SMS Follow-Up",
    path: "sms-follow-up",
  },
  {
    name: "BusinessVoice - HubSpot Sync",
    path: "hubspot-sync",
  },
  {
    name: "BusinessVoice - GoHighLevel Sync",
    path: "ghl-sync",
  },
  {
    name: "BusinessVoice - Google Sheets Log",
    path: "sheets-log",
  },
];

const REQUIRED_CREDENTIALS = [
  { label: "Twilio", types: ["twilioApi"], requiredFor: "SMS Follow-Up" },
  { label: "HubSpot", types: ["hubspotApi", "hubspotOAuth2Api"], requiredFor: "HubSpot Sync" },
  { label: "GoHighLevel", types: ["goHighLevelApi"], requiredFor: "GoHighLevel Sync" },
  {
    label: "Google Sheets",
    types: ["googleSheetsOAuth2Api", "googleOAuth2Api"],
    requiredFor: "Google Sheets Log",
  },
];

const args = new Set(process.argv.slice(2));
const shouldPingWebhooks = args.has("--webhooks");
const shouldVerifySupabase = args.has("--supabase");

const baseUrl = (process.env.N8N_API_URL || DEFAULT_N8N_API_URL).replace(/\/$/, "");
const apiKey = process.env.N8N_API_KEY;

if (!apiKey) {
  console.error("Missing N8N_API_KEY. Create one in n8n, then run this command again.");
  process.exit(1);
}

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.warn(`WARN ${message}`);
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function verifyRetellKnowledgeFiles() {
  if (!existsSync(RETELL_KNOWLEDGE_MIGRATION)) fail(`Missing ${RETELL_KNOWLEDGE_MIGRATION}`);
  else pass(`Retell knowledge migration present: 20260808210000_retell_knowledge_sync.sql`);
  if (!existsSync(RETELL_KNOWLEDGE_FUNCTION)) fail("Missing retell-knowledge-sync Edge Function");
  else pass("Retell knowledge sync Edge Function present");
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    ...options,
    headers: {
      "X-N8N-API-KEY": apiKey,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw text for diagnostics.
  }

  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function fetchAll(path) {
  const body = await api(path);
  return body?.data ?? body ?? [];
}

function findWebhookPath(workflow) {
  return workflow.nodes
    ?.filter((node) => String(node.type).includes("webhook"))
    ?.map((node) => node.parameters?.path)
    ?.filter(Boolean) ?? [];
}

function hasReadinessGate(workflow) {
  return workflow.nodes?.some((node) =>
    node.name === "Is Readiness Check" ||
    JSON.stringify(node.parameters ?? {}).includes("beta_readiness_check")
  );
}

async function verifyHealth() {
  const response = await fetch(`${baseUrl}/healthz`);
  if (!response.ok) {
    fail(`n8n health check returned ${response.status}`);
    return;
  }
  pass(`n8n health check returned ${response.status}`);
}

async function verifyWorkflows() {
  const list = await fetchAll("/workflows?limit=100");

  for (const expected of REQUIRED_WORKFLOWS) {
    const summary = list.find((workflow) => workflow.name === expected.name);
    if (!summary) {
      fail(`Missing workflow: ${expected.name}`);
      continue;
    }

    if (!summary.active) {
      fail(`Workflow is not active: ${expected.name}`);
    } else {
      pass(`Workflow active: ${expected.name}`);
    }

    const workflow = await api(`/workflows/${summary.id}`);
    const paths = findWebhookPath(workflow);
    if (!paths.includes(expected.path)) {
      fail(`Workflow ${expected.name} webhook path is ${paths.join(", ") || "missing"}, expected ${expected.path}`);
    } else {
      pass(`Workflow path verified: ${expected.path}`);
    }

    if (!hasReadinessGate(workflow)) {
      fail(`Workflow ${expected.name} is missing the beta readiness dry-run gate`);
    } else {
      pass(`Workflow readiness gate present: ${expected.name}`);
    }
  }
}

async function verifyCredentials() {
  const credentials = await fetchAll("/credentials?limit=100");
  if (!credentials.length) {
    fail("No n8n credentials are configured; Twilio, HubSpot, GoHighLevel, and Google Sheets must be added before beta launch");
    return;
  }

  for (const required of REQUIRED_CREDENTIALS) {
    const match = credentials.find((credential) => required.types.includes(credential.type));
    if (!match) {
      fail(`Missing ${required.label} credential for ${required.requiredFor}`);
    } else {
      pass(`${required.label} credential configured: ${match.name}`);
    }
  }
}

function readinessPayload(path) {
  const base = {
    event: path === "call-completed" ? "call_completed" : "readiness_check",
    business_id: "00000000-0000-0000-0000-000000000001",
    call_id: "00000000-0000-0000-0000-000000000002",
    contact: {
      name: "Beta Readiness",
      phone: "+15555550100",
      email: "beta-readiness@example.com",
    },
    call_summary: "Synthetic beta launch readiness check.",
    lead_score: 80,
    pipeline_stage: "qualified_lead",
    type: "missed_call",
    phone: "+15555550100",
    metadata: {
      beta_readiness_check: true,
      sheet_id: "dry-run-sheet-id",
      outcome: "qualified_lead",
      source: "scripts/beta-launch-readiness.mjs",
    },
  };

  if (path === "call-completed") {
    base.outcome = "completed";
  }

  return base;
}

async function verifyWebhookDryRuns() {
  if (!shouldPingWebhooks) {
    warn("Skipped webhook dry-runs. Re-run with --webhooks after deploying readiness-gated workflows.");
    return;
  }

  for (const workflow of REQUIRED_WORKFLOWS) {
    const url = `${baseUrl}/webhook/${workflow.path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readinessPayload(workflow.path)),
    });

    const text = await response.text();
    if (!response.ok) {
      fail(`Webhook dry-run failed for ${workflow.name}: ${response.status} ${text}`);
    } else {
      pass(`Webhook dry-run passed: ${workflow.name}`);
    }
  }
}

async function verifyRecentExecutions() {
  const executions = await fetchAll("/executions?limit=10");
  const errored = executions.filter((execution) => execution.status === "error");
  if (errored.length) {
    warn(`${errored.length} of the latest ${executions.length} n8n executions are errors; launch remains blocked until post-fix dry-runs and real smoke tests pass`);
  } else {
    pass("Latest n8n executions do not include errors");
  }
}

function loadSupabaseEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function supabaseFetch(path, options = {}) {
  const { url, serviceRoleKey } = loadSupabaseEnv();
  if (!url || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw text for diagnostics.
  }

  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function verifySupabase() {
  if (!shouldVerifySupabase) {
    warn("Skipped Supabase sync/dispatch checks. Re-run with --supabase when Supabase env vars are loaded.");
    return;
  }

  try {
    const sync = await supabaseFetch("/functions/v1/sync-n8n-workflows", { method: "POST" });
    if (sync.synced !== REQUIRED_WORKFLOWS.length) {
      fail(`Supabase workflow sync synced ${sync.synced ?? 0}/${REQUIRED_WORKFLOWS.length}`);
    } else {
      pass(`Supabase workflow sync updated ${sync.synced}/${sync.total} workflows`);
    }

    const workflowRows = await supabaseFetch(
      "/rest/v1/workflows?business_id=is.null&select=name,webhook_url,is_active,config,n8n_workflow_id&order=name",
    );
    const activeRows = workflowRows.filter((row) => row.is_active && row.webhook_url);
    if (activeRows.length < REQUIRED_WORKFLOWS.length) {
      fail(`Supabase has ${activeRows.length}/${REQUIRED_WORKFLOWS.length} active global workflow rows`);
    } else {
      pass(`Supabase has ${activeRows.length} active global workflow rows`);
    }

    const businesses = await supabaseFetch("/rest/v1/businesses?select=id,name&limit=1");
    if (!businesses.length) {
      fail("No real business row exists in Supabase; create a beta test business before real n8n-dispatch verification");
      return;
    }

    const business = businesses[0];
    const dispatch = await supabaseFetch("/functions/v1/n8n-dispatch", {
      method: "POST",
      body: JSON.stringify({
        event: "call_completed",
        business_id: business.id,
        metadata: {
          beta_readiness_check: true,
          source: "scripts/beta-launch-readiness.mjs",
        },
      }),
    });

    if (!dispatch.dispatched) {
      fail(`Supabase n8n-dispatch did not dispatch for business ${business.id}`);
    } else if (dispatch.payload?.metadata?.beta_readiness_check !== true) {
      fail("Supabase n8n-dispatch dropped beta_readiness_check metadata");
    } else {
      pass(`Supabase n8n-dispatch reached n8n for business ${business.name || business.id}`);
    }
  } catch (error) {
    fail(`Supabase verification failed: ${error.message}`);
  }
}

async function main() {
  console.log(`BusinessVoice beta launch readiness check`);
  verifyRetellKnowledgeFiles();
  console.log(`n8n: ${baseUrl}`);
  console.log("");

  await verifyHealth();
  await verifyWorkflows();
  await verifyCredentials();
  await verifyWebhookDryRuns();
  await verifyRecentExecutions();
  await verifySupabase();

  console.log("");
  console.log(`Summary: ${failures.length} failure(s), ${warnings.length} warning(s)`);

  if (failures.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
