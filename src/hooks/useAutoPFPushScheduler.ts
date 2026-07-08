import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useClinic } from './useClinic';
import { normalizeDob } from '@/lib/pfDob';

/**
 * Once per session per scheduled time, if the active clinic has auto-PF push
 * enabled and the local time has passed the configured time, queue every
 * patient documented today into pf_push_queue.
 */
export function useAutoPFPushScheduler() {
  const { user } = useAuth();
  const { activeClinic } = useClinic();
  const lastRunKey = useRef<string | null>(null);

  useEffect(() => {
    if (!user || !activeClinic) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      const { data: settings } = await supabase
        .from('clinic_settings')
        .select('auto_pf_push_enabled, auto_pf_push_time')
        .eq('clinic_id', activeClinic.id)
        .maybeSingle();

      if (!settings?.auto_pf_push_enabled) return;
      const [hh, mm] = (settings.auto_pf_push_time || '18:00').split(':').map(Number);
      const now = new Date();
      const target = new Date();
      target.setHours(hh || 18, mm || 0, 0, 0);
      if (now < target) return;

      const today = now.toISOString().slice(0, 10);
      const runKey = `${activeClinic.id}-${today}`;
      const stored = localStorage.getItem('cs:autoPFLastRun');
      if (stored === runKey || lastRunKey.current === runKey) return;

      // Find today's documented patients restricted to active clinic
      const [{ data: times }, { data: notes }, { data: clinicPatients }] = await Promise.all([
        supabase
          .from('ccm_time_entries')
          .select('patient_id, minutes, description')
          .eq('user_id', user.id)
          .eq('date', today),
        supabase.from('clinical_notes').select('patient_id, date'),
        supabase.from('patients').select('id').eq('clinic_id', activeClinic.id),
      ]);

      const allowed = new Set((clinicPatients || []).map((p: any) => p.id));
      const todayNotes = (notes || []).filter(
        (n: any) =>
          (n.date || '').slice(0, 10) === today &&
          n.patient_id &&
          allowed.has(n.patient_id),
      );
      const ids = new Set<string>();
      (times || []).forEach((t: any) => {
        if (t.patient_id && allowed.has(t.patient_id)) ids.add(t.patient_id);
      });
      todayNotes.forEach((n: any) => ids.add(n.patient_id));
      if (ids.size === 0) {
        localStorage.setItem('cs:autoPFLastRun', runKey);
        lastRunKey.current = runKey;
        return;
      }

      const { data: patients } = await supabase
        .from('patients')
        .select('id, first_name, last_name, mrn, dob')
        .eq('clinic_id', activeClinic.id)
        .in('id', Array.from(ids));

      // Pull today's SOAP notes for the same patients so we can populate the
      // structured S/O/A/P columns instead of only the legacy `note` blob.
      const { data: todayNotesFull } = await supabase
        .from('clinical_notes')
        .select('patient_id, date, subjective, objective, assessment, plan')
        .in('patient_id', Array.from(ids));
      const soapByPatient = new Map<string, any>();
      (todayNotesFull || []).forEach((n: any) => {
        if ((n.date || '').slice(0, 10) === today) soapByPatient.set(n.patient_id, n);
      });

      const { data: existing } = await supabase
        .from('pf_push_queue')
        .select('patient_id')
        .eq('user_id', user.id)
        .eq('encounter_date', today)
        .in('status', ['pending', 'done']);
      const skip = new Set((existing || []).map((e: any) => e.patient_id));

      const rows = (patients || [])
        .filter((p: any) => !skip.has(p.id))
        .map((p: any) => {
          const mins = (times || [])
            .filter((t: any) => t.patient_id === p.id)
            .reduce((s: number, t: any) => s + (t.minutes || 0), 0);
          const descs = (times || [])
            .filter((t: any) => t.patient_id === p.id && t.description)
            .map((t: any) => `• (${t.minutes}m) ${t.description}`)
            .join('\n');
          const ccmSummary =
            `CCM care coordination — ${mins} minute(s) of non-face-to-face care today.\n\n` +
            (descs || 'See chart for activity details.');
          const soap = soapByPatient.get(p.id);
          const subjective = soap?.subjective || null;
          const objective = soap?.objective || null;
          const assessment = soap?.assessment || null;
          const plan = [soap?.plan, ccmSummary].filter(Boolean).join('\n\n');
          return {
            user_id: user.id,
            clinic_id: activeClinic.id,
            patient_id: p.id,
            patient_name: `${p.first_name} ${p.last_name}`,
            mrn: p.mrn,
            patient_dob: normalizeDob(p.dob),
            encounter_date: today,
            minutes: mins,
            program: 'CCM',
            note: ccmSummary,
            subjective,
            objective,
            assessment,
            plan: plan || null,
            status: 'pending',
          };
        });

      if (rows.length > 0) {
        await supabase.from('pf_push_queue').insert(rows);
      }
      localStorage.setItem('cs:autoPFLastRun', runKey);
      lastRunKey.current = runKey;
    };

    tick();
    const id = window.setInterval(tick, 5 * 60 * 1000); // every 5 min
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [user?.id, activeClinic?.id]);
}
