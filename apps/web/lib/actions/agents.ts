"use server";

import { createClient } from "@/lib/supabase/server";
import { getBusiness } from "./business";

export async function getAgents() {
  const business = await getBusiness();
  if (!business) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("agents")
    .select("*")
    .eq("business_id", business.id)
    .order("hired_at", { ascending: false });

  return data || [];
}
