
CREATE OR REPLACE FUNCTION public.prevent_patient_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  -- Allow service_role / no-auth contexts (edge functions with service key) to bypass
  IF caller IS NULL THEN
    RETURN NEW;
  END IF;

  -- Block changes to user_id unless caller is admin of the (old) clinic
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    IF OLD.clinic_id IS NULL OR NOT public.is_clinic_admin(caller, OLD.clinic_id) THEN
      RAISE EXCEPTION 'Only clinic admins can reassign a patient owner'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Block changes to clinic_id unless caller is admin of both old (if any) and new (if any) clinics
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id THEN
    IF OLD.clinic_id IS NOT NULL AND NOT public.is_clinic_admin(caller, OLD.clinic_id) THEN
      RAISE EXCEPTION 'Only an admin of the current clinic can move this patient'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.clinic_id IS NOT NULL AND NOT public.is_clinic_admin(caller, NEW.clinic_id) THEN
      RAISE EXCEPTION 'Only an admin of the destination clinic can assign this patient'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_patient_reassignment ON public.patients;
CREATE TRIGGER trg_prevent_patient_reassignment
  BEFORE UPDATE OF user_id, clinic_id ON public.patients
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_patient_reassignment();
