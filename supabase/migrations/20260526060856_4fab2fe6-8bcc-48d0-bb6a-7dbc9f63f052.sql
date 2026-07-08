
ALTER TABLE public.clinic_settings
  ADD COLUMN IF NOT EXISTS auto_pf_push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_pf_push_time text NOT NULL DEFAULT '18:00';

CREATE TABLE IF NOT EXISTS public.pf_push_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  clinic_id uuid,
  patient_id uuid,
  patient_name text NOT NULL,
  mrn text,
  encounter_date date NOT NULL DEFAULT CURRENT_DATE,
  minutes integer NOT NULL DEFAULT 0,
  program text NOT NULL DEFAULT 'CCM',
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS pf_push_queue_user_status_idx
  ON public.pf_push_queue (user_id, status, encounter_date);

ALTER TABLE public.pf_push_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own pf queue"
  ON public.pf_push_queue
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER pf_push_queue_touch
  BEFORE UPDATE ON public.pf_push_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();
