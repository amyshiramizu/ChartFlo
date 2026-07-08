ALTER TABLE public.patient_vitals
  ADD COLUMN IF NOT EXISTS o2_saturation text,
  ADD COLUMN IF NOT EXISTS height text,
  ADD COLUMN IF NOT EXISTS respiratory_rate text;