BEGIN;
SET LOCAL search_path = public, extensions;
SELECT extensions.plan(8);

SELECT extensions.has_table('public', 'beta_invitations', 'beta invitations table exists');
SELECT extensions.has_table('public', 'system_controls', 'operational controls table exists');
SELECT extensions.has_table('public', 'rate_limit_windows', 'distributed rate limits table exists');
SELECT extensions.has_function('public', 'hook_restrict_beta_signup', ARRAY['jsonb'], 'signup auth hook exists');

SELECT extensions.is(
  public.hook_restrict_beta_signup(jsonb_build_object('user', jsonb_build_object(
    'id', '41000000-0000-4000-8000-000000000001', 'email', 'uninvited@example.test'
  )))->'error'->>'message',
  'A valid beta invitation is required',
  'uninvited signup is denied'
);

INSERT INTO public.beta_invitations (email, code_hash, expires_at)
VALUES ('invited@example.test', repeat('a', 64), now() + interval '1 day');
SELECT extensions.is(
  public.hook_restrict_beta_signup(jsonb_build_object('user', jsonb_build_object(
    'id', '42000000-0000-4000-8000-000000000002', 'email', 'invited@example.test'
  ))),
  '{}'::jsonb,
  'invited signup is allowed'
);
SELECT extensions.is(
  (SELECT consumed_by::text FROM public.beta_invitations WHERE email = 'invited@example.test'),
  '42000000-0000-4000-8000-000000000002',
  'invitation is consumed by the new auth user'
);

DO $$ BEGIN
  PERFORM * FROM public.consume_rate_limit('test', repeat('b', 64), 1, 60);
END $$;
SELECT extensions.is(
  (SELECT allowed FROM public.consume_rate_limit('test', repeat('b', 64), 1, 60)),
  false,
  'distributed rate limit rejects requests over the limit'
);

SELECT * FROM extensions.finish();
ROLLBACK;
