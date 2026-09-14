-- Leads sourced by the external lead-scraping pipeline (DataForSEO Google
-- Maps + Reviews), destined for the outbound "sdr" agent's call queue.
-- Writes are service-role only: the scraper and the call pipeline own this
-- table end to end; members/anon only ever read it through the app.

CREATE TYPE lead_status AS ENUM ('new', 'queued', 'called', 'booked', 'not_interested', 'dnc', 'invalid');

CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT NOT NULL UNIQUE,
  business_name TEXT NOT NULL,
  website TEXT,
  niche TEXT NOT NULL,
  city TEXT NOT NULL,
  rating NUMERIC(2,1), -- 0.0-9.9, fine for Google's 0-5 star ratings
  review_count INT,
  pain_signals JSONB NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'dataforseo',
  source_run_id TEXT,
  status lead_status NOT NULL DEFAULT 'new',
  last_called_at TIMESTAMPTZ,
  call_count INT NOT NULL DEFAULT 0,
  last_conversation_id TEXT,
  demo_booked_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_status_city ON leads(status, city);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY leads_admin ON leads FOR ALL USING (is_admin());

-- Writes are service-role only (scraper + call pipeline) — no client role
-- ever inserts/updates/deletes a lead directly.
REVOKE INSERT, UPDATE, DELETE ON public.leads FROM anon, authenticated;

CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at();
