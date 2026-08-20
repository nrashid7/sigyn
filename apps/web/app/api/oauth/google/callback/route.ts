import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBusiness } from "@/lib/actions/business";
import { hasServerEnv } from "@/lib/server/env";
import { requireServerEnv } from "@/lib/server/env";
import { verifyOAuthState } from "@/lib/server/oauth-state";
import { encryptIntegrationSecret } from "@/lib/server/integration-crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGoogleOAuthConfig } from "@/lib/integrations/google-oauth";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/dashboard/settings?error=oauth_denied`);
  }

  if (!hasServerEnv("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "OAUTH_STATE_SECRET", "INTEGRATION_ENCRYPTION_KEY")) {
    return NextResponse.redirect(`${origin}/dashboard/settings?error=google_not_configured`);
  }

  try {
    let verifiedState: Awaited<ReturnType<typeof verifyOAuthState>> = null;
    for (const purpose of ["google_calendar", "google_business_profile"]) {
      verifiedState = await verifyOAuthState(
        state,
        requireServerEnv("OAUTH_STATE_SECRET"),
        purpose,
      );
      if (verifiedState) break;
    }
    if (!verifiedState) {
      return NextResponse.redirect(`${origin}/dashboard/settings?error=invalid_oauth_state`);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== verifiedState.userId) {
      return NextResponse.redirect(`${origin}/login?error=invalid_oauth_state`);
    }
    const oauthConfig = getGoogleOAuthConfig(verifiedState.purpose);

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: `${origin}/api/oauth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok || tokens.error || !tokens.access_token) {
      return NextResponse.redirect(`${origin}/dashboard/settings?error=token_failed`);
    }

    const business = await getBusiness();
    if (business) {
      const { data: integration, error: integrationError } = await createAdminClient().from("integrations").upsert(
        {
          business_id: business.id,
          provider: oauthConfig.provider,
          config: { scope: tokens.scope },
          is_active: true,
        },
        { onConflict: "business_id,provider" }
      ).select("id").single();
      if (integrationError || !integration) throw integrationError ?? new Error("Integration was not saved");

      const encryptionKey = requireServerEnv("INTEGRATION_ENCRYPTION_KEY");
      const credential: Record<string, unknown> = {
        integration_id: integration.id,
        business_id: business.id,
        access_token_encrypted: await encryptIntegrationSecret(tokens.access_token, encryptionKey),
        scopes: String(tokens.scope ?? "").split(" ").filter(Boolean),
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        refresh_status: "valid",
      };
      if (tokens.refresh_token) {
        credential.refresh_token_encrypted = await encryptIntegrationSecret(tokens.refresh_token, encryptionKey);
      }
      const { error: credentialError } = await createAdminClient()
        .from("integration_credentials")
        .upsert(credential, { onConflict: "integration_id" });
      if (credentialError) throw credentialError;
    }

    const redirectTo = `${verifiedState.returnTo}?connected=${oauthConfig.provider}`;

    return NextResponse.redirect(`${origin}${redirectTo}`);
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    return NextResponse.redirect(`${origin}/dashboard/settings?error=oauth_failed`);
  }
}
