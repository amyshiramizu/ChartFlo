-- IMEI identifies a cellular RPM device so incoming readings can be
-- matched to the right device and patient.
ALTER TABLE public.rpm_devices
  ADD COLUMN IF NOT EXISTS imei text;

-- One device per IMEI (NULLs allowed for devices without one).
CREATE UNIQUE INDEX IF NOT EXISTS rpm_devices_imei_key
  ON public.rpm_devices (imei)
  WHERE imei IS NOT NULL;
