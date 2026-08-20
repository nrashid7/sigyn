-- Production launch foundation: tenancy, ingestion, managed deployments, and auditability.
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'google_business_profile';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'facebook';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'instagram';
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'twilio';

DO $$ BEGIN
  CREATE TYPE source_type AS ENUM ('website', 'google_place', 'social_profile', 'document', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE ingestion_status AS ENUM ('queued', 'running', 'needs_review', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE fact_review_status AS ENUM ('proposed', 'approved', 'rejected', 'stale');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE agent_lifecycle_status AS ENUM ('draft', 'ingesting', 'needs_review', 'testing', 'ready', 'live', 'paused', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_members_one_business_per_user
  ON public.business_members(user_id);

DROP POLICY IF EXISTS businesses_insert ON public.businesses;
DROP POLICY IF EXISTS business_members_insert ON public.business_members;

CREATE OR REPLACE FUNCTION public.create_business_for_current_user(
  business_name text,
  business_website text,
  business_industry industry_type,
  business_phone text,
  business_timezone text,
  business_hours jsonb
)
RETURNS public.businesses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  created_business public.businesses;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_members WHERE user_id = current_user_id) THEN
    RAISE EXCEPTION 'User already belongs to a business' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.businesses (
    name, website, industry, phone, timezone, hours, onboarding_step, onboarding_complete
  ) VALUES (
    business_name, NULLIF(business_website, ''), business_industry, business_phone,
    business_timezone, business_hours, 2, false
  ) RETURNING * INTO created_business;

  INSERT INTO public.business_members (business_id, user_id, role)
  VALUES (created_business.id, current_user_id, 'business_owner');

  RETURN created_business;
END;
$$;
REVOKE ALL ON FUNCTION public.create_business_for_current_user(text, text, industry_type, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business_for_current_user(text, text, industry_type, text, text, jsonb) TO authenticated;

DROP POLICY IF EXISTS businesses_update ON public.businesses;
CREATE POLICY businesses_update ON public.businesses FOR UPDATE TO authenticated
  USING (public.is_business_member(id) OR public.is_admin())
  WITH CHECK (public.is_business_member(id) OR public.is_admin());

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS lifecycle_status agent_lifecycle_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS retell_knowledge_base_id text,
  ADD COLUMN IF NOT EXISTS deployment_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_tested_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.agents ALTER COLUMN is_active SET DEFAULT false;

DROP POLICY IF EXISTS agents_all ON public.agents;
CREATE POLICY agents_tenant_select ON public.agents FOR SELECT TO authenticated
  USING (public.is_business_member(business_id) OR public.is_admin());
CREATE POLICY agents_tenant_insert_draft ON public.agents FOR INSERT TO authenticated
  WITH CHECK (
    public.is_business_member(business_id)
    AND is_active = false
    AND lifecycle_status = 'draft'
    AND retell_agent_id IS NULL AND retell_llm_id IS NULL
    AND phone_number IS NULL AND retell_knowledge_base_id IS NULL
  );
CREATE POLICY agents_tenant_pause ON public.agents FOR UPDATE TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (
    public.is_business_member(business_id)
    AND is_active = false
    AND lifecycle_status IN ('draft', 'paused')
  );
CREATE POLICY agents_admin_all ON public.agents FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS knowledge_documents_all ON public.knowledge_documents;
CREATE POLICY knowledge_documents_all ON public.knowledge_documents FOR ALL TO authenticated
  USING (public.is_business_member(business_id) OR public.is_admin())
  WITH CHECK (public.is_business_member(business_id) OR public.is_admin());
DROP POLICY IF EXISTS call_preferences_all ON public.call_preferences;
CREATE POLICY call_preferences_all ON public.call_preferences FOR ALL TO authenticated
  USING (public.is_business_member(business_id) OR public.is_admin())
  WITH CHECK (public.is_business_member(business_id) OR public.is_admin());
DROP POLICY IF EXISTS appointments_all ON public.appointments;
CREATE POLICY appointments_all ON public.appointments FOR ALL TO authenticated
  USING (public.is_business_member(business_id) OR public.is_admin())
  WITH CHECK (public.is_business_member(business_id) OR public.is_admin());
DROP POLICY IF EXISTS integrations_all ON public.integrations;
CREATE POLICY integrations_all ON public.integrations FOR ALL TO authenticated
  USING (public.is_business_member(business_id) OR public.is_admin())
  WITH CHECK (public.is_business_member(business_id) OR public.is_admin());

REVOKE UPDATE ON public.businesses FROM authenticated;
GRANT UPDATE (name, website, industry, phone, timezone, hours, onboarding_step,
  onboarding_complete, white_label_config, updated_at) ON public.businesses TO authenticated;
REVOKE INSERT, UPDATE ON public.agents FROM authenticated;
GRANT INSERT (business_id, template_id, name, type, voice_provider, voice_id, config,
  is_active, lifecycle_status) ON public.agents TO authenticated;
GRANT UPDATE (name, config, is_active, lifecycle_status, updated_at) ON public.agents TO authenticated;
REVOKE SELECT, INSERT, UPDATE ON public.integrations FROM authenticated;
GRANT SELECT (id, business_id, provider, config, is_active, created_at, updated_at)
  ON public.integrations TO authenticated;

DROP POLICY IF EXISTS knowledge_storage_select ON storage.objects;
DROP POLICY IF EXISTS knowledge_storage_insert ON storage.objects;
DROP POLICY IF EXISTS knowledge_storage_update ON storage.objects;
DROP POLICY IF EXISTS knowledge_storage_delete ON storage.objects;
CREATE POLICY knowledge_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'knowledge'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND public.is_business_member(((storage.foldername(name))[1])::uuid)
    AND lower(storage.extension(name)) = ANY (ARRAY['pdf','doc','docx','txt','md'])
    AND coalesce(metadata->>'mimetype', '') = ANY (ARRAY[
      'application/pdf','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain','text/markdown'
    ])
    AND coalesce((metadata->>'size')::bigint, 0) BETWEEN 1 AND 10485760
  );
CREATE POLICY knowledge_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'knowledge'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND public.is_business_member(((storage.foldername(name))[1])::uuid)
    AND lower(storage.extension(name)) = ANY (ARRAY['pdf','doc','docx','txt','md'])
    AND coalesce(metadata->>'mimetype', '') = ANY (ARRAY[
      'application/pdf','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain','text/markdown'
    ])
    AND coalesce((metadata->>'size')::bigint, 0) BETWEEN 1 AND 10485760
  );
CREATE POLICY knowledge_storage_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'knowledge'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND public.is_business_member(((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'knowledge'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND public.is_business_member(((storage.foldername(name))[1])::uuid)
    AND lower(storage.extension(name)) = ANY (ARRAY['pdf','doc','docx','txt','md'])
    AND coalesce(metadata->>'mimetype', '') = ANY (ARRAY[
      'application/pdf','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain','text/markdown'
    ])
    AND coalesce((metadata->>'size')::bigint, 0) BETWEEN 1 AND 10485760
  );
CREATE POLICY knowledge_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'knowledge'
    AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND public.is_business_member(((storage.foldername(name))[1])::uuid)
  );

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS lifecycle_status agent_lifecycle_status NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS retell_knowledge_base_id text,
  ADD COLUMN IF NOT EXISTS deployment_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_tested_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.agents ALTER COLUMN is_active SET DEFAULT false;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS retention_expires_at timestamptz DEFAULT (now() + interval '90 days');
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS provisioning_waived_at timestamptz,
  ADD COLUMN IF NOT EXISTS provisioning_waived_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provisioning_waiver_reason text;

UPDATE public.agent_templates
SET config = jsonb_set(
  jsonb_set(
    jsonb_set(config, '{template_version}', '1'::jsonb, true),
    '{catalog_slug}', to_jsonb(CASE slug
      WHEN 'dexter' THEN 'general-receptionist'
      WHEN 'zia' THEN 'appointment-booking'
      WHEN 'sparky' THEN 'home-services-dispatcher'
      WHEN 'bella' THEN 'lead-qualification'
      ELSE slug END), true
  ),
  '{retell_llm_config,temperature}', '0.2'::jsonb, true
)
WHERE slug IN ('dexter', 'zia', 'sparky', 'bella');
UPDATE public.agent_templates SET is_active = false WHERE slug = 'sunny';

CREATE TABLE IF NOT EXISTS public.business_sources (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  type source_type NOT NULL,
  url text,
  external_id text,
  status ingestion_status NOT NULL DEFAULT 'queued',
  metadata jsonb NOT NULL DEFAULT '{}',
  last_synced_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, type, url)
);

CREATE TABLE IF NOT EXISTS public.ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.business_sources(id) ON DELETE CASCADE,
  status ingestion_status NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 10),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.business_facts (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.business_sources(id) ON DELETE SET NULL,
  category text NOT NULL,
  fact_key text NOT NULL,
  value jsonb NOT NULL,
  source_url text,
  confidence numeric(4,3) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  review_status fact_review_status NOT NULL DEFAULT 'proposed',
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_deployments (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  template_version integer NOT NULL DEFAULT 1,
  deployment_version integer NOT NULL,
  lifecycle_status agent_lifecycle_status NOT NULL DEFAULT 'draft',
  retell_agent_id text,
  retell_llm_id text,
  retell_knowledge_base_id text,
  prompt_snapshot text,
  knowledge_snapshot text,
  test_result jsonb NOT NULL DEFAULT '{}',
  activated_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, deployment_version)
);

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.integration_credentials (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE UNIQUE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  access_token_encrypted text,
  refresh_token_encrypted text,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  refresh_status text NOT NULL DEFAULT 'valid' CHECK (refresh_status IN ('valid', 'refreshing', 'expired', 'revoked', 'failed')),
  last_refreshed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.demo_requests (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  agent_template_slug text NOT NULL,
  phone_hash text NOT NULL,
  ip_hash text NOT NULL,
  consented_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'calling', 'completed', 'blocked', 'failed')),
  retell_call_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_sources_business ON public.business_sources(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON public.ingestion_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_business_facts_review ON public.business_facts(business_id, review_status, category);
CREATE INDEX IF NOT EXISTS idx_agent_deployments_agent ON public.agent_deployments(agent_id, deployment_version DESC);
CREATE INDEX IF NOT EXISTS idx_demo_requests_phone_created ON public.demo_requests(phone_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_retention ON public.calls(retention_expires_at);

ALTER TABLE public.business_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_sources_tenant ON public.business_sources FOR ALL TO authenticated
  USING (public.is_business_member(business_id) OR public.is_admin())
  WITH CHECK (public.is_business_member(business_id) OR public.is_admin());
CREATE POLICY ingestion_jobs_tenant ON public.ingestion_jobs FOR SELECT TO authenticated
  USING (public.is_business_member(business_id) OR public.is_admin());
CREATE POLICY business_facts_tenant_select ON public.business_facts FOR SELECT TO authenticated
  USING (public.is_business_member(business_id) OR public.is_admin());
CREATE POLICY business_facts_admin_update ON public.business_facts FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY agent_deployments_tenant_select ON public.agent_deployments FOR SELECT TO authenticated
  USING (public.is_business_member(business_id) OR public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_sources TO authenticated;
GRANT SELECT ON public.ingestion_jobs, public.business_facts, public.agent_deployments TO authenticated;
GRANT UPDATE ON public.business_facts TO authenticated;
GRANT ALL ON public.business_sources, public.ingestion_jobs, public.business_facts,
  public.agent_deployments, public.webhook_events, public.integration_credentials,
  public.demo_requests TO service_role;

CREATE TRIGGER business_sources_updated_at BEFORE UPDATE ON public.business_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER ingestion_jobs_updated_at BEFORE UPDATE ON public.ingestion_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER business_facts_updated_at BEFORE UPDATE ON public.business_facts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER integration_credentials_updated_at BEFORE UPDATE ON public.integration_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
