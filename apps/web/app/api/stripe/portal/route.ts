import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { getBusiness } from "@/lib/actions/business";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-08-27.basil",
  });
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const business = await getBusiness();
    if (!business) {
      return NextResponse.json({ error: "No business found" }, { status: 404 });
    }

    const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL;

    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("business_id", business.id)
      .single();

    if (!subscription?.stripe_customer_id) {
      return NextResponse.redirect(
        new URL("/dashboard/billing?error=no_subscription", origin),
      );
    }

    const portalSession = await getStripe().billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${origin}/dashboard/billing`,
    });

    return NextResponse.redirect(portalSession.url, 303);
  } catch (error) {
    console.error("Stripe portal error:", error);
    return NextResponse.json({ error: "Portal failed" }, { status: 500 });
  }
}
