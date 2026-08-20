import test from "node:test";
import assert from "node:assert/strict";
import { prepareFactRows } from "../apps/web/lib/ingestion/persistence.ts";

test("extracted facts retain tenant, provenance, confidence, and proposed state", () => {
  const rows = prepareFactRows("business-1", "source-1", [{
    category: "contact",
    factKey: "phone",
    value: "+15551234567",
    confidence: 0.94,
    sourceUrl: "https://example.com/contact",
  }]);

  assert.deepEqual(rows, [{
    business_id: "business-1",
    source_id: "source-1",
    category: "contact",
    fact_key: "phone",
    value: "+15551234567",
    confidence: 0.94,
    source_url: "https://example.com/contact",
    review_status: "proposed",
  }]);
});
