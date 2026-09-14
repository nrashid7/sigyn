ALTER TABLE subscriptions ALTER COLUMN stripe_customer_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION handle_new_business() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO subscriptions (business_id, plan, status, included_minutes, used_minutes, current_period_end)
  VALUES (NEW.id, 'starter', 'trialing', 200, 0, NOW() + INTERVAL '14 days')
  ON CONFLICT (business_id) DO NOTHING;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_business_created AFTER INSERT ON businesses
  FOR EACH ROW EXECUTE FUNCTION handle_new_business();

INSERT INTO subscriptions (business_id, plan, status, included_minutes, used_minutes, current_period_end)
SELECT b.id, 'starter', 'trialing', 200, 0, NOW() + INTERVAL '14 days'
FROM businesses b WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.business_id = b.id);

DELETE FROM usage_records u USING usage_records u2
WHERE u.call_id IS NOT NULL AND u2.call_id IS NOT NULL
  AND u.call_id = u2.call_id AND u.type = u2.type
  AND (u.recorded_at, u.id) > (u2.recorded_at, u2.id);

CREATE UNIQUE INDEX IF NOT EXISTS usage_records_call_type_key
  ON usage_records (call_id, type) WHERE call_id IS NOT NULL;

CREATE OR REPLACE FUNCTION record_call_minutes(p_business_id UUID, p_call_id UUID, p_minutes INT)
RETURNS TABLE (inserted BOOLEAN, used_minutes INT, included_minutes INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inserted BOOLEAN := FALSE;
BEGIN
  INSERT INTO usage_records (business_id, call_id, type, quantity)
  VALUES (p_business_id, p_call_id, 'call_minutes', p_minutes)
  ON CONFLICT (call_id, type) WHERE call_id IS NOT NULL DO NOTHING;
  v_inserted := FOUND;
  IF v_inserted THEN
    UPDATE subscriptions SET used_minutes = subscriptions.used_minutes + p_minutes
    WHERE business_id = p_business_id;
  END IF;
  RETURN QUERY SELECT v_inserted, s.used_minutes, s.included_minutes
    FROM subscriptions s WHERE s.business_id = p_business_id;
END $$;
-- This REVOKE/GRANT pair is the ONLY authorization boundary for this SECURITY DEFINER function; never grant it to authenticated.
REVOKE EXECUTE ON FUNCTION record_call_minutes(UUID, UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_call_minutes(UUID, UUID, INT) TO service_role;
