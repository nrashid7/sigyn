export type GoogleIntegrationPurpose = "google_calendar" | "google_business_profile";

export function getGoogleOAuthConfig(purpose: string) {
  if (purpose === "google_calendar") {
    return {
      provider: "google_calendar" as const,
      returnTo: "/onboarding/calendar",
      scopes: [
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/calendar.events",
      ],
    };
  }
  if (purpose === "google_business_profile") {
    return {
      provider: "google_business_profile" as const,
      returnTo: "/dashboard/settings",
      scopes: ["https://www.googleapis.com/auth/business.manage"],
    };
  }
  throw new Error("Unsupported Google integration");
}
