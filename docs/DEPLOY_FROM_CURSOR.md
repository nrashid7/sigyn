# Deploying the ElevenLabs backend from Cursor

Prefer `docs/DEPLOY_WITH_GITHUB_ACTIONS.md` unless you can run the CLI on a machine you trust with secrets; this file is the local-CLI alternative.

**⚠️ Do not run `supabase link --project-ref wtrqpnzacuaroxluxwfa` or any `db_push` / `seed` / `deploy_functions` stage against the live project — it is under a concurrent ElevenLabs migration by another developer and collisions would halt both efforts.** For testing, create a fresh Supabase project and point all steps at it instead.

Everything below runs from a terminal in Cursor opened at the repo root (`~/Desktop/sigyn`, branch `feat/elevenlabs-backend`). Use personal accounts only. No Docker, no AWS. Each step lists the command and what you should observe before moving on.

## 0. One-time tooling and logins

```bash
brew install supabase/tap/supabase deno stripe/stripe-cli/stripe
supabase login
supabase link --project-ref wtrqpnzacuaroxluxwfa
supabase functions list
npm install
npm test
```

Observe: `supabase functions list` prints the currently deployed functions; `npm test` runs the Node tests (`scripts/**/*.test.mjs`) and the Deno tests (`supabase/functions/tests`) and both are green.

Push the branch with Cursor's Source Control panel ("Publish Branch"). If GitHub refuses (no write access to `nrashid7/sigyn`), fork the repo to your own account, add the fork as a remote, and push there instead — nothing else in this guide changes.

## 1. Vault secrets for the cron job (SQL editor, run once)

In the Supabase dashboard → SQL Editor:

```sql
select vault.create_secret('https://wtrqpnzacuaroxluxwfa.supabase.co', 'project_url');
select vault.create_secret('<legacy service_role JWT from Settings → API>', 'service_role_key');
select name from vault.decrypted_secrets;
```

Observe: both names listed. (The service-role value must be the legacy JWT — the new `sb_secret_…` keys do not pass `verify_jwt`.)

## 2. Schema

```bash
npm run db:push
```

Observe: migrations `20260913000001`, `…000002`, `…000003`, `…000004`, `…000010`, `…000011`, `…000020` applied. If `CREATE EXTENSION pg_cron` fails: Dashboard → Integrations → Cron → Enable, then run `npm run db:push` again.

Verify in the SQL editor:

```sql
select column_name from information_schema.columns where table_name = 'agents' and column_name in ('elevenlabs_agent_id','provision_status');
select jobname from cron.job;                    -- calls-reconcile-10m
select status, plan from subscriptions limit 5;  -- trialing rows exist for every business
```

## 3. Seed the agent templates

```bash
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

(`SUPABASE_DB_URL` = Dashboard → Settings → Database → connection string. Alternatively paste the file into the SQL editor.)

Observe: `select slug, config->'elevenlabs'->>'llm' from agent_templates;` → 6 rows, all `gpt-4o-mini`.

## 4. Edge-function secrets

Create `supabase/.env.local` (gitignored) from the "Supabase edge-function secrets" section of `.env.example`. Fill everything except the three `ELEVENLABS_TOOL_*`/`ELEVENLABS_WEBHOOK_SECRET` values (step 5 produces them). Step 5 fills those three in this same file — from then on they must never be left empty, because `npm run secrets:set` uploads the whole file and an empty value overwrites a good secret with an empty one. Then:

```bash
npm run secrets:set
supabase secrets list
```

## 5. ElevenLabs workspace setup (tools + post-call webhook)

```bash
export ELEVENLABS_API_KEY=<your key>
export SUPABASE_URL=https://wtrqpnzacuaroxluxwfa.supabase.co
npm run setup:elevenlabs
```

Observe: a summary table with three tools and the webhook, followed by a `supabase secrets set ELEVENLABS_TOOL_IDS='…' ELEVENLABS_TOOL_SECRET=… ELEVENLABS_WEBHOOK_SECRET=…` line.

**Do not run that printed line.** Paste its three values into `supabase/.env.local` instead — quote the JSON:

```bash
ELEVENLABS_TOOL_IDS='{"check_availability":"…","book_appointment":"…","qualify_lead":"…"}'
ELEVENLABS_TOOL_SECRET=…
ELEVENLABS_WEBHOOK_SECRET=…
```

then upload them from that file:

```bash
npm run secrets:set
```

`supabase/.env.local` is the single source of truth for edge-function secrets: `npm run secrets:set` uploads every name in it, so anything only ever set by the one-off printed command is wiped the next time the file is uploaded (step 10). Keeping the values in the file makes every later `npm run secrets:set` idempotent.

In the ElevenLabs dashboard confirm the three tools exist and the `sigyn-post-call` webhook has retries enabled with the `transcript` and `call_initiation_failure` events.

If the script exits 1 with a raw JSON dump, the ElevenLabs API returned a shape the script did not expect — read the JSON, fix the script, re-run (it is idempotent).

## 6. Deploy the functions

```bash
npm run deploy:functions
supabase functions list
```

Observe: `agent-provision`, `agent-sync`, `elevenlabs-webhook`, `calls-reconcile`, `calendar-availability`, `calendar-book`, `qualify-lead`, `knowledge-ingest`, `knowledge-delete`, `n8n-dispatch`, `sync-n8n-workflows`, `stripe-webhook`, `voice-preview`. JWT verification matches `supabase/config.toml` (public: the webhook, stripe-webhook and the three tools).

Remove the Retell-era functions and secrets from the project (they no longer exist locally):

```bash
supabase functions delete retell-webhook
supabase functions delete retell-create-agent
supabase functions delete knowledge-search
supabase functions delete call-analyze
supabase secrets unset RETELL_API_KEY RETELL_WEBHOOK_SECRET OPENAI_API_KEY OPENROUTER_API_KEY VOYAGE_API_KEY EMBEDDING_PROVIDER APP_URL
```

Quick gateway checks:

```bash
curl -i https://wtrqpnzacuaroxluxwfa.supabase.co/functions/v1/stripe-webhook      # 405 (handler reached)
curl -i https://wtrqpnzacuaroxluxwfa.supabase.co/functions/v1/n8n-dispatch        # 401 (JWT required)
curl -i -X POST https://wtrqpnzacuaroxluxwfa.supabase.co/functions/v1/elevenlabs-webhook -d '{}'   # 401 invalid signature
```

## 7. Smoke test the deployed functions

```bash
export SUPABASE_URL=https://wtrqpnzacuaroxluxwfa.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<legacy service_role JWT>
export ELEVENLABS_WEBHOOK_SECRET=<from step 5>
export ELEVENLABS_TOOL_SECRET=<from step 5>
npm run smoke
```

Observe: PASS for the signed webhook (skipped-agent path), the tampered-signature 401, the tool 401/404 matrix, and `calls-reconcile` 200. Re-run later with `AGENT_ID=<agents.elevenlabs_agent_id>` after the first hire to exercise the full write path.

With `AGENT_ID` set the smoke test stops skipping the write paths and leaves **real rows** in the database: a `calls` row for the fixture conversation (`conv_test`, or `conv_missed_test` with `--fixture missed-call`) plus its transcript, and a qualified-lead `calls` stub for `conv_smoke_test`. Clean them up afterwards (transcripts cascade):

```sql
delete from calls where elevenlabs_conversation_id in ('conv_test','conv_smoke_test','conv_missed_test');
```

## 8. Vercel

Import the repo (Root Directory `apps/web`). Set the "Vercel" variables from `.env.example` — `SUPABASE_SERVICE_ROLE_KEY` must be the legacy JWT. Deploy. Then set `NEXT_PUBLIC_APP_URL` to the Vercel domain and, in Supabase → Authentication → URL Configuration, the Site URL and `https://<domain>/auth/callback` redirect.

