CREATE POLICY "Creators can view their clinics"
ON public.clinics
FOR SELECT
TO authenticated
USING (created_by = auth.uid());