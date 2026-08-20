ALTER FUNCTION public.is_business_member(uuid) SET search_path = public;
ALTER FUNCTION public.is_admin() SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.update_updated_at() SET search_path = public;
ALTER FUNCTION public.match_knowledge_chunks(vector, uuid, integer) SET search_path = public;
