"use server";

import { revalidatePath } from "next/cache";
import { businessDetailsSchema } from "@businessvoice/shared";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "./auth";
import { createBusinessForCurrentUser } from "@/lib/services/business-service";
import { after } from "next/server";
import { queueWebsiteIngestion } from "@/lib/ingestion/queue-job";
import { processIngestionJob } from "@/lib/ingestion/process-job";

export async function getBusiness() {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", user.id)
    .single();

  if (!membership) return null;

  const { data } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", membership.business_id)
    .single();

  return data;
}

export async function createBusiness(formData: FormData) {
  const user = await getUser();
  if (!user) return { error: "Not authenticated" };

  const raw = {
    name: formData.get("name") as string,
    website: formData.get("website") as string,
    industry: formData.get("industry") as string,
    phone: formData.get("phone") as string,
    timezone: formData.get("timezone") as string || "America/New_York",
    hours: JSON.parse(formData.get("hours") as string || "{}"),
  };

  const parsed = businessDetailsSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message || "Invalid input" };
  }

  const supabase = await createClient();

  let business;
  try {
    business = await createBusinessForCurrentUser(supabase, parsed.data);
  } catch (error) {
    return {
      error: error instanceof Error
        ? error.message
        : "Could not create the business",
    };
  }

  const created = business as { id?: string } | null;
  if (created?.id && parsed.data.website) {
    try {
      const job = await queueWebsiteIngestion(created.id, parsed.data.website);
      after(() => processIngestionJob(job.id).catch((error) => {
        console.error("Onboarding ingestion failed", { jobId: job.id, error });
      }));
    } catch (error) {
      console.error("Could not queue onboarding ingestion", error);
    }
  }

  revalidatePath("/dashboard");
  return { success: true, business };
}

export async function updateBusiness(id: string, updates: Record<string, unknown>) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("businesses")
    .update(updates)
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return { success: true };
}
