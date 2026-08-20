interface BusinessIdentity {
  name?: string | null;
  website?: string | null;
  phone?: string | null;
}

interface KnowledgeFact {
  category: string;
  factKey: string;
  value: unknown;
  reviewStatus: string;
}

function normalizedHost(value?: string | null): string {
  if (!value) return "";
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizedPhone(value?: string | null): string {
  return (value ?? "").replace(/\D/g, "").slice(-10);
}

function normalizedName(value?: string | null): string[] {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
}

export function scoreGooglePlaceMatch(expected: BusinessIdentity, candidate: BusinessIdentity): number {
  let score = 0;
  const expectedHost = normalizedHost(expected.website);
  if (expectedHost && expectedHost === normalizedHost(candidate.website)) score += 0.4;
  const expectedPhone = normalizedPhone(expected.phone);
  if (expectedPhone && expectedPhone === normalizedPhone(candidate.phone)) score += 0.4;
  const expectedName = normalizedName(expected.name);
  const candidateName = new Set(normalizedName(candidate.name));
  if (expectedName.length > 0 && expectedName.some((token) => candidateName.has(token))) score += 0.2;
  return Number(score.toFixed(3));
}

function title(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function printable(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function buildKnowledgeMarkdown(businessName: string, facts: KnowledgeFact[]): string {
  const approved = facts
    .filter((fact) => fact.reviewStatus === "approved")
    .sort((left, right) =>
      left.category.localeCompare(right.category) || left.factKey.localeCompare(right.factKey)
    );
  const sections = new Map<string, KnowledgeFact[]>();
  for (const fact of approved) sections.set(fact.category, [...(sections.get(fact.category) ?? []), fact]);

  let markdown = `# ${businessName}\n`;
  for (const [category, categoryFacts] of sections) {
    markdown += `\n## ${title(category)}\n`;
    for (const fact of categoryFacts) markdown += `- **${title(fact.factKey)}:** ${printable(fact.value)}\n`;
  }
  return markdown;
}
