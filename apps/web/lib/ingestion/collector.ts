import { load } from "cheerio";
import { extractFactsFromHtml, selectHighValueUrls, type ExtractedFact } from "./extract.ts";
import { fetchSafeHtml, fetchSafeText, type HostResolver, type SafeFetcher } from "./safe-url.ts";

interface CollectWebsiteInput {
  website: string;
  resolveHost: HostResolver;
  fetchImpl?: SafeFetcher;
  pageLimit?: number;
}

export async function collectWebsiteFacts(input: CollectWebsiteInput): Promise<ExtractedFact[]> {
  const homepage = await fetchSafeHtml(input.website, input.resolveHost, input.fetchImpl);
  const $ = load(homepage.body);
  const links = $("a[href]").toArray().flatMap((element) => {
    const href = $(element).attr("href");
    if (!href) return [];
    try {
      return [new URL(href, homepage.url).toString()];
    } catch {
      return [];
    }
  });
  const origin = new URL(homepage.url).origin;
  const disallowed: string[] = [];
  const sitemapUrls = new Set<string>([`${origin}/sitemap.xml`]);
  try {
    const robots = await fetchSafeText(`${origin}/robots.txt`, input.resolveHost, input.fetchImpl);
    let applies = false;
    for (const rawLine of robots.body.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      const [directive, ...parts] = line.split(":");
      const value = parts.join(":").trim();
      if (directive?.trim().toLowerCase() === "user-agent") applies = value === "*";
      if (applies && directive?.trim().toLowerCase() === "disallow" && value) disallowed.push(value);
      if (directive?.trim().toLowerCase() === "sitemap" && value) sitemapUrls.add(value);
    }
  } catch {
    // Missing robots.txt does not prevent a bounded public-site import.
  }
  const sitemapLinks: string[] = [];
  for (const sitemapUrl of [...sitemapUrls].slice(0, 5)) {
    try {
      const sitemap = await fetchSafeText(sitemapUrl, input.resolveHost, input.fetchImpl);
      sitemapLinks.push(...[...sitemap.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1]));
    } catch {
      // Sitemaps are optional and individual failures are isolated.
    }
  }
  const pages = selectHighValueUrls(homepage.url, [...links, ...sitemapLinks], input.pageLimit ?? 25)
    .filter((page) => !disallowed.some((prefix) => new URL(page).pathname.startsWith(prefix)));
  const facts = extractFactsFromHtml(homepage.body, homepage.url);

  for (const page of pages.slice(1)) {
    try {
      const fetched = await fetchSafeHtml(page, input.resolveHost, input.fetchImpl);
      facts.push(...extractFactsFromHtml(fetched.body, fetched.url));
    } catch {
      // A single secondary page must not fail the entire business import.
    }
  }

  const deduped = new Map<string, ExtractedFact>();
  for (const fact of facts) {
    const key = `${fact.category}:${fact.factKey}:${JSON.stringify(fact.value)}`;
    const existing = deduped.get(key);
    if (!existing || fact.confidence > existing.confidence) deduped.set(key, fact);
  }
  return [...deduped.values()];
}
