import { assertEquals } from "jsr:@std/assert@1";
import type { AvailabilityRequest } from "../_shared/calendar.ts";
import { generateDefaultSlots } from "../_shared/calendar.ts";

/**
 * generateDefaultSlots parses "YYYY-MM-DD" as UTC midnight, then walks days with
 * local-time Date mutators (setHours/getDay/setDate). Pinning TZ to UTC for the
 * duration of each test (and restoring it immediately after, so nothing leaks into
 * other test files in the same `deno test` run) makes the two halves agree
 * regardless of the machine running the suite — matching how the deployed edge
 * function actually runs.
 */
function withUtc<T>(fn: () => T): T {
  const original = Deno.env.get("TZ");
  Deno.env.set("TZ", "UTC");
  try {
    return fn();
  } finally {
    if (original === undefined) Deno.env.delete("TZ");
    else Deno.env.set("TZ", original);
  }
}

// Fixed, far-future weekdays — 2026-09-21 is a Monday.
const MONDAY = "2026-09-21";
const TUESDAY = "2026-09-22";
const WEDNESDAY = "2026-09-23";

function request(overrides: Partial<AvailabilityRequest> = {}): AvailabilityRequest {
  return { businessId: "test-business", startDate: MONDAY, ...overrides };
}

Deno.test("generateDefaultSlots: a single-day request (start === end, a weekday) yields slots", () => {
  withUtc(() => {
    const slots = generateDefaultSlots(request({ endDate: MONDAY }));
    assertEquals(slots.length > 0, true);
    assertEquals(slots.every((slot) => slot.start.startsWith(MONDAY)), true);
  });
});

Deno.test("generateDefaultSlots: a 3-weekday range includes slots on the last day", () => {
  withUtc(() => {
    const slots = generateDefaultSlots(request({ endDate: WEDNESDAY }));
    assertEquals(slots.length > 0, true);
    assertEquals(slots.some((slot) => slot.start.startsWith(WEDNESDAY)), true);
  });
});

Deno.test("generateDefaultSlots: an omitted endDate yields slots across the default multi-day window", () => {
  withUtc(() => {
    const slots = generateDefaultSlots(request());
    assertEquals(slots.length > 0, true);

    const distinctDays = new Set(slots.map((slot) => slot.start.slice(0, 10)));
    // More than just the single start day — proves the 7-day default window kicked
    // in, not the pre-fix bug where an omitted end_date collapsed to zero slots.
    assertEquals(distinctDays.size > 1, true);
    assertEquals(distinctDays.has(TUESDAY), true);
  });
});
