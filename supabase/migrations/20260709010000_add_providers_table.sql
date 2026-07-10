-- Providers directory: real records instead of free-text names on patients.
CREATE TABLE IF NOT EXISTS public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  clinic_id uuid,
  name text NOT NULL,
  specialty text,
  npi text,
  phone text,
  email text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manage providers" ON public.providers
FOR ALL TO authenticated
USING (
  user_id = auth.uid()
  OR (clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id))
)
WITH CHECK (
  user_id = auth.uid()
  OR (clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id))
);
