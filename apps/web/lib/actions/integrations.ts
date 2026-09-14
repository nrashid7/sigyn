"use server";

import { createClient } from "@/lib/supabase/server";
import { getBusiness } from "./business";

export async function getIntegrations() {
  const business = await getBusiness();
  if (!business) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("integrations")
    .select("id, business_id, provider, config, is_active, created_at")
    .eq("business_id", business.id);

  return data ?? [];
}

export async function connectIntegration(provider: string, config: Record<string, unknown>) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const supabase = await createClient();
  const accessToken =
    (config.api_key as string) ||
    (config.access_token as string) ||
    undefined;

  const { error } = await supabase.from("integrations").upsert(
    {
      business_id: business.id,
      provider,
      config,
      access_token: accessToken,
      is_active: true,
    },
    { onConflict: "business_id,provider" }
  );

  if (error) return { error: error.message };
  return { success: true };
}

export async function disconnectIntegration(provider: string) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("integrations")
    .update({ is_active: false })
    .eq("business_id", business.id)
    .eq("provider", provider);

  if (error) return { error: error.message };
  return { success: true };
}
