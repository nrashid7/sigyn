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
```

### Enable Google Auth in Supabase Dashboard

1. Authentication → Providers → Google → Enable
2. Add OAuth credentials from Google Cloud Console
3. Set redirect URL: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`

### Storage Bucket

The migration creates a `knowledge` bucket automatically. Verify in Storage settings.

## 2. Retell AI Setup

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

## 4. Stripe Setup

1. Create products in Stripe Dashboard:
   - **Starter** — $99/mo recurring, 200 min included
   - **Pro** — $249/mo recurring, 600 min included
   - **Setup Fee** — $199 one-time
2. Copy price IDs to env vars: `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_SETUP` (one-time price)
3. Create webhook endpoint:
   ```
   https://YOUR_PROJECT.supabase.co/functions/v1/stripe-webhook
   ```
   Pin the endpoint's API version to `2025-08-27.basil`.
4. Enable events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`

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
