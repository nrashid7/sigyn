#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { validateProductionEvidence } from "./production-readiness-lib.mjs";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => !arg.includes("=")));
const value = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  || process.env[name.toUpperCase().replaceAll("-", "_")];
const requiredFlags = ["--supabase", "--webhooks", "--live-integrations"];
const missingFlags = requiredFlags.filter((flag) => !flags.has(flag));

if (missingFlags.length) {
  console.error(`Production verification requires every strict gate: ${requiredFlags.join(" ")}`);
  process.exit(1);
}

const baseUrl = String(value("base-url") || process.env.PRODUCTION_APP_URL || "").replace(/\/$/, "");
const release = String(value("release") || process.env.RELEASE_VERSION || "");
const evidencePath = value("evidence") || process.env.PRODUCTION_SMOKE_EVIDENCE_PATH;
const failures = [];
const passes = [];

function fail(message) { failures.push(message); console.error(`FAIL ${message}`); }
function pass(message) { passes.push(message); console.log(`PASS ${message}`); }

try {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.hostname.endsWith(".vercel.app")) fail("--base-url must be the owned HTTPS production hostname");
  else pass("Owned HTTPS production hostname configured");
} catch {
  fail("--base-url is required and must be a valid HTTPS URL");
}
if (!/^[a-f0-9]{40}$/i.test(release)) fail("--release must be the immutable 40-character Git commit SHA");
else pass(`Release pinned: ${release}`);

const requiredEnvironment = [
  "N8N_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_STARTER", "STRIPE_PRICE_PRO", "STRIPE_PRICE_SETUP",
  "SENTRY_DSN", "NEXT_PUBLIC_POSTHOG_KEY",
];
for (const name of requiredEnvironment) {
  if (!process.env[name]) fail(`Missing required production configuration: ${name}`);
}
if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_")) fail("STRIPE_SECRET_KEY is not a live Stripe key (sk_live_)");
else pass("Stripe live mode configured");

if (baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { headers: { "Cache-Control": "no-cache" } });
    const body = await response.json();
    if (!response.ok || body.status !== "ok") fail(`Production health is not ready (${response.status})`);
    else if (body.version !== release) fail(`Health release ${body.version || "unknown"} does not match ${release}`);
    else pass("Production health and release identity verified");
  } catch (error) {
    fail(`Production health request failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (supabaseUrl && serviceRoleKey) {
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/system_controls?id=eq.true&select=signup_enabled,agent_provisioning_enabled,billing_enabled,automation_dispatch_enabled`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    const rows = await response.json();
    const controls = Array.isArray(rows) ? rows[0] : null;
    const disabled = ["signup_enabled", "agent_provisioning_enabled", "billing_enabled", "automation_dispatch_enabled"]
      .filter((name) => controls?.[name] !== true);
    if (!response.ok || disabled.length) fail(`Production controls are not fully enabled: ${disabled.join(", ") || "unavailable"}`);
    else pass("Production operational controls are enabled");
  } catch (error) {
    fail(`Production controls could not be verified: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

const betaGate = spawnSync(process.execPath, ["scripts/beta-launch-readiness.mjs", "--webhooks", "--supabase"], {
  cwd: process.cwd(),
  env: process.env,
  encoding: "utf8",
});
const gateOutput = `${betaGate.stdout || ""}\n${betaGate.stderr || ""}`;
if (gateOutput.trim()) process.stdout.write(gateOutput);
if (betaGate.status !== 0) fail("n8n/Supabase readiness gate failed");
else if (/\bWARN\b/.test(gateOutput)) fail("n8n/Supabase readiness gate emitted WARN output");
else pass("n8n/Supabase readiness gate passed without warnings");

if (!evidencePath) {
  fail("Production smoke evidence is required through --evidence or PRODUCTION_SMOKE_EVIDENCE_PATH");
} else {
  try {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    const evidenceFailures = validateProductionEvidence(evidence, release);
    if (evidenceFailures.length) evidenceFailures.forEach(fail);
    else pass("All required live integration evidence is current and release-matched");
  } catch (error) {
    fail(`Production smoke evidence could not be read: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

console.log(`Summary: ${passes.length} pass(es), ${failures.length} failure(s), 0 skipped`);
process.exit(failures.length ? 1 : 0);
