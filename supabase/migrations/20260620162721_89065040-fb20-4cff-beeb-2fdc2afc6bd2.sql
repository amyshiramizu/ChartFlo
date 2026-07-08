
-- Fix monthly_superbills: replace clinic_id IS NULL bypass with created_by ownership fallback
DROP POLICY IF EXISTS "superbill clinic members read" ON public.monthly_superbills;
DROP POLICY IF EXISTS "superbill clinic members write" ON public.monthly_superbills;
DROP POLICY IF EXISTS "superbill clinic members update" ON public.monthly_superbills;
DROP POLICY IF EXISTS "superbill clinic members delete" ON public.monthly_superbills;

CREATE POLICY "superbill access read" ON public.monthly_superbills
FOR SELECT TO authenticated
USING (
  (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))
  OR (clinic_id IS NULL AND created_by = auth.uid())
);
CREATE POLICY "superbill access write" ON public.monthly_superbills
FOR INSERT TO authenticated
WITH CHECK (
  (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))
  OR (clinic_id IS NULL AND created_by = auth.uid())
);
CREATE POLICY "superbill access update" ON public.monthly_superbills
FOR UPDATE TO authenticated
USING (
  (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))
  OR (clinic_id IS NULL AND created_by = auth.uid())
)
WITH CHECK (
  (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))
  OR (clinic_id IS NULL AND created_by = auth.uid())
);
CREATE POLICY "superbill access delete" ON public.monthly_superbills
FOR DELETE TO authenticated
USING (
  (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))
  OR (clinic_id IS NULL AND created_by = auth.uid())
);

-- Fix patient_avs: same pattern
DROP POLICY IF EXISTS "avs clinic members read" ON public.patient_avs;
DROP POLICY IF EXISTS "avs clinic members write" ON public.patient_avs;
DROP POLICY IF EXISTS "avs clinic members update" ON public.patient_avs;
DROP POLICY IF EXISTS "avs clinic members delete" ON public.patient_avs;

CREATE POLICY "avs access read" ON public.patient_avs
FOR SELECT TO authenticated
USING (
  (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))
  OR (clinic_id IS NULL AND created_by = auth.uid())
);
CREATE POLICY "avs access write" ON public.patient_avs
FOR INSERT TO authenticated
WITH CHECK (
  (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))
  OR (clinic_id IS NULL AND created_by = auth.uid())
);
CREATE POLICY "avs access update" ON public.patient_avs
FOR UPDATE TO authenticated
USING (
  (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))
  OR (clinic_id IS NULL AND created_by = auth.uid())
)
WITH CHECK (
  (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))
  OR (clinic_id IS NULL AND created_by = auth.uid())
);
CREATE POLICY "avs access delete" ON public.patient_avs
FOR DELETE TO authenticated
USING (
  (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))
  OR (clinic_id IS NULL AND created_by = auth.uid())
);

-- Add clinic-scoped visibility for eligibility_decision_logs so clinic members
-- can see logs for patients in their clinic (not just the inserting user).
CREATE POLICY "Clinic members view clinic eligibility logs" ON public.eligibility_decision_logs
FOR SELECT TO authenticated
USING (
  patient_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.id = eligibility_decision_logs.patient_id
      AND p.clinic_id IS NOT NULL
      AND is_clinic_member(auth.uid(), p.clinic_id)
  )
);

-- Add explicit DELETE policy for clinic members on clinic-owned patients
CREATE POLICY "Clinic members can delete clinic patients" ON public.patients
FOR DELETE TO authenticated
USING (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id));
