export interface N8nDispatchPayload {
  event: string;
  business_id: string;
  call_id?: string;
  contact?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  call_summary?: string;
  transcript_url?: string;
  lead_score?: number;
  pipeline_stage?: string;
  metadata?: Record<string, unknown>;
}

export interface BuildCrmPayloadOptions {
  event: string;
  businessId: string;
  callId?: string;
  contact?: N8nDispatchPayload["contact"];
  callSummary?: string;
  transcriptUrl?: string;
  leadScore?: number;
  pipelineStage?: string;
  sentiment?: string;
  outcome?: string;
  extractedEntities?: Record<string, unknown>;
  appointmentId?: string;
  metadata?: Record<string, unknown>;
}

export function buildN8nDispatchPayload(
  options: BuildCrmPayloadOptions,
): N8nDispatchPayload {
  const metadata: Record<string, unknown> = {
    ...(options.extractedEntities ?? {}),
    ...(options.metadata ?? {}),
    dispatched_at: new Date().toISOString(),
  };

  if (options.sentiment) metadata.sentiment = options.sentiment;
  if (options.outcome) metadata.outcome = options.outcome;
  if (options.appointmentId) metadata.appointment_id = options.appointmentId;

  return {
    event: options.event,
    business_id: options.businessId,
    call_id: options.callId,
    contact: options.contact,
    call_summary: options.callSummary,
    transcript_url: options.transcriptUrl,
    lead_score: options.leadScore,
    pipeline_stage: options.pipelineStage ?? inferPipelineStage(options),
    metadata,
  };
}

function inferPipelineStage(options: BuildCrmPayloadOptions): string {
  if (options.outcome === "booked") return "appointment_booked";
  if (options.leadScore && options.leadScore >= 70) return "qualified_lead";
  if (options.outcome === "qualified_lead") return "qualified_lead";
  if (options.event === "call_completed") return "new_inquiry";
  return "new_inquiry";
}

export type CrmEventType =
  | "call_started"
  | "call_completed"
  | "call_analyzed"
  | "lead_qualified"
  | "appointment_booked"
  | "appointment_cancelled";
