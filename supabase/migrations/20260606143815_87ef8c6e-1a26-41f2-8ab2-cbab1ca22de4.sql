CREATE TABLE public.eligibility_decision_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  patient_id uuid,
  program text NOT NULL,
  eligible boolean NOT NULL,
  confidence text,
  rationale text,
  qualifying_icd_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  cpt_hcpcs_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  note_excerpts jsonb NOT NULL DEFAULT '[]'::jsonb,
  care_plan_focus text,
  ai_model text,
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX eligibility_decision_logs_user_idx ON public.eligibility_decision_logs(user_id, created_at DESC);
CREATE INDEX eligibility_decision_logs_patient_idx ON public.eligibility_decision_logs(patient_id, created_at DESC);

GRANT SELECT, INSERT ON public.eligibility_decision_logs TO authenticated;
GRANT ALL ON public.eligibility_decision_logs TO service_role;

ALTER TABLE public.eligibility_decision_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own eligibility logs"
ON public.eligibility_decision_logs FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users insert own eligibility logs"
ON public.eligibility_decision_logs FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());