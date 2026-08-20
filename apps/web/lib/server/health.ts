interface HealthInput {
  version: string;
  database: { ok: boolean; latency_ms?: number };
  configuration: { ok: boolean; missing?: string[] };
}

export function evaluateHealth(input: HealthInput) {
  return {
    status: input.database.ok && input.configuration.ok ? "ok" as const : "degraded" as const,
    version: input.version,
    checks: {
      database: input.database,
      configuration: input.configuration,
    },
  };
}

export const REQUIRED_PRODUCTION_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "RETELL_API_KEY",
  "RETELL_WEBHOOK_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "N8N_WEBHOOK_BASE_URL",
  "N8N_WEBHOOK_SECRET",
  "INTEGRATION_ENCRYPTION_KEY",
  "OAUTH_STATE_SECRET",
  "DEMO_HASH_SECRET",
  "RATE_LIMIT_SECRET",
  "BETA_INVITE_SECRET",
  "CRON_SECRET",
  "SENTRY_DSN",
  "NEXT_PUBLIC_POSTHOG_KEY",
] as const;
