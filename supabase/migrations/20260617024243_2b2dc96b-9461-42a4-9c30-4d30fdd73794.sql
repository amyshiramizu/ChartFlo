
-- patient_avs
CREATE TABLE public.patient_avs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE SET NULL,
  note_id uuid REFERENCES public.clinical_notes(id) ON DELETE SET NULL,
  language text NOT NULL DEFAULT 'en',
  reading_level text NOT NULL DEFAULT '6th-grade',
  summary_md text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_avs TO authenticated;
GRANT ALL ON public.patient_avs TO service_role;
ALTER TABLE public.patient_avs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "avs clinic members read"
  ON public.patient_avs FOR SELECT TO authenticated
  USING (clinic_id IS NULL OR public.is_clinic_member(auth.uid(), clinic_id));
CREATE POLICY "avs clinic members write"
  ON public.patient_avs FOR INSERT TO authenticated
  WITH CHECK (clinic_id IS NULL OR public.is_clinic_member(auth.uid(), clinic_id));
CREATE POLICY "avs clinic members update"
  ON public.patient_avs FOR UPDATE TO authenticated
  USING (clinic_id IS NULL OR public.is_clinic_member(auth.uid(), clinic_id))
  WITH CHECK (clinic_id IS NULL OR public.is_clinic_member(auth.uid(), clinic_id));
CREATE POLICY "avs clinic members delete"
  ON public.patient_avs FOR DELETE TO authenticated
  USING (clinic_id IS NULL OR public.is_clinic_member(auth.uid(), clinic_id));
CREATE INDEX idx_patient_avs_patient ON public.patient_avs(patient_id, created_at DESC);

-- monthly_superbills
CREATE TABLE public.monthly_superbills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  month date NOT NULL,
  codes_jsonb jsonb NOT NULL DEFAULT '[]'::jsonb,
  projected_revenue_cents integer NOT NULL DEFAULT 0,
  apcm_recommended boolean NOT NULL DEFAULT false,
  apcm_level text,
  evidence_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  finalized_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, patient_id, month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_superbills TO authenticated;
GRANT ALL ON public.monthly_superbills TO service_role;
ALTER TABLE public.monthly_superbills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "superbill clinic members read"
  ON public.monthly_superbills FOR SELECT TO authenticated
  USING (clinic_id IS NULL OR public.is_clinic_member(auth.uid(), clinic_id));
CREATE POLICY "superbill clinic members write"
  ON public.monthly_superbills FOR INSERT TO authenticated
  WITH CHECK (clinic_id IS NULL OR public.is_clinic_member(auth.uid(), clinic_id));
CREATE POLICY "superbill clinic members update"
  ON public.monthly_superbills FOR UPDATE TO authenticated
  USING (clinic_id IS NULL OR public.is_clinic_member(auth.uid(), clinic_id))
  WITH CHECK (clinic_id IS NULL OR public.is_clinic_member(auth.uid(), clinic_id));
CREATE POLICY "superbill clinic members delete"
  ON public.monthly_superbills FOR DELETE TO authenticated
  USING (clinic_id IS NULL OR public.is_clinic_member(auth.uid(), clinic_id));
CREATE TRIGGER superbill_touch
  BEFORE UPDATE ON public.monthly_superbills
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_superbills_clinic_month ON public.monthly_superbills(clinic_id, month);
