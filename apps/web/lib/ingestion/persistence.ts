import type { ExtractedFact } from "./extract.ts";

export function prepareFactRows(
  businessId: string,
  sourceId: string,
  facts: ExtractedFact[],
) {
  return facts.map((fact) => ({
    business_id: businessId,
    source_id: sourceId,
    category: fact.category,
    fact_key: fact.factKey,
    value: fact.value,
    confidence: fact.confidence,
    source_url: fact.sourceUrl,
    review_status: "proposed" as const,
  }));
}
