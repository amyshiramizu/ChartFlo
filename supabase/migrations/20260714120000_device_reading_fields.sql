-- Device readings: blood sugar, AFib detection, and reading source.
-- Cellular devices (BP cuffs, glucometers, scales, oximeters) report these;
-- source distinguishes device-transmitted readings from manual entry.
ALTER TABLE public.patient_vitals
  ADD COLUMN IF NOT EXISTS blood_glucose text,
  ADD COLUMN IF NOT EXISTS afib_detected boolean,
  ADD COLUMN IF NOT EXISTS source text;
