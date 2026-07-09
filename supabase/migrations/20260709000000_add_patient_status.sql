-- Add active/inactive status to patients.
-- Existing rows default to 'active'.
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'inactive'));
