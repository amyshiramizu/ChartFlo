
-- Enrollments
CREATE TABLE public.patient_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  program text NOT NULL CHECK (program IN ('CCM','BHI','RPM','CCO')),
  status text NOT NULL DEFAULT 'enrolled',
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(patient_id, program)
);
ALTER TABLE public.patient_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage patient_enrollments" ON public.patient_enrollments FOR ALL TO authenticated
USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))))
WITH CHECK (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))));

-- Vitals
CREATE TABLE public.patient_vitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  blood_pressure text,
  heart_rate text,
  weight text,
  a1c text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.patient_vitals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage patient_vitals" ON public.patient_vitals FOR ALL TO authenticated
USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))))
WITH CHECK (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))));

-- Problems
CREATE TABLE public.patient_problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  icd_code text NOT NULL,
  description text NOT NULL,
  program_tag text DEFAULT 'CCM',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.patient_problems ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage patient_problems" ON public.patient_problems FOR ALL TO authenticated
USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))))
WITH CHECK (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))));

-- Assessments
CREATE TABLE public.patient_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  assessment_type text NOT NULL,
  cadence text NOT NULL DEFAULT 'Annual',
  due_date date,
  completed_at date,
  status text NOT NULL DEFAULT 'pending',
  notes text DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.patient_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage patient_assessments" ON public.patient_assessments FOR ALL TO authenticated
USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))))
WITH CHECK (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))));

-- Care plans (CMS comprehensive)
CREATE TABLE public.patient_care_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL UNIQUE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  problem_plans jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_review_date date,
  shared_date date,
  shared_method text,
  shared_with_patient boolean DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.patient_care_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manage patient_care_plans" ON public.patient_care_plans FOR ALL TO authenticated
USING (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))))
WITH CHECK (patient_id IN (SELECT id FROM patients WHERE user_id = auth.uid() OR (clinic_id IS NOT NULL AND is_clinic_member(auth.uid(), clinic_id))));
