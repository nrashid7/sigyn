-- Consolidate overlapping agent policies and cover production-foundation foreign keys.
DROP POLICY IF EXISTS agents_tenant_insert_draft ON public.agents;
DROP POLICY IF EXISTS agents_tenant_pause ON public.agents;
DROP POLICY IF EXISTS agents_admin_all ON public.agents;

CREATE POLICY agents_insert_managed ON public.agents FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_business_member(business_id)
      AND is_active = false
      AND lifecycle_status = 'draft'
      AND retell_agent_id IS NULL
      AND retell_llm_id IS NULL
      AND phone_number IS NULL
      AND retell_knowledge_base_id IS NULL
    )
  );

CREATE POLICY agents_update_managed ON public.agents FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.is_business_member(business_id))
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_business_member(business_id)
      AND is_active = false
      AND lifecycle_status IN ('draft', 'paused')
    )
  );

CREATE INDEX IF NOT EXISTS idx_agent_deployments_business ON public.agent_deployments(business_id);
CREATE INDEX IF NOT EXISTS idx_agent_deployments_created_by ON public.agent_deployments(created_by);
CREATE INDEX IF NOT EXISTS idx_business_facts_source ON public.business_facts(source_id);
CREATE INDEX IF NOT EXISTS idx_business_facts_reviewed_by ON public.business_facts(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_businesses_provisioning_waived_by ON public.businesses(provisioning_waived_by);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_business ON public.ingestion_jobs(business_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_source ON public.ingestion_jobs(source_id);
CREATE INDEX IF NOT EXISTS idx_integration_credentials_business ON public.integration_credentials(business_id);
