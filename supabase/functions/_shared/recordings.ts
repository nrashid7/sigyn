import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AgentRow } from "./conversations.ts";
import { getConversationAudio } from "./elevenlabs.ts";

/** Signed playback URLs are valid for a year; the dashboard re-signs lazily after that. */
const SIGNED_URL_TTL_SECONDS = 31_536_000;

/**
 * Fetches a conversation's recording from ElevenLabs, stores it in the private `recordings`
 * bucket at `<business_id>/<conversation_id>.mp3`, and points the call row's `recording_url`
 * at a long-lived signed URL. Never throws — logs and returns null on any failure, since a
 * missing recording should not block the rest of a webhook or reconcile run.
 */
export async function storeRecording(
  supabase: SupabaseClient,
  agent: AgentRow,
  conversationId: string,
): Promise<string | null> {
  try {
    const audio = await getConversationAudio(conversationId);
    const path = `${agent.business_id}/${conversationId}.mp3`;

    const { error: uploadError } = await supabase.storage
      .from("recordings")
      .upload(path, await audio.arrayBuffer(), {
        contentType: "audio/mpeg",
        upsert: true,
      });
    if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

    const { data: signed, error: signError } = await supabase.storage
      .from("recordings")
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed) {
      throw new Error(`sign failed: ${signError?.message ?? "no data returned"}`);
    }

    const { error: updateError } = await supabase
      .from("calls")
      .update({ recording_url: signed.signedUrl })
      .eq("elevenlabs_conversation_id", conversationId);
    if (updateError) throw new Error(`update failed: ${updateError.message}`);

    return signed.signedUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[recordings] Failed to store recording for ${conversationId}: ${message}`);
    return null;
  }
}
