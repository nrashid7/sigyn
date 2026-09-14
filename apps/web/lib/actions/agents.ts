"use server";

import { revalidatePath } from "next/cache";
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

export async function toggleAgent(id: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("agents")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/agents");
  return { success: true };
}
