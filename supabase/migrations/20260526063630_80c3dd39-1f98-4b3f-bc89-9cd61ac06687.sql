-- Validation trigger: enforce that pf_push_queue.clinic_id is set and that
-- the referenced patient belongs to the same clinic. This prevents any
-- cross-clinic write even if the client code is bypassed.
CREATE OR REPLACE FUNCTION public.enforce_pf_push_queue_clinic()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  patient_clinic uuid;
BEGIN
  IF NEW.clinic_id IS NULL THEN
    RAISE EXCEPTION 'pf_push_queue.clinic_id is required (active clinic must be set)';
  END IF;

  IF NEW.patient_id IS NOT NULL THEN
    SELECT clinic_id INTO patient_clinic
    FROM public.patients
    WHERE id = NEW.patient_id;

    IF patient_clinic IS NULL THEN
      RAISE EXCEPTION 'Patient % is not assigned to any clinic', NEW.patient_id;
    END IF;

    IF patient_clinic <> NEW.clinic_id THEN
      RAISE EXCEPTION 'Patient % belongs to clinic %, not %',
        NEW.patient_id, patient_clinic, NEW.clinic_id;
    END IF;
  END IF;

  -- User must be a member of the clinic they are queueing for
  IF NOT public.is_clinic_member(NEW.user_id, NEW.clinic_id) THEN
    RAISE EXCEPTION 'User % is not a member of clinic %', NEW.user_id, NEW.clinic_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_pf_push_queue_clinic_trg ON public.pf_push_queue;
CREATE TRIGGER enforce_pf_push_queue_clinic_trg
BEFORE INSERT OR UPDATE ON public.pf_push_queue
FOR EACH ROW
EXECUTE FUNCTION public.enforce_pf_push_queue_clinic();

CREATE INDEX IF NOT EXISTS idx_pf_push_queue_clinic
  ON public.pf_push_queue (clinic_id, encounter_date);
