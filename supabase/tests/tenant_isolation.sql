BEGIN;
SET LOCAL search_path = public, extensions;
SELECT extensions.plan(5);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'tenant-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('20000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'tenant-b@example.test', '', now(), '{}', '{}', now(), now());
INSERT INTO public.profiles (id, email, full_name, role) VALUES
  ('10000000-0000-4000-8000-000000000001', 'tenant-a@example.test', 'Tenant A', 'business_owner'),
  ('20000000-0000-4000-8000-000000000002', 'tenant-b@example.test', 'Tenant B', 'business_owner')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.create_business_for_current_user('Tenant A', 'https://a.example', 'general_smb', '+16125550101', 'America/Chicago', '{}');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.create_business_for_current_user('Tenant B', 'https://b.example', 'general_smb', '+16125550102', 'America/Chicago', '{}');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT extensions.is((SELECT count(*)::integer FROM public.businesses), 1, 'tenant sees only its business');
SELECT extensions.is((SELECT count(*)::integer FROM public.business_members), 1, 'tenant sees only its membership');
SELECT extensions.is((SELECT count(*)::integer FROM public.business_facts), 0, 'tenant cannot see another tenant facts');
SELECT extensions.throws_ok(
  $$INSERT INTO public.business_members (business_id, user_id, role)
    VALUES ('00000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000001', 'business_owner')$$,
  '42501', NULL, 'users cannot join an arbitrary business'
);
UPDATE public.businesses SET name = 'Compromised' WHERE name = 'Tenant B';
SELECT extensions.is((SELECT count(*)::integer FROM public.businesses WHERE name = 'Compromised'), 0,
  'cross-tenant business updates affect no visible rows');
RESET ROLE;

SELECT * FROM extensions.finish();
ROLLBACK;
