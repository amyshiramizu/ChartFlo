-- Create patients table
CREATE TABLE public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  dob text NOT NULL,
  mrn text NOT NULL,
  gender text NOT NULL DEFAULT 'male',
  phone text,
  allergies text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Create medications table
CREATE TABLE public.medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  dosage text NOT NULL,
  frequency text NOT NULL,
  route text NOT NULL DEFAULT 'PO',
  prescribed_date text NOT NULL,
  active boolean DEFAULT true
);

-- Create clinical_notes table
CREATE TABLE public.clinical_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
  date text NOT NULL,
  type text NOT NULL DEFAULT 'soap',
  subjective text DEFAULT '',
  objective text DEFAULT '',
  assessment text DEFAULT '',
  plan text DEFAULT '',
  author text DEFAULT '',
  dictated boolean DEFAULT false
);

-- Create note_templates table
CREATE TABLE public.note_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'soap',
  subjective_prompt text DEFAULT '',
  objective_prompt text DEFAULT '',
  assessment_prompt text DEFAULT '',
  plan_prompt text DEFAULT ''
);

-- Enable RLS on all tables
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_templates ENABLE ROW LEVEL SECURITY;

-- Patients: users can CRUD their own
CREATE POLICY "Users manage own patients" ON public.patients
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Medications: users can CRUD meds for their own patients
CREATE POLICY "Users manage own patient medications" ON public.medications
  FOR ALL TO authenticated
  USING (patient_id IN (SELECT id FROM public.patients WHERE user_id = auth.uid()))
  WITH CHECK (patient_id IN (SELECT id FROM public.patients WHERE user_id = auth.uid()));

-- Clinical notes: users can CRUD notes for their own patients
CREATE POLICY "Users manage own patient notes" ON public.clinical_notes
  FOR ALL TO authenticated
  USING (patient_id IN (SELECT id FROM public.patients WHERE user_id = auth.uid()))
  WITH CHECK (patient_id IN (SELECT id FROM public.patients WHERE user_id = auth.uid()));

-- Note templates: users can CRUD their own templates
CREATE POLICY "Users manage own templates" ON public.note_templates
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());