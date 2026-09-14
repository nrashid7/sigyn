import Stripe from "npm:stripe@18.5.0";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./errors.ts";
import { captureBusinessEvent } from "./analytics.ts";

export function getStripeClient(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) {
    throw new AppError("Missing STRIPE_SECRET_KEY", 500, "CONFIG_ERROR");
  }
  return new Stripe(key, { apiVersion: "2025-08-27.basil" });
}

export async function verifyStripeWebhook(
  req: Request,
  rawBody: string,
): Promise<Stripe.Event> {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    throw new AppError("Missing STRIPE_WEBHOOK_SECRET", 500, "CONFIG_ERROR");
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    throw new AppError("Missing Stripe signature", 401, "INVALID_SIGNATURE");
  }

  const stripe = getStripeClient();
  try {
    // Deno's runtime lacks Node's synchronous crypto internals that
    // `constructEvent` relies on, so verification must go through the async variant.
    return await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch (err) {
    throw new AppError(
      `Stripe signature verification failed: ${err instanceof Error ? err.message : "unknown"}`,
      401,
      "INVALID_SIGNATURE",
    );
  }
}

const PLAN_MINUTES: Record<"starter" | "pro", number> = {
  starter: 200,
  pro: 600,
};

/**
 * Maps a Stripe subscription status to our internal `subscription_status` enum.
 * `status` is typed as `string` (not `Stripe.Subscription.Status`) so this stays
 * forward-compatible with statuses Stripe adds in the future.
 */
export function mapStripeStatus(
  status: string,
): "trialing" | "active" | "past_due" | "canceled" {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "incomplete":
    case "paused":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "past_due";
  }
}

/** Resolves a Stripe price id to our internal plan; unknown ids default to starter. */
export function mapStripePlan(priceId: string | undefined): "starter" | "pro" {
  const starterPrice = Deno.env.get("STRIPE_PRICE_STARTER");
  const proPrice = Deno.env.get("STRIPE_PRICE_PRO");

  if (priceId && priceId === proPrice) return "pro";
  if (priceId && priceId === starterPrice) return "starter";

  console.warn("[stripe] Unknown price id", priceId);
  return "starter";
}

/**
 * Reads a subscription's current period end. Stripe API >= 2025-03-31 moved this
 * from the subscription's top level to each subscription item; we check the
 * items-level value first and fall back to the legacy top-level field for
 * safety against older cached objects.
 */
export function getPeriodEnd(sub: Stripe.Subscription): string | null {
  const value = sub.items?.data?.[0]?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof value === "number" ? new Date(value * 1000).toISOString() : null;
}

export async function syncSubscriptionFromStripe(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;

  const priceId = subscription.items.data[0]?.price?.id;
  const plan = mapStripePlan(priceId);
  const status = mapStripeStatus(subscription.status);
  const businessId = subscription.metadata?.business_id;

  // A trial row (created by the on-business-created trigger) has no
  // stripe_customer_id yet, so the first paid subscription for that business
  // has to be found by its metadata business_id instead.
  let existingQuery = supabase
    .from("subscriptions")
    .select("business_id, stripe_subscription_id");
  existingQuery = businessId
    ? existingQuery.or(
      `stripe_customer_id.eq.${customerId},business_id.eq.${businessId}`,
    )
    : existingQuery.eq("stripe_customer_id", customerId);

  const { data: existing } = await existingQuery.maybeSingle();

  // A new Stripe subscription id (trial -> first paid sub, or a resubscribe
  // after cancellation) starts a fresh billing cycle, so usage resets too.
  const isNewSubscription = existing !== null &&
    existing.stripe_subscription_id !== subscription.id;

  const payload = {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    plan,
    status,
    included_minutes: PLAN_MINUTES[plan],
    current_period_end: getPeriodEnd(subscription),
    updated_at: new Date().toISOString(),
    ...(isNewSubscription ? { used_minutes: 0 } : {}),
  };

  if (existing?.business_id) {
    const { error } = await supabase
      .from("subscriptions")
      .update(payload)
      .eq("business_id", existing.business_id);

    if (error) {
      throw new AppError(`Failed to update subscription: ${error.message}`, 500);
    }
    return;
  }

  if (!businessId) {
    console.warn("[stripe] No business_id in subscription metadata, skipping insert");
    return;
  }

  const { error } = await supabase.from("subscriptions").upsert({
    business_id: businessId,
    ...payload,
  }, { onConflict: "business_id" });

  if (error) {
    throw new AppError(`Failed to upsert subscription: ${error.message}`, 500);
  }
}

export async function handleSubscriptionDeleted(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "canceled",
      stripe_subscription_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_customer_id", customerId);

  if (error) {
    throw new AppError(`Failed to cancel subscription: ${error.message}`, 500);
  }
}

/** Pure predicate behind `resetUsageForInvoice`: does this invoice start a fresh billing cycle? */
export function shouldResetUsage(
  billingReason: Stripe.Invoice.BillingReason | string | null | undefined,
): boolean {
  return billingReason === "subscription_cycle" ||
    billingReason === "subscription_create";
}

/**
 * Resets usage minutes when an invoice starts a new billing cycle (renewal or
 * the first invoice on a brand-new subscription). Returns whether it reset anything.
 */
export async function resetUsageForInvoice(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice,
): Promise<boolean> {
  if (!shouldResetUsage(invoice.billing_reason)) return false;

  const customerId = typeof invoice.customer === "string"
    ? invoice.customer
    : invoice.customer?.id;

  if (!customerId) {
    console.warn("[stripe] Invoice has no customer id, skipping usage reset");
    return false;
  }

  const { error } = await supabase
    .from("subscriptions")
    .update({
      used_minutes: 0,
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_customer_id", customerId);

  if (error) {
    throw new AppError(`Failed to reset usage for invoice: ${error.message}`, 500);
  }

  return true;
}

export interface RecordUsageMinutesResult {
  inserted: boolean;
  used: number;
  included: number;
}

export async function recordUsageMinutes(
  supabase: SupabaseClient,
  businessId: string,
  callId: string,
  minutes: number,
): Promise<RecordUsageMinutesResult> {
  const { data, error } = await supabase.rpc("record_call_minutes", {
    p_business_id: businessId,
    p_call_id: callId,
    p_minutes: minutes,
  });

  if (error) {
    throw new AppError(`Failed to record usage minutes: ${error.message}`, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (row?.inserted && row.included_minutes > 0) {
    const used = row.used_minutes;
    const included = row.included_minutes;
    const before = used - minutes;
    for (const threshold of [80, 100]) {
      if ((before / included) * 100 < threshold && (used / included) * 100 >= threshold) {
        try {
          await captureBusinessEvent(businessId, "usage_threshold_reached", {
            threshold,
            used_minutes: used,
            included_minutes: included,
          });
        } catch (err) {
          console.warn("[stripe] usage_threshold_reached emit failed:", err);
        }
      }
    }
  }

  return {
    inserted: Boolean(row?.inserted),
    used: row?.used_minutes ?? 0,
    included: row?.included_minutes ?? 0,
  };
}
