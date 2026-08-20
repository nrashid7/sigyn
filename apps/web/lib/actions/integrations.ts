"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptIntegrationSecret } from "@/lib/server/integration-crypto";
import { requireServerEnv } from "@/lib/server/env";
import { getBusiness } from "./business";

export async function getIntegrations() {
  const business = await getBusiness();
  if (!business) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("integrations")
    .select("id,business_id,provider,config,is_active,created_at,updated_at")
    .eq("business_id", business.id);

  return data ?? [];
}

export async function connectIntegration(provider: string, config: Record<string, unknown>) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const accessToken =
    (config.api_key as string) ||
    (config.access_token as string) ||
    undefined;
  if (!accessToken) {
    return { error: "This integration requires an owner-authorized credential" };
  }

  const validationUrls: Record<string, string> = {
    cal_com: "https://api.cal.com/v2/me",
    calendly: "https://api.calendly.com/users/me",
    hubspot: "https://api.hubapi.com/crm/v3/owners?limit=1",
    gohighlevel: "https://rest.gohighlevel.com/v1/users/",
    google_sheets: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(String(config.sheet_id || ""))}?fields=spreadsheetId`,
  };
  const validationUrl = validationUrls[provider];
  if (!validationUrl) return { error: "Use the provider OAuth connection for this integration" };
  if (provider === "google_sheets" && !config.sheet_id) {
    return { error: "A spreadsheet ID is required" };
  }
  const validation = await fetch(validationUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!validation?.ok) return { error: "The provider rejected this credential" };

  const publicConfig = Object.fromEntries(
    Object.entries(config).filter(([key]) => !["api_key", "access_token", "refresh_token", "client_secret"].includes(key)),
  );

  const admin = createAdminClient();
  const { data: integration, error } = await admin.from("integrations").upsert(
    {
      business_id: business.id,
      provider,
      config: publicConfig,
      is_active: true,
    },
    { onConflict: "business_id,provider" }
  ).select("id").single();

  if (error || !integration) return { error: error?.message ?? "Could not save integration" };
  const { error: credentialError } = await admin.from("integration_credentials").upsert({
    integration_id: integration.id,
    business_id: business.id,
    access_token_encrypted: await encryptIntegrationSecret(
      accessToken,
      requireServerEnv("INTEGRATION_ENCRYPTION_KEY"),
    ),
    scopes: [],
    refresh_status: "valid",
  }, { onConflict: "integration_id" });
  if (credentialError) {
    await admin.from("integrations").update({ is_active: false }).eq("id", integration.id);
    return { error: "Could not securely store the credential" };
  }
  return { success: true };
}

export async function disconnectIntegration(provider: string) {
  const business = await getBusiness();
  if (!business) return { error: "No business found" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("integrations")
    .update({ is_active: false })
    .eq("business_id", business.id)
    .eq("provider", provider);

  if (error) return { error: error.message };
  return { success: true };
}
