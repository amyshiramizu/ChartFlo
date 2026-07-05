
CREATE OR REPLACE FUNCTION public.enforce_time_entry_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  has_enrollment boolean;
BEGIN
  IF NEW.minutes IS NULL OR NEW.minutes <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.patient_enrollments
    WHERE patient_id = NEW.patient_id
      AND program = NEW.program
      AND status = 'enrolled'
  ) INTO has_enrollment;

  IF NOT has_enrollment THEN
    RAISE EXCEPTION 'Patient is not enrolled in % program. Enroll the patient before logging minutes.', NEW.program
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_time_entry_enrollment ON public.ccm_time_entries;
CREATE TRIGGER trg_enforce_time_entry_enrollment
  BEFORE INSERT OR UPDATE ON public.ccm_time_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_time_entry_enrollment();
