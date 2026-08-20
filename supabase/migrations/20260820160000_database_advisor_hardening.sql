-- Resolve actionable Supabase database advisor findings before beta launch.
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION vector SET SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_agents_template_id
  ON public.agents(template_id);
CREATE INDEX IF NOT EXISTS idx_appointments_agent_id
  ON public.appointments(agent_id);
CREATE INDEX IF NOT EXISTS idx_appointments_call_id
  ON public.appointments(call_id);
CREATE INDEX IF NOT EXISTS idx_beta_invitations_created_by
  ON public.beta_invitations(created_by);
CREATE INDEX IF NOT EXISTS idx_calls_agent_id
  ON public.calls(agent_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_business_id
  ON public.sms_messages(business_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_call_id
  ON public.sms_messages(call_id);
CREATE INDEX IF NOT EXISTS idx_system_controls_updated_by
  ON public.system_controls(updated_by);
CREATE INDEX IF NOT EXISTS idx_usage_records_call_id
  ON public.usage_records(call_id);
CREATE INDEX IF NOT EXISTS idx_workflows_business_id
  ON public.workflows(business_id);
