import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  AppError,
  createServiceClient,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from "../_shared/errors.ts";
import { chatCompletionJson } from "../_shared/ai.ts";
import { captureCallEvent } from "../_shared/analytics.ts";
import { assertServiceRole } from "../_shared/auth.ts";

interface AnalyzeRequest {
  call_id: string;
}

interface AnalysisResult {
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  outcome: string;
  lead_score: number;
  extracted_entities: {
    customer_name?: string;
    customer_phone?: string;
    customer_email?: string;
    intent?: string;
    topics?: string[];
    appointment_requested?: boolean;
    [key: string]: unknown;
  };
}

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
    const { call_id } = await parseJsonBody<AnalyzeRequest>(req);
    if (!call_id) {
      throw new AppError("call_id is required", 400);
    }

    const supabase = createServiceClient();

    const { data: call, error: callError } = await supabase
      .from("calls")
      .select("*, call_transcripts(*)")
      .eq("id", call_id)
      .single();

    if (callError || !call) {
      throw new AppError("Call not found", 404);
    }

    const transcriptRow = Array.isArray(call.call_transcripts)
      ? call.call_transcripts[0]
      : call.call_transcripts;

    const transcript = transcriptRow?.transcript ?? [];
    if (!Array.isArray(transcript) || transcript.length === 0) {
      return jsonResponse({ call_id, skipped: true, reason: "no_transcript" });
    }

    const transcriptText = transcript
      .map((t: { role: string; content: string }) => `${t.role}: ${t.content}`)
      .join("\n");

    const { data: analysis, model } = await chatCompletionJson<AnalysisResult>({
      messages: [
        {
          role: "system",
          content: `You are a call analysis assistant. Analyze the phone call transcript and return JSON with:
- summary: 2-3 sentence summary
- sentiment: positive, neutral, or negative
- outcome: one of answered, booked, qualified_lead, transferred, voicemail, missed, other
- lead_score: 0-100 integer based on lead quality
- extracted_entities: object with customer_name, customer_phone, customer_email, intent, topics (array), appointment_requested (boolean), and any other relevant fields`,
        },
        { role: "user", content: transcriptText },
      ],
      temperature: 0.2,
      maxTokens: 1500,
    });

    const outcomeMap: Record<string, string> = {
      answered: "answered",
      booked: "booked",
      qualified_lead: "qualified_lead",
      transferred: "transferred",
      voicemail: "voicemail",
      missed: "missed",
    };

    const outcome = outcomeMap[analysis.outcome] ?? "other";

    await supabase.from("calls").update({
      sentiment: analysis.sentiment,
      outcome,
      lead_score: analysis.lead_score,
      qualification_data: analysis.extracted_entities,
    }).eq("id", call_id);

    await supabase.from("call_transcripts").upsert({
      call_id,
      transcript,
      summary: analysis.summary,
      extracted_entities: analysis.extracted_entities,
    }, { onConflict: "call_id" });

    await captureCallEvent(call.business_id, call_id, "call_analyzed", {
      sentiment: analysis.sentiment,
      outcome,
      lead_score: analysis.lead_score,
      model,
    });

    return jsonResponse({ call_id, analysis, model });
  } catch (error) {
    return errorResponse(error);
  }
});
