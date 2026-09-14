# BusinessVoice AI — End-to-End Smoke Test

Run after deploying all services with valid API keys.

## Prerequisites

- Supabase project with migrations applied and seed data
- Edge Functions deployed
- ElevenLabs API key and webhook/tool secrets configured (see `docs/ENVIRONMENT.md`)
- `.env.local` filled in `apps/web`

## Test Flow

### 1. Authentication

1. Open http://localhost:3000/signup
2. Create account with email/password OR Google OAuth
3. Verify redirect to `/onboarding/business`

### 2. Onboarding (target: under 15 minutes)

| Step | Route | Action | Expected |
|------|-------|--------|----------|
| 1 | `/onboarding/business` | Enter business details | Business created, step advances |
| 2 | `/onboarding/knowledge` | Upload TXT or PDF | Document status → processing → ready |
| 3 | `/onboarding/calendar` | Connect Google Calendar (optional) | Integration saved or skip |
| 4 | `/onboarding/call-preferences` | Set transfer rules | Preferences saved |
| 5 | `/onboarding/voice` | Select agent + voice, click Hire | ElevenLabs agent created + phone number assigned, redirect to dashboard |

### 3. Live Call Test

1. Note the phone number assigned to your agent (from dashboard/agents)
2. Call the number from a mobile phone
3. Ask a question covered by uploaded knowledge
4. Request an appointment (if calendar connected)

### 4. Dashboard Verification

| Page | Check |
|------|-------|
| `/dashboard` | KPI cards show call count |
| `/dashboard/calls` | Call appears in list |
| `/dashboard/calls/[id]` | Transcript, summary, sentiment visible |
| `/dashboard/agents` | Hired agent listed with phone number |
| `/dashboard/knowledge` | Document shows status "ready" |

### 5. Automation Verification

- **Missed call:** Don't answer a call → SMS follow-up within 2 min (n8n + Twilio)
- **CRM sync:** Complete a call → contact created in HubSpot/GHL/Sheets (n8n)
- **Appointment:** Book via call → appointment in dashboard + calendar

### 6. Billing

1. Visit `/dashboard/billing`
2. Click Subscribe → Stripe Checkout
3. Complete test payment
4. Verify subscription status in dashboard

### 7. Admin

1. Set `profiles.role = 'admin'` in Supabase for test user
2. Visit `/admin` — businesses list, templates, call monitor

## API Endpoint Checks

```bash
# Automated checks against the deployed ElevenLabs-facing functions
# (signed webhook delivery, tool auth matrix, calls-reconcile, optional --provision)
npm run smoke

# Voice preview
curl -X POST "$SUPABASE_URL/functions/v1/voice-preview" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"voice_id":"21m00Tcm4TlvDq8ikWAM","text":"Hello from BusinessVoice AI"}'
```

## Success Criteria

- [ ] Signup to live phone number in under 15 minutes
- [ ] Inbound call answered with business context
- [ ] ElevenLabs knowledge base answers a question from the uploaded FAQ
- [ ] Appointment booked via calendar tool
- [ ] Transcript + AI summary in dashboard
- [ ] SMS on missed call
- [ ] CRM contact via n8n
- [ ] Stripe subscription gates usage
- [ ] New vertical = new agent_templates row only
