import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useMemo } from 'react';
import { PageLayout } from '@/components/MobileLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft, Plus, Check, X, FileText, Activity, HeartPulse, Save, Download, Trash2, Copy, Sparkles, Loader2,
  RefreshCw, ClipboardList, Monitor, Clock,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePatientStore } from '@/store/patientStore';
import { toast } from 'sonner';
import { getExternalTimeLog, clearExternalTimeLog, formatMonthlyTimeLog, formatDailyTimeLog, sendSOAPToExtension } from '@/lib/practiceFusionBridge';
import { Send, CalendarDays } from 'lucide-react';
import { BillingMeterCard } from '@/components/BillingMeterCard';
import EncounterPanel from '@/components/EncounterPanel';
import { AfterVisitSummaryDialog } from '@/components/AfterVisitSummaryDialog';
import { MonthlyCcmPdfButton } from '@/components/MonthlyCcmPdfButton';

type Program = 'CCM' | 'BHI' | 'RPM' | 'CCO';

const PROGRAMS: Program[] = ['CCM', 'BHI', 'RPM', 'CCO'];

const ASSESSMENT_DEFS = [
  { type: 'Comprehensive Care Plan', cadence: 'Annual' },
  { type: 'Medication Reconciliation', cadence: 'Quarterly' },
  { type: 'Depression Screening (PHQ-9)', cadence: 'Annual' },
  { type: 'Anxiety Screening (GAD-7)', cadence: 'Annual' },
  { type: 'Fall Risk Assessment', cadence: 'Annual' },
  { type: 'Cognitive Screening', cadence: 'Annual' },
  { type: 'Alcohol Use Screening (AUDIT-C)', cadence: 'Annual' },
  { type: 'Annual Wellness Visit', cadence: 'Annual' },
  { type: 'Advance Directives Review', cadence: 'Annual' },
];

const CMS_ELEMENTS = [
  { key: 'two_chronic', label: '≥ 2 chronic conditions on problem list' },
  { key: 'measurable_goals', label: 'Measurable goals for each condition' },
  { key: 'planned_interventions', label: 'Planned interventions for each condition' },
  { key: 'expected_outcomes', label: 'Expected outcomes & prognosis' },
  { key: 'symptom_management', label: 'Symptom management' },
  { key: 'medication_mgmt', label: 'Medication management & reconciliation' },
  { key: 'preventive_care', label: 'Preventive care services' },
  { key: 'community_services', label: 'Community / social services' },
  { key: 'care_coordination', label: 'Coordination of care with providers' },
  { key: 'caregivers_identified', label: 'Caregiver(s) identified' },
  { key: 'advance_directives', label: 'Advance directives addressed' },
  { key: 'periodic_review', label: 'Scheduled periodic review' },
  { key: 'plan_provided', label: 'Plan provided to patient / caregiver' },
];

const PLAN_FIELDS = [
  { key: 'expected_outcomes', label: 'Expected outcomes & overall prognosis', placeholder: 'Anticipated overall outcome across all conditions...' },
  { key: 'symptom_plan', label: 'Symptom management plan', placeholder: 'Plan for managing acute & chronic symptoms, when to call, ED criteria...' },
  { key: 'med_mgmt', label: 'Medication management & reconciliation', placeholder: 'Full med list reviewed on [date]; adherence strategy; pharmacy; allergies...' },
  { key: 'preventive', label: 'Preventive care services', placeholder: 'Vaccines, screenings (mammo, colon, AAA, A1C, lipids), AWV due...' },
  { key: 'caregivers', label: 'Caregiver(s) & support system', placeholder: 'Name, relationship, phone, role in care, consent to discuss...' },
  { key: 'advance_dir', label: 'Advance directives', placeholder: 'MOLST/POLST on file, code status, healthcare proxy, location of documents...' },
  { key: 'psychosocial', label: 'Psychosocial & behavioral health needs', placeholder: 'PHQ-9/GAD-7 results, BH referrals, SDoH screening findings...' },
  { key: 'education', label: 'Patient / caregiver education provided', placeholder: 'Topics, materials given, teach-back outcome...' },
];

// Medicare 2026 national non-facility allowed amounts (CY2026 PFS final rule).
// Source of truth: src/lib/medicare2026Codes.ts
import { CCM_CODES_2026, APCM_CODES_2026 } from '@/lib/medicare2026Codes';
const CPT_CODES = [
  ...CCM_CODES_2026.filter(c => ['99490','99439','99491','99437','99487','99489','G0511'].includes(c.code)),
  ...APCM_CODES_2026,
].map(c => ({ code: c.code, desc: c.description, min: c.minMinutes ?? 0, reimb: c.rate2026 }));

export default function CCMPatientChartPage() {
  return <PageLayout><ChartContent /></PageLayout>;
}

