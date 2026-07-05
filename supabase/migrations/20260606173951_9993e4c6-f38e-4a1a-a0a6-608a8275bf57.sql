
-- clinical_notes: extend to clinic members
DROP POLICY IF EXISTS "Users manage own patient notes" ON public.clinical_notes;
CREATE POLICY "Users manage own patient notes" ON public.clinical_notes
FOR ALL TO authenticated
USING (patient_id IN (SELECT id FROM public.patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id))))
WITH CHECK (patient_id IN (SELECT id FROM public.patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id))));

-- medications: extend to clinic members
DROP POLICY IF EXISTS "Users manage own patient medications" ON public.medications;
CREATE POLICY "Users manage own patient medications" ON public.medications
FOR ALL TO authenticated
USING (patient_id IN (SELECT id FROM public.patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id))))
WITH CHECK (patient_id IN (SELECT id FROM public.patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id))));

-- rpm_devices: extend to clinic members
DROP POLICY IF EXISTS "Users manage own patient devices" ON public.rpm_devices;
CREATE POLICY "Users manage own patient devices" ON public.rpm_devices
FOR ALL TO authenticated
USING (patient_id IN (SELECT id FROM public.patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id))))
WITH CHECK (patient_id IN (SELECT id FROM public.patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id))));

-- ccm_time_entries: keep owner write, add clinic colleague read + add policy for clinic colleagues to view
CREATE POLICY "Clinic members view ccm entries" ON public.ccm_time_entries
FOR SELECT TO authenticated
USING (patient_id IN (SELECT id FROM public.patients WHERE clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id)));

-- storage: restrict clinic logo upload/update to admins
DROP POLICY IF EXISTS "Clinic members upload clinic logos" ON storage.objects;
DROP POLICY IF EXISTS "Clinic members update clinic logos" ON storage.objects;

CREATE POLICY "Clinic admins upload clinic logos" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'clinic-logos' AND public.is_clinic_admin(auth.uid(), ((storage.foldername(name))[1])::uuid));

CREATE POLICY "Clinic admins update clinic logos" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'clinic-logos' AND public.is_clinic_admin(auth.uid(), ((storage.foldername(name))[1])::uuid));
