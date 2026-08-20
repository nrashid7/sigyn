import { NextResponse } from "next/server";
import { getSupabaseServiceRoleKey } from "@/lib/supabase/admin";
import { enforceRateLimit, requestIp } from "@/lib/server/production-service";

export async function POST(request: Request) {
  try {
    await enforceRateLimit("voice_preview", requestIp(request));
    const body = await request.json();
    const { voice_id, text } = body as { voice_id?: string; text?: string };

    if (!voice_id) {
      return NextResponse.json({ error: "voice_id required" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = getSupabaseServiceRoleKey();

    const response = await fetch(`${supabaseUrl}/functions/v1/voice-preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        voice_id,
        text: text ?? "Hi! I'm your Sigyn AI voice agent. How can I help you today?",
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return NextResponse.json(err, { status: response.status });
    }

    const audioBuffer = await response.arrayBuffer();
    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error("Voice preview error:", error);
    const rateLimited = error instanceof Error && error.message.includes("Too many requests");
    return NextResponse.json({ error: rateLimited ? "Voice preview limit reached" : "Preview failed" }, { status: rateLimited ? 429 : 500 });
  }
}
