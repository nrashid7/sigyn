-- Repair the distributed rate-limit function on databases that received the
-- original controlled-beta migration before its SQL expressions were fixed.
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
