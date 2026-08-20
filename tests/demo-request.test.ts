import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUsPhone, isDemoQuietHour } from "../apps/web/lib/demo/request-policy.ts";

test("demo callbacks normalize valid US numbers and reject malformed input", () => {
  assert.equal(normalizeUsPhone("(612) 555-0123"), "+16125550123");
  assert.throws(() => normalizeUsPhone("911"), /valid US phone/i);
});

test("demo callbacks respect quiet hours in the supplied time zone", () => {
  assert.equal(isDemoQuietHour(new Date("2026-08-09T03:00:00Z"), "America/Chicago"), true);
  assert.equal(isDemoQuietHour(new Date("2026-08-08T18:00:00Z"), "America/Chicago"), false);
});
