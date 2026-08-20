import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasServerEnv } from "@/lib/server/env";
import { requireServerEnv } from "@/lib/server/env";
import { createOAuthState } from "@/lib/server/oauth-state";
import { getGoogleOAuthConfig } from "@/lib/integrations/google-oauth";
import { enforceRateLimit, requestIp } from "@/lib/server/production-service";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  try {
    await enforceRateLimit("oauth", `${user.id}:${requestIp(request)}`);
  } catch {
    return NextResponse.redirect(new URL("/dashboard/settings?error=oauth_rate_limited", request.url));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!hasServerEnv("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NEXT_PUBLIC_APP_URL", "OAUTH_STATE_SECRET")) {
    return NextResponse.redirect(new URL("/dashboard/settings?error=google_not_configured", request.url));
  }

  const purpose = new URL(request.url).searchParams.get("purpose") ?? "google_calendar";
  let oauthConfig;
  try {
    oauthConfig = getGoogleOAuthConfig(purpose);
  } catch {
    return NextResponse.redirect(new URL("/dashboard/settings?error=unsupported_google_integration", request.url));
  }
  if (
    oauthConfig.provider === "google_business_profile" &&
    process.env.GOOGLE_BUSINESS_PROFILE_ENABLED !== "true"
  ) {
    return NextResponse.redirect(new URL("/dashboard/settings?error=google_business_profile_unavailable", request.url));
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/oauth/google/callback`;
  const state = await createOAuthState({
    userId: user.id,
    purpose: oauthConfig.provider,
    returnTo: oauthConfig.returnTo,
  }, requireServerEnv("OAUTH_STATE_SECRET"));

  const params = new URLSearchParams({
    client_id: clientId || "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: oauthConfig.scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
}
