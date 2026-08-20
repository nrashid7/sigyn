# BusinessVoice AI — Deployment Guide

## Architecture

| Component | Platform |
|-----------|----------|
| Frontend | Vercel |
| Database, Auth, Storage, Edge Functions | Supabase |
| Voice | Retell AI |
| SMS | Twilio |
| Automation | n8n Cloud |
| Billing | Stripe |
| Analytics | PostHog |

The existing hosted stack is staging. Production must use dedicated provider projects, a protected GitHub `production` Environment, and an owned hostname supplied as `PRODUCTION_APP_URL`. Never reuse staging credentials in production.

## 1. Supabase Setup

```bash
# Install Supabase CLI
npm install -g supabase

# Login and link project
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Run migrations
supabase db push

# Seed agent templates
supabase db execute --file supabase/seed.sql

# Set Edge Function secrets
supabase secrets set RETELL_API_KEY=xxx OPENROUTER_API_KEY=xxx OPENAI_API_KEY=xxx
supabase secrets set STRIPE_SECRET_KEY=xxx STRIPE_WEBHOOK_SECRET=xxx
supabase secrets set TWILIO_ACCOUNT_SID=xxx TWILIO_AUTH_TOKEN=xxx TWILIO_PHONE_NUMBER=+1xxx
supabase secrets set ELEVENLABS_API_KEY=xxx N8N_WEBHOOK_BASE_URL=xxx N8N_WEBHOOK_SECRET=xxx

# Deploy Edge Functions
supabase functions deploy retell-webhook
supabase functions deploy retell-create-agent
supabase functions deploy knowledge-ingest
supabase functions deploy knowledge-search
supabase functions deploy call-analyze
supabase functions deploy calendar-availability
supabase functions deploy calendar-book
supabase functions deploy stripe-webhook
supabase functions deploy n8n-dispatch
supabase functions deploy voice-preview
supabase functions deploy retell-knowledge-sync
supabase functions deploy sync-n8n-workflows
```

### Enable Google Auth in Supabase Dashboard

1. Authentication → Providers → Google → Enable
2. Add OAuth credentials from Google Cloud Console
3. Set redirect URL: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`

### Enable controlled-beta auth enforcement

In Authentication > Hooks, select the Postgres `before-user-created` hook `public.hook_restrict_beta_signup`. Confirm email verification, leaked-password protection, and MFA for operators are enabled. Create invitations only with `npm run create:beta-invite -- --email=owner@example.com`.

### Storage Bucket

The migration creates a `knowledge` bucket automatically. Verify in Storage settings.

## 2. Retell AI Setup

### Native knowledge synchronization

Sigyn uses one native Retell knowledge base per business. Supabase retains the original files and URLs; the `retell-knowledge-sync` Edge Function publishes them to Retell and attaches the shared KB to every business agent.

1. Apply `supabase/migrations/20260808210000_retell_knowledge_sync.sql`.
2. Deploy the authenticated function: `supabase functions deploy retell-knowledge-sync`.
3. Confirm `RETELL_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are configured as Edge Function secrets.
4. Preview existing-source migration with `npm run sync:retell-knowledge`.
5. Apply it with `npm run sync:retell-knowledge -- --apply` after reviewing the dry-run counts. Limit a run with `--business=<uuid>`.

The command never changes provider state without `--apply`. Failed sources remain in Supabase and are retryable from the Knowledge dashboard.

Rollback keeps the additive database records and Retell sources intact. Restore the prior LLM tool configuration only if native retrieval must be disabled; do not delete business KBs during an incident.

1. Create account at [retellai.com](https://retellai.com)
2. Copy API key to Supabase secrets
3. Register webhook URL:
   ```
   https://YOUR_PROJECT.supabase.co/functions/v1/retell-webhook
   ```
4. Phone numbers are provisioned via `retell-create-agent` Edge Function during onboarding

## 3. Vercel Deployment

```bash
# From repo root
npm install
npm run build

# Deploy via Vercel CLI or GitHub integration
vercel --prod
```

Set all environment variables from [ENVIRONMENT.md](./ENVIRONMENT.md) in Vercel project settings.

Root directory: `apps/web`

Configure `CRON_SECRET`; Vercel invokes `/api/cron/retention` daily. Configure Sentry release upload with `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN`.

## 4. Stripe Setup

1. Create products in Stripe Dashboard:
   - **Starter** — $99/mo recurring, 200 min included
   - **Pro** — $249/mo recurring, 600 min included
   - **Setup Fee** — $199 one-time
2. Copy price IDs to env vars
3. Create webhook endpoint:
   ```
   https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook
   ```
4. Enable events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`

## 5. n8n Setup

1. Create n8n Cloud account or self-host with Docker
2. Import workflows from `n8n/workflows/`:
   - `retell-call-completed.json`
   - `sms-follow-up.json`
   - `hubspot-sync.json`
   - `ghl-sync.json`
   - `sheets-log.json`
3. Configure credentials (Twilio, HubSpot, GoHighLevel, Google Sheets)
4. Activate workflows and copy webhook URLs to `N8N_WEBHOOK_BASE_URL`

## 6. PostHog Setup

1. Create project at [posthog.com](https://posthog.com)
2. Copy project API key to `NEXT_PUBLIC_POSTHOG_KEY`
3. Key events tracked: `signup`, `onboarding_step_completed`, `agent_hired`, `first_call_received`, `appointment_booked`

## 7. Smoke Test Checklist

- [ ] Sign up with email or Google
- [ ] Complete 5-step onboarding wizard
- [ ] Upload a knowledge document (TXT/PDF)
- [ ] Hire an AI agent (Retell agent created)
- [ ] Make a test inbound call
- [ ] Verify transcript appears in dashboard
- [ ] Verify SMS follow-up on missed call
- [ ] Verify CRM sync via n8n
- [ ] Subscribe via Stripe checkout
- [ ] Access admin panel (set `profiles.role = 'admin'` in Supabase)

After recording provider evidence identifiers, run the strict immutable-release gate:

```bash
npm run verify:production -- --supabase --webhooks --live-integrations \
  --base-url="$PRODUCTION_APP_URL" --release="$RELEASE_SHA" \
  --evidence="$PRODUCTION_SMOKE_EVIDENCE_PATH"
```

The command must finish with zero failures, warnings, and skipped checks. Follow `docs/PRODUCTION_OPERATIONS.md` for alerts, rollback, restore testing, rotation, and the 24-hour soak.

## Local Development

```bash
# Install dependencies
npm install

# Start Supabase locally (optional)
supabase start

# Start Next.js dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)
