# Controlled-Beta Production Operations

Production is a dedicated environment. The existing hosted stack is staging. `main` must require the CI workflow and review; the `production` GitHub Environment must restrict deployment to tagged commits and designated operators.

## Release procedure

1. Rotate and store production credentials in the provider, GitHub Environment, Vercel, Supabase, and Railway secret stores. Never copy secrets into the repository or smoke evidence.
2. Confirm Supabase point-in-time recovery, MFA, spend alerts, Retell/Twilio limits, Stripe live mode, PostHog, and Sentry alert delivery.
3. Merge only with all CI jobs green, create an annotated `v*` tag, and push it. The release workflow promotes the same commit through staging and the protected production environment.
4. Perform the real inbound-call, SMS, HubSpot, GoHighLevel, Google Sheets, calendar, and refundable live-Stripe checks. Store only provider evidence identifiers in `PRODUCTION_SMOKE_EVIDENCE_JSON`.
5. Re-run the tagged production job after evidence is present. `verify:production` must report zero failures, warnings, and skipped checks.
6. Run a 24-hour soak with synthetic health checks and no unresolved critical errors before issuing the first invitation. The beta is capped at ten consumed invitations.

Issue an invitation with `npm run create:beta-invite -- --email=owner@example.com`. Change a kill switch with, for example, `npm run set:production-controls -- --environment=production --automation-dispatch=off --confirm-production`.

## Alerts and ownership

- Page the launch operator for application 5xx errors over 1% for five minutes, three consecutive webhook failures, any n8n execution error, Retell knowledge synchronization stalled for five minutes, a missing call-completion event after ten minutes, Stripe webhook failures, or provider quota above 80%.
- Sentry owns application exceptions and release regression alerts. Vercel covers availability, Supabase covers database/auth/storage, Railway covers n8n, and provider dashboards cover Retell, Twilio, Stripe, HubSpot, GoHighLevel, Google Sheets, and PostHog.
- Correlate incidents using release SHA, business ID, agent ID, call ID, workflow ID, and provider event ID. Do not attach call content, credentials, authorization headers, or unnecessary PII.

## 15-minute rollback

1. Disable the affected control in `system_controls`: signup, agent provisioning, billing, or automation dispatch.
2. Use Vercel Instant Rollback to restore the previous tagged deployment.
3. Pause affected Retell agents and deactivate failing n8n workflows; preserve Retell knowledge bases and additive database records.
4. Confirm `/api/health`, inbound call handling, and unaffected workflows. Record the rollback start/end timestamps and release SHAs.
5. Cron configuration must be checked separately after a Vercel rollback because cron changes do not automatically roll back with the deployment.

## Data recovery and credential rotation

- Quarterly, restore the latest Supabase backup into a disposable project and verify tenant RLS, calls, subscriptions, integrations, and knowledge metadata. Record restore duration and row-count checks. Never test point-in-time recovery against production.
- Rotate service-role, Retell, Twilio, Stripe, n8n, OAuth, encryption, invitation, rate-limit, cron, PostHog, and Sentry credentials after exposure or operator departure. Deploy consumers before revoking the previous key where the provider supports overlapping credentials.
- The daily authenticated retention job removes expired call records, completed webhook history, expired rate-limit windows, and failed knowledge documents older than seven days.

## Provider outage behavior

- Retell unavailable: pause provisioning and publication; existing local sources remain intact and retryable.
- Twilio or n8n unavailable: disable automation dispatch and communicate that SMS/CRM follow-up is delayed.
- Stripe unavailable: disable billing changes without disabling active agents.
- Supabase unavailable: treat the application as unavailable; `/api/health` returns 503 and no provisioning or dispatch operation proceeds.