function ChartContent() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { patients, fetchPatients } = usePatientStore();
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [vitals, setVitals] = useState({ blood_pressure: '', heart_rate: '', weight: '', a1c: '', o2_saturation: '', height: '', respiratory_rate: '' });
  const [problems, setProblems] = useState<{ id: string; icd_code: string; description: string; program_tag: string }[]>([]);
  const [newProblem, setNewProblem] = useState({ icd_code: '', description: '' });
  const [assessments, setAssessments] = useState<any[]>([]);
  const [carePlan, setCarePlan] = useState<any>({ data: {}, problem_plans: {}, next_review_date: '', shared_date: '', shared_method: '', shared_with_patient: false });
  const [timeEntries, setTimeEntries] = useState<any[]>([]);
  const [carePlanTemplates, setCarePlanTemplates] = useState<{ id: string; name: string; content: string; program: string }[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => { if (patients.length === 0) fetchPatients(); }, []);
  const patient = patients.find(p => p.id === id);

  useEffect(() => { if (id) loadAll(id); }, [id]);

  useEffect(() => {
    supabase.from('care_plan_templates').select('id, name, content, program').order('created_at', { ascending: false })
      .then(({ data }) => setCarePlanTemplates(data || []));
  }, []);


  async function loadAll(pid: string) {
    const [en, vt, pr, asm, cp, te] = await Promise.all([
      supabase.from('patient_enrollments').select('*').eq('patient_id', pid),
      supabase.from('patient_vitals').select('*').eq('patient_id', pid).order('recorded_at', { ascending: false }).limit(1),
      supabase.from('patient_problems').select('*').eq('patient_id', pid).order('created_at'),
      supabase.from('patient_assessments').select('*').eq('patient_id', pid),
      supabase.from('patient_care_plans').select('*').eq('patient_id', pid).maybeSingle(),
      supabase.from('ccm_time_entries').select('*').eq('patient_id', pid).order('date', { ascending: false }),
    ]);
    setEnrollments(en.data || []);
    if (vt.data?.[0]) setVitals({ blood_pressure: vt.data[0].blood_pressure || '', heart_rate: vt.data[0].heart_rate || '', weight: vt.data[0].weight || '', a1c: vt.data[0].a1c || '', o2_saturation: (vt.data[0] as any).o2_saturation || '', height: (vt.data[0] as any).height || '', respiratory_rate: (vt.data[0] as any).respiratory_rate || '' });
    setProblems(pr.data || []);
    // ensure assessment rows exist
    const existing = asm.data || [];
    const missing = ASSESSMENT_DEFS.filter(d => !existing.find(e => e.assessment_type === d.type));
    if (missing.length && pid) {
      const rows = missing.map(m => ({ patient_id: pid, assessment_type: m.type, cadence: m.cadence, due_date: new Date().toISOString().split('T')[0], status: 'pending' }));
      const ins = await supabase.from('patient_assessments').insert(rows).select();
      setAssessments([...existing, ...(ins.data || [])]);
    } else {
      setAssessments(existing);
    }
    if (cp.data) setCarePlan({
      data: cp.data.data || {}, problem_plans: cp.data.problem_plans || {},
      next_review_date: cp.data.next_review_date || '', shared_date: cp.data.shared_date || '',
      shared_method: cp.data.shared_method || '', shared_with_patient: cp.data.shared_with_patient || false,
    });
    setTimeEntries(te.data || []);
  }

  async function reloadTimeEntries(pid: string) {
    const { data } = await supabase.from('ccm_time_entries').select('*').eq('patient_id', pid).order('date', { ascending: false });
    setTimeEntries(data || []);
  }

  // Auto-log a care-plan activity into the CCM time log.
  // Inserts with minutes=0 if patient isn't enrolled in CCM (the enrollment trigger only blocks minutes>0).
  // Description is prefixed `[Care Plan] …` so the log-history UI can render it as a distinct activity event.
  async function logCarePlanActivity(label: string, minutes: number) {
    if (!id) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const useMinutes = enrolled('CCM') ? minutes : 0;
    const { error } = await supabase.from('ccm_time_entries').insert({
      patient_id: id,
      user_id: user.id,
      date: new Date().toISOString().split('T')[0],
      minutes: useMinutes,
      program: 'CCM',
      description: `[Care Plan] ${label}`,
      staff: user.email ?? null,
    });
    if (!error) await reloadTimeEntries(id);
  }

  // Pull time accumulated by the Chart Flo Chrome extension while the user was inside
  // Practice Fusion (and other tracked sites) and import it as ccm_time_entries for this patient.
  // Matches extension entries by patient name (case-insensitive substring on first+last).
  // Entries flagged as Practice Fusion get a `[Practice Fusion]` description prefix for the log UI.
  const [syncingPF, setSyncingPF] = useState(false);
  async function syncPracticeFusionTime() {
    if (!id || !patient) return;
    setSyncingPF(true);
    try {
      const log = await getExternalTimeLog();
      if (!log.length) { toast.message('No external time captured by the extension yet.'); return; }
      const full = `${patient.firstName} ${patient.lastName}`.toLowerCase();
      const matches = log.filter(e => {
        if (!e?.minutes || e.minutes < 1) return false;
        const n = (e.patientName || '').toLowerCase();
        if (!n) return false;
        return n.includes(full) || full.includes(n);
      });
      if (!matches.length) { toast.message(`No tracked time found for ${patient.firstName} ${patient.lastName}.`); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('Not signed in'); return; }
      if (!enrolled('CCM')) { toast.error('Enroll patient in CCM before syncing Practice Fusion time.'); return; }
      const rows = matches.map(e => ({
        patient_id: id!,
        user_id: user.id,
        date: (e.timestamp || new Date().toISOString()).slice(0, 10),
        minutes: e.minutes,
        program: 'CCM',
        description: `[${e.site || 'Practice Fusion'}] ${(e as any).note || (e as any).activities?.join?.(', ') || 'Chart time tracked in Practice Fusion'}`,
        staff: user.email ?? null,
      }));
      const { error } = await supabase.from('ccm_time_entries').insert(rows);
      if (error) { toast.error(error.message); return; }
      // Drop the imported entries from extension storage so they aren't double-counted.
      // We clear the whole log; remaining entries for OTHER patients will be lost — acceptable today.
      await clearExternalTimeLog();
      await reloadTimeEntries(id);
      const total = matches.reduce((s, e) => s + e.minutes, 0);
      toast.success(`Synced ${matches.length} entries (${total} min) from Practice Fusion.`);
    } finally {
      setSyncingPF(false);
    }
  }

  // Build a monthly time-log SOAP note and push it to the Chrome extension so the
  // MA can paste it directly into the patient's Practice Fusion visit note for the
  // month. Also drops the formatted text on the clipboard as a fallback.
  const [pushingMonthlyLog, setPushingMonthlyLog] = useState(false);
  async function pushMonthlyTimeLogToPF() {
    if (!patient || !id) return;
    setPushingMonthlyLog(true);
    try {
      const today = new Date();
      const month = today.getMonth() + 1;
      const year = today.getFullYear();
      const monthName = today.toLocaleString('default', { month: 'long' });

      const logText = formatMonthlyTimeLog(timeEntries, {
        patientName: `${patient.firstName} ${patient.lastName}`,
        mrn: patient.mrn,
        month,
        year,
        program: 'CCM',
      });

      const totalMin = timeEntries
        .filter(e => {
          const d = new Date(e.date + 'T00:00:00');
          return d.getMonth() + 1 === month && d.getFullYear() === year && (e.minutes || 0) > 0;
        })
        .reduce((s, e) => s + (e.minutes || 0), 0);

      const subjective = `Chronic Care Management — ${monthName} ${year} monthly review for ${patient.firstName} ${patient.lastName}. ${totalMin} minutes of non-face-to-face CCM time documented this month.`;
      const objective = 'Non-face-to-face care management; no exam performed. See itemized time log in Plan section.';
      const assessment = 'Chronic care management services rendered per CMS 99490/99439 guidelines. Patient remains enrolled in CCM with consent on file.';

      const ok = await sendSOAPToExtension({
        subjective,
        objective,
        assessment,
        plan: logText,
        patientName: `${patient.firstName} ${patient.lastName}`,
        mrn: patient.mrn,
        date: today.toISOString().slice(0, 10),
      });

      // Always copy plain text too so the MA can paste straight into PF if the
      // extension isn't reachable on this device.
      try { await navigator.clipboard.writeText(logText); } catch { /* noop */ }

      toast.success(
        ok
          ? `Sent ${monthName} time log to Practice Fusion extension (${totalMin} min)`
          : `Time log copied to clipboard — paste into PF visit note (${totalMin} min)`
      );
    } catch (e: any) {
      toast.error(e?.message || 'Failed to push monthly time log');
    } finally {
      setPushingMonthlyLog(false);
    }
  }

  // Push today's CCM time log to the Chrome extension so the MA can paste it
  // straight into Practice Fusion as the day's visit-note documentation.
  const [pushingDailyLog, setPushingDailyLog] = useState(false);
  const [dailyLogDate, setDailyLogDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  async function pushDailyTimeLogToPF(targetDate: string) {
    if (!patient || !id) return;
    setPushingDailyLog(true);
    try {
      const dayObj = new Date(targetDate + 'T00:00:00');
      const dayLabel = dayObj.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

      const logText = formatDailyTimeLog(timeEntries, {
        patientName: `${patient.firstName} ${patient.lastName}`,
        mrn: patient.mrn,
        date: targetDate,
        program: 'CCM',
      });

      const dayEntries = timeEntries.filter(e => e.date === targetDate && (e.minutes || 0) > 0);
      const totalMin = dayEntries.reduce((s, e) => s + (e.minutes || 0), 0);

      if (totalMin === 0) {
        toast.error(`No CCM time logged on ${dayLabel}.`);
        return;
      }

      const subjective = `Chronic Care Management — daily note for ${dayLabel}. ${totalMin} minutes of non-face-to-face CCM time documented for ${patient.firstName} ${patient.lastName}.`;
      const objective = 'Non-face-to-face care management; no exam performed. See itemized time log in Plan section.';
      const assessment = 'Chronic care management services rendered per CMS 99490/99439 guidelines. Patient remains enrolled in CCM with consent on file.';

      const ok = await sendSOAPToExtension({
        subjective,
        objective,
        assessment,
        plan: logText,
        patientName: `${patient.firstName} ${patient.lastName}`,
        mrn: patient.mrn,
        date: targetDate,
      });

      try { await navigator.clipboard.writeText(logText); } catch { /* noop */ }

      toast.success(
        ok
          ? `Sent ${dayLabel} log to Practice Fusion extension (${totalMin} min)`
          : `Daily log copied to clipboard — paste into PF visit note (${totalMin} min)`
      );
    } catch (e: any) {
      toast.error(e?.message || 'Failed to push daily time log');
    } finally {
      setPushingDailyLog(false);
    }
  }


  



  

  const enrolled = (p: Program) => enrollments.some(e => e.program === p);
  const status = enrolled('CCM') || enrolled('RPM') ? (timeEntries.length ? 'In Progress' : 'Not Started') : 'Not Enrolled';

  async function toggleEnroll(program: Program) {
    if (!id) return;
    if (enrolled(program)) {
      await supabase.from('patient_enrollments').delete().eq('patient_id', id).eq('program', program);
    } else {
      await supabase.from('patient_enrollments').insert({ patient_id: id, program });
    }
    const { data } = await supabase.from('patient_enrollments').select('*').eq('patient_id', id);
    setEnrollments(data || []);
    toast.success(`${program} ${enrolled(program) ? 'removed' : 'enrolled'}`);
  }

  async function saveVitals() {
    if (!id) return;
    const { error } = await supabase.from('patient_vitals').insert({ patient_id: id, ...vitals });
    if (error) return toast.error(error.message);
    toast.success('Vitals saved');
  }

  async function addProblem() {
    if (!id || !newProblem.icd_code || !newProblem.description) return;
    const { data, error } = await supabase.from('patient_problems').insert({ patient_id: id, ...newProblem, program_tag: 'CCM' }).select();
    if (error) return toast.error(error.message);
    setProblems([...problems, ...(data || [])]);
    setNewProblem({ icd_code: '', description: '' });
  }

  async function removeProblem(pid: string) {
    await supabase.from('patient_problems').delete().eq('id', pid);
    setProblems(problems.filter(p => p.id !== pid));
  }

  async function completeAssessment(a: any) {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase.from('patient_assessments').update({ status: 'completed', completed_at: today }).eq('id', a.id).select();
    setAssessments(assessments.map(x => x.id === a.id ? data?.[0] || x : x));
    toast.success(`${a.assessment_type} marked complete`);
  }

  async function updateAssessmentNotes(a: any, notes: string) {
    setAssessments(assessments.map(x => x.id === a.id ? { ...x, notes } : x));
    await supabase.from('patient_assessments').update({ notes }).eq('id', a.id);
  }

  async function saveCarePlan() {
    if (!id) return;
    const payload = {
      patient_id: id,
      data: carePlan.data,
      problem_plans: carePlan.problem_plans,
      next_review_date: carePlan.next_review_date || null,
      shared_date: carePlan.shared_date || null,
      shared_method: carePlan.shared_method || null,
      shared_with_patient: carePlan.shared_with_patient,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('patient_care_plans').upsert(payload, { onConflict: 'patient_id' });
    if (error) return toast.error(error.message);
    toast.success('Care plan saved (15 min logged)');
    // Activity event in CCM log history — 15 min for care-plan creation/review.
    await logCarePlanActivity('Comprehensive care plan saved & reviewed', 15);
    if (carePlan.shared_with_patient && carePlan.shared_date) {
      await logCarePlanActivity(`Plan shared with patient/caregiver via ${carePlan.shared_method || 'documented method'}`, 1);
    }
  }

  async function generateCarePlan() {
    if (!id || !patient) return;
    setGenerating(true);
    try {
      // Pull recent notes from clinical_notes table for full context
      const { data: notesData } = await supabase
        .from('clinical_notes')
        .select('date, subjective, objective, assessment, plan')
        .eq('patient_id', id)
        .order('date', { ascending: false })
        .limit(5);

      // If no problems yet, auto-derive from most recent note via suggest-icd
      let workingProblems = problems;
      if (workingProblems.length === 0) {
        const latest = (notesData || [])[0];
        if (!latest || !(latest.assessment || latest.subjective)) {
          toast.error('No diagnoses on file and no recent notes to derive them from.');
          setGenerating(false);
          return;
        }
        toast.message('No problems on file — extracting diagnoses from the most recent note…');
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
          toast.error('Could not derive diagnoses from notes. Add them manually first.');
          setGenerating(false);
          return;
        }
        const rows = codes.map((c: any) => ({
          patient_id: id, icd_code: c.code, description: c.description, program_tag: 'CCM',
        }));
        const { data: inserted, error: insErr } = await supabase
          .from('patient_problems').insert(rows).select();
        if (insErr) throw insErr;
        workingProblems = inserted || [];
        setProblems([...problems, ...workingProblems]);
        toast.success(`Added ${workingProblems.length} diagnosis code(s) to the problem list.`);
      }

      const tpl = carePlanTemplates.find(t => t.id === selectedTemplateId);

      const { data, error } = await supabase.functions.invoke('generate-ccm-care-plan', {
        body: {
          patient: { firstName: patient.firstName, lastName: patient.lastName, dob: patient.dob },
          problems: workingProblems.map(p => ({ id: p.id, icd_code: p.icd_code, description: p.description })),
          medications: patient.medications || [],
          allergies: patient.allergies || [],
          recentNotes: notesData || [],
          templateContent: tpl?.content || null,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Map per-problem plans back to carePlan.problem_plans keyed by id
      const newProblemPlans: Record<string, { goal: string; intervention: string }> = { ...carePlan.problem_plans };
      (data.problem_plans || []).forEach((pp: any) => {
        if (pp.problem_id) {
          newProblemPlans[pp.problem_id] = { goal: pp.goal || '', intervention: pp.intervention || '' };
        }
      });

      const newData = {
        ...carePlan.data,
        expected_outcomes: data.expected_outcomes || carePlan.data?.expected_outcomes || '',
        symptom_plan: data.symptom_plan || carePlan.data?.symptom_plan || '',
        med_mgmt: data.med_mgmt || carePlan.data?.med_mgmt || '',
        preventive: data.preventive || carePlan.data?.preventive || '',
        community: data.community || carePlan.data?.community || '',
        care_coordination: data.care_coordination || carePlan.data?.care_coordination || '',
        caregivers: data.caregivers || carePlan.data?.caregivers || '',
        advance_dir: data.advance_dir || carePlan.data?.advance_dir || '',
        psychosocial: data.psychosocial || carePlan.data?.psychosocial || '',
        education: data.education || carePlan.data?.education || '',
      };

      const updatedPlan = { ...carePlan, problem_plans: newProblemPlans, data: newData };
      setCarePlan(updatedPlan);

      // Auto-persist so refreshes don't lose the generated plan
      const { error: saveErr } = await supabase.from('patient_care_plans').upsert({
        patient_id: id,
        data: updatedPlan.data,
        problem_plans: updatedPlan.problem_plans,
        next_review_date: updatedPlan.next_review_date || null,
        shared_date: updatedPlan.shared_date || null,
        shared_method: updatedPlan.shared_method || null,
        shared_with_patient: updatedPlan.shared_with_patient,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'patient_id' });
      if (saveErr) {
        toast.error('Generated but failed to auto-save: ' + saveErr.message);
      } else {
        toast.success('Care plan generated and saved (15 min logged) — review and refine as needed.');
        // Auto-log AI generation as a care-plan activity (15 min for care-plan creation).
        await logCarePlanActivity('AI-generated comprehensive care plan from patient data', 15);
      }
    } catch (e: any) {
      console.error('generateCarePlan failed', e);
      toast.error('Generation failed: ' + (e.message || 'unknown'));
    } finally {
      setGenerating(false);
    }
  }


  // CMS element completion auto-derived
  const cmsCompleted = useMemo(() => {
    const checks: Record<string, boolean> = {
      two_chronic: problems.length >= 2,
      measurable_goals: Object.values(carePlan.problem_plans || {}).some((p: any) => p?.goal),
      planned_interventions: Object.values(carePlan.problem_plans || {}).some((p: any) => p?.intervention),
      expected_outcomes: !!carePlan.data?.expected_outcomes,
      symptom_management: !!carePlan.data?.symptom_plan,
      medication_mgmt: !!carePlan.data?.med_mgmt,
      preventive_care: !!carePlan.data?.preventive,
      community_services: !!carePlan.data?.community,
      care_coordination: !!carePlan.data?.care_coordination,
      caregivers_identified: !!carePlan.data?.caregivers,
      advance_directives: !!carePlan.data?.advance_dir,
      periodic_review: !!carePlan.next_review_date,
      plan_provided: !!carePlan.shared_with_patient,
    };
    return checks;
  }, [problems, carePlan]);
  const cmsCount = Object.values(cmsCompleted).filter(Boolean).length;
  const draftedCount = problems.filter(p => carePlan.problem_plans?.[p.id]?.goal && carePlan.problem_plans?.[p.id]?.intervention).length;

  const minutesThisMonth = timeEntries
    .filter(t => t.date?.startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((s, t) => s + (t.minutes || 0), 0);

  if (!patient) return <div className="flex-1 flex items-center justify-center text-muted-foreground">Loading patient...</div>;

  return (
    <div className="flex-1 p-4 md:p-6 space-y-6 max-w-7xl mx-auto w-full">

      <Button variant="ghost" size="sm" onClick={() => navigate('/ccm')} className="gap-2">
        <ArrowLeft className="h-4 w-4" /> All patients
      </Button>

      {/* Header card */}
      <Card className="p-6 bg-card border-border">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold">{patient.lastName}, {patient.firstName}</h1>
            <p className="text-muted-foreground mt-1">DOB {patient.dob} · MRN {patient.mrn}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-sm">{status}</Badge>
            <SessionTimer />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {PROGRAMS.map(p => {
            const on = enrolled(p);
            return (
              <Button key={p} variant="outline" size="sm" onClick={() => toggleEnroll(p)}
                className={on ? 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10' : ''}>
                {on ? <Check className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                {p} {on ? 'Enrolled' : 'Enroll'}
              </Button>
            );
          })}
        </div>
      </Card>

      {/* Real-time billing meter + AVS */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-start">
        <BillingMeterCard
          patientId={patient.id}
          chronicConditionCount={problems.length}
        />
        <div className="flex flex-col gap-2">
          <AfterVisitSummaryDialog
            patientId={patient.id}
            patientName={`${patient.firstName} ${patient.lastName}`}
            note={{}}
          />
          <MonthlyCcmPdfButton
            patientId={patient.id}
            patient={{ firstName: patient.firstName, lastName: patient.lastName, dob: patient.dob, mrn: (patient as any).mrn, provider: (patient as any).provider }}
          />
        </div>
      </div>

      <Tabs defaultValue="patient" className="w-full">
        <TabsList className="bg-transparent border-b border-border w-full justify-start rounded-none h-auto p-0 gap-6">
          {['patient', 'clinical', 'billing', 'summary', 'assessments', 'care', 'encounters'].map((v, i) => (
            <TabsTrigger key={v} value={v}
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-1 pb-3 pt-2 text-base">
              {['Basic', 'Readings', 'Period', 'Summary', 'Assessments', 'Care Plan', 'Encounters'][i]}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* PATIENT INFO */}
        <TabsContent value="patient" className="mt-6 space-y-4">
          <Card className="p-6">
            <h3 className="text-sm font-semibold text-muted-foreground tracking-wider mb-4">DEMOGRAPHICS</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Info label="First name" value={patient.firstName} />
              <Info label="Last name" value={patient.lastName} />
              <Info label="DOB" value={patient.dob} />
              <Info label="MRN" value={patient.mrn} />
              <Info label="Gender" value={patient.gender} />
              <Info label="Phone" value={patient.phone || '—'} />
              <Info label="Provider" value={patient.provider || '—'} />
              <Info label="Location" value={patient.location || '—'} />
            </div>
            <Separator className="my-4" />
            <Info label="Allergies" value={patient.allergies?.join(', ') || 'NKDA'} />
          </Card>
        </TabsContent>

        {/* SUMMARY */}
        <TabsContent value="summary" className="mt-6 space-y-4">
          <Card className="p-6">
            <h3 className="text-sm font-semibold text-muted-foreground tracking-wider mb-4">CARE SUMMARY</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat label="Enrolled programs" value={enrollments.map(e => e.program).join(', ') || '—'} />
              <Stat label="Active problems" value={String(problems.length)} />
              <Stat label="Time this month" value={`${minutesThisMonth} min`} />
              <Stat label="CMS elements" value={`${cmsCount}/13`} />
            </div>
          </Card>
        </TabsContent>

        {/* CARE MANAGEMENT - Comprehensive Care Plan */}
        <TabsContent value="care" className="mt-6 space-y-6">
          <Card className="p-6 bg-card">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground tracking-wider">COMPREHENSIVE CARE PLAN</h3>
                <p className="text-sm text-muted-foreground mt-1">CMS-aligned CCM plan: problem list, goals, interventions, medications, coordination, and patient sharing.</p>
              </div>
              <Badge variant="outline" className="border-orange-500/40 text-orange-400 bg-orange-500/10">{cmsCount}/13 CMS elements</Badge>
            </div>

            {/* AI Generate from Patient Data */}
            <Card className="p-4 bg-primary/5 border-primary/20 mb-6">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    AI-Generated Personalized Care Plan
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Builds a CMS-compliant plan from this patient's diagnoses, medications, allergies, and recent SOAP notes. Optionally seed with a template from Settings → Care Plans.
                  </p>
                </div>
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="min-w-[180px]">
                    <Label className="text-xs">Template (optional)</Label>
                    <Select value={selectedTemplateId || 'none'} onValueChange={(v) => setSelectedTemplateId(v === 'none' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="No template" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No template</SelectItem>
                        {carePlanTemplates.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name} ({t.program})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={generateCarePlan} disabled={generating} className="gap-2">
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {generating ? 'Generating…' : 'Generate from Patient Data'}
                  </Button>

                </div>
              </div>
            </Card>


            {/* CMS checklist */}
            <Card className="p-4 bg-background/40 mb-6">
              <h4 className="font-semibold mb-3">CMS CCM Plan Elements</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                {CMS_ELEMENTS.map(el => {
                  const ok = cmsCompleted[el.key];
                  return (
                    <div key={el.key} className="flex items-center gap-2">
                      {ok ? <Check className="h-4 w-4 text-emerald-500" /> : <X className="h-4 w-4 text-muted-foreground" />}
                      <span className={ok ? '' : 'text-muted-foreground'}>{el.label}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Problem list with per-condition plans */}
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-muted-foreground tracking-wider">PROBLEM LIST & PER-CONDITION PLAN</h4>
              <Badge variant="outline">{draftedCount}/{problems.length || 0} drafted</Badge>
            </div>
            <div className="space-y-2 mb-4">
              {problems.map(p => {
                const plan = carePlan.problem_plans?.[p.id] || {};
                const drafted = plan.goal && plan.intervention;
                return (
                  <Card key={p.id} className="p-3 bg-background/40">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-3">
                        <code className="text-primary font-mono text-sm">{p.icd_code}</code>
                        <span>{p.description}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={drafted ? 'border-emerald-500/40 text-emerald-400' : ''}>
                          {drafted ? 'Drafted' : 'No plan'}
                        </Badge>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeProblem(p.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Textarea placeholder="Measurable goal..." rows={2}
                        value={plan.goal || ''}
                        onChange={e => setCarePlan({ ...carePlan, problem_plans: { ...carePlan.problem_plans, [p.id]: { ...plan, goal: e.target.value } } })} />
                      <Textarea placeholder="Planned intervention..." rows={2}
                        value={plan.intervention || ''}
                        onChange={e => setCarePlan({ ...carePlan, problem_plans: { ...carePlan.problem_plans, [p.id]: { ...plan, intervention: e.target.value } } })} />
                    </div>
                  </Card>
                );
              })}
              {problems.length === 0 && <p className="text-sm text-muted-foreground">No problems added yet. Add them in the Clinical Data tab.</p>}
            </div>

            {/* Plan-level elements */}
            <h4 className="text-sm font-semibold text-muted-foreground tracking-wider mb-3">PLAN-LEVEL ELEMENTS (CMS REQUIRED)</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {PLAN_FIELDS.map(f => (
                <div key={f.key}>
                  <Label className="text-sm font-semibold mb-1.5 block">{f.label}</Label>
                  <Textarea rows={3} placeholder={f.placeholder}
                    value={carePlan.data?.[f.key] || ''}
                    onChange={e => setCarePlan({ ...carePlan, data: { ...carePlan.data, [f.key]: e.target.value } })} />
                </div>
              ))}
            </div>

            <Separator className="my-4" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label className="text-sm font-semibold mb-1.5 block">Next plan review date</Label>
                <Input type="date" value={carePlan.next_review_date || ''} onChange={e => setCarePlan({ ...carePlan, next_review_date: e.target.value })} />
              </div>
              <div>
                <Label className="text-sm font-semibold mb-1.5 block">Date plan shared with patient/caregiver</Label>
                <Input type="date" value={carePlan.shared_date || ''} onChange={e => setCarePlan({ ...carePlan, shared_date: e.target.value })} />
              </div>
              <div>
                <Label className="text-sm font-semibold mb-1.5 block">Method shared</Label>
                <Select value={carePlan.shared_method || ''} onValueChange={v => setCarePlan({ ...carePlan, shared_method: v })}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portal">Patient portal</SelectItem>
                    <SelectItem value="paper">Paper copy</SelectItem>
                    <SelectItem value="email">Secure email</SelectItem>
                    <SelectItem value="verbal">Verbal review</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator className="my-4" />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={carePlan.shared_with_patient} onCheckedChange={v => setCarePlan({ ...carePlan, shared_with_patient: !!v })} />
                Comprehensive care plan provided to patient / caregiver (CMS requirement)
              </label>
              <Button onClick={saveCarePlan} className="gap-2"><Save className="h-4 w-4" /> Save comprehensive plan</Button>
            </div>
          </Card>

          {/* Log history */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground tracking-wider">LOG HISTORY ({timeEntries.length})</h3>
                <p className="text-xs text-muted-foreground mt-1">In-app timer entries, care-plan events, and time tracked inside Practice Fusion.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-2" onClick={syncPracticeFusionTime} disabled={syncingPF}>
                  {syncingPF ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Sync Practice Fusion time
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="gap-2"
                  onClick={pushMonthlyTimeLogToPF}
                  disabled={pushingMonthlyLog}
                  title="Send this month's CCM time log to Practice Fusion via the Chrome extension"
                >
                  {pushingMonthlyLog ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Push monthly log to PF
                </Button>
                <div className="flex items-center gap-1 rounded-md border border-border bg-background pl-2">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="date"
                    value={dailyLogDate}
                    onChange={(e) => setDailyLogDate(e.target.value)}
                    className="h-8 w-[140px] border-0 bg-transparent px-1 text-xs focus-visible:ring-0"
                    aria-label="Daily log date"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-2 rounded-l-none"
                    onClick={() => pushDailyTimeLogToPF(dailyLogDate)}
                    disabled={pushingDailyLog}
                    title="Send the selected day's CCM time log to Practice Fusion"
                  >
                    {pushingDailyLog ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Push daily log
                  </Button>
                </div>
                <Button variant="outline" size="sm" className="gap-2"><Download className="h-4 w-4" /> Export All</Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border">
                  <tr><th className="text-left py-2 px-2">Date</th><th className="text-left py-2 px-2">Task</th><th className="text-left py-2 px-2">Source</th><th className="text-left py-2 px-2">Duration</th><th className="text-left py-2 px-2">MA</th><th className="text-right py-2 px-2">Actions</th></tr>
                </thead>
                <tbody>
                  {timeEntries.map(t => {
                    const desc: string = t.description || '';
                    const isCarePlan = desc.startsWith('[Care Plan]');
                    const isPF = desc.startsWith('[Practice Fusion]') || desc.startsWith('[Updox]') || desc.startsWith('[CoverMyMeds]') || desc.startsWith('[Microsoft Teams]');
                    const cleanTask = desc.replace(/^\[[^\]]+\]\s*/, '');
                    const rowClass = isCarePlan ? 'border-b border-border/40 bg-primary/5'
                      : isPF ? 'border-b border-border/40 bg-emerald-500/5'
                      : 'border-b border-border/40';
                    const sourceLabel = isCarePlan ? 'Care Plan'
                      : isPF ? (desc.match(/^\[([^\]]+)\]/)?.[1] || 'Practice Fusion')
                      : `Chart Flo ${t.program}`;
                    const SourceIcon = isCarePlan ? ClipboardList : isPF ? Monitor : Activity;
                    return (
                      <tr key={t.id} className={rowClass}>
                        <td className="py-3 px-2 whitespace-nowrap">{t.date}</td>
                        <td className="py-3 px-2">{cleanTask || '—'}</td>
                        <td className="py-3 px-2">
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <SourceIcon className="h-3.5 w-3.5" />
                            {sourceLabel}
                          </span>
                        </td>
                        <td className="py-3 px-2 font-mono">{t.minutes}m</td>
                        <td className="py-3 px-2 text-muted-foreground">{t.staff || '—'}</td>
                        <td className="py-3 px-2 text-right">
                          <Button variant="ghost" size="icon" className="h-7 w-7"><Copy className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={async () => { await supabase.from('ccm_time_entries').delete().eq('id', t.id); setTimeEntries(timeEntries.filter(x => x.id !== t.id)); }}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {timeEntries.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No time logged yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>


        {/* ASSESSMENTS */}
        <TabsContent value="assessments" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assessments.map(a => (
              <Card key={a.id} className="p-5 bg-card">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <h4 className="font-semibold">{a.assessment_type}</h4>
                  </div>
                  <Badge variant="outline" className={a.status === 'completed' ? 'border-emerald-500/40 text-emerald-400' : ''}>
                    {a.status === 'completed' ? 'Complete' : 'Pending'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-3">Cadence: {a.cadence}</p>
                <Label className="text-xs font-semibold">Date</Label>
                <div className="flex gap-2 mt-1 mb-3">
                  <Input type="date" value={a.completed_at || a.due_date || ''} onChange={async e => {
                    const v = e.target.value;
                    setAssessments(assessments.map(x => x.id === a.id ? { ...x, due_date: v } : x));
                    await supabase.from('patient_assessments').update({ due_date: v }).eq('id', a.id);
                  }} className="flex-1" />
                  <Button onClick={() => completeAssessment(a)} disabled={a.status === 'completed'}>Mark Complete</Button>
                </div>
                <Textarea placeholder="Notes..." rows={3} value={a.notes || ''} onChange={e => updateAssessmentNotes(a, e.target.value)} />
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* CLINICAL DATA */}
        <TabsContent value="clinical" className="mt-6 space-y-4">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <HeartPulse className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-semibold text-muted-foreground tracking-wider">VITALS & LABS</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label className="text-sm font-semibold mb-1.5 block">Blood Pressure</Label><Input placeholder="120/80" value={vitals.blood_pressure} onChange={e => setVitals({ ...vitals, blood_pressure: e.target.value })} /></div>
              <div><Label className="text-sm font-semibold mb-1.5 block">Heart Rate</Label><Input placeholder="bpm" value={vitals.heart_rate} onChange={e => setVitals({ ...vitals, heart_rate: e.target.value })} /></div>
              <div><Label className="text-sm font-semibold mb-1.5 block">Weight</Label><Input placeholder="lbs" value={vitals.weight} onChange={e => setVitals({ ...vitals, weight: e.target.value })} /></div>
              <div><Label className="text-sm font-semibold mb-1.5 block">A1C</Label><Input placeholder="%" value={vitals.a1c} onChange={e => setVitals({ ...vitals, a1c: e.target.value })} /></div>
              <div><Label className="text-sm font-semibold mb-1.5 block">O2 Saturation</Label><Input placeholder="%" value={vitals.o2_saturation} onChange={e => setVitals({ ...vitals, o2_saturation: e.target.value })} /></div>
              <div><Label className="text-sm font-semibold mb-1.5 block">Height</Label><Input placeholder="in or cm" value={vitals.height} onChange={e => setVitals({ ...vitals, height: e.target.value })} /></div>
              <div><Label className="text-sm font-semibold mb-1.5 block">Respiratory Rate</Label><Input placeholder="breaths/min" value={vitals.respiratory_rate} onChange={e => setVitals({ ...vitals, respiratory_rate: e.target.value })} /></div>
            </div>
            <Button onClick={saveVitals} className="w-full mt-4 gap-2"><Activity className="h-4 w-4" /> Save Vitals</Button>
          </Card>

          <Card className="p-6">
            <h3 className="text-sm font-semibold text-muted-foreground tracking-wider mb-4">PROBLEM LIST ({problems.length})</h3>
            <div className="space-y-2 mb-3">
              {problems.map(p => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-border/40">
                  <div className="flex items-center gap-3"><code className="text-primary font-mono text-sm">{p.icd_code}</code><span>{p.description}</span></div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{p.program_tag}</Badge>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeProblem(p.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input placeholder="ICD-10 (e.g. E11.9)" value={newProblem.icd_code} onChange={e => setNewProblem({ ...newProblem, icd_code: e.target.value })} className="w-40 font-mono" />
              <Input placeholder="Description" value={newProblem.description} onChange={e => setNewProblem({ ...newProblem, description: e.target.value })} className="flex-1" />
              <Button onClick={addProblem} className="gap-1"><Plus className="h-4 w-4" /> Add</Button>
            </div>
          </Card>
        </TabsContent>

        {/* BILLING */}
        <TabsContent value="billing" className="mt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-5"><p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Period</p><p className="text-2xl font-bold">{new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</p></Card>
            <Card className="p-5"><p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Minutes Logged</p><p className="text-2xl font-bold">{minutesThisMonth} <span className="text-base font-normal text-muted-foreground">min</span></p></Card>
            <Card className="p-5"><p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Est. Reimbursement</p><p className="text-2xl font-bold text-emerald-400">${estReimb(minutesThisMonth)}</p></Card>
          </div>
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase tracking-wider border-b border-border">
                <tr><th className="text-left py-3 px-4">CPT</th><th className="text-left py-3 px-4">Description</th><th className="text-left py-3 px-4">Min Req.</th><th className="text-left py-3 px-4">2026 Rate</th><th className="text-left py-3 px-4">Status</th></tr>
              </thead>
              <tbody>
                {CPT_CODES.map(c => {
                  const eligible = c.min === 0 ? true : minutesThisMonth >= c.min;
                  return (
                    <tr key={c.code} className="border-b border-border/40">
                      <td className="py-3 px-4 font-mono font-bold">{c.code}</td>
                      <td className="py-3 px-4">{c.desc}</td>
                      <td className="py-3 px-4 text-muted-foreground">{c.min > 0 ? `${c.min} min` : '—'}</td>
                      <td className="py-3 px-4">${c.reimb.toFixed(2)}</td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className={eligible ? 'border-emerald-500/40 text-emerald-400' : ''}>
                          {eligible ? 'Eligible' : '—'}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        {/* ENCOUNTERS */}
        <TabsContent value="encounters" className="mt-6">
          <Card className="p-4 md:p-6">
            <EncounterPanel patient={patient} problems={problems} />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SessionTimer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(i);
  }, []);
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return (
    <span className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-semibold rounded-md px-3 py-1.5 tabular-nums" title="Time on this chart">
      <Clock className="w-4 h-4" /> {h}:{m}:{s}
    </span>
  );
}

function estReimb(min: number) {
  let total = 0;
  if (min >= 20) total += 62;
  if (min >= 40) total += 47;
  if (min >= 60) total += 47;
  return total;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p><p className="font-medium">{value}</p></div>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p><p className="text-xl font-bold">{value}</p></div>;
}
