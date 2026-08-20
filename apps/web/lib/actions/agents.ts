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

export async function hireAgent(templateId: string, name: string) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const supabase = await createClient();
  const { error } = await supabase.from("agents").insert({
    business_id: business.id,
    template_id: templateId,
    name,
    type: "inbound",
    voice_provider: "retell",
    lifecycle_status: "draft",
    is_active: false,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard/agents");
  return { success: true };
}

export async function toggleAgent(id: string, isActive: boolean) {
  if (isActive) return { error: "Only staff can activate a tested Retell deployment" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("agents")
    .update({
      is_active: isActive,
      lifecycle_status: isActive ? "live" : "paused",
    })
    .not("retell_agent_id", "is", null)
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/dashboard/agents");
  return { success: true };
}
