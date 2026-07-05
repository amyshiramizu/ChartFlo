
ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS dispatch_jobs_patient_id_idx ON public.dispatch_jobs(patient_id);
