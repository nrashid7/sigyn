import assert from "node:assert/strict";
import test from "node:test";

import { findMatchingGooglePlace } from "../apps/web/lib/ingestion/google-places.ts";

test("Google Places enrichment accepts a uniquely corroborated match", async () => {
  const result = await findMatchingGooglePlace(
    { name: "Acme HVAC", website: "https://acme.example", phone: "+15075550100" },
    "maps-key",
    async () => new Response(JSON.stringify({ places: [
      { id: "place-1", displayName: { text: "Acme HVAC" }, websiteUri: "https://www.acme.example", nationalPhoneNumber: "(507) 555-0100", formattedAddress: "1 Main St", rating: 4.9 },
      { id: "place-2", displayName: { text: "Acme Heating" }, websiteUri: "https://other.example", nationalPhoneNumber: "(612) 555-0100" },
    ] }), { headers: { "content-type": "application/json" } }),
  );

  assert.equal(result?.place.id, "place-1");
  assert.equal(result?.confidence, 1);
});

test("Google Places enrichment rejects ambiguous or weak matches", async () => {
  const result = await findMatchingGooglePlace(
    { name: "Acme", website: "https://acme.example", phone: "+15075550100" },
    "maps-key",
    async () => new Response(JSON.stringify({ places: [
      { id: "place-1", displayName: { text: "Acme North" } },
      { id: "place-2", displayName: { text: "Acme South" } },
    ] })),
  );
  assert.equal(result, null);
});
