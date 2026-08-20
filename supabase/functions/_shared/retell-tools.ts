export interface RetellCustomTool {
  type: "custom" | "transfer_call" | "end_call";
  name: string;
  description: string;
  url?: string;
  speak_during_execution?: boolean;
  speak_after_execution?: boolean;
  parameters?: Record<string, unknown>;
  transfer_destination?: { type: "predefined"; number: string };
}

function customTool(
  name: string,
  description: string,
  url: string,
  properties: Record<string, unknown>,
  required: string[],
): RetellCustomTool {
  return {
    type: "custom",
    name,
    description,
    url,
    speak_during_execution: true,
    speak_after_execution: true,
    parameters: { type: "object", additionalProperties: false, properties, required },
  };
}

export function buildCustomToolsConfig(
  supabaseUrl: string,
  _businessId: string,
  options: { includeCalendar?: boolean; transferNumber?: string } = {},
): RetellCustomTool[] {
  const base = `${supabaseUrl}/functions/v1`;
  const tools: RetellCustomTool[] = [customTool(
    "qualify_lead",
    "Record the current caller's qualification answers and score.",
    `${base}/qualify-lead`,
    {
      name: { type: "string" }, email: { type: "string" }, company: { type: "string" },
      need: { type: "string" }, timeline: { type: "string" }, budget: { type: "string" },
      lead_score: { type: "number", minimum: 0, maximum: 100 },
    },
    ["name", "lead_score"],
  )];
  tools.push({
    type: "end_call",
    name: "end_call",
    description: "End the call after the caller says goodbye, declines further help, or the conversation is complete.",
  });

  if (options.includeCalendar) {
    tools.push(
      customTool("check_availability", "Check real calendar availability for a date range.", `${base}/calendar-availability`, {
        start_date: { type: "string", description: "ISO date start" },
        end_date: { type: "string", description: "ISO date end" },
        duration_minutes: { type: "number", minimum: 15, maximum: 240 },
      }, ["start_date"]),
      customTool("book_appointment", "Book a confirmed appointment for the current caller.", `${base}/calendar-book`, {
        scheduled_at: { type: "string", description: "ISO datetime" },
        customer_name: { type: "string" }, customer_phone: { type: "string" },
        customer_email: { type: "string" }, duration_minutes: { type: "number" }, notes: { type: "string" },
      }, ["scheduled_at", "customer_name", "customer_phone"]),
    );
  }
  if (options.transferNumber) tools.push({
    type: "transfer_call",
    name: "transfer_call",
    description: "Transfer to a human for emergencies, escalation, or an explicit request.",
    transfer_destination: { type: "predefined", number: options.transferNumber },
  });
  return tools;
}
