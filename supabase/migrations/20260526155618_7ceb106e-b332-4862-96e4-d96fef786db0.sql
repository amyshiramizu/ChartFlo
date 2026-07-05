
-- Lock down SECURITY DEFINER helper functions: revoke from public/anon, keep authenticated for RLS
REVOKE EXECUTE ON FUNCTION public.is_clinic_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_clinic_admin(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_time_entry_enrollment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_pf_push_queue_clinic() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_profile() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

-- Restrict storage listing on the public clinic-logos bucket to clinic members only.
-- Individual logo files remain reachable via public URL (bucket is public); this only stops anonymous listing of all files.
DROP POLICY IF EXISTS "Clinic logos public read" ON storage.objects;

CREATE POLICY "Clinic members list clinic logos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'clinic-logos'
  AND is_clinic_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
