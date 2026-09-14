# Sigyn backend — gap analysis + build plan (ElevenLabs voice layer)

**Status:** APPROVED — executing **P1 → P3 in this Claude Code session** (revised 2026-09-13, see "Revised execution" below); P4–P7 later (Cursor or a follow-up session)
**Date:** 2026-09-13
**Execution:** Claude writes code, tests, commits and deploys from `~/Desktop/sigyn` (branch `feat/elevenlabs-backend`). The user performs every login and supplies every secret personally (personal accounts only — never Ripple email / Ripple AWS; Claude never enters credentials). Git author for this repo is the user's university email (`tpaul73867@ucumberlands.edu`) — not Ripple. Commit subjects: one plain line, no AI attribution.

## Revised execution (session of 2026-09-13)

**Scope this session:** P1 (foundation: config.toml, migrations 0001–0003, `_shared/auth.ts`, npm scripts, env docs, Windows cleanup, lockfile), P2 (ElevenLabs voice swap: migrations 0010–0011, seed, shared modules, 9 functions, setup + smoke scripts, Deno tests, frontend/shared edits, Retell cleanup), P3 (Stripe: `_shared/stripe.ts`, `stripe-webhook`, web billing routes/pages). **Deferred:** P4 calendar hardening (existing `_shared/calendar.ts` keeps working for the tools), P5 n8n, P6 CI (tests still written; `ci.yml` later), P7 lead engine.

