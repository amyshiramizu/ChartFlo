-- Coverage and enrollment metadata for the patient grid.
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS insurance text,
  ADD COLUMN IF NOT EXISTS zip_code text,
  ADD COLUMN IF NOT EXISTS discharge_date date;
