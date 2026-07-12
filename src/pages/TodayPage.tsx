import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useClinic } from '@/hooks/useClinic';
import { AppSidebar, MobileHeader } from '@/components/AppSidebar';
import PeriodMetricsBar from '@/components/PeriodMetricsBar';
import CriticalAlertsBanner from '@/components/CriticalAlertsBanner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, Send, CheckCircle2, AlertCircle, Clock, Upload, Sparkles, Share2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PatientNameLink } from '@/components/PatientNameLink';
import { normalizeDob } from '@/lib/pfDob';
import CCMBatchUpload from '@/components/CCMBatchUpload';

type Row = {
  patient_id: string;
  patient_name: string;
  mrn: string | null;
  minutes: number;
  noteCount: number;
  hasNote: boolean;
  queueStatus?: string;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function TodayPage() {
  const { user } = useAuth();
  const { activeClinic } = useClinic();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState<string | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchEntries, setBatchEntries] = useState<any[]>([]);
  const [batchPatients, setBatchPatients] = useState<any[]>([]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const today = todayISO();

    const [{ data: times }, { data: notes }, { data: queue }, { data: clinicPatients }] =
      await Promise.all([
        supabase
          .from('ccm_time_entries')
          .select('id, patient_id, minutes, description, date, staff, program')
          .eq('user_id', user.id)
          .eq('date', today),
        supabase.from('clinical_notes').select('patient_id, id, date'),
        supabase
          .from('pf_push_queue')
          .select('patient_id, status')
          .eq('user_id', user.id)
          .eq('encounter_date', today),
        // Restrict to patients in the active clinic so data never crosses over.
        activeClinic
          ? supabase.from('patients').select('id').eq('clinic_id', activeClinic.id)
          : Promise.resolve({ data: [] as { id: string }[] }),
      ]);

    if (!activeClinic) {
      setRows([]);
      setBatchEntries([]);
      setBatchPatients([]);
      setLoading(false);
      return;
    }

    const allowed = new Set((clinicPatients || []).map((p: any) => p.id));
    const patientIds = new Set<string>();
    (times || []).forEach((t: any) => {
      if (t.patient_id && allowed.has(t.patient_id)) patientIds.add(t.patient_id);
    });
    const todayNotes = (notes || []).filter(
      (n: any) =>
        (n.date || '').slice(0, 10) === today &&
        n.patient_id &&
        allowed.has(n.patient_id),
    );
    todayNotes.forEach((n: any) => patientIds.add(n.patient_id));

    if (patientIds.size === 0) {
      setRows([]);
      setBatchEntries([]);
      setBatchPatients([]);
      setLoading(false);
      return;
    }

    const { data: patients } = await supabase
      .from('patients')
      .select('id, first_name, last_name, mrn, dob')
      .eq('clinic_id', activeClinic.id)
      .in('id', Array.from(patientIds));


    const queueMap = new Map<string, string>();
    (queue || []).forEach((q: any) => queueMap.set(q.patient_id, q.status));

    const aggregated: Row[] = (patients || []).map((p: any) => {
      const mins = (times || [])
        .filter((t: any) => t.patient_id === p.id)
        .reduce((sum: number, t: any) => sum + (t.minutes || 0), 0);
      const noteCount = todayNotes.filter((n: any) => n.patient_id === p.id).length;
      return {
        patient_id: p.id,
        patient_name: `${p.first_name} ${p.last_name}`,
        mrn: p.mrn,
        minutes: mins,
        noteCount,
        hasNote: noteCount > 0,
        queueStatus: queueMap.get(p.id),
      };
    });

    aggregated.sort((a, b) => b.minutes - a.minutes);
    setRows(aggregated);
    setBatchEntries(
      (times || [])
        .filter((t: any) => t.patient_id && allowed.has(t.patient_id))
        .map((t: any) => ({
          id: t.id,
          patient_id: t.patient_id,
          date: t.date,
          minutes: t.minutes,
          staff: t.staff ?? null,
          description: t.description ?? null,
          program: t.program || 'CCM',
        })),
    );
    setBatchPatients(
      (patients || []).map((p: any) => ({
        id: p.id,
        firstName: p.first_name,
        lastName: p.last_name,
        dob: p.dob,
        mrn: p.mrn,
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, activeClinic?.id]);

  const totals = useMemo(
    () => ({
      patients: rows.length,
      minutes: rows.reduce((s, r) => s + r.minutes, 0),
      pending: rows.filter((r) => r.queueStatus === 'pending').length,
      done: rows.filter((r) => r.queueStatus === 'done').length,
    }),
    [rows],
  );

  const queueOne = async (row: Row) => {
    if (!user) return;
    if (!activeClinic) return toast.error('Select an active clinic first');

    // Hard guard: verify the patient actually belongs to the active clinic
    const { data: verify } = await supabase
      .from('patients')
      .select('id, clinic_id')
      .eq('id', row.patient_id)
      .maybeSingle();
    if (!verify || verify.clinic_id !== activeClinic.id) {
      return toast.error(`${row.patient_name} is not part of ${activeClinic.name}`);
    }

    setPushing(row.patient_id);

    // Pull today's time entries (for the CCM summary) and today's SOAP note.
    const [{ data: times }, { data: noteRows }, { data: pat }] = await Promise.all([
      supabase
        .from('ccm_time_entries')
        .select('description, minutes')
        .eq('user_id', user.id)
        .eq('patient_id', row.patient_id)
        .eq('date', todayISO()),
      supabase
        .from('clinical_notes')
        .select('date, subjective, objective, assessment, plan')
        .eq('patient_id', row.patient_id)
        .order('date', { ascending: false })
        .limit(20),
      supabase.from('patients').select('dob').eq('id', row.patient_id).maybeSingle(),
    ]);

    const noteLines = (times || [])
      .filter((t: any) => t.description)
      .map((t: any) => `• (${t.minutes}m) ${t.description}`)
      .join('\n');

    const today = todayISO();
    const todaysNote = (noteRows || []).find((n: any) => (n.date || '').slice(0, 10) === today);

    const ccmSummary =
      `CCM care coordination — ${row.minutes} minute(s) of non-face-to-face care today.\n\n` +
      (noteLines || 'See chart for activity details.');

    // SOAP fields: prefer today's clinical_note; merge CCM summary into Plan.
    const subjective = todaysNote?.subjective || null;
    const objective = todaysNote?.objective || null;
    const assessment = todaysNote?.assessment || null;
    const plan = [todaysNote?.plan, ccmSummary].filter(Boolean).join('\n\n');

    // Full-text fallback for older extension versions (legacy `note` column).
    const note =
      todaysNote
        ? [
            subjective && `SUBJECTIVE:\n${subjective}`,
            objective && `OBJECTIVE:\n${objective}`,
            assessment && `ASSESSMENT:\n${assessment}`,
            plan && `PLAN:\n${plan}`,
          ]
            .filter(Boolean)
            .join('\n\n')
        : ccmSummary;

    const payload = {
      user_id: user.id,
      clinic_id: activeClinic.id,
      patient_id: row.patient_id,
      patient_name: row.patient_name,
      mrn: row.mrn,
      patient_dob: normalizeDob(pat?.dob),
      encounter_date: todayISO(),
      minutes: row.minutes,
      program: 'CCM',
      note,
      subjective,
      objective,
      assessment,
      plan: plan || null,
      status: 'pending',
      error: null,
    };

    const { error } = await supabase.from('pf_push_queue').upsert(payload as any, {
      onConflict: 'user_id,patient_id,encounter_date' as any,
      ignoreDuplicates: false,
    } as any);

    setPushing(null);
    if (error) {
      const ins = await supabase.from('pf_push_queue').insert(payload as any);
      if (ins.error) return toast.error(ins.error.message);
    }
    toast.success(`Queued ${row.patient_name} for Practice Fusion`);
    load();
  };

  const generateCarePlan = async (row: Row) => {
    if (!user) return;
    if (!activeClinic) return toast.error('Select an active clinic first');
    setGeneratingPlan(row.patient_id);
    try {
      const [{ data: pat }, { data: probs }, { data: meds }, { data: notesData }] = await Promise.all([
        supabase.from('patients').select('first_name, last_name, dob, allergies').eq('id', row.patient_id).maybeSingle(),
        supabase.from('patient_problems').select('id, icd_code, description').eq('patient_id', row.patient_id),
        supabase.from('medications').select('name, dosage, frequency').eq('patient_id', row.patient_id),
        supabase.from('clinical_notes').select('date, subjective, objective, assessment, plan').eq('patient_id', row.patient_id).order('date', { ascending: false }).limit(5),
      ]);

      let workingProblems = probs || [];
      if (workingProblems.length === 0) {
        const latest = (notesData || [])[0];
        if (!latest || !(latest.assessment || latest.subjective)) {
          toast.error('No diagnoses on file and no recent notes to derive them from.');
          return;
        }
        const { data: icd, error: icdErr } = await supabase.functions.invoke('suggest-icd', {
          body: {
            subjective: latest.subjective || '',
            objective: latest.objective || '',
            assessment: latest.assessment || '',
            plan: latest.plan || '',
          },
        });
        if (icdErr) throw icdErr;
        const codes = (icd?.codes || []).filter((c: any) => c.confidence !== 'low').slice(0, 6);
        if (codes.length === 0) {
          toast.error('Could not derive diagnoses from notes. Open the chart to add them manually.');
          return;
        }
        const rows = codes.map((c: any) => ({
          patient_id: row.patient_id, icd_code: c.code, description: c.description, program_tag: 'CCM',
        }));
        const { data: inserted, error: insErr } = await supabase.from('patient_problems').insert(rows).select();
        if (insErr) throw insErr;
        workingProblems = inserted || [];
      }

      const { data, error } = await supabase.functions.invoke('generate-ccm-care-plan', {
        body: {
          patient: { firstName: pat?.first_name, lastName: pat?.last_name, dob: pat?.dob },
          problems: workingProblems.map((p: any) => ({ id: p.id, icd_code: p.icd_code, description: p.description })),
          medications: meds || [],
          allergies: pat?.allergies || [],
          recentNotes: notesData || [],
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const { data: existing } = await supabase.from('patient_care_plans').select('data, problem_plans').eq('patient_id', row.patient_id).maybeSingle();
      const newProblemPlans: Record<string, { goal: string; intervention: string }> = { ...(existing?.problem_plans as any || {}) };
      (data.problem_plans || []).forEach((pp: any) => {
        if (pp.problem_id) newProblemPlans[pp.problem_id] = { goal: pp.goal || '', intervention: pp.intervention || '' };
      });
      const newData = {
        ...(existing?.data as any || {}),
        expected_outcomes: data.expected_outcomes || '',
        symptom_plan: data.symptom_plan || '',
        med_mgmt: data.med_mgmt || '',
        preventive: data.preventive || '',
        community: data.community || '',
        care_coordination: data.care_coordination || '',
        caregivers: data.caregivers || '',
        advance_dir: data.advance_dir || '',
        psychosocial: data.psychosocial || '',
        education: data.education || '',
      };
      const { error: saveErr } = await supabase.from('patient_care_plans').upsert({
        patient_id: row.patient_id,
        data: newData,
        problem_plans: newProblemPlans,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'patient_id' });
      if (saveErr) throw saveErr;

      await supabase.from('ccm_time_entries').insert({
        patient_id: row.patient_id,
        user_id: user.id,
        date: todayISO(),
        minutes: 15,
        program: 'CCM',
        description: '[Care Plan] AI-generated comprehensive care plan from patient data',
        staff: user.email ?? null,
      });

      toast.success(`Care plan generated for ${row.patient_name} (15 min logged)`);
      load();
    } catch (e: any) {
      console.error('generateCarePlan failed', e);
      toast.error('Generation failed: ' + (e.message || 'unknown'));
    } finally {
      setGeneratingPlan(null);
    }
  };

  const dispatchOne = async (row: Row) => {
    if (!user) return;
    if (!activeClinic) return toast.error('Select an active clinic first');
    setDispatching(row.patient_id);
    try {
      const today = todayISO();

      // Find or create today's dispatch batch
      const { data: existingBatch } = await supabase
        .from('dispatch_batches')
        .select('id, share_code')
        .eq('user_id', user.id)
        .eq('session_date', today)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let batchId: string;
      let shareCode: string;
      if (existingBatch) {
        batchId = existingBatch.id;
        shareCode = existingBatch.share_code;
      } else {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        shareCode = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
        const { data: created, error: cErr } = await supabase.from('dispatch_batches').insert({
          user_id: user.id,
          share_code: shareCode,
          label: `Today ${new Date().toLocaleDateString()}`,
          session_date: today,
          default_chart_type: 'ccm_visit',
        }).select('id, share_code').single();
        if (cErr || !created) throw cErr;
        batchId = created.id;
        shareCode = created.share_code;
      }

      // Avoid duplicate job for this patient in this batch
      const { data: dup } = await supabase
        .from('dispatch_jobs')
        .select('id')
        .eq('batch_id', batchId)
        .eq('patient_id', row.patient_id)
        .maybeSingle();
      if (dup) {
        toast.info(`${row.patient_name} is already in today's dispatch (${shareCode})`);
        return;
      }

      // Build SOAP from today's clinical note + CCM summary
      const [{ data: notes }, { data: times }] = await Promise.all([
        supabase.from('clinical_notes').select('date, subjective, objective, assessment, plan')
          .eq('patient_id', row.patient_id).order('date', { ascending: false }).limit(5),
        supabase.from('ccm_time_entries').select('description, minutes')
          .eq('user_id', user.id).eq('patient_id', row.patient_id).eq('date', today),
      ]);
      const todaysNote = (notes || []).find((n: any) => (n.date || '').slice(0, 10) === today);
      const ccmLines = (times || []).filter((t: any) => t.description)
        .map((t: any) => `• (${t.minutes}m) ${t.description}`).join('\n');
      const ccmSummary = `CCM care coordination — ${row.minutes} minute(s) of non-face-to-face care today.\n\n${ccmLines || 'See chart for activity details.'}`;

      const { data: maxRow } = await supabase
        .from('dispatch_jobs').select('position').eq('batch_id', batchId)
        .order('position', { ascending: false }).limit(1).maybeSingle();
      const nextPos = ((maxRow?.position as number | undefined) ?? -1) + 1;

      const { error: jErr } = await supabase.from('dispatch_jobs').insert({
        batch_id: batchId,
        position: nextPos,
        patient_name: row.patient_name,
        mrn: row.mrn,
        patient_id: row.patient_id,
        subjective: todaysNote?.subjective || '',
        objective: todaysNote?.objective || '',
        assessment: todaysNote?.assessment || '',
        plan: [todaysNote?.plan, ccmSummary].filter(Boolean).join('\n\n'),
        chart_type: 'ccm_visit',
      });
      if (jErr) throw jErr;

      toast.success(`Added ${row.patient_name} to today's dispatch (${shareCode})`);
    } catch (e: any) {
      console.error('dispatchOne failed', e);
      toast.error('Dispatch failed: ' + (e.message || 'unknown'));
    } finally {
      setDispatching(null);
    }
  };

  const queueAll = async () => {
    const targets = rows.filter((r) => r.queueStatus !== 'done');
    if (targets.length === 0) {
      toast.info('Nothing to queue — all of today\'s patients are already documented.');
      return;
    }
    let ok = 0;
    let fail = 0;
    for (const r of targets) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await queueOne(r);
        ok += 1;
      } catch (e: any) {
        fail += 1;
        console.error('queueAll error for', r.patient_name, e);
      }
    }
    toast.success(`Queued ${ok} patient${ok === 1 ? '' : 's'} for Practice Fusion${fail ? ` (${fail} failed)` : ''}`);
  };

  return (
    <div className="min-h-screen flex w-full bg-background">
      <AppSidebar />
      <div className="flex-1 flex flex-col">
        <MobileHeader />
        <CriticalAlertsBanner />
        <PeriodMetricsBar />
        <main className="flex-1 p-4 md:p-8 max-w-6xl w-full mx-auto space-y-6">
          <header className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-primary">
                <CalendarDays className="w-5 h-5" />
                <h1 className="text-2xl font-semibold">Today's Documented Patients</h1>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Every patient with CCM time or a note recorded today. Queue them to auto-document in
                Practice Fusion via the Chrome extension.
              </p>
            </div>
            <Button
              onClick={() => setBatchOpen(true)}
              disabled={batchEntries.length === 0}
              className="gap-2"
            >
              <Upload className="w-4 h-4" />
              Batch Upload to Practice Fusion
            </Button>
          </header>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Patients</p>
              <p className="text-2xl font-mono font-semibold">{totals.patients}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">CCM Minutes</p>
              <p className="text-2xl font-mono font-semibold">{totals.minutes}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Queued</p>
              <p className="text-2xl font-mono font-semibold">{totals.pending}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Documented</p>
              <p className="text-2xl font-mono font-semibold">{totals.done}</p>
            </Card>
          </div>

          <Card className="divide-y">
            {loading ? (
              <p className="p-6 text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground italic">
                No documented patients yet today.
              </p>
            ) : (
              rows.map((r) => (
                <div
                  key={r.patient_id}
                  className="p-4 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="min-w-0">
                    <PatientNameLink patientId={r.patient_id} className="font-medium truncate block">
                      {r.patient_name}
                    </PatientNameLink>
                    <p className="text-xs text-muted-foreground font-mono">
                      MRN: {r.mrn || '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="gap-1">
                      <Clock className="w-3 h-3" /> {r.minutes}m
                    </Badge>
                    {r.hasNote && (
                      <Badge variant="outline">{r.noteCount} note{r.noteCount > 1 ? 's' : ''}</Badge>
                    )}
                    {r.queueStatus === 'done' && (
                      <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Documented
                      </Badge>
                    )}
                    {r.queueStatus === 'pending' && (
                      <Badge className="gap-1">Pending</Badge>
                    )}
                    {r.queueStatus === 'failed' && (
                      <Badge variant="destructive" className="gap-1">
                        <AlertCircle className="w-3 h-3" /> Failed
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={generatingPlan === r.patient_id}
                      onClick={() => generateCarePlan(r)}
                      className="gap-2"
                      title="Generate AI care plan from history + today's SOAP (logs 15 min)"
                    >
                      {generatingPlan === r.patient_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      Care Plan
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={dispatching === r.patient_id}
                      onClick={() => dispatchOne(r)}
                      className="gap-2"
                      title="Add to today's dispatch batch"
                    >
                      {dispatching === r.patient_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                      Dispatch
                    </Button>
                    <Button
                      size="sm"
                      variant={r.queueStatus === 'done' ? 'outline' : 'default'}
                      disabled={pushing === r.patient_id}
                      onClick={() => queueOne(r)}
                      className="gap-2"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {r.queueStatus === 'done' ? 'Re-queue' : r.queueStatus === 'pending' ? 'Re-queue' : 'Queue for PF'}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </Card>

          <p className="text-xs text-muted-foreground">
            Install the Chart Flo Chrome extension and open Practice Fusion to process the queue.
            Queued items are documented as CCM encounters automatically.
          </p>
        </main>
      </div>
      <CCMBatchUpload
        open={batchOpen}
        onOpenChange={(o) => {
          setBatchOpen(o);
          if (!o) load();
        }}
        entries={batchEntries}
        patients={batchPatients}
        month={new Date().toLocaleString('en-US', { month: 'long' })}
        year={new Date().getFullYear()}
      />
    </div>
  );
}
