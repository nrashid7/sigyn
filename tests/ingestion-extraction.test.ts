import assert from "node:assert/strict";
import test from "node:test";

import {
  extractFactsFromHtml,
  selectHighValueUrls,
} from "../apps/web/lib/ingestion/extract.ts";
import {
  buildKnowledgeMarkdown,
  scoreGooglePlaceMatch,
} from "../apps/web/lib/ingestion/knowledge.ts";

test("website extraction captures structured business facts and official social links", () => {
  const html = `<!doctype html><html><head>
    <title>Acme HVAC</title>
    <script type="application/ld+json">{
      "@context":"https://schema.org","@type":"HVACBusiness","name":"Acme HVAC",
      "telephone":"+1 507-555-0100","url":"https://acme.example",
      "address":{"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"Mankato","addressRegion":"MN"},
      "openingHours":["Mo-Fr 08:00-17:00"],
      "sameAs":["https://www.facebook.com/acmehvac","https://www.instagram.com/acmehvac"]
    }</script>
    <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Do you offer emergency service?","acceptedAnswer":{"text":"Yes, call for current availability."}}]}</script>
  </head><body><a href="https://www.linkedin.com/company/acme-hvac">LinkedIn</a></body></html>`;

  const facts = extractFactsFromHtml(html, "https://acme.example/");

  assert.ok(facts.some((fact) => fact.factKey === "name" && fact.value === "Acme HVAC"));
  assert.ok(facts.some((fact) => fact.factKey === "phone" && fact.value === "+1 507-555-0100"));
  assert.ok(facts.some((fact) => fact.factKey === "address" && (fact.value as { addressLocality: string }).addressLocality === "Mankato"));
  assert.ok(facts.some((fact) => fact.category === "faq" && (fact.value as { question: string }).question.includes("emergency")));
  assert.deepEqual(
    facts.filter((fact) => fact.category === "social").map((fact) => fact.value).sort(),
    [
      "https://www.facebook.com/acmehvac",
      "https://www.instagram.com/acmehvac",
      "https://www.linkedin.com/company/acme-hvac",
    ],
  );
});

test("high-value URL selection stays same-origin, prioritizes useful pages, and is bounded", () => {
  const urls = [
    "https://acme.example/blog/post-1",
    "https://other.example/services",
    "https://acme.example/contact",
    "https://acme.example/services/heating",
    "https://acme.example/privacy",
    "https://acme.example/about",
  ];

  assert.deepEqual(selectHighValueUrls("https://acme.example", urls, 3), [
    "https://acme.example/",
    "https://acme.example/services/heating",
    "https://acme.example/contact",
  ]);
});

test("Google Place confidence requires corroborating identity signals", () => {
  assert.equal(scoreGooglePlaceMatch(
    { name: "Acme HVAC", website: "https://acme.example", phone: "+15075550100" },
    { name: "Acme HVAC", website: "https://www.acme.example/", phone: "(507) 555-0100" },
  ), 1);
  assert.equal(scoreGooglePlaceMatch(
    { name: "Acme HVAC", website: "https://acme.example", phone: "+15075550100" },
    { name: "Acme Heating", website: "https://different.example", phone: "+16125550100" },
  ), 0.2);
});

test("knowledge Markdown includes approved facts only with stable sections", () => {
  const markdown = buildKnowledgeMarkdown("Acme HVAC", [
    { category: "services", factKey: "heating", value: "Furnace repair", reviewStatus: "approved" },
    { category: "policies", factKey: "cancellation", value: "24 hours notice", reviewStatus: "proposed" },
    { category: "contact", factKey: "phone", value: "+1 507-555-0100", reviewStatus: "approved" },
  ]);

  assert.equal(markdown, `# Acme HVAC\n\n## Contact\n- **Phone:** +1 507-555-0100\n\n## Services\n- **Heating:** Furnace repair\n`);
  assert.equal(markdown.includes("cancellation"), false);
});
