import { AppError, requireEnv } from "./errors.ts";
import { timingSafeEqual } from "./auth.ts";

/** Half an hour of clock skew, matching the ElevenLabs webhook tolerance. */
const ELEVENLABS_SIGNATURE_TOLERANCE_SECS = 1800;

export async function verifyHmacSignature(
  payload: string,
  signature: string | null,
  secret: string,
  headerPrefix = "sha256=",
): Promise<boolean> {
  if (!signature) return false;

  const normalized = signature.startsWith(headerPrefix)
    ? signature.slice(headerPrefix.length)
    : signature;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );

  const expected = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(expected, normalized);
}

export async function verifyRetellSignature(
  req: Request,
  rawBody: string,
): Promise<void> {
  const secret = Deno.env.get("RETELL_WEBHOOK_SECRET") ?? Deno.env.get("RETELL_API_KEY");
  if (!secret) {
    throw new AppError("Missing RETELL_WEBHOOK_SECRET or RETELL_API_KEY", 500, "CONFIG_ERROR");
  }

  const signature = req.headers.get("x-retell-signature");
  const valid = await verifyHmacSignature(rawBody, signature, secret);
  if (!valid) {
    throw new AppError("Invalid Retell webhook signature", 401, "INVALID_SIGNATURE");
  }
}

export async function verifyN8nSignature(
  req: Request,
  rawBody: string,
): Promise<void> {
  const secret = Deno.env.get("N8N_WEBHOOK_SECRET");
  if (!secret) return;

  const signature = req.headers.get("x-n8n-signature") ??
    req.headers.get("x-webhook-signature");
  const valid = await verifyHmacSignature(rawBody, signature, secret);
  if (!valid) {
    throw new AppError("Invalid n8n webhook signature", 401, "INVALID_SIGNATURE");
  }
}

/** Parses an ElevenLabs `elevenlabs-signature` header: "t=1757800000,v0=abcd…". */
export function parseElevenLabsSignature(
  header: string | null,
): { t: number; v0: string } | null {
  if (!header) return null;

  let timestamp: number | null = null;
  let v0: string | null = null;

  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === "t") {
      if (!/^\d+$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === "v0") {
      v0 = value;
    }
  }

  if (timestamp === null || !v0) return null;
  return { t: timestamp, v0 };
}

export async function verifyElevenLabsSignature(
  req: Request,
  rawBody: string,
  nowMs: number = Date.now(),
): Promise<void> {
  const secret = requireEnv("ELEVENLABS_WEBHOOK_SECRET");

  const parsed = parseElevenLabsSignature(req.headers.get("elevenlabs-signature"));
  if (!parsed) {
    throw new AppError(
      "Missing ElevenLabs webhook signature",
      401,
      "INVALID_SIGNATURE",
    );
  }

  if (Math.abs(nowMs / 1000 - parsed.t) > ELEVENLABS_SIGNATURE_TOLERANCE_SECS) {
    throw new AppError("Stale ElevenLabs webhook", 401, "STALE_SIGNATURE");
  }

  // ElevenLabs signs "<timestamp>.<raw body>" and sends the digest unprefixed.
  const valid = await verifyHmacSignature(
    `${parsed.t}.${rawBody}`,
    parsed.v0,
    secret,
    "",
  );
  if (!valid) {
    throw new AppError(
      "Invalid ElevenLabs webhook signature",
      401,
      "INVALID_SIGNATURE",
    );
  }
}

export async function readRawBody(req: Request): Promise<string> {
  return await req.text();
}
