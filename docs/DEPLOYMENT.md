# BusinessVoice AI — Deployment Guide

## Architecture

| Component | Platform |
|-----------|----------|
| Frontend | Vercel |
| Database, Auth, Storage, Edge Functions | Supabase |
| Voice | ElevenLabs |
| SMS | Twilio |
| Automation | n8n (Railway) |
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
supabase secrets set ELEVENLABS_API_KEY=xxx ELEVENLABS_WEBHOOK_SECRET=xxx ELEVENLABS_TOOL_SECRET=xxx ELEVENLABS_TOOL_IDS=xxx
supabase secrets set STRIPE_SECRET_KEY=xxx STRIPE_WEBHOOK_SECRET=xxx
supabase secrets set TWILIO_ACCOUNT_SID=xxx TWILIO_AUTH_TOKEN=xxx TWILIO_PHONE_NUMBER=+1xxx
supabase secrets set N8N_WEBHOOK_BASE_URL=xxx N8N_WEBHOOK_SECRET=xxx

# Deploy all 13 Edge Functions
npm run deploy:functions
```

### Enable Google Auth in Supabase Dashboard

1. Authentication → Providers → Google → Enable
2. Add OAuth credentials from Google Cloud Console
3. Set redirect URL: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`

### Storage Bucket

The migration creates a `knowledge` bucket automatically. Verify in Storage settings.

## 2. ElevenLabs Setup

1. Create a Twilio account and verify (or port in) the phone numbers agents will be hired with.
2. Run `npm run setup:elevenlabs` — it creates the ElevenLabs mid-call tools and the
   workspace post-call webhook, and prints `ELEVENLABS_WEBHOOK_SECRET`,
   `ELEVENLABS_TOOL_SECRET`, and `ELEVENLABS_TOOL_IDS` to add to Supabase secrets.
3. Phone numbers are imported from Twilio and assigned to the agent by the
   `agent-provision` Edge Function during onboarding (the Hire flow) — no manual
   per-business step needed.

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

1. Create n8n on Railway (or self-host)
2. Import workflows from `n8n/workflows/`:
   - `call-completed.json`
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
- [ ] Hire an AI agent (ElevenLabs agent created + phone number assigned)
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
