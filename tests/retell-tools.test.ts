import test from "node:test";
import assert from "node:assert/strict";
import { buildCustomToolsConfig } from "../supabase/functions/_shared/retell-tools.ts";

test("live Retell tools use native knowledge and never accept tenant identifiers", () => {
  const tools = buildCustomToolsConfig("https://project.supabase.co", "business-1", {
    includeCalendar: true,
  });
  assert.equal(tools.some((tool) => tool.name === "search_knowledge"), false);
  for (const tool of tools) {
    const properties = (tool.parameters?.properties ?? {}) as Record<string, unknown>;
    assert.equal("business_id" in properties, false, `${tool.name} exposes business_id`);
  }
});
