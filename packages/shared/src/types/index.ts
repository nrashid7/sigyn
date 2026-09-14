export type UserRole = "admin" | "business_owner";

export type Industry =
  | "general_smb"
  | "salon_spa"
  | "home_services";

export type AgentType =
  | "inbound"
  | "outbound"
  | "dispatcher"
  | "collections";

export type DocumentStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed";

export type CallStatus =
  | "ringing"
  | "in_progress"
  | "completed"
  | "no_answer"
  | "failed"
  | "transferred";

export type CallOutcome =
  | "answered"
  | "booked"
  | "qualified_lead"
  | "transferred"
  | "voicemail"
  | "missed"
  | "other";

export type IntegrationProvider =
  | "google_calendar"
  | "calendly"
  | "cal_com"
  | "hubspot"
  | "gohighlevel"
  | "google_sheets";

export type SubscriptionPlan = "starter" | "pro" | "enterprise";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export interface AgentTemplateDisplay {
  avatar: string;
  specialty: string;
  industries: string[];
  description: string;
  features: string[];
  tagline: string;
}

export interface AgentTemplateVoice {
  elevenlabs_voice_id: string;
}

export interface AgentTemplateConfig {
  industry: Industry;
  agent_name: string;
  display: AgentTemplateDisplay;
  voice: AgentTemplateVoice;
  system_prompt: string;
  first_message?: string;
  objection_handlers: Array<{ trigger: string; response: string }>;
  booking_rules: string[];
  escalation_rules: Array<{ condition: string; action: string }>;
  faq_rules: string[];
  qualification_questions: string[];
  elevenlabs: {
    llm: string;
    temperature: number;
    data_collection?: Record<
      string,
      { type: "string" | "boolean" | "integer" | "number"; description: string }
    >;
  };
  locale?: string;
}

export interface BusinessHours {
  [day: string]: { open: string; close: string; closed?: boolean };
}

export interface CallPreferences {
  transfer_number?: string;
  emergency_number?: string;
  voicemail_enabled: boolean;
  voicemail_message?: string;
  escalation_after_seconds?: number;
  after_hours_message?: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
}

export interface Business {
  id: string;
  name: string;
  website: string | null;
  industry: Industry;
  phone: string | null;
  timezone: string;
  hours: BusinessHours;
  onboarding_step: number;
  onboarding_complete: boolean;
  created_at: string;
}

export interface Agent {
  id: string;
  business_id: string;
  template_id: string;
  name: string;
  type: AgentType;
  elevenlabs_agent_id: string | null;
  elevenlabs_phone_number_id: string | null;
  twilio_phone_sid: string | null;
  phone_number: string | null;
  voice_provider: "elevenlabs";
  voice_id: string | null;
  config: Record<string, unknown>;
  is_active: boolean;
  provision_status: "provisioning" | "ready" | "failed";
  provision_error: string | null;
  hired_at: string;
}

export interface Call {
  id: string;
  business_id: string;
  agent_id: string | null;
  elevenlabs_conversation_id: string;
  caller_number: string | null;
  duration_seconds: number;
  status: CallStatus;
  outcome: CallOutcome | null;
  sentiment: string | null;
  lead_score: number | null;
  recording_url: string | null;
  provider_metadata: Record<string, unknown>;
  /** Nullable column: a call the provider never reported a start time for has none. */
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface CallTranscript {
  id: string;
  call_id: string;
  transcript: Array<{ role: string; content: string; timestamp?: number }>;
  summary: string | null;
  extracted_entities: Record<string, unknown>;
  created_at: string;
}

export interface KnowledgeDocument {
  id: string;
  business_id: string;
  filename: string;
  file_type: string;
  storage_path: string;
  status: DocumentStatus;
  chunk_count: number;
  elevenlabs_document_id: string | null;
  error_message: string | null;
  created_at: string;
}

export interface Appointment {
  id: string;
  business_id: string;
  call_id: string | null;
  agent_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: "pending" | "confirmed" | "cancelled" | "completed";
  external_id: string | null;
  created_at: string;
}

export interface Integration {
  id: string;
  business_id: string;
  provider: IntegrationProvider;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface Subscription {
  id: string;
  business_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  included_minutes: number;
  used_minutes: number;
  current_period_end: string | null;
  created_at: string;
}

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

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  preview_url?: string;
  category: string;
  is_premium: boolean;
}
