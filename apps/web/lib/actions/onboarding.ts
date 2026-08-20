"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callPreferencesSchema, voiceSelectionSchema } from "@businessvoice/shared";
import { createClient } from "@/lib/supabase/server";
import { getBusiness } from "./business";
import { trackServerEvent } from "@/lib/analytics-server";

export async function getAgentTemplatesFromDb() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("agent_templates")
    .select("id, slug, name, industry, config")
    .eq("is_active", true)
    .order("name");
  return data ?? [];
}

export async function updateOnboardingStep(step: number) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("businesses")
    .update({ onboarding_step: step })
    .eq("id", business.id);

  if (error) return { error: error.message };
  revalidatePath("/onboarding");
  return { success: true };
}

export async function saveCallPreferences(formData: FormData) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const raw = {
    transfer_number: (formData.get("transfer_number") as string) || undefined,
    emergency_number: (formData.get("emergency_number") as string) || undefined,
    voicemail_enabled: formData.get("voicemail_enabled") === "true",
    voicemail_message: (formData.get("voicemail_message") as string) || undefined,
    escalation_after_seconds: formData.get("escalation_after_seconds")
      ? Number(formData.get("escalation_after_seconds"))
      : undefined,
    after_hours_message: (formData.get("after_hours_message") as string) || undefined,
  };

  const parsed = callPreferencesSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message || "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("call_preferences").upsert(
    { business_id: business.id, ...parsed.data },
    { onConflict: "business_id" }
  );

  if (error) return { error: error.message };

  await supabase.from("businesses").update({ onboarding_step: 4 }).eq("id", business.id);
  await trackServerEvent("onboarding_step_completed", { step: 4, business_id: business.id });

  revalidatePath("/onboarding");
  redirect("/onboarding/voice");
}

export async function saveVoiceSelection(formData: FormData) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const templateSlug = formData.get("template_slug") as string;
  const voiceProvider = formData.get("voice_provider") as "retell" | "elevenlabs";
  const voiceId = formData.get("voice_id") as string;

  if (!templateSlug || !voiceId) {
    return { error: "Please select an agent and voice" };
  }

  const parsed = voiceSelectionSchema.safeParse({
    voice_provider: voiceProvider,
    voice_id: voiceId,
    template_id: "00000000-0000-0000-0000-000000000001",
  });

  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message || "Invalid input" };
  }

  const supabase = await createClient();
  const { data: template } = await supabase.from("agent_templates")
    .select("id,name,config").eq("slug", templateSlug).eq("is_active", true).single();
  if (!template) return { error: "Agent template not found" };
  const { error: agentError } = await supabase.from("agents").insert({
    business_id: business.id,
    template_id: template.id,
    name: (formData.get("agent_name") as string) || template.name,
    type: "inbound",
    voice_provider: voiceProvider,
    voice_id: voiceId,
    config: template.config,
    lifecycle_status: "draft",
    is_active: false,
  });
  if (agentError) return { error: agentError.message };

  const { error } = await supabase
    .from("businesses")
    .update({ onboarding_step: 5, onboarding_complete: true })
    .eq("id", business.id);

  if (error) return { error: error.message };

  await trackServerEvent("agent_hired", {
    business_id: business.id,
    template_slug: templateSlug,
    agent_name: formData.get("agent_name"),
  });
  await trackServerEvent("onboarding_step_completed", { step: 5, business_id: business.id });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function completeOnboardingKnowledge() {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const supabase = await createClient();
  await supabase.from("businesses").update({ onboarding_step: 3 }).eq("id", business.id);
  await trackServerEvent("onboarding_step_completed", { step: 2, business_id: business.id });

  revalidatePath("/onboarding");
  redirect("/onboarding/calendar");
}

export async function completeOnboardingCalendar() {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const supabase = await createClient();
  await supabase.from("businesses").update({ onboarding_step: 4 }).eq("id", business.id);
  await trackServerEvent("onboarding_step_completed", { step: 3, business_id: business.id });

  revalidatePath("/onboarding");
  redirect("/onboarding/call-preferences");
}
