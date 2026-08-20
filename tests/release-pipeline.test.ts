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
});

test("operations runbook defines rollback, alerts, restore proof, and the 24-hour soak", () => {
  const runbook = readFileSync(new URL("../docs/PRODUCTION_OPERATIONS.md", import.meta.url), "utf8");
  for (const phrase of ["15-minute rollback", "point-in-time recovery", "credential rotation", "24-hour soak", "Twilio", "HubSpot", "GoHighLevel", "Google Sheets", "Sentry"]) {
    assert.match(runbook, new RegExp(phrase, "i"));
  }
});
