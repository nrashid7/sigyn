# BusinessVoice AI — Environment Variables

`.env.example` (repo root) mirrors the three sections below. Copy the relevant
section's values into the right place — there is no single `.env` that covers
everything, because the app, the edge functions, and the local scripts run in
three different places.

## Vercel (apps/web)

Set these in the Vercel project settings for `apps/web`.

| Variable | Where set | Description |
|----------|-----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel project settings | Supabase project URL, exposed to the browser |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel project settings | Publishable key for the browser client. Legacy projects can instead set `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the app reads either |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel project settings | Legacy JWT service-role key for server actions/routes. Rotated `sb_secret_*` keys do not pass `verify_jwt` and cannot be used here |
| `NEXT_PUBLIC_APP_URL` | Vercel project settings | Public app URL (`http://localhost:3000` in dev) |
| `STRIPE_SECRET_KEY` | Vercel project settings | Stripe secret key for checkout/portal routes |
| `STRIPE_PRICE_STARTER` | Vercel project settings | Price ID for the Starter plan |
| `STRIPE_PRICE_PRO` | Vercel project settings | Price ID for the Pro plan |
| `STRIPE_PRICE_SETUP` | Vercel project settings | Price ID for the one-time setup fee |
| `GOOGLE_CLIENT_ID` | Vercel project settings | Google OAuth client ID (Calendar connect) |
| `GOOGLE_CLIENT_SECRET` | Vercel project settings | Google OAuth client secret |
| `NEXT_PUBLIC_POSTHOG_KEY` | Vercel project settings | PostHog project API key (browser) |
| `NEXT_PUBLIC_POSTHOG_HOST` | Vercel project settings | PostHog host (default `https://us.i.posthog.com`) |
| `POSTHOG_API_KEY` | Vercel project settings | Server-side PostHog key, also used by edge functions (see below) |

## Supabase edge-function secrets

Put these in `supabase/.env.local` (gitignored via the `.env*.local` pattern
in `.gitignore`), then run `npm run secrets:set` to push them to the linked
project.

> `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are
> **auto-injected into every Edge Function at runtime** — the Supabase CLI
> rejects any secret whose name starts with `SUPABASE_`, so none of the three
> are ever set via `npm run secrets:set`. The `SUPABASE_URL` listed under
> **Local scripts only** below is a separate, explicit value for standalone
> Node scripts that run outside the edge runtime and so never get that
> injection.

| Variable | Where set | Description |
|----------|-----------|-------------|
| `ELEVENLABS_API_KEY` | `supabase/.env.local` → `npm run secrets:set` | ElevenLabs API key used to create/update agents, import phone numbers, and fetch voices |
| `ELEVENLABS_WEBHOOK_SECRET` | Printed by `npm run setup:elevenlabs` | HMAC secret for verifying `elevenlabs-webhook` post-call signatures |
| `ELEVENLABS_TOOL_SECRET` | Printed by `npm run setup:elevenlabs` | Shared secret ElevenLabs sends back on every mid-call tool request (`calendar-availability`, `calendar-book`, `qualify-lead`) |
| `ELEVENLABS_TOOL_IDS` | Printed by `npm run setup:elevenlabs` | JSON map of tool name → ElevenLabs tool id, used when attaching tools to an agent |
| `TWILIO_ACCOUNT_SID` | `supabase/.env.local` → `npm run secrets:set` | Twilio account SID, for SMS and phone number import |
| `TWILIO_AUTH_TOKEN` | `supabase/.env.local` → `npm run secrets:set` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | `supabase/.env.local` → `npm run secrets:set` | Fallback SMS sender number when a business has no dedicated number yet |
| `STRIPE_SECRET_KEY` | `supabase/.env.local` → `npm run secrets:set` | Stripe secret key used server-side by `stripe-webhook` |
| `STRIPE_WEBHOOK_SECRET` | `supabase/.env.local` → `npm run secrets:set` | Signing secret for verifying `stripe-webhook` events |
| `STRIPE_PRICE_STARTER` | `supabase/.env.local` → `npm run secrets:set` | Price ID used to resolve the Starter plan from a subscription |
| `STRIPE_PRICE_PRO` | `supabase/.env.local` → `npm run secrets:set` | Price ID used to resolve the Pro plan from a subscription |
| `GOOGLE_CLIENT_ID` | `supabase/.env.local` → `npm run secrets:set` | Google OAuth client ID (Calendar token refresh) |
| `GOOGLE_CLIENT_SECRET` | `supabase/.env.local` → `npm run secrets:set` | Google OAuth client secret |
| `N8N_WEBHOOK_BASE_URL` | `supabase/.env.local` → `npm run secrets:set` | Base URL `n8n-dispatch` posts to when a business has no per-workflow `webhook_url` in the `workflows` table |
| `N8N_WEBHOOK_SECRET` | `supabase/.env.local` → `npm run secrets:set` | Shared secret `n8n-dispatch` signs outgoing payloads with; also verified on incoming n8n calls |
| `POSTHOG_API_KEY` | `supabase/.env.local` → `npm run secrets:set` | Server-side PostHog key used by edge functions (`captureBusinessEvent`) |
| `POSTHOG_HOST` | `supabase/.env.local` → `npm run secrets:set` | PostHog host for edge functions (default `https://us.i.posthog.com`) |

