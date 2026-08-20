import assert from "node:assert/strict";
import test from "node:test";

import { createBusinessForCurrentUser } from "../apps/web/lib/services/business-service.ts";

test("business creation uses the atomic current-user RPC", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: { id: "business-1", name: "Acme HVAC" }, error: null };
    },
  };

  const result = await createBusinessForCurrentUser(client, {
    name: "Acme HVAC",
    website: "https://acme.example",
    industry: "home_services",
    phone: "+15075550100",
    timezone: "America/Chicago",
    hours: { monday: { open: "08:00", close: "17:00" } },
  });

  assert.deepEqual(result, { id: "business-1", name: "Acme HVAC" });
  assert.deepEqual(calls, [{
    name: "create_business_for_current_user",
    args: {
      business_name: "Acme HVAC",
      business_website: "https://acme.example",
      business_industry: "home_services",
      business_phone: "+15075550100",
      business_timezone: "America/Chicago",
      business_hours: { monday: { open: "08:00", close: "17:00" } },
    },
  }]);
});

test("business creation surfaces the database error", async () => {
  const client = {
    async rpc() {
      return { data: null, error: { message: "User already belongs to a business" } };
    },
  };

  await assert.rejects(
    () => createBusinessForCurrentUser(client, {
      name: "Acme HVAC",
      website: "",
      industry: "home_services",
      phone: "+15075550100",
      timezone: "America/Chicago",
      hours: {},
    }),
    /already belongs/,
  );
});
