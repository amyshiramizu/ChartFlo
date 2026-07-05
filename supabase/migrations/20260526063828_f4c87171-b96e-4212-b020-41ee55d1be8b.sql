-- Public bucket for clinic logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('clinic-logos', 'clinic-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read
DROP POLICY IF EXISTS "Clinic logos public read" ON storage.objects;
CREATE POLICY "Clinic logos public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'clinic-logos');

-- Members of the clinic can upload to the {clinic_id}/... folder
DROP POLICY IF EXISTS "Clinic members upload clinic logos" ON storage.objects;
CREATE POLICY "Clinic members upload clinic logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'clinic-logos'
  AND public.is_clinic_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Clinic members update clinic logos" ON storage.objects;
CREATE POLICY "Clinic members update clinic logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'clinic-logos'
  AND public.is_clinic_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Clinic admins delete clinic logos" ON storage.objects;
CREATE POLICY "Clinic admins delete clinic logos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'clinic-logos'
  AND public.is_clinic_admin(auth.uid(), ((storage.foldername(name))[1])::uuid)
);