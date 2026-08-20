# BusinessVoice AI — End-to-End Smoke Test

Run after deploying all services with valid API keys.

## Prerequisites

- Supabase project with migrations applied and seed data
- Edge Functions deployed
- Retell API key configured
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
| 5 | `/onboarding/voice` | Select agent + voice, click Hire | Retell agent created, redirect to dashboard |

## Retell Knowledge

1. Upload a small Markdown or PDF source containing one distinctive fact.
2. Confirm the dashboard moves from **Publishing** to **Available to calls**.
3. Call the business agent and ask for the distinctive fact; verify the answer is grounded in the uploaded source.
4. Ask for an absent price or policy; verify the agent says it does not know and offers human follow-up.
5. Add a public HTTPS website and confirm it reaches **Available to calls** without approving extracted facts.
6. Delete the test source and confirm the row remains **Removing** until Retell confirms deletion.
7. Temporarily use an invalid Retell credential in a non-production environment, verify **Publish failed** is visible, restore the credential, and verify Retry succeeds.

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

- **Launch gate:** Run `npm run verify:beta-launch -- --webhooks --supabase` → all n8n and Supabase checks pass
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
# Knowledge search (replace IDs)
curl -X POST "$SUPABASE_URL/functions/v1/knowledge-search" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"business_id":"UUID","query":"business hours"}'

# Voice preview
curl -X POST "$SUPABASE_URL/functions/v1/voice-preview" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"voice_id":"21m00Tcm4TlvDq8ikWAM","text":"Hello from BusinessVoice AI"}'
```

## Success Criteria

- [ ] Signup to live phone number in under 15 minutes
- [ ] Inbound call answered with business context
- [ ] RAG retrieves uploaded FAQ during call
- [ ] Appointment booked via calendar tool
- [ ] Transcript + AI summary in dashboard
- [ ] SMS on missed call
- [ ] CRM contact via n8n
- [ ] Stripe subscription gates usage
- [ ] New vertical = new agent_templates row only
