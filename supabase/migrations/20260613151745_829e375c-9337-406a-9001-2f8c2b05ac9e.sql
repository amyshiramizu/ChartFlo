
ALTER TABLE public.dispatch_batches
  ADD COLUMN IF NOT EXISTS shift_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS shift_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS shift_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_chart_type text NOT NULL DEFAULT 'ccm_visit',
  ADD COLUMN IF NOT EXISTS session_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date;

CREATE INDEX IF NOT EXISTS dispatch_batches_user_day_idx
  ON public.dispatch_batches(user_id, session_date);

ALTER TABLE public.dispatch_jobs
  ADD COLUMN IF NOT EXISTS chart_type text NOT NULL DEFAULT 'ccm_visit',
  ADD COLUMN IF NOT EXISTS actual_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
