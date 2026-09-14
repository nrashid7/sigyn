import { assertEquals } from "jsr:@std/assert@1";
import type Stripe from "npm:stripe@18.5.0";
import {
  getPeriodEnd,
  mapStripePlan,
  mapStripeStatus,
  shouldResetUsage,
} from "../_shared/stripe.ts";

// --- getPeriodEnd ---

Deno.test("getPeriodEnd: reads the items-level current_period_end", () => {
  const sub = {
    items: { data: [{ current_period_end: 1700000000 }] },
  } as unknown as Stripe.Subscription;
  assertEquals(getPeriodEnd(sub), new Date(1700000000 * 1000).toISOString());
});

Deno.test("getPeriodEnd: falls back to the legacy top-level field", () => {
  const sub = {
    items: { data: [] },
    current_period_end: 1700000000,
  } as unknown as Stripe.Subscription;
  assertEquals(getPeriodEnd(sub), new Date(1700000000 * 1000).toISOString());
});

Deno.test("getPeriodEnd: returns null when neither value is present", () => {
  const sub = { items: { data: [] } } as unknown as Stripe.Subscription;
  assertEquals(getPeriodEnd(sub), null);
});

// --- mapStripePlan ---

Deno.test("mapStripePlan: matches the pro price id", () => {
  Deno.env.set("STRIPE_PRICE_STARTER", "price_s");
  Deno.env.set("STRIPE_PRICE_PRO", "price_p");
  assertEquals(mapStripePlan("price_p"), "pro");
});

Deno.test("mapStripePlan: matches the starter price id", () => {
  Deno.env.set("STRIPE_PRICE_STARTER", "price_s");
  Deno.env.set("STRIPE_PRICE_PRO", "price_p");
  assertEquals(mapStripePlan("price_s"), "starter");
});

Deno.test("mapStripePlan: defaults an unknown price id to starter", () => {
  Deno.env.set("STRIPE_PRICE_STARTER", "price_s");
  Deno.env.set("STRIPE_PRICE_PRO", "price_p");
  assertEquals(mapStripePlan("price_x"), "starter");
});

// --- mapStripeStatus ---

Deno.test("mapStripeStatus: trialing maps to trialing", () => {
  assertEquals(mapStripeStatus("trialing"), "trialing");
});

Deno.test("mapStripeStatus: active maps to active", () => {
  assertEquals(mapStripeStatus("active"), "active");
});

Deno.test("mapStripeStatus: past_due maps to past_due", () => {
  assertEquals(mapStripeStatus("past_due"), "past_due");
});

Deno.test("mapStripeStatus: incomplete maps to past_due", () => {
  assertEquals(mapStripeStatus("incomplete"), "past_due");
});

Deno.test("mapStripeStatus: paused maps to past_due", () => {
  assertEquals(mapStripeStatus("paused"), "past_due");
});

Deno.test("mapStripeStatus: unpaid maps to past_due", () => {
  assertEquals(mapStripeStatus("unpaid"), "past_due");
});

Deno.test("mapStripeStatus: canceled maps to canceled", () => {
  assertEquals(mapStripeStatus("canceled"), "canceled");
});

// The brief groups incomplete_expired under past_due, but the pre-existing
// implementation already mapped it to canceled. Per the task's instruction to
// preserve existing semantics when the brief's assumption doesn't match reality,
// that mapping is kept as-is and only the previously-unhandled statuses
// (incomplete, paused) are added as past_due.
Deno.test("mapStripeStatus: incomplete_expired preserves the existing canceled mapping", () => {
  assertEquals(mapStripeStatus("incomplete_expired"), "canceled");
});

Deno.test("mapStripeStatus: an unknown status defaults to past_due", () => {
  assertEquals(mapStripeStatus("some_future_status"), "past_due");
});

// --- shouldResetUsage ---

Deno.test("shouldResetUsage: true for subscription_cycle", () => {
  assertEquals(shouldResetUsage("subscription_cycle"), true);
});

Deno.test("shouldResetUsage: true for subscription_create", () => {
  assertEquals(shouldResetUsage("subscription_create"), true);
});

Deno.test("shouldResetUsage: false for subscription_update", () => {
  assertEquals(shouldResetUsage("subscription_update"), false);
});

Deno.test("shouldResetUsage: false for manual", () => {
  assertEquals(shouldResetUsage("manual"), false);
});

Deno.test("shouldResetUsage: false for undefined", () => {
  assertEquals(shouldResetUsage(undefined), false);
});