**Execution mode (revised again 2026-09-13, user request): code-first.** Claude writes every file (migrations, functions, scripts, tests, frontend edits, docs) and commits locally in `~/Desktop/sigyn`. The user authenticates and deploys from **Cursor** (GitHub push via Cursor's sign-in; `supabase login/link`, `db push`, `secrets set`, `functions deploy`, setup + smoke scripts) following `docs/DEPLOY_FROM_CURSOR.md`, which Claude writes as the final task. `gh` CLI is not required. If Cursor's push to `nrashid7/sigyn` is refused (no collaborator access) → fork to `aspiringlearnerDE` and push there; nothing else changes. Accounts confirmed: Twilio, Stripe, Supabase, ElevenLabs.

**User actions (Cursor terminal, later, in order — details in `docs/DEPLOY_FROM_CURSOR.md`):**
1. `brew install supabase/tap/supabase deno && supabase login && supabase link --project-ref wtrqpnzacuaroxluxwfa`.
2. Before P2 deploy: create `~/Desktop/sigyn/supabase/.env.local` (gitignored) with `ELEVENLABS_API_KEY`, `TWILIO_*` (when the account exists), `STRIPE_*`, `N8N_*`, `POSTHOG_*`; export `ELEVENLABS_API_KEY` for `scripts/elevenlabs-setup.mjs`; run the Vault SQL (4.1) in the SQL editor.
3. Before P3 verification: Stripe test-mode products + webhook endpoint (`api_version=2025-08-27.basil`) → price ids + `whsec_` into `.env.local`; `stripe login` for `stripe trigger`.
4. Twilio account when ready — until then `agent-provision` stops at step 3 with `PHONE_PROVISION_FAILED` (resumable by re-running Hire), which is the designed behaviour.

**Claude's cadence:** one commit per task group, push after each phase; deploy migrations (`supabase db push`) and functions (`supabase functions deploy <name> --use-api`) as soon as each is written and unit-tested; verify with the curl checks listed per task; never run `--prune`; delete Retell functions remotely only after `elevenlabs-webhook` is live and smoke-tested.

**Gates:** end of P1 → security curl matrix passes; end of P2 → `npm run smoke` green + one real inbound call if a Twilio number exists (else forged-webhook path only); end of P3 → Stripe test checkout updates `subscriptions` via webhook 200s.
**Repos:** product = `nrashid7/sigyn` (frontend + backend monorepo; branch `feat/elevenlabs-backend`); lead engine = `aspiringlearnerDE/AIreceptionist` (= local `~/Desktop/AI_agent`, Phase 7 only).

---

## Context

The user is building the backend for an AI-receptionist SaaS whose frontend is `sigyn/apps/web` (Next.js 16 on Vercel). Constraints: no Docker, no AWS, hosted services only, Mac + CLI. Voice provider decision: **ElevenLabs (ElevenAgents) replaces Retell AI**.

Reality from the scan: `sigyn` already ships a *Retell-shaped* backend — Supabase schema (16 tables, RLS, `knowledge` bucket), 12 Deno edge functions, 5 n8n workflows — and it is **already deployed** to Supabase project `wtrqpnzacuaroxluxwfa` and n8n on Railway (`n8n-production-08c9.up.railway.app`). So the job is:

1. **Swap the voice layer** Retell → ElevenLabs (agent create/update, Twilio numbers, post-call webhook, mid-call tools, native knowledge base, built-in call analysis).
2. **Fix the 13 audited defects** (B1–B13) — several are security holes on the live project.
3. **Make billing, calendar, SMS and n8n CRM actually work end to end** (all four selected for the first slice, delivered as ordered phases).
4. **Connect the lead engine** (DataForSEO scraping → outbound ElevenLabs calls) as the final phase.
5. **Everything verifiable from a Mac** with `supabase` CLI + `curl` + dashboards.

---

## Facts established (read-only scan, 2026-09-13)

### Live infra probe
| Check | Result |
|---|---|
| `https://wtrqpnzacuaroxluxwfa.supabase.co/rest/v1/` | 401 → project alive |
| 12 edge functions (`GET /functions/v1/<name>`) | all deployed: 401 (JWT-gated) or 405 (handler ran) — zero 404 |
| `verify_jwt` live state (inferred) | OFF: retell-webhook, calendar-availability, calendar-book, qualify-lead, stripe-webhook · ON: everything else incl. knowledge-search |
| n8n Railway `/healthz` | 200; all 5 webhook paths registered (POST) |

### Local toolchain (this Mac)
| Tool | State |
|---|---|
| node 26.7 / npm 11.19 / git 2.50 / python3 3.14 | present |
| gh 2.89 | present, **not authenticated** |
| `supabase` CLI, `deno`, `vercel`, `stripe` | **missing** → `brew install supabase/tap/supabase deno stripe/stripe-cli/stripe` |
| docker | missing — by design |

Docker-free deploy confirmed (Supabase CLI docs): `supabase functions deploy [name] --use-api [--no-verify-jwt] [--prune]` bundles server-side; `supabase db push`, `secrets set` never touch Docker. Only `supabase start` / `functions serve` need Docker — skipped; test against the hosted project.

### Frontend → backend contract (apps/web)
- Auth: Supabase Auth (email+password, Google via Supabase). Route gate `apps/web/lib/supabase/proxy.ts`; admin = `profiles.role='admin'`.
- Tables the UI reads that **only the backend populates**: `calls`, `call_transcripts`, `subscriptions`, `knowledge_documents.status`, `agents.phone_number`.
- Edge functions the UI calls (service-role bearer): `voice-preview`, `knowledge-ingest`, `retell-create-agent` (`lib/actions/onboarding.ts:96`, body `{business_id, template_slug, name, voice_id, voice_provider, include_calendar}`), `sync-n8n-workflows`, `n8n-dispatch`.
- `calls` fields read: `caller_number, started_at, created_at, duration_seconds (NOT NULL), status (NOT NULL enum), outcome, sentiment, lead_score, recording_url`. `call_transcripts.transcript` = `[{role, content, timestamp?}]`, role `agent|assistant` = AI; `.single()` per call. `agents.name ∈ Dexter|Zia|Sunny|Sparky|Bella`.
- Never reads `retell_*` columns by name (all `select("*")`) → renames are safe.
- Dead/fake UI: marketing demo-call (`setTimeout`), `hireAgent`/`toggleAgent` unused, disconnect-integration unused, "Upgrade Plan" has no `?plan=`, hardcoded KPI deltas.
- Frontend bugs: `api/integrations/connect` upsert lacks `onConflict`; `billing.ts` default 500 (DB 200) + divide-by-zero; checkout may send empty `business_id`.

### Supabase backend audit — defects
| # | Defect | Where |
|---|---|---|
| B1 | `verify_jwt` policy absent from repo (`config.toml` has no `[functions]` block); live state set by hand | `supabase/config.toml` |
| B2 | **Security:** tool endpoints publicly callable, run as service role, trust caller-supplied `business_id`, no signature → cross-tenant read/write on live project | `calendar-*`, `qualify-lead` |
| B3 | Stripe price env names mismatch (`STRIPE_*_PRICE_ID` in code vs `STRIPE_PRICE_*` in docs) → every subscription recorded as `starter` | `_shared/stripe.ts:63-65` |
| B4 | n8n router dead: `"call.completed"` vs sent `"call_completed"`, `body.outcome` vs `metadata.outcome`, stringified payload, stale `$json` scope, `sheet_id` never passed, `$env` use, placeholder credential ids | `n8n/workflows/*.json`, `retell-webhook:212` |
| B5 | Phone provisioning failure swallowed (`console.warn`) → agent saved with `phone_number=null`, UI says success | `retell-create-agent:142-148` |
| B6 | Second hire path `apps/web/lib/actions/agents.ts:hireAgent` creates a dead agent (no provider) | frontend |
| B7 | PDF extraction = regex over raw bytes → most PDFs fail | `knowledge-ingest:41-63` |
| B8 | Storage policies not tenant-scoped; `integrations.access_token/refresh_token` readable by any business member | migration `:365+`, `:358` |
| B9 | No agent update/delete path → hours/prefs/knowledge changes never reach the voice agent | `_shared/retell.ts` dead code |
| B10 | Billing: no `used_minutes` reset, `invoice.payment_succeeded` no-op, `current_period_end` removed from Subscription in Stripe API ≥2025-03-31, no trial row at signup (`getSubscription()` null until payment) | `stripe-webhook`, `_shared/stripe.ts:96` |
| B11 | Calendar default slots ignore `businesses.hours/timezone`; no Google token refresh; no double-booking check; Calendly "booking" returns a link | `_shared/calendar.ts` |
| B12 | seed `workflows` `ON CONFLICT DO NOTHING` without unique constraint → duplicate rows | `supabase/seed.sql` |
| B13 | Only test = source-grep script; no `test` npm script; no CI | `scripts/` |
| — | Templates triplicated: `packages/shared` (rich rules) vs `seed.sql` (one-sentence prompt, empty rule arrays — this is what agents are provisioned from) | `seed.sql`, `packages/shared/src/templates/index.ts` |
| — | Six overlapping `workflows` sync mechanisms; admin Sync button hits an RLS-blocked route (`synced: 0`) | `apps/web/app/api/admin/sync-n8n/route.ts` |
| — | Env drift: code-only `APP_URL`, `POSTHOG_HOST`, `STRIPE_*_PRICE_ID`; dead `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `CALENDLY_CLIENT_*`; `turbo.json` `globalEnv` lists 5 vars; nested `apps/web/package-lock.json` (stale, non-workspace) | root |

### ElevenLabs "ElevenAgents" API (verified against live docs 2026-09-13)
Base `https://api.elevenlabs.io/v1/convai/...`, header `xi-api-key`. Plain `fetch` is sufficient (repo pattern); `npm:@elevenlabs/elevenlabs-js` is Deno-compatible if wanted.

| Capability | Endpoint / shape | Consequence |
|---|---|---|
| Agents | `POST /agents/create`, `PATCH /agents/{id}`, `GET /agents/{id}`, `DELETE /agents/{id}`. Prompt `conversation_config.agent.prompt.prompt`, `first_message`, `prompt.llm` (enum incl. `gpt-4o-mini`, `gpt-4o`, `claude-sonnet-4-5`, `gemini-2.5-flash`), `tts.voice_id`, `prompt.tool_ids[]`, `prompt.built_in_tools{}`, `prompt.knowledge_base[]`, `prompt.rag{enabled}`, `platform_settings.data_collection{}` | **No agent limit** → one agent per business |
| Phone numbers | `POST /phone-numbers {provider:"twilio", phone_number, label, sid, token, agent_id?}` → `{phone_number_id}`; `GET /phone-numbers`; `PATCH /phone-numbers/{id} {agent_id}`; `DELETE`. ElevenLabs auto-configures the Twilio voice webhook | **No native purchase** → buy via Twilio API, import, assign |
| Post-call webhook | Workspace-level; automatable: `POST /v1/workspace/webhooks {name, webhook_url, auth_type:"hmac"}` → `{webhook_id, webhook_secret}` (shown once), `PATCH /v1/workspace/webhooks/{id} {retry_enabled:true}`, `PATCH /v1/convai/settings {webhooks:{post_call_webhook_id, events:["transcript","call_initiation_failure"]}}`. Header `ElevenLabs-Signature: t=<unix>,v0=<hmac_sha256_hex(t + "." + rawBody)>`, 30-min tolerance. Payload `{type, event_timestamp, data:{agent_id, conversation_id, status, transcript[{role user|agent, message, time_in_call_secs, tool_calls, tool_results}], analysis{transcript_summary, call_successful, data_collection_results{id:{value, rationale}}}, metadata{start_time_unix_secs, call_duration_secs, cost, termination_reason, phone_call{direction, agent_number, external_number, call_sid}}, conversation_initiation_client_data}}`. Retries off by default (5 tries; only `post_call_transcription`). No call-started event | Replaces `retell-webhook`; add reconciliation poll |
| Server tools | `POST /tools {tool_config:{type:"webhook", name, description, response_timeout_secs 5–300, api_schema:{url, method, request_body_schema, request_headers}}}` → `{id}`. Property value source: `description` (LLM) \| `dynamic_variable:"system__agent_id"` \| `constant_value`. Header value `{secret_id}` (workspace secret via `POST /secrets {type:"new", name, value}`). System vars: `system__agent_id`, `system__conversation_id`, `system__caller_id`, `system__called_number` | Create tools once; tenant from agent id + secret header → **closes B2** |
| System tools | `built_in_tools.{end_call, transfer_to_number, voicemail_detection, language_detection, skip_turn}` each `{name, description, params:{system_tool_type,…}}`; `transfer_to_number.params.transfers[] = {transfer_destination:{type:"phone", phone_number}, condition, transfer_type: conference\|blind\|sip_refer}` | Transfer from `call_preferences` |
| Knowledge base | `POST /knowledge-base/file` (multipart `file`, `name`; PDF/Word/TXT/MD/HTML/EPUB, 20 MB) → `{id, name}`; `DELETE /knowledge-base/{id}?force=true`; attach `knowledge_base[{type:"file", id, name, usage_mode:"auto"}]`; non-RAG full context ≤300k chars | Replaces pgvector + OpenAI + PDF regex |
| Data collection | items `{identifier, type: string\|boolean\|integer\|number, description}`, ≤25/agent; results in `analysis.data_collection_results` | Replaces OpenRouter `call-analyze` |
| Conversations | `GET /conversations?agent_id&call_start_after_unix&cursor&page_size`, `GET /conversations/{id}`, `GET /conversations/{id}/audio` | Reconcile + recording on demand |
| Outbound | `POST /twilio/outbound-call {agent_id, agent_phone_number_id, to_number, conversation_initiation_client_data}`; `POST /batch-calling/submit {call_name, agent_id, agent_phone_number_id, recipients[{phone_number, conversation_initiation_client_data}], scheduled_time_unix}` | Phase 7 lead engine |
| Pricing | Creator $22/275 min/10 concurrent; Pro $99/1238 min/20 concurrent; overage $0.08/min; **LLM + Twilio billed separately**; SMS $0.003 | COGS > $0.08/min; concurrency shared across tenants |

### Twilio facts
Trial: 30 days, calls/SMS only to ≤5 verified numbers, one free number, Twilio-provided SMS templates only, no A2P 10DLC. Upgrade (payment method) needed to buy more numbers, call unverified numbers, send custom SMS. US SMS from local numbers needs A2P 10DLC registration (days–weeks). Number purchase: `GET /2010-04-01/Accounts/{sid}/AvailablePhoneNumbers/US/Local.json?AreaCode=&VoiceEnabled=true&SmsEnabled=true`, `POST …/IncomingPhoneNumbers.json {PhoneNumber, FriendlyName}` → `{sid}`, `DELETE …/IncomingPhoneNumbers/{sid}.json`.

### Other verified facts
- Stripe API `2025-03-31.basil`+: `subscription.current_period_end` moved to `items.data[].current_period_end`; `invoice.subscription` → `invoice.parent.subscription_details.subscription`. Checkout subscription mode allows one-time prices as line items ("initial invoice only").
- Supabase new `sb_secret_*` keys do **not** pass `verify_jwt`; keep the legacy service-role JWT for server→edge calls.
- Google OAuth consent screen in "Testing" issues refresh tokens that expire after 7 days.
- Turborepo `globalEnv` supports wildcards; Vercel install path follows Root Directory + nearest lockfile.

### User constraints & decisions (2026-09-13)
- Build executed in **Cursor** with personal accounts; this Claude session only produced this plan (no repo/account changes).
- Repo home: feature branch in `nrashid7/sigyn` (user has push access).
- Access today: Supabase project + Railway n8n + ElevenLabs. **No Twilio account yet.** Stripe/Google/Vercel accounts on personal email.
- Voice: ElevenLabs only. Knowledge: ElevenLabs native KB. Analysis: ElevenLabs data collection.
- Scope: baseline + Stripe + calendar + SMS + n8n CRM, then lead engine (scraping is "the most important part").
- DataForSEO balance $50 (≈150+ city scrapes at ~$0.30 each).

---

## Level 1 — Capabilities (scope) ✅ agreed

**In scope (this plan, phases P0–P7):**
1. Signup → onboarding → hire → **ElevenLabs agent + Twilio number** → inbound call answered with business knowledge → transcript + summary + lead score in dashboard.
2. Mid-call tools: check availability, book appointment (Google Calendar), qualify lead, transfer to human, voicemail detection.
3. Knowledge upload → ElevenLabs KB attached to the agent (PDF/DOCX/TXT/MD; CSV wrapped as TXT).
4. Missed-call SMS via Twilio (Supabase fast path).
5. Billing: trial row at signup, Stripe Checkout, webhook plan sync, usage metering (idempotent), renewal reset, usage-threshold events (no hard cap enforcement in v1).
6. n8n CRM/Sheets sync from `call_completed` (HubSpot, GoHighLevel, Google Sheets) with per-business routing.
7. Security: tool auth, service-role gating, tenant-scoped storage, hidden OAuth tokens.
8. Reconciliation job for missed webhooks; recordings via signed URLs.
9. Tests + CI (no Docker); docs/runbook rewrite; Windows-only scripts removed.
10. **Lead engine (P7):** DataForSEO scrape (existing `AI_agent`) → `leads` table → ElevenLabs batch outbound with an SDR agent → results back to `leads`.

**Out of scope:** white-label, multiple businesses per user, hire/pause UI after onboarding, Calendly/Cal.com (dropped — Calendly can't book), per-business CRM credentials in n8n, hard cap enforcement (pause agent), business-hours editing UI, HIPAA verticals, marketing demo-call form, app-store-grade PDF pipeline, deploy automation (manual `supabase functions deploy` from Mac in v1).

---

## Level 2 — Components ✅

### Edge functions (final: 13)
| Function | `verify_jwt` | Caller | Role |
|---|---|---|---|
| `agent-provision` **(new; replaces `retell-create-agent`)** | true + `requireServiceRole` | `onboarding.ts saveVoiceSelection` | Idempotent: EL agent → Twilio number → EL import → assign → `agents` row |
| `agent-sync` **(new)** | true + service role | `knowledge-ingest`, `knowledge-delete`, (optional) `saveCallPreferences` | Re-push full agent config (prompt/tools/KB/transfer) |
| `elevenlabs-webhook` **(new; replaces `retell-webhook`)** | **false** (HMAC) | ElevenLabs | Persist conversation → calls/transcripts/usage → SMS → n8n |
| `calls-reconcile` **(new)** | true (pg_cron sends service JWT) | pg_cron every 10 min / manual | Backfill missed conversations, fill recordings |
| `calendar-availability`, `calendar-book`, `qualify-lead` (hardened) | **false** (tool secret) | ElevenLabs tools | Tenant from `agent_id`; create call stub mid-call |
| `knowledge-ingest` (rewritten) | true + service role | `knowledge.ts uploadKnowledgeDocument` | Storage → EL KB → `agent-sync` |
| `knowledge-delete` **(new)** | true + service role | `knowledge.ts deleteKnowledgeDocument` | EL KB delete (force) → Storage → row → `agent-sync` |
| `n8n-dispatch` (modified) | true + service role | `elevenlabs-webhook` | Adds per-business `integrations` config to payload |
| `sync-n8n-workflows` (modified) | true + service role | admin server action | Only env-driven sync path left |
| `stripe-webhook` (modified) | **false** (Stripe sig) | Stripe | basil-compatible; `invoice.paid` reset |
| `voice-preview` (+ service-role check) | true | web API route | unchanged TTS |

**Deleted:** `retell-webhook`, `retell-create-agent`, `knowledge-search`, `call-analyze` (+ remote `supabase functions delete`).

### Shared modules (`supabase/functions/_shared/`)
| Module | Status | Contents |
|---|---|---|
| `elevenlabs.ts` | new | `elFetch`, `createAgent`, `updateAgent`, `deleteAgent`, `importTwilioNumber`, `listPhoneNumbers`, `assignNumberToAgent`, `deletePhoneNumber`, `createKbDocumentFromFile`, `deleteKbDocument`, `listConversations`, `getConversation`, `getConversationAudio`, `buildAgentConfig` (pure), `DEFAULT_DATA_COLLECTION` |
| `twilio.ts` | new | `twilioFetch`, `searchAvailableNumbers`, `purchaseNumber`, `listOwnedNumbers`, `releaseNumber`, `acquireNumber` (reuse-owned-first) |
| `conversations.ts` | new | `mapConversationToCallRow`, `mapTranscript`, `flattenDataCollection` (pure); `persistConversation`, `ensureCallStub` |
| `auth.ts` | new | `requireServiceRole(req)`, `requireToolSecret(req)`, `timingSafeEqual` |
| `invoke.ts` | new | `invokeFunction(name, body)` (moved out of retell-webhook) |
| `webhook.ts` | modified | drop `verifyRetellSignature`; add `verifyElevenLabsSignature(req, rawBody)` (parse `t`/`v0`, 1800 s window, reuse `verifyHmacSignature` over `${t}.${rawBody}`) |
| `stripe.ts` | modified | `npm:stripe@18.5.0`, `apiVersion "2025-08-27.basil"`, `getPeriodEnd`, price env names, `recordUsageMinutes` → RPC `record_call_minutes`, threshold events |
| `calendar.ts` | modified | Google only; `getGoogleAccessToken` refresh; `generateDefaultSlots(request, business)` honours hours/tz; double-booking checks |
| `n8n.ts`, `crm.ts` | modified | drop SMS definition; `integrations` passthrough; deactivate stale rows |
| `prompts.ts`, `sms.ts`, `analytics.ts`, `errors.ts` | unchanged | reused as-is (`buildSystemPrompt`, `sendSms(from?)`) |
| `retell.ts`, `ai.ts`, `embeddings.ts`, `retrieval.ts` | **deleted** | |

### Migrations (ordered; all forward-only, run with `supabase db push`)
1. `20260913000001_billing_trial_and_usage.sql` — nullable `stripe_customer_id`, `handle_new_business` trigger (trial row), backfill, `usage_records` unique `(call_id,type)`, RPC `record_call_minutes`.
2. `20260913000002_workflows_unique_global_name.sql` — dedupe + partial unique index `workflows(name) WHERE business_id IS NULL`.
3. `20260913000003_security_hardening.sql` — tenant-scoped storage policies; column-level grants on `integrations`.
4. `20260913000010_elevenlabs_voice_layer.sql` — rename `retell_*` → `elevenlabs_*`, provisioning status, KB doc id, `provider_metadata`, drop pgvector, `recordings` bucket.
5. `20260913000011_calls_reconcile_cron.sql` — `pg_cron` + `pg_net` schedule (Vault-backed secrets).
6. *(P7)* `20260913000020_leads.sql` — `leads` table for the lead engine.

`seed.sql` rewritten (upsert templates with rich prompts, ElevenLabs config, data-collection extras; `workflows` seed removed — sync fn owns it).

### Scripts (`scripts/`, Node 26, no Docker)
- `elevenlabs-setup.mjs` + `lib/tool-definitions.mjs` — idempotent workspace setup (secret, 3 tools, post-call webhook, settings); prints `supabase secrets set …`.
- `smoke-elevenlabs.mjs` — forged signed webhook, tool auth matrix, reconcile ping, optional `--provision`.
- `deploy-n8n-workflows.mjs` — modified: `__N8N_BASE_URL__` substitution, credential-binding preservation, paths derived from files.
- Tests: `n8n-workflows.test.mjs`, `env-contract.test.mjs`, `elevenlabs-setup.test.mjs`.
- **Deleted:** `retell-integration.test.mjs`, `apply-n8n-railway.ps1`, `sync-n8n-workflows.sql`.

### n8n workflows (`n8n/workflows/`)
- `call-completed.json` (renamed from `retell-call-completed.json`; n8n name unchanged) — Webhook → Code router → HTTP forward.
- `hubspot-sync.json`, `ghl-sync.json`, `sheets-log.json` — expression fixes.
- **Deleted:** `sms-follow-up.json` (Supabase owns SMS).

### Frontend / shared (minimal)
`onboarding.ts` (URL + provider literal), `onboarding/voice/page.tsx` (drop provider toggle), `schemas/index.ts` (`voice_provider` literal), `templates/voices.ts` (drop `retellDefaultVoices`), `types/index.ts` (new columns), `templates/index.ts` (voice/llm shape), `agent-card.tsx` ×2 (drop retell fallback), `lib/actions/agents.ts` (delete `hireAgent`), `knowledge.ts` (delete via `knowledge-delete`), `integrations.ts` (explicit columns), `billing.ts` (defaults/guard), `api/stripe/checkout` (400 w/o business, reuse customer, `client_reference_id`), `api/stripe/portal` (trial redirect), `billing/page.tsx` (plan-aware links), `api/integrations/connect` (`onConflict`), `api/oauth/google/callback` (keep refresh token), admin `integrations-panel.tsx` / `workflow-sync-button.tsx` (server action), delete `api/admin/sync-n8n/route.ts`, `packages/shared/src/config/n8n.ts`, `apps/web/package-lock.json`. Settings: remove Calendly/Cal.com entries.

### Lead engine components (P7)
- `AI_agent` (Python): existing `main.py` pipeline; `exporter.py` gains `--supabase` upsert to `leads` via PostgREST.
- Supabase: `leads` table; SDR outbound agent provisioned under a "Sigyn platform" business row via `agent-provision` (template `sdr`); `lead-call-batch` edge function (or Node script) → ElevenLabs batch calling; `elevenlabs-webhook` writes outbound results to `leads`.
- Scheduler with no server: GitHub Actions cron in `AIreceptionist` runs the scraper matrix and upserts.

---

## Level 3 — Interactions (data flow) ✅

**Hire (onboarding step 5)** — `saveVoiceSelection` → `POST agent-provision {business_id, template_slug, name, voice_id, voice_provider:"elevenlabs", include_calendar}` → load `businesses`, `agent_templates`, `call_preferences`, ready `knowledge_documents` → `buildSystemPrompt(template, business)` → `buildAgentConfig` → `createAgent` → `acquireNumber` (reuse owned Twilio number else buy by area code) → `importTwilioNumber` → `assignNumberToAgent` → `agents` row `provision_status='ready'`. Each external id is persisted the moment it is known; re-running resumes at the first incomplete step; any failure returns 4xx/5xx `{error, code}` that the UI already displays (B5).

**Inbound call** — PSTN → Twilio number → ElevenLabs agent (prompt + KB) → tools POST to Supabase with header `x-sigyn-tool-secret` and body `{agent_id:{{system__agent_id}}, conversation_id:{{system__conversation_id}}, caller_id:{{system__caller_id}}, …}` → handler `requireToolSecret` → `agents ⋈ businesses` by `elevenlabs_agent_id` → `ensureCallStub` (`calls` row `in_progress`) → business logic → flat JSON with `result` sentence → agent speaks. Transfer via `transfer_to_number` system tool. Call ends → ElevenLabs POST `post_call_transcription` → `verifyElevenLabsSignature` → `persistConversation` (upsert `calls` by `elevenlabs_conversation_id`, `call_transcripts`, `provider_metadata`) → `recordUsageMinutes` (RPC, idempotent) → recording fetched via `/audio` → `recordings/<business>/<conv>.mp3` → signed URL → missed-call SMS if the agent never spoke → PostHog → `invokeFunction("n8n-dispatch", {event:"call_completed", business_id, call_id})`.

**Reconcile** — pg_cron every 10 min → `calls-reconcile` → per ready agent: `listConversations(since = last started_at − 1h)` → any `done|failed` conversation missing or still `in_progress` → `getConversation` → `persistConversation` (same code path, same idempotency) → also fills missing `recording_url`.

**Knowledge** — upload → Storage `knowledge/<business_id>/<ts>-<file>` → `knowledge_documents(pending)` → `knowledge-ingest` → download → (CSV→TXT) → `POST /knowledge-base/file` → `elevenlabs_document_id`, `ready` → `agent-sync` re-pushes `knowledge_base[]`. Delete → `knowledge-delete` → EL `?force=true` → Storage → row → `agent-sync`.

**Billing** — `businesses` INSERT → trigger → `subscriptions(trialing, starter, 200 min, +14 d)`. `/api/stripe/checkout?plan=` → Checkout (recurring price + one-time setup) → Stripe `customer.subscription.created/updated` (metadata `business_id`) → upsert by `business_id`, fills `stripe_customer_id`, resets `used_minutes` on new subscription id → `invoice.paid (subscription_cycle)` → `used_minutes=0`, `status=active` → `invoice.payment_failed` → `past_due`. Usage: webhook → `record_call_minutes` → 80%/100% PostHog events.

**n8n** — `n8n-dispatch` loads call + transcript + active `integrations (hubspot|gohighlevel|google_sheets)` config → HMAC-signed POST to router → Code node emits one item per active provider (`hubspot` only when `contact.email`) → HTTP forward of the original body to `/webhook/<path>` → provider workflow writes contact/note/row.

**Lead engine (P7)** — `python main.py` (DataForSEO Maps SERP → filter → reviews → pain keywords) → `exporter --supabase` upsert `leads (on_conflict=phone)` → `lead-call-batch` selects `status='new'` within calling hours → `POST /batch-calling/submit` (SDR agent, Sigyn's Twilio number, `dynamic_variables {business_name, city, pain_signal}`) → outbound conversations hit the same `elevenlabs-webhook` → SDR agent's business = platform row → `leads.status ∈ called|booked|dnc|invalid`, `demo_booked_at` from data collection.

---

## Level 4 — Contracts ✅

### 4.1 Migration SQL (key statements)

`20260913000001_billing_trial_and_usage.sql`
```sql
ALTER TABLE subscriptions ALTER COLUMN stripe_customer_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION handle_new_business() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO subscriptions (business_id, plan, status, included_minutes, used_minutes, current_period_end)
  VALUES (NEW.id, 'starter', 'trialing', 200, 0, NOW() + INTERVAL '14 days')
  ON CONFLICT (business_id) DO NOTHING;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
CREATE TRIGGER on_business_created AFTER INSERT ON businesses FOR EACH ROW EXECUTE FUNCTION handle_new_business();

INSERT INTO subscriptions (business_id, plan, status, included_minutes, used_minutes, current_period_end)
SELECT b.id, 'starter', 'trialing', 200, 0, NOW() + INTERVAL '14 days'
FROM businesses b WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.business_id = b.id);

CREATE UNIQUE INDEX IF NOT EXISTS usage_records_call_type_key ON usage_records (call_id, type) WHERE call_id IS NOT NULL;

CREATE OR REPLACE FUNCTION record_call_minutes(p_business_id UUID, p_call_id UUID, p_minutes INT)
RETURNS TABLE (inserted BOOLEAN, used_minutes INT, included_minutes INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inserted BOOLEAN := FALSE;
BEGIN
  INSERT INTO usage_records (business_id, call_id, type, quantity) VALUES (p_business_id, p_call_id, 'call_minutes', p_minutes)
  ON CONFLICT (call_id, type) WHERE call_id IS NOT NULL DO NOTHING;
  v_inserted := FOUND;
  IF v_inserted THEN UPDATE subscriptions SET used_minutes = subscriptions.used_minutes + p_minutes WHERE business_id = p_business_id; END IF;
  RETURN QUERY SELECT v_inserted, s.used_minutes, s.included_minutes FROM subscriptions s WHERE s.business_id = p_business_id;
END $$;
REVOKE EXECUTE ON FUNCTION record_call_minutes(UUID, UUID, INT) FROM PUBLIC, anon, authenticated;
```

`20260913000002_workflows_unique_global_name.sql`
```sql
DELETE FROM workflows w USING workflows w2
WHERE w.business_id IS NULL AND w2.business_id IS NULL AND w.name = w2.name AND (w.created_at, w.id) > (w2.created_at, w2.id);
CREATE UNIQUE INDEX IF NOT EXISTS workflows_global_name_key ON workflows (name) WHERE business_id IS NULL;
```

`20260913000003_security_hardening.sql`
```sql
DROP POLICY IF EXISTS knowledge_storage_select ON storage.objects;
DROP POLICY IF EXISTS knowledge_storage_insert ON storage.objects;
DROP POLICY IF EXISTS knowledge_storage_delete ON storage.objects;
-- path is "<business_id>/<ts>-<file>"; regex guard avoids a cast error on foreign prefixes
CREATE POLICY knowledge_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'knowledge' AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    AND (public.is_business_member(((storage.foldername(name))[1])::uuid) OR public.is_admin()));
CREATE POLICY knowledge_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'knowledge' AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    AND (public.is_business_member(((storage.foldername(name))[1])::uuid) OR public.is_admin()));
CREATE POLICY knowledge_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'knowledge' AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    AND (public.is_business_member(((storage.foldername(name))[1])::uuid) OR public.is_admin()));

REVOKE SELECT ON TABLE public.integrations FROM anon, authenticated;
GRANT SELECT (id, business_id, provider, config, token_expires_at, is_active, created_at, updated_at) ON public.integrations TO authenticated;
```

`20260913000010_elevenlabs_voice_layer.sql`
```sql
CREATE TYPE agent_provision_status AS ENUM ('provisioning', 'ready', 'failed');

ALTER TABLE agents RENAME COLUMN retell_agent_id TO elevenlabs_agent_id;
ALTER TABLE agents DROP COLUMN retell_llm_id;
ALTER TABLE agents
  ADD COLUMN elevenlabs_phone_number_id TEXT,
  ADD COLUMN twilio_phone_sid TEXT,
  ADD COLUMN provision_status agent_provision_status NOT NULL DEFAULT 'ready',
  ADD COLUMN provision_error TEXT;
ALTER TABLE agents ALTER COLUMN voice_provider SET DEFAULT 'elevenlabs';
UPDATE agents SET voice_provider = 'elevenlabs' WHERE voice_provider <> 'elevenlabs';
ALTER TABLE agents ADD CONSTRAINT agents_voice_provider_check CHECK (voice_provider = 'elevenlabs');
DROP INDEX IF EXISTS idx_agents_retell;
CREATE UNIQUE INDEX agents_elevenlabs_agent_id_key ON agents(elevenlabs_agent_id) WHERE elevenlabs_agent_id IS NOT NULL;
CREATE UNIQUE INDEX agents_business_template_key ON agents(business_id, template_id);

ALTER TABLE calls RENAME COLUMN retell_call_id TO elevenlabs_conversation_id;
ALTER TABLE calls RENAME CONSTRAINT calls_retell_call_id_key TO calls_elevenlabs_conversation_id_key;
ALTER INDEX idx_calls_retell RENAME TO idx_calls_elevenlabs_conversation;
ALTER TABLE calls ADD COLUMN provider_metadata JSONB NOT NULL DEFAULT '{}';

ALTER TABLE knowledge_documents ADD COLUMN elevenlabs_document_id TEXT;
CREATE UNIQUE INDEX knowledge_documents_elevenlabs_document_id_key ON knowledge_documents(elevenlabs_document_id) WHERE elevenlabs_document_id IS NOT NULL;

DROP FUNCTION IF EXISTS match_knowledge_chunks(vector, uuid, int);
DROP TABLE IF EXISTS knowledge_chunks;
DROP EXTENSION IF EXISTS vector;

INSERT INTO storage.buckets (id, name, public) VALUES ('recordings', 'recordings', false) ON CONFLICT (id) DO NOTHING;
-- no user policies on recordings: service-role writes, playback via signed URLs
```

`20260913000011_calls_reconcile_cron.sql`
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;   -- if db push lacks privilege: Dashboard → Integrations → Cron → Enable, re-run
GRANT USAGE ON SCHEMA cron TO postgres;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
SELECT cron.schedule('calls-reconcile-10m', '*/10 * * * *', $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/calls-reconcile',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := jsonb_build_object('source','pg_cron'),
    timeout_milliseconds := 30000);
$$);
```
One-time SQL the user runs in the SQL editor (never committed): `select vault.create_secret('https://wtrqpnzacuaroxluxwfa.supabase.co','project_url'); select vault.create_secret('<legacy service_role JWT>','service_role_key');`

`20260913000020_leads.sql` (P7)
```sql
CREATE TYPE lead_status AS ENUM ('new','queued','called','booked','not_interested','dnc','invalid');
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT NOT NULL UNIQUE,                -- E.164; dedupe key (matches exporter dedup-by-phone)
  business_name TEXT NOT NULL,
  website TEXT, niche TEXT NOT NULL, city TEXT NOT NULL,
  rating NUMERIC(2,1), review_count INT,
  pain_signals JSONB NOT NULL DEFAULT '[]',   -- [{keyword, review_excerpt, when}]
  source TEXT NOT NULL DEFAULT 'dataforseo', source_run_id TEXT,
  status lead_status NOT NULL DEFAULT 'new',
  last_called_at TIMESTAMPTZ, call_count INT NOT NULL DEFAULT 0,
  last_conversation_id TEXT, demo_booked_at TIMESTAMPTZ, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_leads_status_city ON leads(status, city);
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY leads_admin ON leads FOR ALL USING (is_admin());   -- platform-internal; writes via service role
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 4.2 `seed.sql` (rewritten)
- `INSERT … ON CONFLICT (slug) DO UPDATE SET name, industry, config, updated_at = now()`.
- Per template config: `voice: {elevenlabs_voice_id}`, `first_message` (e.g. `"Hi, thanks for calling {{business_name}}. This is Dexter — how can I help you today?"`), `elevenlabs: {llm: "gpt-4o-mini", temperature: 0.5, data_collection: {…template extras…}}`, and the **full** `system_prompt`, `objection_handlers`, `booking_rules`, `escalation_rules`, `faq_rules`, `qualification_questions` copied from `packages/shared/src/templates/index.ts` (reword "search knowledge base" → "use the attached knowledge base documents"). Extras: Bella `company, need, timeline, budget`; Sparky `service_address, urgency`; Zia `service_requested, preferred_stylist`; Sunny `appointment_type`.
- Add template `sdr` (P7): outbound Sigyn SDR — first sentence discloses AI, pitch = missed-call revenue loss using `{{pain_signal}}`, CTA = 15-min demo, data collection `interested (boolean)`, `demo_booked (boolean)`, `callback_time`, `do_not_call (boolean)`.
- `workflows` seed block removed. Apply with `psql "$SUPABASE_DB_URL" -f supabase/seed.sql` (or SQL editor); `db push` does not run seeds remotely.

### 4.3 `buildAgentConfig` output (ElevenLabs agent JSON)
```json
{
  "name": "<business.name> · Dexter · <agents.id>",
  "conversation_config": {
    "agent": {
      "first_message": "<template.first_message rendered by mergeTemplateVariables>",
      "language": "en",
      "prompt": {
        "prompt": "<buildSystemPrompt(template, business)> + ## Tools + ## Transfers + ## After hours",
        "llm": "gpt-4o-mini", "temperature": 0.5,
        "tool_ids": ["<qualify_lead>", "<check_availability>", "<book_appointment>"],
        "built_in_tools": {
          "end_call": { "name": "end_call", "description": "End the call when the caller says goodbye or the request is fully handled.", "params": { "system_tool_type": "end_call" } },
          "transfer_to_number": { "name": "transfer_to_number", "description": "Transfer the caller to a human.",
            "params": { "system_tool_type": "transfer_to_number", "transfers": [
              { "transfer_destination": { "type": "phone", "phone_number": "<E.164 transfer_number>" }, "condition": "Caller asks for a person, is upset after two attempts, or has a request you cannot fulfil.", "transfer_type": "conference" },
              { "transfer_destination": { "type": "phone", "phone_number": "<E.164 emergency_number>" }, "condition": "Caller reports an emergency.", "transfer_type": "conference" } ] } },
          "voicemail_detection": { "name": "voicemail_detection", "params": { "system_tool_type": "voicemail_detection", "voicemail_message": "<callPrefs.voicemail_message>" } }
        },
        "knowledge_base": [ { "type": "file", "id": "<elevenlabs_document_id>", "name": "<filename>", "usage_mode": "auto" } ],
        "rag": { "enabled": false }
      }
    },
    "tts": { "voice_id": "<voiceId>", "model_id": "eleven_turbo_v2" },
    "conversation": { "max_duration_seconds": 900 }
  },
  "platform_settings": { "data_collection": { "...DEFAULT_DATA_COLLECTION + template extras": "…" } }
}
```
Rules: `transfer_to_number` = `null` when no numbers (normalise to E.164); `voicemail_detection` = `null` when `voicemail_enabled=false`; calendar `tool_ids` omitted when `include_calendar=false`; `rag.enabled=false` (full-context) until a business's KB exceeds ~100k chars; **guard**: throw `TEMPLATE_ERROR` if `/\{\{(?!system__)\w+\}\}/` remains in prompt/first_message (ElevenLabs uses the same `{{}}` syntax — unrendered vars fail calls). `data_collection` exact JSON path to be confirmed from a dashboard-created agent (`GET /agents/{id}`) in P2.

```ts
export const DEFAULT_DATA_COLLECTION = {
  customer_name:  { type: "string",  description: "Caller's full name if given, else empty string." },
  customer_phone: { type: "string",  description: "Best callback number in E.164 if given, else empty string." },
  customer_email: { type: "string",  description: "Caller's email if given, else empty string." },
  intent:         { type: "string",  description: "One sentence: why the caller called." },
  outcome:        { type: "string",  description: "Exactly one of: answered, booked, qualified_lead, transferred, voicemail, missed, other." },
  sentiment:      { type: "string",  description: "Exactly one of: positive, neutral, negative." },
  lead_score:     { type: "integer", description: "0-100 lead quality; 0 if not a sales inquiry." },
  appointment_requested: { type: "boolean", description: "True if the caller asked to book, move or cancel an appointment." },
};
```

### 4.4 Tool definitions (registered once by `scripts/elevenlabs-setup.mjs`)
All: `method: "POST"`, `request_headers: { "x-sigyn-tool-secret": { "secret_id": "<id>" } }`, `response_timeout_secs: 20`.
```json
// check_availability → {SUPABASE_URL}/functions/v1/calendar-availability
{ "type":"object", "required":["agent_id","conversation_id","start_date"], "properties":{
  "agent_id":{"type":"string","dynamic_variable":"system__agent_id"},
  "conversation_id":{"type":"string","dynamic_variable":"system__conversation_id"},
  "start_date":{"type":"string","description":"First day to search, ISO date YYYY-MM-DD, in the business timezone."},
  "end_date":{"type":"string","description":"Optional last day to search, ISO date."},
  "duration_minutes":{"type":"integer","description":"Appointment length in minutes. Default 30."} } }
// → { slots:[{start,end,display}], result:"Available slots: …" | "No available slots …" }

// book_appointment → …/calendar-book
{ "type":"object", "required":["agent_id","conversation_id","scheduled_at","customer_name","customer_phone"], "properties":{
  "agent_id":{"type":"string","dynamic_variable":"system__agent_id"},
  "conversation_id":{"type":"string","dynamic_variable":"system__conversation_id"},
  "caller_id":{"type":"string","dynamic_variable":"system__caller_id"},
  "scheduled_at":{"type":"string","description":"Confirmed start time as ISO 8601 with timezone offset."},
  "customer_name":{"type":"string","description":"Caller's full name, confirmed back to them."},
  "customer_phone":{"type":"string","description":"Callback number confirmed with the caller."},
  "customer_email":{"type":"string","description":"Optional email."},
  "duration_minutes":{"type":"integer","description":"Default 30."},
  "notes":{"type":"string","description":"Service requested and any details."} } }
// → { appointment_id, result:"Appointment confirmed for … on …" } | 409 { result:"That time was just taken. Please choose another slot." }

// qualify_lead → …/qualify-lead
{ "type":"object", "required":["agent_id","conversation_id","name","lead_score"], "properties":{
  "agent_id":{"type":"string","dynamic_variable":"system__agent_id"},
  "conversation_id":{"type":"string","dynamic_variable":"system__conversation_id"},
  "caller_id":{"type":"string","dynamic_variable":"system__caller_id"},
  "name":{"type":"string"},"email":{"type":"string"},"company":{"type":"string"},
  "need":{"type":"string"},"timeline":{"type":"string"},"budget":{"type":"string"},
  "lead_score":{"type":"integer","description":"0-100 lead quality."} } }
// → { success:true, lead_score, result:"Lead recorded (score N)." }
```
Handler order: `requireToolSecret` (401) → `parseJsonBody` → `resolveAgentContext(agent_id)` = `agents ⋈ businesses` by `elevenlabs_agent_id` (404) → `ensureCallStub(conversation_id, caller_id)` → logic → flat JSON with `result`. `business_id` is never read from the body.

### 4.5 `elevenlabs-webhook` → row mapping
| `calls` column | Source |
|---|---|
| `elevenlabs_conversation_id` | `data.conversation_id` (upsert key) |
| `business_id`, `agent_id` | `agents` row by `data.agent_id` (unknown → `200 {received, skipped}`) |
| `caller_number` | `metadata.phone_call.external_number` → `conversation_initiation_client_data.dynamic_variables.system__caller_id` → existing stub |
| `duration_seconds` | `metadata.call_duration_secs ?? 0` |
| `started_at` / `ended_at` | `start_time_unix_secs*1000`; + duration |
| `status` | `termination_reason ~ /transfer/i` → `transferred`; `data.status='failed'` → `failed`; `done` & duration 0 → `no_answer`; `done` → `completed`; `initiated|in-progress|processing` → `in_progress` |
| `outcome` | `appointments` row for this call → `booked`; stub `qualified_lead` → keep; `transferred`; `data_collection.outcome` if in enum; `failed|no_answer` → `missed`; else `answered` |
| `sentiment`, `lead_score` | `data_collection.sentiment` (enum-checked); stub `lead_score` else `data_collection.lead_score` clamped 0–100 |
| `qualification_data` | `{...stub, ...flattenDataCollection}` |
| `recording_url` | `getConversationAudio` → `recordings/<business_id>/<conversation_id>.mp3` → `createSignedUrl(path, 31_536_000)` |
| `provider_metadata` | `{status, termination_reason, call_successful, cost, phone_call}` |
| `call_transcripts` | `transcript = data.transcript.filter(t=>t.message).map(t=>({role: t.role==="agent"?"agent":"user", content: t.message, timestamp: t.time_in_call_secs}))`; `summary = analysis.transcript_summary`; `extracted_entities = flattenDataCollection` |
Side effects (each try/catch'd): `recordUsageMinutes` (RPC) → recording → missed-call SMS (**missed** = `call_initiation_failure` \| `status=failed` \| zero `agent` turns; `from = agent.phone_number ?? TWILIO_PHONE_NUMBER`) → PostHog → `n8n-dispatch {event:"call_completed", business_id, call_id}`. `call_initiation_failure` → `calls {status:'failed', outcome:'missed', duration 0, provider_metadata.failure_reason}` + SMS rule. `post_call_audio` → `200 {ignored}` (not subscribed). Return `500` on DB/EL errors so ElevenLabs retries.

### 4.6 `agent-provision` contract
Request (unchanged): `{ business_id, template_slug | template_id, name?, voice_id?, voice_provider?, include_calendar?, area_code? }`. Responses: `201 {agent}` · `200 {agent, already_provisioned:true}` · `409 {error:"Provisioning in progress"}` · `4xx/5xx {error, code ∈ ELEVENLABS_ERROR|TWILIO_ERROR|PHONE_PROVISION_FAILED|TEMPLATE_ERROR, agent}`.
Checkpoints on the `agents` row (`UNIQUE(business_id, template_id)`): 1 insert `provisioning` → 2 `createAgent` → `elevenlabs_agent_id` → 3 `acquireNumber` → `phone_number, twilio_phone_sid` → 4 `importTwilioNumber` (reuse existing import by number) → `elevenlabs_phone_number_id` → 5 `assignNumberToAgent` → 6 `ready`, `is_active=true`, PostHog `agent_created`. Failure → `failed` + `provision_error`; no compensating deletes (numbers are never auto-released).

### 4.7 Stripe contract
- Env: `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_SETUP` (web); `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (edge). Drop `STRIPE_*_PRICE_ID`, enterprise mapping.
- SDK `stripe@18.5.0` both runtimes, `apiVersion "2025-08-27.basil"`, webhook endpoint pinned to the same version. Events: `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed`. `getPeriodEnd(sub) = sub.items.data[0]?.current_period_end ?? sub.current_period_end ?? null`. `mapStripeStatus`: `incomplete|paused` → `past_due`. New subscription id → `used_minutes=0`. `invoice.paid` with `billing_reason ∈ subscription_cycle|subscription_create` → `used_minutes=0, status='active'` by `customer`.
- `recordUsageMinutes(supabase, businessId, callId, minutes)` → `rpc("record_call_minutes")`; PostHog `usage_threshold_reached {threshold: 80|100}` when crossed.

### 4.8 n8n payload contract
`buildN8nDispatchPayload` → `{ event:"call_completed", business_id, call_id, contact:{name, phone, email}, call_summary, lead_score, pipeline_stage, metadata:{ outcome, sentiment, dispatched_at, … }, integrations:{ hubspot?:config, gohighlevel?:config, google_sheets?:{sheet_id} } }` (config only, never tokens). Router Code node:
```js
const body = $input.first().json.body;
if (body.event !== 'call_completed') return [];
const routes = { hubspot: 'hubspot-sync', gohighlevel: 'ghl-sync', google_sheets: 'sheets-log' };
const active = body.integrations || {};
return Object.entries(routes).filter(([p]) => active[p] && (p !== 'hubspot' || body.contact?.email))
  .map(([p, path]) => ({ json: { provider: p, path, body } }));
```
HTTP forward: `url = "=__N8N_BASE_URL__/webhook/{{ $json.path }}"`, `jsonBody = "={{ JSON.stringify($json.body) }}"` (`__N8N_BASE_URL__` substituted by the deploy script; no `$env`). `sheets-log` `documentId = {{ $json.body.integrations.google_sheets.sheet_id }}`; sheet tab `Calls` with header `Date, Business ID, Caller, Phone, Summary, Lead Score, Outcome`. HubSpot note: `contactId = {{ $json.vid ?? $json.id }}`, text from `$('Webhook').item.json.body.call_summary`.

### 4.9 `supabase/config.toml`
```toml
[functions.elevenlabs-webhook]
verify_jwt = false
[functions.stripe-webhook]
verify_jwt = false
[functions.calendar-availability]
verify_jwt = false
[functions.calendar-book]
verify_jwt = false
[functions.qualify-lead]
verify_jwt = false
# service-role only (gateway JWT + requireServiceRole in code)
[functions.agent-provision]
verify_jwt = true
[functions.agent-sync]
verify_jwt = true
[functions.calls-reconcile]
verify_jwt = true
[functions.knowledge-ingest]
verify_jwt = true
[functions.knowledge-delete]
verify_jwt = true
[functions.n8n-dispatch]
verify_jwt = true
[functions.sync-n8n-workflows]
verify_jwt = true
[functions.voice-preview]
verify_jwt = true
```

### 4.10 Secrets / env matrix
| Target | Variables |
|---|---|
| **Supabase secrets** (`supabase/.env.local`, gitignored; `supabase secrets set --env-file`) | `ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK_SECRET`, `ELEVENLABS_TOOL_SECRET`, `ELEVENLABS_TOOL_IDS` (JSON `{check_availability, book_appointment, qualify_lead}`), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `N8N_WEBHOOK_BASE_URL=https://n8n-production-08c9.up.railway.app/webhook`, `N8N_WEBHOOK_SECRET`, `POSTHOG_API_KEY`, `POSTHOG_HOST` (opt). Auto-injected: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. **Unset:** `RETELL_API_KEY`, `RETELL_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `VOYAGE_API_KEY`, `EMBEDDING_PROVIDER`, `APP_URL`, `N8N_WEBHOOK_{CALL_COMPLETED,SMS,HUBSPOT,GHL,SHEETS}` |
| **Vault** (SQL editor) | `project_url`, `service_role_key` (legacy JWT) |
| **Vercel** (`apps/web`) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`), `SUPABASE_SERVICE_ROLE_KEY` (legacy JWT), `NEXT_PUBLIC_APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_SETUP`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_API_KEY` (opt) |
| **Railway n8n** | nothing app-specific after the `$env` removal |
| **Local scripts** | `N8N_API_URL`, `N8N_API_KEY`; `ELEVENLABS_API_KEY`, `SUPABASE_URL` (setup script); `SUPABASE_DB_URL` (psql seed) |
| **GitHub Actions (P7, AIreceptionist repo)** | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
`turbo.json`: `"globalEnv": ["NEXT_PUBLIC_*", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_*", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "POSTHOG_API_KEY"]`. Vercel Root Directory `apps/web`; delete `apps/web/package-lock.json`.

### 4.11 Lead engine contracts (P7)
- `AI_agent/exporter.py --supabase`: `POST {SUPABASE_URL}/rest/v1/leads?on_conflict=phone` headers `apikey`, `Authorization: Bearer <service role>`, `Prefer: resolution=merge-duplicates,return=minimal`; body = list of `{phone (E.164), business_name, website, niche, city, rating, review_count, pain_signals, source_run_id}`; never downgrade `status` (merge only touches source fields — use a DB trigger or exclude `status` from the payload).
- `lead-call-batch` (edge fn, service role; or `scripts/lead-call-batch.mjs`): select `leads where status='new' and call_count < 2` limited to N, respecting 9:00–18:00 in the lead's city timezone → `POST /v1/convai/batch-calling/submit { call_name:"sigyn-<date>", agent_id:<sdr>, agent_phone_number_id:<sigyn number>, recipients:[{ phone_number, conversation_initiation_client_data:{ dynamic_variables:{ business_name, city, pain_signal } } }] }` → `leads.status='queued'`.
- `elevenlabs-webhook`: when the agent row's business is the platform row and `metadata.phone_call.direction='outbound'`, update `leads` by `external_number`: `status` from data collection (`do_not_call` → `dnc`; `demo_booked` → `booked` + `demo_booked_at`; `interested=false` → `not_interested`; else `called`), `call_count+1`, `last_conversation_id`.
- Legal guardrails baked into the SDR template: AI disclosure in the first sentence, business lines only, honour `dnc`, calling-hours window, max 2 attempts.

---

## Level 5 — Implementation checklist (phases; each task has a verification)

### P0 — Accounts & tooling (user, personal email; ~30 min + waits)
- [ ] `brew install supabase/tap/supabase deno stripe/stripe-cli/stripe`; `supabase login`; `supabase link --project-ref wtrqpnzacuaroxluxwfa`; `gh auth login`. ✔ `supabase functions list` shows 12 live functions; `gh auth status` OK.
- [ ] ElevenLabs: Creator plan+, API key (agents/KB/phone permissions). ✔ `curl -H "xi-api-key: $K" https://api.elevenlabs.io/v1/convai/settings` → 200.
- [ ] Twilio: create account, verify your mobile as caller ID, note SID/token; start upgrade (small top-up) + A2P 10DLC brand/campaign registration (SMS is best-effort until approved). ✔ `curl -u $SID:$TOKEN https://api.twilio.com/2010-04-01/Accounts/$SID/IncomingPhoneNumbers.json` → 200.
- [ ] Stripe test mode: products Starter $99/mo, Pro $249/mo, Setup $199 **one-time** → price ids. Webhook endpoint `…/functions/v1/stripe-webhook`, 5 events, `api_version=2025-08-27.basil` → `whsec_…`.
- [ ] Google Cloud project: enable Calendar API; consent screen External/Testing + test users; scopes `calendar`, `calendar.events`, `openid email profile`; Web OAuth client with redirect URIs `https://wtrqpnzacuaroxluxwfa.supabase.co/auth/v1/callback`, `https://<vercel>/api/oauth/google/callback`, `http://localhost:3000/api/oauth/google/callback`. Enable Google provider in Supabase Auth; set Site URL/redirects.
- [ ] Vercel project (import `nrashid7/sigyn`, Root Directory `apps/web`). n8n API key (Railway → Settings → n8n API).
- [ ] Vault secrets SQL (4.1). ✔ `select name from vault.decrypted_secrets` lists both.
- [ ] Branch `feat/elevenlabs-backend`; copy this plan to `docs/BACKEND_PLAN.md`.

### P1 — Foundation: config, security, billing schema (repo work)
- [ ] `supabase/config.toml` per 4.9. ✔ after deploy: `curl -i …/stripe-webhook` → 405; `curl -i …/n8n-dispatch` → 401.
- [ ] Migrations 0001–0003 → `supabase db push`. ✔ `select status from subscriptions` shows `trialing` rows for existing businesses; `select indexname from pg_indexes where tablename='workflows'` shows `workflows_global_name_key`; as a user JWT `GET /rest/v1/integrations?select=access_token` → 42501, `?select=id,provider` → 200; cross-tenant `storage/v1/object/list/knowledge` → empty.
- [ ] `_shared/auth.ts` (`requireServiceRole`, `requireToolSecret`, `timingSafeEqual`); add `requireServiceRole` to `n8n-dispatch`, `sync-n8n-workflows`, `voice-preview`. ✔ `curl -X POST …/n8n-dispatch -H "Authorization: Bearer $ANON"` → 403.
- [ ] `package.json` scripts: `db:push`, `deploy:functions` (`supabase functions deploy --use-api`), `secrets:set`, `test`, `test:node`, `test:deno`; delete `setup:n8n`; delete `scripts/apply-n8n-railway.ps1`, `scripts/sync-n8n-workflows.sql`; `docs` `set X=` → `export X=`.
- [ ] `turbo.json` globalEnv; delete `apps/web/package-lock.json`. ✔ `npm ci && npm run build` from root passes.
- [ ] `.env.example` + `docs/ENVIRONMENT.md` rewritten per 4.10; `scripts/env-contract.test.mjs` green.

### P2 — Voice layer (ElevenLabs)
- [ ] Migrations 0010 + 0011 → `db push`. ✔ `agents` has `elevenlabs_agent_id`, `provision_status`; `knowledge_chunks` gone; `select jobname from cron.job` shows `calls-reconcile-10m` (if `pg_cron` enable fails → Dashboard → Integrations → Cron → Enable → re-run).
- [ ] `seed.sql` rewrite → `psql -f`. ✔ `select config->'elevenlabs'->>'llm', length(config->>'system_prompt') from agent_templates` → `gpt-4o-mini`, > 300 chars each.
- [ ] `_shared/elevenlabs.ts`, `twilio.ts`, `conversations.ts`, `invoke.ts`, `webhook.ts` edits + Deno tests (`supabase/functions/tests/{webhook,conversations,elevenlabs_config,tool_definitions}_test.ts` with fixture `fixtures/post_call_transcription.json`). ✔ `npm run test:deno` green (HMAC known-answer vector, mapping cases, builder guard).
- [ ] `scripts/lib/tool-definitions.mjs`, `scripts/elevenlabs-setup.mjs`; run → `supabase secrets set …` from its output (incl. `ELEVENLABS_TOOL_IDS`, `ELEVENLABS_TOOL_SECRET`, `ELEVENLABS_WEBHOOK_SECRET`). ✔ ElevenLabs dashboard shows 3 tools + webhook (retries on, events transcript + call_initiation_failure).
- [ ] Confirm from a dashboard-created agent (`GET /v1/convai/agents/{id}`): `platform_settings.data_collection` path/shape, `built_in_tools` shape, `llm` string. Adjust `buildAgentConfig` if needed.
- [ ] Deploy `elevenlabs-webhook`, `calendar-availability`, `calendar-book`, `qualify-lead` (hardened per 4.4). ✔ `npm run smoke`: forged signed webhook → `calls` row; tools 401 (no header) / 404 (bogus agent) / 200 (real agent → stub row).
- [ ] `agent-provision`, `agent-sync`; deploy. ✔ curl with service bearer `{business_id, template_slug:"dexter", voice_id:"pNInz6obpgDQGcFmaJgB", include_calendar:true}` → 201; row `ready`, phone set; EL dashboard shows agent + assigned number; re-run → 200 `already_provisioned`. Negative: break `TWILIO_AUTH_TOKEN`, delete row, re-run → 4xx `PHONE_PROVISION_FAILED`, row `failed`; restore → resumes.
- [ ] Live call from your verified mobile; ask a question, request a booking. ✔ `calls` stub → completed; transcript + summary; `usage_records` one row; `recording_url` plays in `/dashboard/calls/[id]`; hang up before the agent speaks from a second verified number → `missed` + `sms_messages` row.
- [ ] `knowledge-ingest` rewrite + `knowledge-delete`; frontend `deleteKnowledgeDocument`; deploy. ✔ PDF upload → `ready` + `elevenlabs_document_id`; agent answers a PDF-only question; delete → gone from EL + agent.
- [ ] `calls-reconcile`; deploy. ✔ delete a `calls` row → manual POST → `imported: 1`; after 10 min `cron.job_run_details` succeeded; `net._http_response` latest → 200.
- [ ] Frontend/shared edits (Level 2 list); `npm run typecheck && npm run build`; push → Vercel. ✔ full onboarding ends with a live number on `/dashboard/agents`; a wrong Twilio secret surfaces as an error on Hire.
- [ ] Cleanup: delete Retell/RAG functions + modules; `supabase functions delete retell-webhook retell-create-agent knowledge-search call-analyze`; `supabase secrets unset …` (4.10). ✔ `grep -ri retell` → only the 2026-05-30 migration; `supabase functions list` = 13.

### P3 — Billing
- [ ] `_shared/stripe.ts` + `stripe-webhook` per 4.7; `deno test` for `getPeriodEnd`, `mapStripePlan`, `mapStripeStatus`. Web routes: checkout (400 w/o business, `customer` reuse, `client_reference_id`, drop `*_PRICE_ID` fallbacks), portal (trial redirect), `billing.ts` defaults/guard, `billing/page.tsx` plan-aware links. Pin `stripe@18.5.0` + basil both runtimes. ✔ `/dashboard/billing` → Upgrade to Pro → Checkout shows "$199 one time" + "$249/month" → `4242…` → row `plan=pro, status=active, stripe_customer_id, current_period_end`; Stripe endpoint deliveries all 200; `stripe trigger invoice.paid` → 200.
- [ ] `docs/DEPLOYMENT.md` Stripe events list = handled events.

### P4 — Calendar
- [ ] `_shared/calendar.ts`: Google only (delete Calendly/Cal.com), `getGoogleAccessToken` refresh (`invalid_grant` → `is_active=false` + `CALENDAR_DISCONNECTED`), `generateDefaultSlots(request, business)` honouring `hours`/`timezone` (fallback Mon–Fri 9–17), overlap filter vs `appointments`, 409 on double-book; secrets `GOOGLE_CLIENT_ID/SECRET`. Frontend: remove Calendly/Cal.com from settings; `api/integrations/connect` `onConflict`; OAuth callback keeps existing refresh token. ✔ `deno test` slots/overlap; `UPDATE integrations SET token_expires_at = now()` → next availability call writes a new token; book by voice → `appointments` row + Google event; same slot again → agent says taken.

### P5 — n8n
- [ ] Router rewrite `call-completed.json` (rename file), sub-workflow fixes (4.8), delete `sms-follow-up.json`; `deploy-n8n-workflows.mjs` (URL substitution, credential preservation, derived paths); `n8n-dispatch` adds `integrations`; `_shared/n8n.ts`/`crm.ts` changes; admin panel → server action; delete `api/admin/sync-n8n/route.ts`, `packages/shared/src/config/n8n.ts`; `scripts/n8n-workflows.test.mjs`. ✔ `npm run deploy:n8n` → 4 workflows active, smoke 200s; bind credentials once in n8n UI; deactivate old SMS workflow; `sync-n8n-workflows` → `synced: 4`; `n8n-dispatch test.ping` → execution with 0 items; connect Google Sheets (`sheet_id`, tab `Calls`) → real call → new row; `/admin` shows 4 active workflows.

### P6 — Tests, CI, docs
- [ ] `.github/workflows/ci.yml`: job `web` (node 22, `npm ci`, lint, typecheck, `test:node`), job `edge` (`denoland/setup-deno@v2`, `deno check supabase/functions/*/index.ts`, `test:deno`). ✔ PR shows both green.
- [ ] `docs/SMOKE_TEST.md` rewritten = the runbook below; `README.md`/`DEPLOYMENT.md` updated (ElevenLabs, no Retell/pgvector/OpenRouter, Railway not "n8n Cloud", Next 16, macOS commands).

### P7 — Lead engine (scraping → outbound)
- [ ] **P7a validate first (no code, ~$5):** run existing `AI_agent` pipeline for HVAC × 3–4 cities (`DATAFORSEO_LOCATION` swap) → CSV of ~15 leads → provision `sdr` agent under a platform business row → ElevenLabs dashboard **Batch calling** CSV upload (requires upgraded Twilio: trial cannot dial unverified numbers) → listen to recordings, count demo bookings. ✔ decision: conversion good enough to automate?
- [ ] Migration 0020 `leads`; `exporter.py --supabase` upsert (`requests`, service role from `.env`, never commit); `main.py` flag passthrough; pytest for payload shaping. ✔ `select count(*) from leads` after a run; re-run doesn't duplicate (`on_conflict=phone`).
- [ ] `lead-call-batch` (edge fn or Node script) per 4.11; `elevenlabs-webhook` outbound branch → `leads`. ✔ 3-lead batch → `queued` → conversations → statuses updated; `dnc` never re-queued.
- [ ] Scheduler: `.github/workflows/scrape.yml` in `AIreceptionist` (weekly cron, matrix of niche×city, secrets `DATAFORSEO_*`, `SUPABASE_*`) → upsert. ✔ manual `workflow_dispatch` run inserts rows; budget guard: stop when DataForSEO balance < $10 (check via `/v3/appendix/user_data`).

---

## Verification — end-to-end runbook (becomes `docs/SMOKE_TEST.md`)
Cost: Twilio number ~$1.15/mo + upgrade top-up; ElevenLabs Creator $22/mo (LLM + Twilio minutes extra); Stripe test mode free; Vercel Hobby free; Supabase/Railway already running.

1. **Schema** — `npm run db:push`; `supabase migration list --linked` local = remote; `psql … -f supabase/seed.sql` → 5 templates (`sdr` is a P7 item and is not seeded).
2. **Secrets** — fill `supabase/.env.local` → `npm run secrets:set`; `supabase secrets list` shows every name in 4.10.
3. **Functions** — `npm run deploy:functions`; `supabase functions list` = 13; `curl -i …/stripe-webhook` 405; `curl -i …/n8n-dispatch` 401; with anon bearer 403; `curl -X POST …/elevenlabs-webhook -d '{}'` → 401 invalid signature.
4. **ElevenLabs** — `node scripts/elevenlabs-setup.mjs` → tools + webhook present, retries on.
5. **Vercel** — deploy; build log installs from root lockfile and resolves `@businessvoice/shared`; set `NEXT_PUBLIC_APP_URL`; Supabase Auth Site URL.
6. **Signup → onboarding → hire** — `subscriptions` `trialing` immediately; knowledge `ready`; Google Calendar connected (`refresh_token` not null); Hire → `/dashboard/agents` shows the number.
7. **Inbound call** (verified phone) — within ~60 s: call listed, transcript + summary, `usage_records` 1 row, billing used minutes = `ceil(duration/60)`, recording plays.
8. **Booking by voice** — `appointments` `confirmed` with Google event id; event visible in Google Calendar; same slot again → taken.
9. **Missed-call SMS** — `node scripts/smoke-elevenlabs.mjs --fixture missed-call` (signed, duration 0, your verified number) → SMS arrives, `sms_messages` row. Document: calls abandoned before ElevenLabs answers produce no webhook.
10. **Stripe** — Upgrade to Pro → test card → `pro/active`; endpoint deliveries 200; `stripe trigger invoice.paid` → 200.
11. **n8n** — `npm run deploy:n8n`; credentials bound; `sync-n8n-workflows` → 4; real call → router execution routes 1 item to `sheets-log` → sheet row.
12. **Reconcile** — set `ELEVENLABS_WEBHOOK_SECRET=wrong`, short call → no row; restore; `curl -X POST …/calls-reconcile -H "Authorization: Bearer $SERVICE_ROLE"` → `imported: 1`; second run changes nothing.
13. **Security matrix** — user JWT cannot select `integrations.access_token`; cannot list another business's storage prefix; tools without header → 401; anon bearer on private fns → 403.
14. **Lead engine (P7)** — scrape run inserts `leads`; batch call → statuses; DNC honoured.

---

## Risks / unknowns → resolution
| Risk | Resolution |
|---|---|
| ElevenLabs HMAC construction (`t.rawBody`, hex, 30 min) from custom-channel docs, not the post-call page | Known-answer Deno test + log raw header on first real 401; fallback `npm:@elevenlabs/elevenlabs-js` `webhooks.constructEvent` |
| `platform_settings.data_collection` / `built_in_tools` / `llm` exact JSON | Create one agent in dashboard, `GET /agents/{id}`, copy shape (P2 task) |
| `metadata.phone_call` absent from some webhook payloads | `caller_number` fallback chain; `provider_metadata` keeps raw slice |
| `termination_reason` free text → `transferred` regex | Collect distinct values for a week; adjust pure mapper |
| PATCH agent merge semantics undocumented | `agent-sync` always sends full config |
| Unrendered `{{vars}}` break calls | Builder guard + test |
| Twilio trial (one number, verified destinations, template SMS; 30-day expiry) and A2P 10DLC lead time | Reuse-owned-number path; upgrade before demos/outbound; SMS best-effort until 10DLC approved |
| Stripe API version drift | Pin endpoint `api_version` to SDK version; `getPeriodEnd` handles both shapes; new-subscription reset makes `invoice.paid` ordering irrelevant |
| Google OAuth Testing mode: refresh tokens expire in 7 days; verification takes weeks | Weekly reconnect in dev; submit for verification before customers |
| `pg_cron` extension privilege on `db push` | Isolated migration; enable via Dashboard → Integrations → Cron |
| Deno edge runtime `npm:`/multipart | Already exercised (`npm:stripe`, `npm:fflate`); plain `fetch` + `FormData` |
| Recording storage growth (~1 MB/min), 1-year signed URLs | Acceptable for pilot; retention later; never subscribe to `audio` webhook |
| `--prune` deletes any remote fn missing locally | Prefer explicit `supabase functions delete`; never prune from a partial branch |
| Vercel monorepo root | Root Directory `apps/web` + delete nested lockfile; fallback root dir with workspace build command |
| n8n import quirks (Sheets resourceLocator, HubSpot `vid` vs `id`, credentials reset) | Import → open in UI → confirm → re-export; deploy script preserves credential bindings |
| ElevenLabs concurrency (Creator 10 / Pro 20) shared across tenants; LLM + Twilio pass-through cost | Pricing note; upgrade plan as tenants grow |
| Outbound cold-calling compliance (TCPA/state rules) | B2B lines only, AI disclosure first sentence, calling hours, DNC list, ≤2 attempts — baked into `sdr` template + `lead-call-batch` |
| One agent per (business, template); `toggleAgent`/row deletion orphan EL agent + number | No UI path today; backlog: `agent-sync` unassigns on `is_active=false` |

---

## Handoff notes (Cursor)
- Work on `feat/elevenlabs-backend` in `nrashid7/sigyn`; one PR per phase (P1…P6), P7 spans both repos.
- Follow existing patterns: `Deno.serve`, `jsonResponse`/`errorResponse`/`AppError`, `createServiceClient`, `parseJsonBody`, `requireEnv`; type hints; one-purpose modules; no Retell naming left.
- Never commit secrets: `supabase/.env.local`, `.env.local`, seed of Vault SQL stay local. `.gitignore` already covers `.env*.local`.
- Commit subjects: one plain human-readable line, no AI attribution.
- Order matters: P1 migrations before P2 deploys (`record_call_minutes` RPC is called by the webhook); run `supabase functions delete` for Retell functions only after `elevenlabs-webhook` is live.
