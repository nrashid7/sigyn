import { load } from "cheerio";

export interface ExtractedFact {
  category: string;
  factKey: string;
  value: unknown;
  confidence: number;
  sourceUrl: string;
}

const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "x.com",
  "twitter.com",
];

function isSocialUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return SOCIAL_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function localBusinessNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(localBusinessNodes);
  if (!value || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  const graph = Array.isArray(node["@graph"]) ? localBusinessNodes(node["@graph"]) : [];
  const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  const isBusiness = types.some((type) =>
    typeof type === "string" && (
      type === "LocalBusiness" ||
      type.endsWith("Business") ||
      ["Organization", "ProfessionalService", "Store", "MedicalOrganization"].includes(type)
    )
  );
  return isBusiness ? [node, ...graph] : graph;
}

function allSchemaNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(allSchemaNodes);
  if (!value || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  return [node, ...allSchemaNodes(node["@graph"])];
}

function addFact(
  facts: ExtractedFact[],
  category: string,
  factKey: string,
  value: unknown,
  sourceUrl: string,
  confidence = 0.95,
) {
  if (value === undefined || value === null || value === "") return;
  const duplicate = facts.some((fact) =>
    fact.category === category && fact.factKey === factKey &&
    JSON.stringify(fact.value) === JSON.stringify(value)
  );
  if (!duplicate) facts.push({ category, factKey, value, confidence, sourceUrl });
}

export function extractFactsFromHtml(html: string, sourceUrl: string): ExtractedFact[] {
  const $ = load(html);
  const facts: ExtractedFact[] = [];

  $('script[type="application/ld+json"]').each((_index, element) => {
    try {
      const parsed = JSON.parse($(element).text());
      for (const node of localBusinessNodes(parsed)) {
        addFact(facts, "identity", "name", node.name, sourceUrl);
        addFact(facts, "contact", "phone", node.telephone, sourceUrl);
        addFact(facts, "contact", "email", node.email, sourceUrl);
        addFact(facts, "contact", "website", node.url, sourceUrl);
        addFact(facts, "location", "address", node.address, sourceUrl);
        addFact(facts, "hours", "opening_hours", node.openingHoursSpecification ?? node.openingHours, sourceUrl);
        addFact(facts, "services", "catalog", node.hasOfferCatalog ?? node.makesOffer, sourceUrl, 0.9);
        const sameAs = Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs];
        for (const socialUrl of sameAs) {
          if (typeof socialUrl === "string" && isSocialUrl(socialUrl)) {
            addFact(facts, "social", "profile", socialUrl, sourceUrl, 0.98);
          }
        }
      }
      for (const node of allSchemaNodes(parsed)) {
        const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
        if (!types.includes("FAQPage")) continue;
        const questions = Array.isArray(node.mainEntity) ? node.mainEntity : [];
        for (const question of questions) {
          if (!question || typeof question !== "object") continue;
          const item = question as Record<string, unknown>;
          const answer = item.acceptedAnswer && typeof item.acceptedAnswer === "object"
            ? (item.acceptedAnswer as Record<string, unknown>).text
            : undefined;
          if (typeof item.name === "string" && typeof answer === "string") {
            addFact(facts, "faq", "question_answer", { question: item.name, answer }, sourceUrl, 0.92);
          }
        }
      }
    } catch {
      // Invalid JSON-LD is ignored; visible-page extraction can still proceed.
    }
  });

  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const absolute = new URL(href, sourceUrl).toString();
      if (isSocialUrl(absolute)) addFact(facts, "social", "profile", absolute, sourceUrl, 0.85);
    } catch {
      // Ignore malformed links.
    }
  });

  return facts;
}

const PAGE_PRIORITY: Array<[RegExp, number]> = [
  [/\/(services?|products?|solutions?)(\/|$)/i, 100],
  [/\/(pricing|rates?|menu)(\/|$)/i, 95],
  [/\/(faq|frequently-asked)(\/|$)/i, 90],
  [/\/(contact|locations?)(\/|$)/i, 85],
  [/\/(about|team|staff)(\/|$)/i, 80],
  [/\/(polic(y|ies)|privacy|terms|cancellations?)(\/|$)/i, 75],
];

export function selectHighValueUrls(baseUrl: string, candidates: string[], limit = 25): string[] {
  const base = new URL(baseUrl);
  base.hash = "";
  base.pathname = "/";
  base.search = "";

  const unique = new Map<string, number>();
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, base);
      if (url.origin !== base.origin) continue;
      url.hash = "";
      const score = PAGE_PRIORITY.find(([pattern]) => pattern.test(url.pathname))?.[1] ?? 0;
      if (score > 0) unique.set(url.toString(), Math.max(score, unique.get(url.toString()) ?? 0));
    } catch {
      // Ignore malformed sitemap links.
    }
  }

  return [base.toString(), ...[...unique.entries()]
    .filter(([url]) => url !== base.toString())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([url]) => url)]
    .slice(0, limit);
}
