import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireServerEnv } from "@/lib/server/env";
import { hashBetaInvite } from "./beta-invitations";
import {
  assertBetaInvitation,
  assertOperationEnabled,
  consumeDistributedRateLimit,
} from "./production-runtime";
import type { ProductionOperation } from "./production-controls";
import type { RateLimitPolicy } from "./rate-limit";

export async function requireProductionOperation(operation: ProductionOperation) {
  await assertOperationEnabled(createAdminClient(), operation);
}

export async function validateBetaInvitation(email: string, code: string) {
  const hash = hashBetaInvite(code, requireServerEnv("BETA_INVITE_SECRET"));
  await assertBetaInvitation(createAdminClient(), email, hash);
}

export async function enforceRateLimit(policy: RateLimitPolicy, key: string) {
  const result = await consumeDistributedRateLimit(
    createAdminClient(),
    policy,
    key,
    requireServerEnv("RATE_LIMIT_SECRET"),
  );
  if (!result.allowed) {
    const error = new Error("Too many requests; please try again later") as Error & { retryAfterSeconds?: number };
    error.retryAfterSeconds = result.retryAfterSeconds;
    throw error;
  }
  return result;
}

export function requestIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}