### Cron job (Vault secrets)

The `calls-reconcile` cron job
(`supabase/migrations/20260913000011_calls_reconcile_cron.sql`) calls the
function on a schedule via `pg_cron` + `pg_net`, authenticated with two Vault
secrets created **once, by hand, in the SQL editor** — they are not part of
`.env.example` and are never set via the CLI:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<legacy service_role JWT>', 'service_role_key');
```

## GitHub Actions

`docs/DEPLOY_WITH_GITHUB_ACTIONS.md` covers full setup. These are set in the
repo's Settings → Secrets and variables → Actions and read by
`.github/workflows/deploy-backend.yml` — never by the app or the edge
functions.

| Repository variable | Description |
|----------------------|-------------|
| `SUPABASE_PROJECT_REF` | Linked project ref, used by every `--project-ref` flag |
| `SUPABASE_URL` | Same project URL as above, used by the job `env` and the ElevenLabs setup script |
| `N8N_WEBHOOK_BASE_URL` | Optional — same value as the edge-function secret of the same name above, supplied as a repository variable instead |

| CI-only secret | Description |
|-----------------|-------------|
| `SUPABASE_ACCESS_TOKEN` | Personal access token the workflow uses to authenticate the Supabase CLI |
| `SUPABASE_DB_URL` | Session-pooler connection string used by `supabase db push` and the seed/vault `psql` steps |

The edge-function secrets listed above (`ELEVENLABS_*`, `TWILIO_*`,
`STRIPE_*`, `GOOGLE_CLIENT_*`, `N8N_WEBHOOK_SECRET`, `POSTHOG_API_KEY`) are
also stored as GitHub Secrets with the same names — the workflow forwards
them to Supabase rather than introducing new names for them.

## Local scripts only

These are read directly from the shell environment when you run a script by
hand — they are not set in Vercel or via `supabase secrets set`.

| Variable | Where set | Description |
|----------|-----------|-------------|
| `N8N_API_URL` | Local shell | n8n instance URL used by `scripts/deploy-n8n-workflows.mjs` |
| `N8N_API_KEY` | Local shell | n8n API key used by `scripts/deploy-n8n-workflows.mjs` to import/activate workflows |
| `SUPABASE_URL` | Local shell | Project URL read directly by `scripts/elevenlabs-setup.mjs` and `scripts/smoke-elevenlabs.mjs`, which run outside Vercel/the edge runtime and so don't get it auto-injected |
| `AGENT_ID` | Local shell (optional) | Optional agent id for `scripts/smoke-elevenlabs.mjs`; without it, checks that need a real agent row are skipped rather than failed |
