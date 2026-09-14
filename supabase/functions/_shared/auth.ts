import { AppError, requireEnv } from "./errors.ts";

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** Bearer must equal SUPABASE_SERVICE_ROLE_KEY exactly. 403 otherwise; 500 CONFIG_ERROR if env missing. */
export function requireServiceRole(req: Request): void {
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : undefined;

  if (!token || !timingSafeEqual(token, serviceRoleKey)) {
    throw new AppError("Service role required", 403, "FORBIDDEN");
  }
}

/** Header x-sigyn-tool-secret must equal ELEVENLABS_TOOL_SECRET. 401 otherwise; 500 CONFIG_ERROR if env missing. */
export function requireToolSecret(req: Request): void {
  const toolSecret = requireEnv("ELEVENLABS_TOOL_SECRET");

  const provided = req.headers.get("x-sigyn-tool-secret");

  if (!provided || !timingSafeEqual(provided, toolSecret)) {
    throw new AppError("Invalid tool secret", 401, "INVALID_TOOL_SECRET");
  }
}
