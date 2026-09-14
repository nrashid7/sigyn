# Deploying the backend from GitHub Actions

**⚠️ Read before running any stage against `wtrqpnzacuaroxluxwfa`.** On 2026-09-14 the live project was found to be under a *separate, concurrent* ElevenLabs migration by another developer (schema uses `runtime_provider`, `provider_agent_id`, `agent_deployments`, `voice_*` tables; 19 recorded migrations vs the 10 in this repo). Running `db_push`, `seed` or `deploy_functions` against it would collide with that work. **Do not run those stages against the live project until the schema is reconciled with nrashid7.** For any test deployment, create a fresh Supabase project and point `SUPABASE_PROJECT_REF`, `SUPABASE_URL` and `SUPABASE_DB_URL` at it.

The **Deploy backend** workflow (`.github/workflows/deploy-backend.yml`) runs
the same stages as `docs/DEPLOY_FROM_CURSOR.md`, but on a GitHub Actions
runner instead of a developer's laptop. No API key or secret is ever stored
on a developer machine: every value lives in the repo's GitHub Actions
Secrets/Variables and the Supabase secrets store, and the workflow only ever
reads a secret through `${{ secrets.* }}` inside a step's `env:`.

Prefer this over `docs/DEPLOY_FROM_CURSOR.md` unless you can run the CLI on a
machine you trust with production keys.

## 1. One-time account setup (personal browser)

Do these once. Each item becomes a GitHub Secret or Variable in step 2.

- **Supabase access token** — dashboard → Account → Access Tokens → generate.
- **Supabase session-pooler DB URL** — Project → Connect → "Session pooler",
  with the database password filled in. Use the pooler URL, not the direct
  connection string (see Troubleshooting).
- **Supabase legacy `service_role` key** — Project → Settings → API → the
  legacy JWT. The newer `sb_secret_…` keys do not pass `verify_jwt` and
  cannot be used here.
- **Supabase project ref and URL** — same Settings → API page.
- **ElevenLabs API key** — ElevenLabs dashboard → Profile → API keys.
- **ElevenLabs post-call webhook** — ElevenLabs dashboard → Settings →
  Webhooks → create `sigyn-post-call` with URL
  `<SUPABASE_URL>/functions/v1/elevenlabs-webhook` and HMAC auth. Copy the
  secret shown once — ElevenLabs never shows it again.
- **ElevenLabs tool secret** — generate any 64-character hex string, e.g.
  `openssl rand -hex 32`.
- **Twilio** — create an account, verify your mobile number as a caller ID
  (required on a trial account), and copy the Account SID, Auth Token, and
  the trial phone number. A trial account can only call/text verified
  numbers, holds one number, and sends Twilio-templated SMS only; upgrade
  (add a payment method) before demoing to real numbers.
- **Stripe (test mode)** — create three products: Starter $99/mo, Pro
  $249/mo, Setup Fee $199 one-time, and note their price ids. Create a
  webhook endpoint at `<SUPABASE_URL>/functions/v1/stripe-webhook` for the
  events `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`,
  with the API version pinned to `2025-08-27.basil`, and copy its signing
  secret.
- **Vercel** — import the fork with Root Directory `apps/web`, and set the
  "Vercel (apps/web)" variables from `.env.example` in the Vercel project
  settings. Vercel deploys the frontend separately from this workflow.

## 2. GitHub Secrets and Variables

Repo → Settings → Secrets and variables → Actions. Names must match exactly
— the workflow reads them by name.

### Secrets

