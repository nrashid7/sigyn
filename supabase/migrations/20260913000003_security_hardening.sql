-- Storage: tenant-scoped by path prefix "<business_id>/..." (uploads use `${business.id}/${Date.now()}-${name}`)
DROP POLICY IF EXISTS knowledge_storage_select ON storage.objects;
DROP POLICY IF EXISTS knowledge_storage_insert ON storage.objects;
DROP POLICY IF EXISTS knowledge_storage_delete ON storage.objects;
CREATE POLICY knowledge_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'knowledge' AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    AND (public.is_business_member(((storage.foldername(name))[1])::uuid) OR public.is_admin()));
CREATE POLICY knowledge_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'knowledge' AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    AND (public.is_business_member(((storage.foldername(name))[1])::uuid) OR public.is_admin()));
CREATE POLICY knowledge_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'knowledge' AND (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    AND (public.is_business_member(((storage.foldername(name))[1])::uuid) OR public.is_admin()));

-- Integrations: hide OAuth tokens from members via column-level grants
REVOKE SELECT ON TABLE public.integrations FROM anon, authenticated;
GRANT SELECT (id, business_id, provider, config, token_expires_at, is_active, created_at, updated_at)
  ON public.integrations TO authenticated;
