import { AppError } from "./errors.ts";

export function assertServiceRole(req: Request): void {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new AppError("Service-role authorization is required", 401, "SERVICE_ROLE_REQUIRED");
  try {
    const encoded = token.split(".")[1];
    if (!encoded) throw new Error("Missing JWT payload");
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized)) as { role?: string };
    if (payload.role !== "service_role") throw new Error("Wrong role");
  } catch {
    throw new AppError("Service-role authorization is required", 401, "SERVICE_ROLE_REQUIRED");
  }
}
