-- Critical alerts: out-of-range readings surface app-wide until acknowledged.
CREATE TABLE IF NOT EXISTS public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  patient_name text NOT NULL DEFAULT '',
  user_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'critical_reading',
  message text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged')),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manage alerts" ON public.alerts
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
