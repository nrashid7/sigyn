import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AgentRow } from "./conversations.ts";
import { sendSms } from "./sms.ts";

const MISSED_CALL_MESSAGE =
  "Hi! We noticed we missed your call. Reply here or call us back — we'd love to help!";

/**
 * Texts a caller back after a missed call. Reused by the webhook's `post_call_transcription`
 * and `call_initiation_failure` handling, and by the reconcile backfill. Callers decide
 * *whether* to send (see `shouldSendMissedCallSms`); this just sends. Propagates errors from
 * `sendSms` so the caller's own try/catch logs them alongside the other per-call side effects.
 */
export async function sendMissedCallSms(
  supabase: SupabaseClient,
  agent: AgentRow,
  callId: string,
  callerNumber: string,
): Promise<void> {
  await sendSms(supabase, {
    businessId: agent.business_id,
    callId,
    to: callerNumber,
    from: agent.phone_number ?? undefined,
    body: MISSED_CALL_MESSAGE,
  });
}
