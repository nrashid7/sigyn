import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AppError,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../_shared/errors.ts";
import { assertServiceRole } from "../_shared/auth.ts";

interface VoicePreviewRequest {
  voice_id: string;
  text?: string;
  model_id?: string;
}

const DEFAULT_PREVIEW_TEXT =
  "Hi, thanks for calling! I'm your AI receptionist. How can I help you today?";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    assertServiceRole(req);
    const { voice_id, text, model_id } = await parseJsonBody<VoicePreviewRequest>(req);

    if (!voice_id) {
      throw new AppError("voice_id is required", 400);
    }

    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      throw new AppError("Missing ELEVENLABS_API_KEY", 500, "CONFIG_ERROR");
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: text ?? DEFAULT_PREVIEW_TEXT,
          model_id: model_id ?? "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new AppError(`ElevenLabs TTS failed: ${errText}`, response.status, "TTS_ERROR");
    }

    const audioBytes = await response.arrayBuffer();

    return new Response(audioBytes, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
});