| Name | Required | Used by |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | yes | every step (Supabase CLI auth) |
| `SUPABASE_DB_URL` | unless you skip `db_push`, `seed` and `vault` | Apply migrations, Seed agent templates, Create Vault secrets |
| `SUPABASE_SERVICE_ROLE_KEY` | unless you skip `vault` and `smoke` | Create Vault secrets, Smoke test |
| `ELEVENLABS_API_KEY` | unless you skip `secrets` and `elevenlabs_setup` | Push edge-function secrets, Register ElevenLabs tools |
| `ELEVENLABS_TOOL_SECRET` | unless you skip `secrets`, `elevenlabs_setup` and `smoke` | Push edge-function secrets, Register ElevenLabs tools, Smoke test |
| `ELEVENLABS_WEBHOOK_SECRET` | unless you skip `secrets`, `elevenlabs_setup` and `smoke` | Push edge-function secrets, Register ElevenLabs tools, Smoke test |
| `TWILIO_ACCOUNT_SID` | optional | Push edge-function secrets |
| `TWILIO_AUTH_TOKEN` | optional | Push edge-function secrets |
| `TWILIO_PHONE_NUMBER` | optional | Push edge-function secrets |
| `STRIPE_SECRET_KEY` | optional | Push edge-function secrets |
| `STRIPE_WEBHOOK_SECRET` | optional | Push edge-function secrets |
| `STRIPE_PRICE_STARTER` | optional | Push edge-function secrets |
| `STRIPE_PRICE_PRO` | optional | Push edge-function secrets |
| `GOOGLE_CLIENT_ID` | optional | Push edge-function secrets |
| `GOOGLE_CLIENT_SECRET` | optional | Push edge-function secrets |
| `N8N_WEBHOOK_SECRET` | optional | Push edge-function secrets |
| `POSTHOG_API_KEY` | optional | Push edge-function secrets |

Optional secrets can be left unset — "Push edge-function secrets" only
forwards names that have a non-empty value.

### Variables

| Name | Required | Used by |
|---|---|---|
| `SUPABASE_PROJECT_REF` | yes | every `--project-ref` flag |
| `SUPABASE_URL` | yes | job `env`, Gateway checks, ElevenLabs setup |
| `N8N_WEBHOOK_BASE_URL` | optional | Push edge-function secrets |

## 3. Running the workflow

Actions → **Deploy backend** → Run workflow.

**First run**: leave every input at its default (all `true` except
`delete_legacy` and `smoke`). Expected observables, in step order:

| Stage | Observe |
|---|---|
| Apply migrations | seven migrations applied: `20260913000001`, `…000002`, `…000003`, `…000004`, `…000010`, `…000011`, `…000020` |
| Seed agent templates | 6 rows printed |
| Create Vault secrets | `project_url` and `service_role_key` listed (names only) |
| Push edge-function secrets | the names you configured, listed by `supabase secrets list` — values are never printed |
| Register ElevenLabs tools and webhook settings | a summary table with 3 tools + the webhook, and `$RUNNER_TEMP/elevenlabs.env` written and pushed |
| Deploy edge functions | 13 functions listed |
| Gateway checks | `stripe-webhook` 405, `n8n-dispatch` 401, `elevenlabs-webhook` 401 |

**Second run**: only `delete_legacy` — removes the four legacy (pre-
ElevenLabs) functions and their secrets. Safe to re-run: functions or
secrets that are already gone are skipped, not treated as failures.

**Third run (optional)**: only `smoke`, with `agent_id` set once you've
hired an agent through the app, to exercise the full write path.

## 4. Troubleshooting

| Symptom | Check |
|---|---|
| Migration or seed step can't connect, or times out | Use the **session pooler** URL from Project → Connect for `SUPABASE_DB_URL`, not the direct connection string — GitHub Actions runners have no IPv6 egress, which the direct connection string requires |
| Apply migrations fails on `pg_cron` | Enable the Cron integration in the Supabase dashboard (Integrations → Cron), then re-run with only `db_push` |
| "Register ElevenLabs tools and webhook settings" exits 1 naming `ELEVENLABS_TOOL_SECRET` and/or `ELEVENLABS_WEBHOOK_SECRET` | CI mode never mints or prints either — the message says which is missing and how to obtain it; add it as a GitHub Secret and re-run |
| Same step exits 1 saying the webhook was not found | CI mode never creates `sigyn-post-call` — create it by hand in the ElevenLabs dashboard first (step 1), then re-run |
| Twilio-related failures in "Push edge-function secrets" or later calls | Trial accounts can only call/text verified numbers and hold one number; verify your number or upgrade the account |
