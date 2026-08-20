import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateHealth } from "../apps/web/lib/server/health.ts";
import { SECURITY_HEADERS } from "../apps/web/lib/server/security-headers.ts";
import { validateProductionEvidence } from "../scripts/production-readiness-lib.mjs";

test("health evaluation exposes names and statuses without secret values", () => {
  const result = evaluateHealth({
    version: "release-123",
    database: { ok: true, latency_ms: 12 },
    configuration: { ok: false, missing: ["RETELL_API_KEY"] },
  });
  assert.equal(result.status, "degraded");
  assert.equal(result.version, "release-123");
  assert.deepEqual(result.checks.database, { ok: true, latency_ms: 12 });
  assert.deepEqual(result.checks.configuration, { ok: false, missing: ["RETELL_API_KEY"] });
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("security headers deny framing and enforce transport and content policy", () => {
  const headers = Object.fromEntries(SECURITY_HEADERS.map(({ key, value }) => [key, value]));
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(headers["Strict-Transport-Security"], /max-age=31536000/);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
});

test("production evidence requires every real controlled-beta flow for the same release", () => {
  const now = Date.parse("2026-08-08T18:00:00Z");
  const checks = ["inbound_call", "sms", "hubspot", "gohighlevel", "google_sheets", "calendar", "stripe_live"];
  const evidence = {
    release: "release-123",
    environment: "production",
    verified_at: "2026-08-08T17:00:00Z",
    checks: Object.fromEntries(checks.map((name) => [name, { passed: true, evidence_id: `${name}-proof` }])),
  };
  assert.deepEqual(validateProductionEvidence(evidence, "release-123", now), []);
  assert.match(
    validateProductionEvidence({ ...evidence, checks: { ...evidence.checks, sms: { passed: false } } }, "release-123", now).join(" "),
    /sms/i,
  );
  assert.match(validateProductionEvidence(evidence, "another-release", now).join(" "), /release/i);
});

test("retention cron is authenticated and configured", () => {
  const route = readFileSync(
    new URL("../apps/web/app/api/cron/retention/route.ts", import.meta.url),
    "utf8",
  );
  const vercel = readFileSync(new URL("../apps/web/vercel.json", import.meta.url), "utf8");
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /purge_expired_records/);
  assert.match(route, /storage\.from\("knowledge"\)\.remove/);
  assert.match(vercel, /api\/cron\/retention/);
});
