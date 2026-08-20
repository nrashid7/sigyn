import { normalizeInviteEmail } from "./beta-invitations.ts";
import { evaluateControl, type ProductionControls, type ProductionOperation } from "./production-controls.ts";
import { hashRateLimitKey, RATE_LIMIT_POLICIES, type RateLimitPolicy } from "./rate-limit.ts";

interface RpcResult { data: unknown; error: { message?: string } | null }
export interface RpcClient { rpc(name: string, args?: Record<string, unknown>): PromiseLike<RpcResult> }

export async function assertBetaInvitation(client: RpcClient, email: string, codeHash: string): Promise<void> {
  const { data, error } = await client.rpc("validate_beta_invitation", {
    p_email: normalizeInviteEmail(email),
    p_code_hash: codeHash,
  });
  if (error) throw new Error("Beta invitation validation is unavailable");
  if (data !== true) throw new Error("A valid beta invitation is required");
}

export async function readProductionControls(client: RpcClient): Promise<ProductionControls> {
  const { data, error } = await client.rpc("get_system_controls");
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || typeof row !== "object") {
    return { signup_enabled: false, agent_provisioning_enabled: false, billing_enabled: false, automation_dispatch_enabled: false };
  }
  const value = row as Record<string, unknown>;
  return {
    signup_enabled: value.signup_enabled === true,
    agent_provisioning_enabled: value.agent_provisioning_enabled === true,
    billing_enabled: value.billing_enabled === true,
    automation_dispatch_enabled: value.automation_dispatch_enabled === true,
  };
}

export async function assertOperationEnabled(client: RpcClient, operation: ProductionOperation): Promise<void> {
  const result = evaluateControl(operation, await readProductionControls(client));
  if (!result.enabled) throw new Error(result.message);
}

export async function consumeDistributedRateLimit(
  client: RpcClient,
  policyName: RateLimitPolicy,
  rawKey: string,
  secret: string,
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  const policy = RATE_LIMIT_POLICIES[policyName];
  const { data, error } = await client.rpc("consume_rate_limit", {
    p_bucket: policyName,
    p_key_hash: hashRateLimitKey(rawKey, secret),
    p_limit: policy.limit,
    p_window_seconds: policy.windowSeconds,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || typeof row !== "object") return { allowed: false, remaining: 0, retryAfterSeconds: policy.windowSeconds };
  const value = row as Record<string, unknown>;
  return {
    allowed: value.allowed === true,
    remaining: Number(value.remaining) || 0,
    retryAfterSeconds: Number(value.retry_after_seconds) || policy.windowSeconds,
  };
}