Observe: the build log installs from the repo-root lockfile and resolves `@businessvoice/shared`.

## 9. Twilio

Trial accounts can only call/text up to five verified numbers, hold one number, and send Twilio-templated SMS only. Verify your mobile as a caller ID before the first test call. Upgrade (add a payment method) before demos to external numbers; start A2P 10DLC registration for US SMS (days–weeks). `agent-provision` reuses the trial's single number automatically.

## 10. Stripe (test mode)

Products: Starter $99/mo, Pro $249/mo, Setup Fee $199 one-time → price ids into Vercel (`STRIPE_PRICE_STARTER|PRO|SETUP`) and `supabase/.env.local` (`STRIPE_PRICE_STARTER|PRO`). Webhook endpoint `https://wtrqpnzacuaroxluxwfa.supabase.co/functions/v1/stripe-webhook` with events `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, API version pinned to `2025-08-27.basil` → signing secret into `STRIPE_WEBHOOK_SECRET` → `npm run secrets:set`.

## 11. End to end

1. Sign up → create the business → `subscriptions` shows a `trialing` row immediately.
2. Upload a PDF → `knowledge_documents.status` becomes `ready` and `elevenlabs_document_id` is set; the document appears on the agent in ElevenLabs.
3. Call preferences → voice → **Hire** → `/dashboard/agents` shows the phone number. If it shows "Setup failed", hover for the reason (usually Twilio), fix it, click Hire again — provisioning resumes from the failed step.
4. Call the number from your verified phone, ask a knowledge question, request an appointment. Within about a minute `/dashboard/calls` lists the call with transcript, summary, and the recording plays.
5. `select * from usage_records order by recorded_at desc limit 1;` → one row per call.
6. Reconcile safety net: `select status, return_message from cron.job_run_details order by start_time desc limit 3;` → succeeded.

## Troubleshooting

| Symptom | Check |
|---|---|
| Hire returns "Phone number setup failed" | Twilio trial limits or wrong `TWILIO_*` secrets; fix and click Hire again |
| Hire returns `TEMPLATE_ERROR` | a `{{placeholder}}` in the template/prefs that `mergeTemplateVariables` does not know — the only supported ones are `{{business_name}}`, `{{business_website}}`, `{{business_phone}}`, `{{business_timezone}}`, `{{business_hours}}`, `{{business_industry}}` |
| ElevenLabs rejects the agent payload (`ELEVENLABS_ERROR` in `provision_error`) | create one agent in the ElevenLabs dashboard with one data-collection item, `GET /v1/convai/agents/{id}`, compare the `platform_settings`/`built_in_tools` shape with `_shared/elevenlabs.ts` `buildAgentConfig` |
| Calls never appear | webhook secret mismatch (`elevenlabs-webhook` logs 401) → re-run step 5 output; or run `curl -X POST …/calls-reconcile -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -d '{"since_hours":1}'` |
| Tools fail mid-call | `ELEVENLABS_TOOL_SECRET` differs between the workspace secret and Supabase; re-run step 5 with the same value |
| `db push` fails on `pg_cron` | enable the Cron integration in the dashboard, re-run |
