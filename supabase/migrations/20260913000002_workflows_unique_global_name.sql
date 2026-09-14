DELETE FROM workflows w USING workflows w2
WHERE w.business_id IS NULL AND w2.business_id IS NULL AND w.name = w2.name
  AND (w.created_at, w.id) > (w2.created_at, w2.id);
CREATE UNIQUE INDEX IF NOT EXISTS workflows_global_name_key ON workflows (name) WHERE business_id IS NULL;
