import { AppError } from "./errors.ts";
import { timingSafeEqual } from "./auth.ts";

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

export async function readRawBody(req: Request): Promise<string> {
  return await req.text();
}
