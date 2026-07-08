
-- RPM Devices
CREATE TABLE public.rpm_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  device_type text NOT NULL,
  model text,
  serial_number text,
  status text NOT NULL DEFAULT 'active',
  notes text,
  assigned_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rpm_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own patient devices"
ON public.rpm_devices
FOR ALL
TO authenticated
USING (patient_id IN (SELECT id FROM public.patients WHERE user_id = auth.uid()))
WITH CHECK (patient_id IN (SELECT id FROM public.patients WHERE user_id = auth.uid()));

-- Care Plan Templates (for CCM / RPM)
CREATE TABLE public.care_plan_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  program text NOT NULL DEFAULT 'CCM',
  name text NOT NULL,
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.care_plan_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own care plan templates"
ON public.care_plan_templates
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- User Settings
CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY,
  default_program text DEFAULT 'CCM',
  default_template_id uuid,
  signature text DEFAULT '',
  default_location text DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own settings"
ON public.user_settings
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Auto-update timestamp trigger function (idempotent)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER care_plan_templates_touch
BEFORE UPDATE ON public.care_plan_templates
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER user_settings_touch
BEFORE UPDATE ON public.user_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
