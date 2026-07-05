
CREATE TABLE public.ccm_time_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  staff TEXT,
  description TEXT,
  program TEXT NOT NULL DEFAULT 'CCM',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.ccm_time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ccm entries"
  ON public.ccm_time_entries FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own ccm entries"
  ON public.ccm_time_entries FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own ccm entries"
  ON public.ccm_time_entries FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own ccm entries"
  ON public.ccm_time_entries FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
