REVOKE EXECUTE ON FUNCTION public.is_business_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_business_member(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
