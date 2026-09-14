import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@18.5.0";
import {
  createServiceClient,
  errorResponse,
  jsonResponse,
} from "../_shared/errors.ts";
import {
  handleSubscriptionDeleted,
  resetUsageForInvoice,
  syncSubscriptionFromStripe,
  verifyStripeWebhook,
} from "../_shared/stripe.ts";
import { readRawBody } from "../_shared/webhook.ts";
import { captureBusinessEvent } from "../_shared/analytics.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, stripe-signature, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const rawBody = await readRawBody(req);
    const event = await verifyStripeWebhook(req, rawBody);
    const supabase = createServiceClient();

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await syncSubscriptionFromStripe(supabase, subscription);

        const businessId = subscription.metadata?.business_id;
        if (businessId) {
          await captureBusinessEvent(businessId, "subscription_updated", {
            plan: subscription.items.data[0]?.price?.id,
            status: subscription.status,
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(supabase, subscription);

        const businessId = subscription.metadata?.business_id;
        if (businessId) {
          await captureBusinessEvent(businessId, "subscription_canceled");
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        await resetUsageForInvoice(supabase, invoice);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer?.id;

        if (customerId) {
          await supabase
            .from("subscriptions")
            .update({ status: "past_due" })
            .eq("stripe_customer_id", customerId);
        }
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event: ${event.type}`);
        return jsonResponse({ received: true, ignored: true });
    }

    return jsonResponse({ received: true, type: event.type });
  } catch (error) {
    return errorResponse(error);
  }
});
