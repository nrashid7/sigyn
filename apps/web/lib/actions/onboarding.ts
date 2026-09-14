"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callPreferencesSchema, voiceSelectionSchema } from "@businessvoice/shared";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseServiceRoleKey } from "@/lib/supabase/admin";
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

  // Call preferences are baked into the agent's system prompt, so an already-hired
  // agent has to be re-pushed to ElevenLabs. Fire-and-forget: a sync failure must not
  // block onboarding, and the next sync re-sends the whole config anyway.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = getSupabaseServiceRoleKey();
  await fetch(`${supabaseUrl}/functions/v1/agent-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ business_id: business.id }),
  }).catch(() => null);

  await supabase.from("businesses").update({ onboarding_step: 4 }).eq("id", business.id);
  await trackServerEvent("onboarding_step_completed", { step: 4, business_id: business.id });

  revalidatePath("/onboarding");
  redirect("/onboarding/voice");
}

export async function saveVoiceSelection(formData: FormData) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const templateSlug = formData.get("template_slug") as string;
  const voiceId = formData.get("voice_id") as string;

  if (!templateSlug || !voiceId) {
    return { error: "Please select an agent and voice" };
  }

  const parsed = voiceSelectionSchema.safeParse({
    voice_provider: "elevenlabs",
    voice_id: voiceId,
    template_slug: templateSlug,
  });

  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message || "Invalid input" };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = getSupabaseServiceRoleKey();

  const response = await fetch(`${supabaseUrl}/functions/v1/agent-provision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      business_id: business.id,
      template_slug: templateSlug,
      name: (formData.get("agent_name") as string) || "AI Employee",
      voice_id: voiceId,
      voice_provider: "elevenlabs",
      include_calendar: true,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const { error: message, code } = err as { error?: string; code?: string };

    if (code === "PROVISIONING") {
      return { error: "Your agent is still being set up — try again in a minute." };
    }

    const errorMessage = message ?? "Failed to hire agent";
    return {
      error:
        code === "PHONE_PROVISION_FAILED"
          ? `Phone number setup failed: ${errorMessage}`
          : errorMessage,
    };
  }

  const supabase = await createClient();
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
