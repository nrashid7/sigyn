-- BusinessVoice AI - Initial Schema
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- Enums
CREATE TYPE user_role AS ENUM ('admin', 'business_owner');
CREATE TYPE industry_type AS ENUM ('general_smb', 'salon_spa', 'home_services');
CREATE TYPE agent_type AS ENUM ('inbound', 'outbound', 'dispatcher', 'collections');
CREATE TYPE document_status AS ENUM ('pending', 'processing', 'ready', 'failed');
CREATE TYPE call_status AS ENUM ('ringing', 'in_progress', 'completed', 'no_answer', 'failed', 'transferred');
CREATE TYPE call_outcome AS ENUM ('answered', 'booked', 'qualified_lead', 'transferred', 'voicemail', 'missed', 'other');
CREATE TYPE integration_provider AS ENUM ('google_calendar', 'calendly', 'cal_com', 'hubspot', 'gohighlevel', 'google_sheets');
CREATE TYPE subscription_plan AS ENUM ('starter', 'pro', 'enterprise');
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled');
CREATE TYPE appointment_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed');
CREATE TYPE sms_direction AS ENUM ('inbound', 'outbound');

-- Profiles (extends auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  role user_role NOT NULL DEFAULT 'business_owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Businesses
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  website TEXT,
  industry industry_type NOT NULL DEFAULT 'general_smb',
  phone TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  hours JSONB NOT NULL DEFAULT '{}',
  onboarding_step INT NOT NULL DEFAULT 1,
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  white_label_config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Business members
CREATE TABLE business_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'business_owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, user_id)
);

-- Agent templates
CREATE TABLE agent_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  industry industry_type NOT NULL,
  config JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agents (hired instances)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES agent_templates(id),
  name TEXT NOT NULL,
  type agent_type NOT NULL DEFAULT 'inbound',
  retell_agent_id TEXT,
  retell_llm_id TEXT,
  phone_number TEXT,
  voice_provider TEXT NOT NULL DEFAULT 'retell',
  voice_id TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  hired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Knowledge documents
CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  status document_status NOT NULL DEFAULT 'pending',
  chunk_count INT NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Knowledge chunks with pgvector
CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Call preferences
CREATE TABLE call_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  transfer_number TEXT,
  emergency_number TEXT,
  voicemail_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  voicemail_message TEXT,
  escalation_after_seconds INT DEFAULT 120,
  after_hours_message TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Calls
CREATE TABLE calls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  retell_call_id TEXT NOT NULL UNIQUE,
  caller_number TEXT,
  duration_seconds INT NOT NULL DEFAULT 0,
  status call_status NOT NULL DEFAULT 'ringing',
  outcome call_outcome,
  sentiment TEXT,
  lead_score INT,
  recording_url TEXT,
  qualification_data JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Call transcripts
CREATE TABLE call_transcripts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE UNIQUE,
  transcript JSONB NOT NULL DEFAULT '[]',
  summary TEXT,
  extracted_entities JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Appointments
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 30,
  status appointment_status NOT NULL DEFAULT 'pending',
  external_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Integrations
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  provider integration_provider NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id, provider)
);

-- Subscriptions
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  plan subscription_plan NOT NULL DEFAULT 'starter',
  status subscription_status NOT NULL DEFAULT 'trialing',
  included_minutes INT NOT NULL DEFAULT 200,
  used_minutes INT NOT NULL DEFAULT 0,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Usage records
CREATE TABLE usage_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'call_minutes',
  quantity INT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workflows (n8n)
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  n8n_workflow_id TEXT,
  webhook_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SMS messages
CREATE TABLE sms_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  call_id UUID REFERENCES calls(id) ON DELETE SET NULL,
  to_number TEXT NOT NULL,
  from_number TEXT NOT NULL,
  body TEXT NOT NULL,
  direction sms_direction NOT NULL DEFAULT 'outbound',
  status TEXT NOT NULL DEFAULT 'pending',
  twilio_sid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_business_members_user ON business_members(user_id);
CREATE INDEX idx_business_members_business ON business_members(business_id);
CREATE INDEX idx_agents_business ON agents(business_id);
CREATE INDEX idx_agents_retell ON agents(retell_agent_id);
CREATE INDEX idx_calls_business_created ON calls(business_id, created_at DESC);
CREATE INDEX idx_calls_retell ON calls(retell_call_id);
CREATE INDEX idx_knowledge_docs_business ON knowledge_documents(business_id);
CREATE INDEX idx_knowledge_chunks_business ON knowledge_chunks(business_id);
CREATE INDEX idx_knowledge_chunks_document ON knowledge_chunks(document_id);
CREATE INDEX idx_integrations_business_provider ON integrations(business_id, provider);
CREATE INDEX idx_appointments_business ON appointments(business_id, scheduled_at);
CREATE INDEX idx_usage_records_business ON usage_records(business_id, recorded_at);

