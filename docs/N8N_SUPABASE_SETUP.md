# n8n + Supabase Integration Guide

BusinessVoice AI uses a **hybrid automation model**:

```
Retell webhook → Supabase Edge Function → n8n Call Completed Router → CRM / SMS / Sheets
```

Supabase handles realtime call logic. n8n handles long-running CRM chains.

---

## 1. Supabase Setup (Connected via MCP)

**Live project:** `businessvoice-ai`  
**Project ref:** `wtrqpnzacuaroxluxwfa`  
**URL:** `https://wtrqpnzacuaroxluxwfa.supabase.co`  
**Dashboard:** https://supabase.com/dashboard/project/wtrqpnzacuaroxluxwfa

Status (as of setup):

1. **Migrations applied** — full schema (16 tables, RLS, storage bucket)
2. **Seed data** — 5 agent templates + 5 n8n workflow rows in `workflows`
3. **Edge Functions deployed** — especially:
   - `retell-webhook`
   - `n8n-dispatch`
   - `sync-n8n-workflows`

### Required Supabase Secrets

```bash
supabase secrets set \
  N8N_WEBHOOK_BASE_URL=https://n8n-production-08c9.up.railway.app/webhook \
  N8N_WEBHOOK_SECRET=your-shared-secret \
  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Optional per-workflow overrides:

```bash
supabase secrets set \
  N8N_WEBHOOK_CALL_COMPLETED=https://n8n-production-08c9.up.railway.app/webhook/call-completed \
  N8N_WEBHOOK_SMS=https://n8n-production-08c9.up.railway.app/webhook/sms-follow-up \
  N8N_WEBHOOK_HUBSPOT=https://n8n-production-08c9.up.railway.app/webhook/hubspot-sync \
  N8N_WEBHOOK_GHL=https://n8n-production-08c9.up.railway.app/webhook/ghl-sync \
  N8N_WEBHOOK_SHEETS=https://n8n-production-08c9.up.railway.app/webhook/sheets-log
```

---

## 2. n8n Setup (Railway)

**Instance:** https://n8n-production-08c9.up.railway.app

### Deploy workflows (CLI)

1. In n8n: **Settings → n8n API → Create API key**
2. Run from repo root:

```bash
export N8N_API_KEY=your-key
npm run deploy:n8n
```

This imports all JSON from `n8n/workflows/`, updates existing workflows by name, and **activates** them.

### Workflows to verify

Import or verify these 5 workflows exist and are **Active**:

| Workflow | Webhook Path | Purpose |
|----------|--------------|---------|
| BusinessVoice - Call Completed Router | `call-completed` | Entry point from Supabase |
| BusinessVoice - SMS Follow-Up | `sms-follow-up` | Missed call / confirmation SMS |
| BusinessVoice - HubSpot Sync | `hubspot-sync` | Create contacts + notes |
| BusinessVoice - GoHighLevel Sync | `ghl-sync` | GHL pipeline sync |
| BusinessVoice - Google Sheets Log | `sheets-log` | Append call rows |

Workflow JSON exports live in [`n8n/workflows/`](../n8n/workflows/).

---

## 3. Sync Workflows to Supabase

After setting secrets, sync webhook URLs into the `workflows` table:

### Option A — Admin UI

1. Set your user as admin: `UPDATE profiles SET role = 'admin' WHERE email = 'you@...'`
2. Visit `/admin`
3. Click **Sync Workflows** in the n8n Automation panel

### Option B — Edge Function

```bash
curl -X POST "$SUPABASE_URL/functions/v1/sync-n8n-workflows" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

### Option C — Automatic env fallback

If the `workflows` table is empty, `n8n-dispatch` falls back to:

```
$N8N_WEBHOOK_BASE_URL/call-completed
```

Only the **router** workflow receives Supabase events. The router branches to SMS/CRM workflows internally.

---

## 4. Test the Pipeline

### Ping n8n dispatch

```bash
curl -X POST "$SUPABASE_URL/functions/v1/n8n-dispatch" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "test.ping",
    "business_id": "YOUR-BUSINESS-UUID",
    "metadata": {"source": "manual_test"}
  }'
```

### Verify in n8n

Check **Executions** in n8n for the Call Completed Router workflow.

### End-to-end

1. Complete a test call via Retell
2. `retell-webhook` fires → `n8n-dispatch`
3. n8n router branches to SMS/CRM based on business integrations

---

## 5. Architecture Notes

- **Do not** point Supabase at all 5 webhooks directly — only the router receives dispatch events
- SMS from missed calls also fires **directly from Supabase** via Twilio (fast path); n8n handles sequences
- Store CRM API keys in `integrations` table per business; n8n reads them via Supabase or passed payload

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `no_active_workflows` | Run Sync Workflows or set `N8N_WEBHOOK_BASE_URL` |
| Webhooks return **404** | Open each workflow in n8n → Webhook node → **Activate** workflow → copy **Production** URL path |
| n8n execution never starts | Verify workflow is Active; check webhook URL matches |
| Duplicate CRM entries | Ensure only router has `dispatch_target: true` in config |

### Railway instance

- **URL:** `https://n8n-production-08c9.up.railway.app`
- **Health:** `GET /healthz` should return 200
- **Expected webhook paths** (must match n8n Webhook node settings):

```
/webhook/call-completed
/webhook/sms-follow-up
/webhook/hubspot-sync
/webhook/ghl-sync
/webhook/sheets-log
```

If your n8n workflows use different paths, update:
- `packages/shared/src/config/n8n.ts`
- Supabase `workflows` table via `/admin` → Sync Workflows
