import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface Clinic {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  role: string; // user's role in this clinic
}

export interface ClinicMember {
  id: string;
  clinic_id: string;
  user_id: string;
  role: string;
  invited_at: string;
  email?: string;
}

const ACTIVE_CLINIC_KEY = 'chart_scribe_active_clinic';

export function useClinic() {
  const { user } = useAuth();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [activeClinicId, setActiveClinicId] = useState<string | null>(
    localStorage.getItem(ACTIVE_CLINIC_KEY)
  );
  const [defaultClinicId, setDefaultClinicId] = useState<string | null>(null);
  const [members, setMembers] = useState<ClinicMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [initializedDefault, setInitializedDefault] = useState(false);

  const activeClinic = clinics.find(c => c.id === activeClinicId) || null;

  const fetchClinics = useCallback(async () => {

    if (!user) return;
    setLoading(true);

    // Get all clinics the user is a member of
    const { data: memberData, error: mErr } = await supabase
      .from('clinic_members')
      .select('clinic_id, role')
      .eq('user_id', user.id);

    if (mErr || !memberData?.length) {
      setClinics([]);
      setLoading(false);
      return;
    }

    const clinicIds = memberData.map(m => m.clinic_id);
    const { data: clinicData, error: cErr } = await supabase
      .from('clinics')
      .select('*')
      .in('id', clinicIds);

    if (cErr) {
      console.error('Failed to fetch clinics:', cErr);
      setLoading(false);
      return;
    }

    const merged: Clinic[] = (clinicData || []).map(c => ({
      id: c.id,
      name: c.name,
      created_by: c.created_by,
      created_at: c.created_at,
      role: memberData.find(m => m.clinic_id === c.id)?.role || 'member',
    }));

    setClinics(merged);

    // On first load, fetch user's preferred default clinic and prefer it
    if (!initializedDefault) {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('default_clinic_id')
        .eq('user_id', user.id)
        .maybeSingle();
      const preferred = settings?.default_clinic_id || null;
      setDefaultClinicId(preferred);
      const pickable = preferred && merged.find(c => c.id === preferred) ? preferred : null;
      if (pickable) {
        setActiveClinicId(pickable);
        localStorage.setItem(ACTIVE_CLINIC_KEY, pickable);
      } else if (!activeClinicId || !merged.find(c => c.id === activeClinicId)) {
        if (merged.length > 0) {
          setActiveClinicId(merged[0].id);
          localStorage.setItem(ACTIVE_CLINIC_KEY, merged[0].id);
        }
      }
      setInitializedDefault(true);
    } else if (!activeClinicId || !merged.find(c => c.id === activeClinicId)) {
      if (merged.length > 0) {
        setActiveClinicId(merged[0].id);
        localStorage.setItem(ACTIVE_CLINIC_KEY, merged[0].id);
      }
    }

    setLoading(false);
  }, [user, activeClinicId, initializedDefault]);

  useEffect(() => {
    fetchClinics();
  }, [fetchClinics]);

  const switchClinic = (clinicId: string) => {
    setActiveClinicId(clinicId);
    localStorage.setItem(ACTIVE_CLINIC_KEY, clinicId);
  };

  const setAsDefaultClinic = async (clinicId: string) => {
    if (!user) return { error: 'Not signed in' };
    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, default_clinic_id: clinicId }, { onConflict: 'user_id' });
    if (error) return { error: error.message };
    setDefaultClinicId(clinicId);
    return { error: null };
  };



  const createClinic = async (name: string) => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('clinics')
      .insert({ name, created_by: user.id })
      .select()
      .single();

    if (error) {
      console.error('Failed to create clinic:', error);
      return null;
    }

    // Add self as admin
    await supabase.from('clinic_members').insert({
      clinic_id: data.id,
      user_id: user.id,
      role: 'admin',
    });

    await fetchClinics();
    switchClinic(data.id);
    return data;
  };

  const fetchMembers = useCallback(async (clinicId: string) => {
    const { data, error } = await supabase
      .from('clinic_members')
      .select('*')
      .eq('clinic_id', clinicId);

    if (error) {
      console.error('Failed to fetch members:', error);
      return;
    }
    setMembers(data || []);
  }, []);

  const inviteMember = async (clinicId: string, email: string, role: string = 'member') => {
    // Look up user by email via a simple approach: 
    // We'll store the email as a placeholder and resolve on login
    // For now, we need the user_id — admin must share a link
    // Simple approach: use edge function or just add by user_id
    return { error: 'Invite by email requires additional setup' };
  };

  const removeMember = async (memberId: string) => {
    const { error } = await supabase
      .from('clinic_members')
      .delete()
      .eq('id', memberId);

    if (error) return { error: error.message };
    if (activeClinicId) await fetchMembers(activeClinicId);
    return { error: null };
  };

  const updateMemberRole = async (memberId: string, newRole: string) => {
    const { error } = await supabase
      .from('clinic_members')
      .update({ role: newRole })
      .eq('id', memberId);

    if (error) return { error: error.message };
    if (activeClinicId) await fetchMembers(activeClinicId);
    return { error: null };
  };

  const deleteClinic = async (clinicId: string) => {
    const { error } = await supabase
      .from('clinics')
      .delete()
      .eq('id', clinicId);

    if (error) return { error: error.message };
    await fetchClinics();
    return { error: null };
  };

  return {
    clinics,
    activeClinic,
    activeClinicId,
    defaultClinicId,
    members,
    loading,
    switchClinic,
    setAsDefaultClinic,
    createClinic,
    fetchMembers,
    removeMember,
    updateMemberRole,
    deleteClinic,
    fetchClinics,
  };

}
