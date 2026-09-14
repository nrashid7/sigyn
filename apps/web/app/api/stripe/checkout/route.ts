import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBusiness } from "@/lib/actions/business";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-08-27.basil",
  });
}

const PRICE_MAP: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER || "",
  pro: process.env.STRIPE_PRICE_PRO || "",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const plan = searchParams.get("plan") || "starter";
  return createCheckout(plan, request);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const plan = (body.plan as string) || "starter";
  return createCheckout(plan, request);
}

async function createCheckout(plan: string, request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(new URL("/signup", request.url));
    }

    const priceId = PRICE_MAP[plan];
    if (!priceId) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const business = await getBusiness();
    if (!business) {
      return NextResponse.json(
        { error: "Create a business before subscribing" },
        { status: 400 },
      );
    }

    const { data: existingSubscription } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("business_id", business.id)
      .maybeSingle();

    const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL;

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      { price: priceId, quantity: 1 },
    ];

    const setupPrice = process.env.STRIPE_PRICE_SETUP;
    if (setupPrice) {
      lineItems.push({ price: setupPrice, quantity: 1 });
    }

    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url: `${origin}/dashboard/billing?success=true`,
      cancel_url: `${origin}/dashboard/billing?canceled=true`,
      client_reference_id: business.id,
      ...(existingSubscription?.stripe_customer_id
        ? { customer: existingSubscription.stripe_customer_id }
        : { customer_email: user.email ?? undefined }),
      metadata: {
        business_id: business.id,
        user_id: user.id,
        plan,
      },
      subscription_data: {
        metadata: {
          business_id: business.id,
          user_id: user.id,
          plan,
        },
      },
    });

    return NextResponse.redirect(session.url!, 303);
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
