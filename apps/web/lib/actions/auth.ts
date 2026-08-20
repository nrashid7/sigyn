"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { loginSchema, signupSchema } from "@businessvoice/shared";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit, requireProductionOperation, validateBetaInvitation } from "@/lib/server/production-service";

const ONBOARDING_STEPS: Record<number, string> = {
  1: "/onboarding/business",
  2: "/onboarding/knowledge",
  3: "/onboarding/calendar",
  4: "/onboarding/call-preferences",
  5: "/onboarding/voice",
};

export async function getPostAuthRedirect(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "/login";

  const { data: membership } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) return "/onboarding/business";

  const { data: business } = await supabase
    .from("businesses")
    .select("onboarding_step, onboarding_complete")
    .eq("id", membership.business_id)
    .single();

  if (!business?.onboarding_complete) {
    return ONBOARDING_STEPS[business?.onboarding_step ?? 1] ?? "/onboarding/business";
  }

  return "/dashboard";
}

export async function signIn(formData: FormData) {
  const raw = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  };

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message || "Invalid credentials" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect(await getPostAuthRedirect());
}

export async function signUp(formData: FormData) {
  const raw = {
    email: formData.get("email") as string,
    password: formData.get("password") as string,
    full_name: formData.get("full_name") as string,
    invite_code: String(formData.get("invite_code") ?? ""),
  };

  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message || "Invalid input" };
  }

  try {
    await requireProductionOperation("signup");
    await validateBetaInvitation(parsed.data.email, raw.invite_code);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "A valid beta invitation is required" };
  }

  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.full_name },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/onboarding/business");
}

export async function signInWithGoogle(formData?: FormData) {
  const email = String(formData?.get("email") ?? "");
  const inviteCode = String(formData?.get("invite_code") ?? "");
  try {
    if (formData) {
      await requireProductionOperation("signup");
      await validateBetaInvitation(email, inviteCode);
    }
    const requestHeaders = await headers();
    const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    await enforceRateLimit("oauth", `${ip}:${email.toLowerCase()}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "A valid beta invitation is required" };
  }
  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) return { error: error.message };
  if (data.url) redirect(data.url);
  return { error: "Failed to start Google sign in" };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return data;
}
