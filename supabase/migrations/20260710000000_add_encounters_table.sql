-- Patient encounters: structured visit documentation with sign & lock.
CREATE TABLE IF NOT EXISTS public.encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  user_id uuid NOT NULL,
  encounter_type text,
  cpt_code text,
  date_of_service date NOT NULL DEFAULT CURRENT_DATE,
  provider text,
  place_of_service text,
  total_minutes integer NOT NULL DEFAULT 0,
  diagnoses text[] NOT NULL DEFAULT '{}',
  no_medications boolean NOT NULL DEFAULT false,
  chief_complaint text,
  vitals jsonb NOT NULL DEFAULT '{}',
  vitals_refused boolean NOT NULL DEFAULT false,
  soap_note text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed')),
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.encounters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manage encounters" ON public.encounters
FOR ALL TO authenticated
USING (patient_id IN (
  SELECT id FROM public.patients
  WHERE user_id = auth.uid()
     OR (clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id))
))
WITH CHECK (patient_id IN (
  SELECT id FROM public.patients
  WHERE user_id = auth.uid()
     OR (clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id))
));
