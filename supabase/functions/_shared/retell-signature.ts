const RETELL_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function hmacHex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyRetellSignatureValue(
  rawBody: string,
  signature: string | null,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!signature) return false;

  const match = /^v=(\d+),d=([a-fA-F0-9]{64})$/.exec(signature.trim());
  if (!match) return false;

  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp)) return false;
  if (Math.abs(now - timestamp) > RETELL_SIGNATURE_MAX_AGE_MS) return false;

  const expected = await hmacHex(`${rawBody}${match[1]}`, secret);
  return constantTimeEqual(expected, match[2].toLowerCase());
}
