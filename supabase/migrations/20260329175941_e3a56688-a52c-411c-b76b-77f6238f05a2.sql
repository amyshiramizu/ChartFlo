
-- Create clinics table
CREATE TABLE public.clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;

-- Create clinic_members table
CREATE TABLE public.clinic_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(clinic_id, user_id)
);

ALTER TABLE public.clinic_members ENABLE ROW LEVEL SECURITY;

-- Add clinic_id to patients (nullable for backward compat)
ALTER TABLE public.patients ADD COLUMN clinic_id uuid REFERENCES public.clinics(id) ON DELETE SET NULL;

-- Security definer function: check if user is member of a clinic
CREATE OR REPLACE FUNCTION public.is_clinic_member(_user_id uuid, _clinic_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clinic_members
    WHERE user_id = _user_id AND clinic_id = _clinic_id
  )
$$;

-- Security definer function: check if user is admin of a clinic
CREATE OR REPLACE FUNCTION public.is_clinic_admin(_user_id uuid, _clinic_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clinic_members
    WHERE user_id = _user_id AND clinic_id = _clinic_id AND role = 'admin'
  )
$$;

-- RLS for clinics: members can see their clinics
CREATE POLICY "Members can view their clinics"
ON public.clinics FOR SELECT TO authenticated
USING (public.is_clinic_member(auth.uid(), id));

-- Only the creator (admin) can update clinic
CREATE POLICY "Admins can update clinics"
ON public.clinics FOR UPDATE TO authenticated
USING (public.is_clinic_admin(auth.uid(), id));

-- Any authenticated user can create a clinic
CREATE POLICY "Users can create clinics"
ON public.clinics FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid());

-- Admins can delete their clinics
CREATE POLICY "Admins can delete clinics"
ON public.clinics FOR DELETE TO authenticated
USING (public.is_clinic_admin(auth.uid(), id));

-- RLS for clinic_members
CREATE POLICY "Members can view clinic members"
ON public.clinic_members FOR SELECT TO authenticated
USING (public.is_clinic_member(auth.uid(), clinic_id));

CREATE POLICY "Admins can insert clinic members"
ON public.clinic_members FOR INSERT TO authenticated
WITH CHECK (public.is_clinic_admin(auth.uid(), clinic_id) OR user_id = auth.uid());

CREATE POLICY "Admins can delete clinic members"
ON public.clinic_members FOR DELETE TO authenticated
USING (public.is_clinic_admin(auth.uid(), clinic_id));

CREATE POLICY "Admins can update clinic members"
ON public.clinic_members FOR UPDATE TO authenticated
USING (public.is_clinic_admin(auth.uid(), clinic_id));

-- Update patients RLS: keep existing policy but also allow clinic-scoped access
-- Existing policy "Users manage own patients" still works for user_id = auth.uid()
-- Patients with a clinic_id are visible to all clinic members
CREATE POLICY "Clinic members can view clinic patients"
ON public.patients FOR SELECT TO authenticated
USING (
  clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id)
);

CREATE POLICY "Clinic members can insert clinic patients"
ON public.patients FOR INSERT TO authenticated
WITH CHECK (
  clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id)
);

CREATE POLICY "Clinic members can update clinic patients"
ON public.patients FOR UPDATE TO authenticated
USING (
  clinic_id IS NOT NULL AND public.is_clinic_member(auth.uid(), clinic_id)
);
