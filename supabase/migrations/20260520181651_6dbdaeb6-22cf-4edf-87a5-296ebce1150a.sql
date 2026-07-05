
CREATE TABLE public.dispatch_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  share_code text NOT NULL UNIQUE,
  label text,
  instructions text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.dispatch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.dispatch_batches(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  patient_name text,
  mrn text,
  subjective text DEFAULT '',
  objective text DEFAULT '',
  assessment text DEFAULT '',
  plan text DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  filled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dispatch_jobs_batch_idx ON public.dispatch_jobs(batch_id, position);
CREATE INDEX dispatch_batches_code_idx ON public.dispatch_batches(share_code);

ALTER TABLE public.dispatch_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their batches" ON public.dispatch_batches
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owners manage their jobs" ON public.dispatch_jobs
  FOR ALL TO authenticated USING (
    batch_id IN (SELECT id FROM public.dispatch_batches WHERE user_id = auth.uid())
  ) WITH CHECK (
    batch_id IN (SELECT id FROM public.dispatch_batches WHERE user_id = auth.uid())
  );
