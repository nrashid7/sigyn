BEGIN;
SET LOCAL search_path = public, extensions;
SELECT extensions.plan(4);

INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('31000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'kb-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('32000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'kb-b@example.test', '', now(), '{}', '{}', now(), now());
INSERT INTO public.profiles (id, email, full_name, role) VALUES
  ('31000000-0000-4000-8000-000000000001', 'kb-a@example.test', 'KB Tenant A', 'business_owner'),
  ('32000000-0000-4000-8000-000000000002', 'kb-b@example.test', 'KB Tenant B', 'business_owner')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.create_business_for_current_user('KB Tenant A', 'https://kb-a.example', 'general_smb', '+16125550111', 'America/Chicago', '{}');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.create_business_for_current_user('KB Tenant B', 'https://kb-b.example', 'general_smb', '+16125550112', 'America/Chicago', '{}');
RESET ROLE;

INSERT INTO public.business_knowledge_bases (business_id, retell_knowledge_base_id, status)
SELECT id, 'kb_' || replace(name, ' ', '_'), 'ready' FROM public.businesses WHERE name LIKE 'KB Tenant%';

SELECT set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.business_knowledge_bases),
  1,
  'tenant sees only its Retell knowledge base'
);
SELECT extensions.throws_ok(
  $$UPDATE public.business_knowledge_bases SET retell_knowledge_base_id = 'kb_compromised'$$,
  '42501', NULL, 'tenant cannot update provider knowledge base state'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.business_knowledge_bases (business_id) SELECT id FROM public.businesses LIMIT 1$$,
  '42501', NULL, 'tenant cannot create provider ownership rows'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.business_knowledge_bases WHERE retell_knowledge_base_id LIKE '%Tenant_B%'),
  0,
  'tenant cannot observe another provider identifier'
);
RESET ROLE;

SELECT * FROM extensions.finish();
ROLLBACK;
