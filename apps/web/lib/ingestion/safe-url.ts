export type HostResolver = (hostname: string) => Promise<string[]>;
export type SafeFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_REDIRECTS = 5;

function isPrivateIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224;
}

function isPrivateAddress(value: string): boolean {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (isPrivateIpv4(normalized)) return true;
  if (!normalized.includes(":")) return false;
  return normalized === "::" || normalized === "::1" ||
    normalized.startsWith("fc") || normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) || normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

export async function assertSafeSourceUrl(
  input: string,
  resolveHost: HostResolver,
): Promise<string> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Source must be a valid HTTP or HTTPS URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Source must be a valid HTTP or HTTPS URL");
  }
  if (url.username || url.password) {
    throw new Error("Source URLs cannot contain credentials");
  }
  if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new Error("Source URL must resolve to a public internet host");
  }

  const addresses = await resolveHost(url.hostname);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error("Source URL must resolve to a public internet host");
  }

  url.hash = "";
  return url.toString();
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Source response is too large");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Source response is too large");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export async function fetchSafeHtml(
  input: string,
  resolveHost: HostResolver,
  fetchImpl: SafeFetcher = fetch,
): Promise<{ url: string; body: string; contentType: string }> {
  return fetchSafeContent(input, resolveHost, fetchImpl, ["text/html", "application/xhtml+xml", "application/xml", "text/xml"], "Source must return HTML or XML content");
}

export async function fetchSafeText(
  input: string,
  resolveHost: HostResolver,
  fetchImpl: SafeFetcher = fetch,
): Promise<{ url: string; body: string; contentType: string }> {
  return fetchSafeContent(input, resolveHost, fetchImpl, ["text/plain", "application/xml", "text/xml"], "Source must return text or XML content");
}

async function fetchSafeContent(
  input: string,
  resolveHost: HostResolver,
  fetchImpl: SafeFetcher,
  allowedContentTypes: string[],
  unsupportedMessage: string,
): Promise<{ url: string; body: string; contentType: string }> {
  let current = await assertSafeSourceUrl(input, resolveHost);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(current, {
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9",
        "User-Agent": "SigynBusinessIngestion/1.0",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Source redirect is missing a location");
      if (redirectCount === MAX_REDIRECTS) throw new Error("Source has too many redirects");
      current = await assertSafeSourceUrl(new URL(location, current).toString(), resolveHost);
      continue;
    }
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);

    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    if (!allowedContentTypes.includes(contentType)) {
      throw new Error(unsupportedMessage);
    }
    return { url: current, body: await readBoundedText(response), contentType };
  }

  throw new Error("Source has too many redirects");
}
