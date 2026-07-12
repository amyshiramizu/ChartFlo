-- Monthly sign-off: attestation that a patient's care-management time for a
-- given month has been reviewed and is ready for billing.
CREATE TABLE IF NOT EXISTS public.month_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  month text NOT NULL, -- 'YYYY-MM'
  minutes_at_signoff integer NOT NULL DEFAULT 0,
  signed_by uuid NOT NULL,
  signed_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, month)
);

ALTER TABLE public.month_signoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manage month_signoffs" ON public.month_signoffs
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
