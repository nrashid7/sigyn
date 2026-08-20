-- Controlled beta access, operational kill switches, distributed rate limits, and retention.
CREATE TABLE IF NOT EXISTS public.system_controls (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  signup_enabled boolean NOT NULL DEFAULT true,
  agent_provisioning_enabled boolean NOT NULL DEFAULT true,
  billing_enabled boolean NOT NULL DEFAULT true,
  automation_dispatch_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
INSERT INTO public.system_controls (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.beta_invitations (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  code_hash text NOT NULL UNIQUE CHECK (length(code_hash) = 64),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid,
  revoked_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_beta_invitations_email_available
  ON public.beta_invitations (lower(email), expires_at DESC)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.rate_limit_windows (
  bucket text NOT NULL,
  key_hash text NOT NULL CHECK (length(key_hash) = 64),
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (bucket, key_hash, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_windows_expiry ON public.rate_limit_windows(expires_at);

ALTER TABLE public.system_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beta_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_controls, public.beta_invitations, public.rate_limit_windows FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.system_controls, public.beta_invitations, public.rate_limit_windows TO service_role;

CREATE OR REPLACE FUNCTION public.hook_restrict_beta_signup(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  signup_email text := lower(btrim(event->'user'->>'email'));
  signup_user_id uuid := (event->'user'->>'id')::uuid;
  invitation_id uuid;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('controlled-beta-signup', 0));
  IF NOT EXISTS (SELECT 1 FROM public.system_controls WHERE id AND signup_enabled) THEN
    RETURN jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'New beta signups are temporarily paused'));
  END IF;
  IF (SELECT count(*) FROM public.beta_invitations WHERE consumed_at IS NOT NULL) >= 10 THEN
    RETURN jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'The controlled beta is full'));
  END IF;
  SELECT id INTO invitation_id FROM public.beta_invitations
    WHERE lower(email) = signup_email AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF invitation_id IS NULL THEN
    RETURN jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'A valid beta invitation is required'));
  END IF;
  UPDATE public.beta_invitations SET consumed_at = now(), consumed_by = signup_user_id WHERE id = invitation_id;
  RETURN '{}'::jsonb;
END;
$$;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.hook_restrict_beta_signup(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.hook_restrict_beta_signup(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_beta_invitation(p_email text, p_code_hash text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.beta_invitations
    WHERE lower(email) = lower(btrim(p_email))
      AND code_hash = p_code_hash
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
  ) AND EXISTS (SELECT 1 FROM public.system_controls WHERE id AND signup_enabled)
$$;
REVOKE EXECUTE ON FUNCTION public.validate_beta_invitation(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_beta_invitation(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_system_controls()
RETURNS TABLE (
  signup_enabled boolean,
  agent_provisioning_enabled boolean,
  billing_enabled boolean,
  automation_dispatch_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT signup_enabled, agent_provisioning_enabled, billing_enabled, automation_dispatch_enabled
  FROM public.system_controls WHERE id
$$;
REVOKE EXECUTE ON FUNCTION public.get_system_controls() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_controls() TO service_role;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_bucket text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS TABLE (allowed boolean, remaining integer, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_window timestamptz;
  current_count integer;
BEGIN
  IF p_bucket = '' OR length(p_key_hash) <> 64 OR p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit request';
  END IF;
  current_window := pg_catalog.to_timestamp(
    pg_catalog.floor(EXTRACT(epoch FROM pg_catalog.now()) / p_window_seconds) * p_window_seconds
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_bucket || ':' || p_key_hash, 0));
  INSERT INTO public.rate_limit_windows (bucket, key_hash, window_start, request_count, expires_at)
  VALUES (p_bucket, p_key_hash, current_window, 1, current_window + pg_catalog.make_interval(secs => p_window_seconds))
  ON CONFLICT (bucket, key_hash, window_start) DO UPDATE
    SET request_count = public.rate_limit_windows.request_count + 1
  RETURNING request_count INTO current_count;
  RETURN QUERY SELECT
    current_count <= p_limit,
    GREATEST(p_limit - current_count, 0),
    GREATEST(pg_catalog.ceil(EXTRACT(epoch FROM ((current_window + pg_catalog.make_interval(secs => p_window_seconds)) - pg_catalog.now())))::integer, 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_expired_records()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  calls_deleted integer;
  events_deleted integer;
  limits_deleted integer;
BEGIN
  DELETE FROM public.calls WHERE retention_expires_at IS NOT NULL AND retention_expires_at < now();
  GET DIAGNOSTICS calls_deleted = ROW_COUNT;
  DELETE FROM public.webhook_events WHERE created_at < now() - interval '30 days' AND status = 'completed';
  GET DIAGNOSTICS events_deleted = ROW_COUNT;
  DELETE FROM public.rate_limit_windows WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS limits_deleted = ROW_COUNT;
  DELETE FROM public.demo_requests WHERE created_at < now() - interval '30 days';
  RETURN jsonb_build_object('calls_deleted', calls_deleted, 'events_deleted', events_deleted, 'rate_limits_deleted', limits_deleted);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_expired_records() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_records() TO service_role;
