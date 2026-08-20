import { createHmac } from "node:crypto";

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashBetaInvite(code: string, secret: string): string {
  if (!code.trim() || secret.length < 16) throw new Error("Invalid beta invitation configuration");
  return createHmac("sha256", secret).update(code.trim()).digest("hex");
}
