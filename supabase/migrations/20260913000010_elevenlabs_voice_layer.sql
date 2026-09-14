CREATE TYPE agent_provision_status AS ENUM ('provisioning', 'ready', 'failed');

-- agents ---------------------------------------------------------------
ALTER TABLE agents RENAME COLUMN retell_agent_id TO elevenlabs_agent_id;
ALTER TABLE agents DROP COLUMN retell_llm_id;
ALTER TABLE agents
  ADD COLUMN elevenlabs_phone_number_id TEXT,
  ADD COLUMN twilio_phone_sid TEXT,
  ADD COLUMN provision_status agent_provision_status NOT NULL DEFAULT 'ready',
  ADD COLUMN provision_error TEXT;
ALTER TABLE agents ALTER COLUMN voice_provider SET DEFAULT 'elevenlabs';
UPDATE agents SET voice_provider = 'elevenlabs' WHERE voice_provider <> 'elevenlabs';
ALTER TABLE agents ADD CONSTRAINT agents_voice_provider_check CHECK (voice_provider = 'elevenlabs');
DROP INDEX IF EXISTS idx_agents_retell;
CREATE UNIQUE INDEX agents_elevenlabs_agent_id_key
  ON agents(elevenlabs_agent_id) WHERE elevenlabs_agent_id IS NOT NULL;
CREATE UNIQUE INDEX agents_business_template_key ON agents(business_id, template_id);

-- calls ----------------------------------------------------------------
ALTER TABLE calls RENAME COLUMN retell_call_id TO elevenlabs_conversation_id;
ALTER TABLE calls RENAME CONSTRAINT calls_retell_call_id_key TO calls_elevenlabs_conversation_id_key;
ALTER INDEX idx_calls_retell RENAME TO idx_calls_elevenlabs_conversation;
ALTER TABLE calls ADD COLUMN provider_metadata JSONB NOT NULL DEFAULT '{}';

-- knowledge_documents ----------------------------------------------------
ALTER TABLE knowledge_documents ADD COLUMN elevenlabs_document_id TEXT;
CREATE UNIQUE INDEX knowledge_documents_elevenlabs_document_id_key
  ON knowledge_documents(elevenlabs_document_id) WHERE elevenlabs_document_id IS NOT NULL;

-- pgvector RAG removal -----------------------------------------------------
DROP FUNCTION IF EXISTS match_knowledge_chunks(vector, uuid, int);
DROP TABLE IF EXISTS knowledge_chunks;
DROP EXTENSION IF EXISTS vector;

-- recordings bucket: service-role writes only, playback via signed URLs -----
INSERT INTO storage.buckets (id, name, public) VALUES ('recordings', 'recordings', false)
ON CONFLICT (id) DO NOTHING;
