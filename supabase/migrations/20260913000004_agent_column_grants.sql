-- Column/table grants for the two tables whose provider ids a member must never set.
-- RLS already scopes both tables to the member's business; these grants narrow *what*
-- a member may write inside their own business, which RLS alone cannot express.

-- agents: every write is service-role (agent-provision / agent-sync / webhooks); members only read.
REVOKE INSERT, UPDATE, DELETE ON public.agents FROM anon, authenticated;

-- knowledge_documents: members may only create the initial row from the upload action;
-- status / elevenlabs_document_id / deletes are owned by knowledge-ingest and knowledge-delete.
REVOKE INSERT, UPDATE, DELETE ON public.knowledge_documents FROM anon, authenticated;
GRANT INSERT (business_id, filename, file_type, storage_path, status) ON public.knowledge_documents TO authenticated;