-- HNSW index for vector similarity search
CREATE INDEX idx_knowledge_chunks_embedding ON knowledge_chunks
  USING hnsw (embedding vector_cosine_ops);

-- Helper: check business membership
CREATE OR REPLACE FUNCTION is_business_member(bid UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_members
    WHERE business_id = bid AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE EXECUTE ON FUNCTION is_business_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_business_member(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION handle_new_user() FROM PUBLIC;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER businesses_updated_at BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER knowledge_documents_updated_at BEFORE UPDATE ON knowledge_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER calls_updated_at BEFORE UPDATE ON calls FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER call_preferences_updated_at BEFORE UPDATE ON call_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER integrations_updated_at BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY profiles_select ON profiles FOR SELECT USING (id = (select auth.uid()) OR is_admin());
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (id = (select auth.uid()));

-- Agent templates (public read for active)
CREATE POLICY agent_templates_select ON agent_templates FOR SELECT USING (is_active = TRUE OR is_admin());
CREATE POLICY agent_templates_admin_insert ON agent_templates FOR INSERT WITH CHECK (is_admin());
CREATE POLICY agent_templates_admin_update ON agent_templates FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY agent_templates_admin_delete ON agent_templates FOR DELETE USING (is_admin());

-- Businesses
CREATE POLICY businesses_select ON businesses FOR SELECT USING (is_business_member(id) OR is_admin());
CREATE POLICY businesses_insert ON businesses FOR INSERT WITH CHECK ((select auth.uid()) IS NOT NULL);
CREATE POLICY businesses_update ON businesses FOR UPDATE USING (is_business_member(id) OR is_admin());

-- Business members
CREATE POLICY business_members_select ON business_members FOR SELECT USING (user_id = (select auth.uid()) OR is_business_member(business_id) OR is_admin());
CREATE POLICY business_members_insert ON business_members FOR INSERT WITH CHECK (user_id = (select auth.uid()) OR is_admin());

-- Tenant-scoped tables
CREATE POLICY agents_all ON agents FOR ALL USING (is_business_member(business_id) OR is_admin());
CREATE POLICY knowledge_documents_all ON knowledge_documents FOR ALL USING (is_business_member(business_id) OR is_admin());
CREATE POLICY knowledge_chunks_select ON knowledge_chunks FOR SELECT USING (is_business_member(business_id) OR is_admin());
CREATE POLICY call_preferences_all ON call_preferences FOR ALL USING (is_business_member(business_id) OR is_admin());
CREATE POLICY calls_select ON calls FOR SELECT USING (is_business_member(business_id) OR is_admin());
CREATE POLICY call_transcripts_select ON call_transcripts FOR SELECT USING (
  EXISTS (SELECT 1 FROM calls c WHERE c.id = call_id AND (is_business_member(c.business_id) OR is_admin()))
);
CREATE POLICY appointments_all ON appointments FOR ALL USING (is_business_member(business_id) OR is_admin());
CREATE POLICY integrations_all ON integrations FOR ALL USING (is_business_member(business_id) OR is_admin());
CREATE POLICY subscriptions_select ON subscriptions FOR SELECT USING (is_business_member(business_id) OR is_admin());
CREATE POLICY usage_records_select ON usage_records FOR SELECT USING (is_business_member(business_id) OR is_admin());
CREATE POLICY workflows_select ON workflows FOR SELECT USING (business_id IS NULL OR is_business_member(business_id) OR is_admin());
CREATE POLICY sms_messages_select ON sms_messages FOR SELECT USING (is_business_member(business_id) OR is_admin());

-- Storage bucket for knowledge documents
INSERT INTO storage.buckets (id, name, public) VALUES ('knowledge', 'knowledge', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY knowledge_storage_select ON storage.objects FOR SELECT
  USING (bucket_id = 'knowledge' AND auth.uid() IS NOT NULL);
CREATE POLICY knowledge_storage_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'knowledge' AND auth.uid() IS NOT NULL);
CREATE POLICY knowledge_storage_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'knowledge' AND auth.uid() IS NOT NULL);

-- Similarity search function
CREATE OR REPLACE FUNCTION match_knowledge_chunks(
  query_embedding vector(1536),
  match_business_id UUID,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    kc.id,
    kc.content,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks kc
  WHERE kc.business_id = match_business_id
    AND kc.embedding IS NOT NULL
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$$;
