interface OAuthStateInput {
  userId: string;
  purpose: string;
  returnTo: string;
}

interface OAuthStatePayload extends OAuthStateInput {
  issuedAt: number;
  nonce: string;
}

const MAX_STATE_AGE_MS = 15 * 60 * 1000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToString(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  )));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function createOAuthState(
  input: OAuthStateInput,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = stringToBase64Url(JSON.stringify({ ...input, issuedAt: now, nonce }));
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifyOAuthState(
  state: string,
  secret: string,
  expectedPurpose: string,
  now = Date.now(),
): Promise<OAuthStateInput | null> {
  try {
    const [payloadPart, signaturePart, extra] = state.split(".");
    if (!payloadPart || !signaturePart || extra) return null;
    const expected = await sign(payloadPart, secret);
    if (!constantTimeEqual(expected, signaturePart)) return null;

    const payload = JSON.parse(base64UrlToString(payloadPart)) as OAuthStatePayload;
    if (
      !payload.userId ||
      !payload.returnTo.startsWith("/") ||
      payload.returnTo.startsWith("//") ||
      payload.purpose !== expectedPurpose ||
      !Number.isSafeInteger(payload.issuedAt) ||
      payload.issuedAt > now ||
      now - payload.issuedAt > MAX_STATE_AGE_MS
    ) return null;

    return {
      userId: payload.userId,
      purpose: payload.purpose,
      returnTo: payload.returnTo,
    };
  } catch {
    return null;
  }
}
