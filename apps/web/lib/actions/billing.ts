"use server";

import { createClient } from "@/lib/supabase/server";
import { getBusiness } from "./business";

export async function getSubscription() {
  const business = await getBusiness();
  if (!business) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("business_id", business.id)
    .single();

  return data;
}

export async function getUsageStats() {
  const subscription = await getSubscription();
  if (!subscription) {
    return { used: 0, included: 200, percent: 0 };
  }

  const { used_minutes: used, included_minutes: included } = subscription;
  const percent = included > 0 ? Math.round((used / included) * 100) : 0;

  return {
    used,
    included,
    percent: Math.min(percent, 100),
  };
}
