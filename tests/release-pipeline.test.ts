import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("CI enforces the pinned toolchain, database tests, Deno checks, audit, and secret scanning", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const nvmrc = readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim();
  assert.equal(nvmrc, "24.19.0");
  assert.match(ci, /node-version:\s*24\.19\.0/);
  assert.match(ci, /npm@10\.9\.2/);
  assert.match(ci, /npm audit --omit=dev --audit-level=high/);
  assert.match(ci, /denoland\/setup-deno/);
  assert.match(ci, /deno check/);
  assert.match(ci, /supabase test db/);
  assert.match(ci, /gitleaks/);
});

test("tagged releases promote staging before the protected production environment", () => {
  const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(release, /tags:[\s\S]*v\*/);
  assert.match(release, /environment:\s*staging/);
  assert.match(release, /environment:\s*production/);
  assert.match(release, /needs:[\s\S]*staging/);
  assert.match(release, /supabase db push/);
  assert.match(release, /retell-knowledge-sync/);
  assert.match(release, /vercel deploy/);
  assert.match(release, /verify:production/);
  assert.doesNotMatch(release, /working-directory:\s*apps\/web/);
});

test("Vercel packages the Next.js web app from the monorepo root", () => {
  const config = JSON.parse(
    readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
  ) as {
    framework?: string;
    buildCommand?: string;
    installCommand?: string;
    outputDirectory?: string;
  };

  assert.equal(config.framework, "nextjs");
  assert.equal(config.buildCommand, "npx turbo build --filter=web");
  assert.equal(config.installCommand, "npx --yes npm@10.9.2 ci");
  assert.equal(config.outputDirectory, "apps/web/.next");
});

test("Turborepo tracks every production runtime variable used by the web build", () => {
  const turbo = JSON.parse(
    readFileSync(new URL("../turbo.json", import.meta.url), "utf8"),
  ) as { globalEnv?: string[] };

  for (const name of [
    "RETELL_API_KEY",
    "RETELL_WEBHOOK_SECRET",
    "RETELL_DEMO_AGENT_GENERAL_RECEPTIONIST",
    "RETELL_DEMO_AGENT_APPOINTMENT_BOOKING",
    "RETELL_DEMO_AGENT_HOME_SERVICES_DISPATCHER",
    "RETELL_DEMO_AGENT_LEAD_QUALIFICATION",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "N8N_WEBHOOK_BASE_URL",
    "N8N_WEBHOOK_SECRET",
    "INTEGRATION_ENCRYPTION_KEY",
    "OAUTH_STATE_SECRET",
    "DEMO_HASH_SECRET",
    "RATE_LIMIT_SECRET",
    "BETA_INVITE_SECRET",
    "CRON_SECRET",
    "SENTRY_DSN",
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_PROJECT",
    "NEXT_PUBLIC_POSTHOG_KEY",
    "NEXT_PUBLIC_POSTHOG_HOST",
  ]) {
    assert.ok(turbo.globalEnv?.includes(name), `${name} must be tracked by Turborepo`);
  }
});

test("operations runbook defines rollback, alerts, restore proof, and the 24-hour soak", () => {
  const runbook = readFileSync(new URL("../docs/PRODUCTION_OPERATIONS.md", import.meta.url), "utf8");
  for (const phrase of ["15-minute rollback", "point-in-time recovery", "credential rotation", "24-hour soak", "Twilio", "HubSpot", "GoHighLevel", "Google Sheets", "Sentry"]) {
    assert.match(runbook, new RegExp(phrase, "i"));
  }
});
