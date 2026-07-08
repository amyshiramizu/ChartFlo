
REVOKE EXECUTE ON FUNCTION public.is_clinic_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_clinic_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
