import { createHmac } from "node:crypto";

export const RATE_LIMIT_POLICIES = {
  demo_ip: { limit: 3, windowSeconds: 60 * 60 },
  demo_phone: { limit: 2, windowSeconds: 24 * 60 * 60 },
  ingestion: { limit: 10, windowSeconds: 60 * 60 },
  oauth: { limit: 10, windowSeconds: 15 * 60 },
  billing_checkout: { limit: 5, windowSeconds: 60 * 60 },
  billing_portal: { limit: 10, windowSeconds: 60 * 60 },
  agent_provisioning: { limit: 5, windowSeconds: 60 * 60 },
  voice_preview: { limit: 30, windowSeconds: 60 * 60 },
} as const;

export type RateLimitPolicy = keyof typeof RATE_LIMIT_POLICIES;

export function hashRateLimitKey(value: string, secret: string): string {
  if (!value || secret.length < 16) throw new Error("Invalid rate-limit configuration");
  return createHmac("sha256", secret).update(value).digest("hex");
}
