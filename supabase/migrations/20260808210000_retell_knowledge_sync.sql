-- One native Retell knowledge base per business with service-managed source state.
DO $$ BEGIN
  CREATE TYPE retell_sync_status AS ENUM ('pending', 'syncing', 'ready', 'failed', 'deleting');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.business_knowledge_bases (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  business_id uuid NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  retell_knowledge_base_id text UNIQUE,
  status retell_sync_status NOT NULL DEFAULT 'pending',
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS retell_source_id text,
  ADD COLUMN IF NOT EXISTS retell_status retell_sync_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS retell_last_error text,
  ADD COLUMN IF NOT EXISTS retell_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS retell_deleted_at timestamptz;

ALTER TABLE public.business_sources
  ADD COLUMN IF NOT EXISTS retell_source_id text,
  ADD COLUMN IF NOT EXISTS retell_status retell_sync_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS retell_last_error text,
  ADD COLUMN IF NOT EXISTS retell_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS retell_deleted_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_documents_retell_source
  ON public.knowledge_documents(business_id, retell_source_id)
  WHERE retell_source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_sources_retell_source
  ON public.business_sources(business_id, retell_source_id)
  WHERE retell_source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_retell_status
  ON public.knowledge_documents(business_id, retell_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_business_sources_retell_status
  ON public.business_sources(business_id, retell_status, updated_at);

ALTER TABLE public.business_knowledge_bases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_knowledge_bases_tenant_select ON public.business_knowledge_bases;
CREATE POLICY business_knowledge_bases_tenant_select
  ON public.business_knowledge_bases FOR SELECT TO authenticated
  USING (public.is_business_member(business_id) OR public.is_admin());

REVOKE ALL ON public.business_knowledge_bases FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.business_knowledge_bases TO authenticated;
GRANT ALL ON public.business_knowledge_bases TO service_role;

REVOKE UPDATE ON public.knowledge_documents FROM authenticated;
GRANT UPDATE (filename, file_type, storage_path, status, chunk_count, error_message, updated_at)
  ON public.knowledge_documents TO authenticated;
REVOKE UPDATE ON public.business_sources FROM authenticated;
GRANT UPDATE (type, url, external_id, status, metadata, last_synced_at, error_message, updated_at)
  ON public.business_sources TO authenticated;

GRANT ALL ON public.knowledge_documents, public.business_sources TO service_role;

DROP TRIGGER IF EXISTS business_knowledge_bases_updated_at ON public.business_knowledge_bases;
CREATE TRIGGER business_knowledge_bases_updated_at
  BEFORE UPDATE ON public.business_knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
