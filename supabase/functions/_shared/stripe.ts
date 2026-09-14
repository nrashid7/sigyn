import Stripe from "npm:stripe@17";
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./errors.ts";
import { captureBusinessEvent } from "./analytics.ts";

export function getStripeClient(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) {
    throw new AppError("Missing STRIPE_SECRET_KEY", 500, "CONFIG_ERROR");
  }
  return new Stripe(key, { apiVersion: "2024-11-20.acacia" });
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
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    throw new AppError(
      `Stripe signature verification failed: ${err instanceof Error ? err.message : "unknown"}`,
      401,
      "INVALID_SIGNATURE",
    );
  }
}

const PLAN_MINUTES: Record<string, number> = {
  starter: 200,
  pro: 600,
  enterprise: 5000,
};

function mapStripeStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "active";
  }
}

function mapStripePlan(priceId: string | undefined): string {
  const starterPrice = Deno.env.get("STRIPE_STARTER_PRICE_ID");
  const proPrice = Deno.env.get("STRIPE_PRO_PRICE_ID");
  const enterprisePrice = Deno.env.get("STRIPE_ENTERPRISE_PRICE_ID");

  if (priceId === proPrice) return "pro";
  if (priceId === enterprisePrice) return "enterprise";
  if (priceId === starterPrice) return "starter";
  return "starter";
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

  const { data: existing } = await supabase
    .from("subscriptions")
    .select("business_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  const payload = {
    stripe_subscription_id: subscription.id,
    plan,
    status,
    included_minutes: PLAN_MINUTES[plan] ?? 200,
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    updated_at: new Date().toISOString(),
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

  const businessId = subscription.metadata?.business_id;
  if (!businessId) {
    console.warn("[stripe] No business_id in subscription metadata, skipping insert");
    return;
  }

  const { error } = await supabase.from("subscriptions").upsert({
    business_id: businessId,
    stripe_customer_id: customerId,
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
