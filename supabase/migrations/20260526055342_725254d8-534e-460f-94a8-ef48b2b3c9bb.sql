-- Per-clinic settings shared across all clinic members
CREATE TABLE public.clinic_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id uuid NOT NULL UNIQUE,
  default_program text NOT NULL DEFAULT 'CCM',
  default_location text NOT NULL DEFAULT '',
  brand_name text NOT NULL DEFAULT '',
  brand_phone text NOT NULL DEFAULT '',
  brand_fax text NOT NULL DEFAULT '',
  brand_address text NOT NULL DEFAULT '',
  signature_block text NOT NULL DEFAULT '',
  logo_url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;

-- All clinic members can read clinic settings
CREATE POLICY "Members can view clinic settings"
ON public.clinic_settings
FOR SELECT
TO authenticated
USING (public.is_clinic_member(auth.uid(), clinic_id));

-- Only admins can insert clinic settings
CREATE POLICY "Admins can insert clinic settings"
ON public.clinic_settings
FOR INSERT
TO authenticated
WITH CHECK (public.is_clinic_admin(auth.uid(), clinic_id));

-- Only admins can update clinic settings
CREATE POLICY "Admins can update clinic settings"
ON public.clinic_settings
FOR UPDATE
TO authenticated
USING (public.is_clinic_admin(auth.uid(), clinic_id));

-- Only admins can delete clinic settings
CREATE POLICY "Admins can delete clinic settings"
ON public.clinic_settings
FOR DELETE
TO authenticated
USING (public.is_clinic_admin(auth.uid(), clinic_id));

CREATE TRIGGER clinic_settings_touch_updated_at
BEFORE UPDATE ON public.clinic_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
