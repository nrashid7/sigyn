import assert from "node:assert/strict";
import test from "node:test";

import { getGoogleOAuthConfig } from "../apps/web/lib/integrations/google-oauth.ts";

test("Google Calendar requests only calendar scopes", () => {
  assert.deepEqual(getGoogleOAuthConfig("google_calendar"), {
    provider: "google_calendar",
    returnTo: "/onboarding/calendar",
    scopes: [
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/calendar.events",
    ],
  });
});

test("Google Business Profile uses an independent owner-authorized scope", () => {
  assert.deepEqual(getGoogleOAuthConfig("google_business_profile"), {
    provider: "google_business_profile",
    returnTo: "/dashboard/settings",
    scopes: ["https://www.googleapis.com/auth/business.manage"],
  });
});

test("unknown Google OAuth purposes are rejected", () => {
  assert.throws(() => getGoogleOAuthConfig("drive"), /Unsupported Google integration/);
});
