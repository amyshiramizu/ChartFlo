ALTER TABLE public.pf_push_queue
  ADD COLUMN IF NOT EXISTS subjective text,
  ADD COLUMN IF NOT EXISTS objective text,
  ADD COLUMN IF NOT EXISTS assessment text,
  ADD COLUMN IF NOT EXISTS plan text,
  ADD COLUMN IF NOT EXISTS patient_dob date;