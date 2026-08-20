import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("production verifier refuses partial execution", () => {
  const result = spawnSync(process.execPath, ["scripts/production-readiness.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: {},
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /--supabase[\s\S]*--webhooks[\s\S]*--live-integrations/);
});

test("production verifier is wired as the immutable release gate", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const script = readFileSync(new URL("../scripts/production-readiness.mjs", import.meta.url), "utf8");
  assert.equal(pkg.scripts["verify:production"], "node scripts/production-readiness.mjs");
  assert.match(script, /sk_live_/);
  assert.match(script, /validateProductionEvidence/);
  assert.match(script, /beta-launch-readiness\.mjs/);
  assert.match(script, /WARN/);
  assert.match(script, /api\/health/);
  assert.match(script, /system_controls/);
  assert.match(script, /automation_dispatch_enabled/);
});
