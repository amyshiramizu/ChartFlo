
-- 1. Tighten child PHI tables: solo branch requires patients.clinic_id IS NULL
DROP POLICY IF EXISTS "Users manage own patient notes" ON public.clinical_notes;
CREATE POLICY "Users manage own patient notes" ON public.clinical_notes FOR ALL
USING (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
))
WITH CHECK (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
));

DROP POLICY IF EXISTS "Users manage own patient medications" ON public.medications;
CREATE POLICY "Users manage own patient medications" ON public.medications FOR ALL
USING (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
))
WITH CHECK (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
));

DROP POLICY IF EXISTS "manage patient_assessments" ON public.patient_assessments;
CREATE POLICY "manage patient_assessments" ON public.patient_assessments FOR ALL
USING (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
))
WITH CHECK (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
));

DROP POLICY IF EXISTS "manage patient_care_plans" ON public.patient_care_plans;
CREATE POLICY "manage patient_care_plans" ON public.patient_care_plans FOR ALL
USING (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
))
WITH CHECK (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
));

DROP POLICY IF EXISTS "manage patient_enrollments" ON public.patient_enrollments;
CREATE POLICY "manage patient_enrollments" ON public.patient_enrollments FOR ALL
USING (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
))
WITH CHECK (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
));

DROP POLICY IF EXISTS "manage patient_problems" ON public.patient_problems;
CREATE POLICY "manage patient_problems" ON public.patient_problems FOR ALL
USING (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
))
WITH CHECK (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
));

DROP POLICY IF EXISTS "manage patient_vitals" ON public.patient_vitals;
CREATE POLICY "manage patient_vitals" ON public.patient_vitals FOR ALL
USING (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
))
WITH CHECK (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
));

-- Also tighten rpm_devices if it follows the same pattern
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='rpm_devices'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.rpm_devices', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "manage rpm_devices" ON public.rpm_devices FOR ALL
USING (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
))
WITH CHECK (patient_id IN (
  SELECT p.id FROM public.patients p
  WHERE (p.user_id = auth.uid() AND p.clinic_id IS NULL)
     OR (p.clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), p.clinic_id))
));

-- 2. Prevent client-specified patient.id on insert (no shadowing of victim UUIDs)
CREATE OR REPLACE FUNCTION public.enforce_patient_id_generated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow service_role / no-auth contexts (edge functions) to specify id
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Force server-side id generation for authenticated client inserts
  NEW.id := gen_random_uuid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_patient_id_generated_trg ON public.patients;
CREATE TRIGGER enforce_patient_id_generated_trg
BEFORE INSERT ON public.patients
FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_id_generated();

-- 3. Make tamper-resistance of eligibility logs explicit
DROP POLICY IF EXISTS "No updates to eligibility logs" ON public.eligibility_decision_logs;
CREATE POLICY "No updates to eligibility logs"
ON public.eligibility_decision_logs
AS RESTRICTIVE FOR UPDATE
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "No deletes from eligibility logs" ON public.eligibility_decision_logs;
CREATE POLICY "No deletes from eligibility logs"
ON public.eligibility_decision_logs
AS RESTRICTIVE FOR DELETE
USING (false);
