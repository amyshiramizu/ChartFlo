import { useState, useEffect, useRef } from 'react';
import { usePatientStore } from '@/store/patientStore';
import type { Patient, ClinicalNote } from '@/types/patient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Mic, MicOff, Save, History, Radio, Send, Sparkles, Plus, X, ClipboardList, Receipt, FileOutput, Stethoscope, Award, FileText, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { PatientTimeline } from '@/components/PatientTimeline';
import { useDictation } from '@/hooks/useDictation';
import { AmbientDictation } from '@/components/AmbientDictation';
import { sendSOAPToExtension, sendOrdersToExtension, type MedData } from '@/lib/practiceFusionBridge';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { CMSChecklistCard } from '@/components/CMSChecklistCard';
import { validateCMSChecklist } from '@/lib/cmsChecklist';
import { openOrdersPrintWindow, buildOrdersSummary } from '@/lib/orderExport';
import { AWV_TEMPLATES, type AWVType } from '@/lib/medicareWellnessTemplate';
import { TCMBillingPanel } from '@/components/TCMBillingPanel';
import { recommendPrograms } from '@/lib/careProgramRecommendation';
import { extractAndApply, summarizeResult } from '@/lib/extractClinicalData';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';


interface NoteEditorProps {
  patient: Patient;
  onSaved: () => void;
}

interface Diagnosis {
  id: string;
  code: string;
  description: string;
  plan: string;
}

type SimpleField = 'subjective' | 'objective';

export function NoteEditor({ patient, onSaved }: NoteEditorProps) {
  const { addNote, templates, addMedication, updateMedication } = usePatientStore();
  const { isListening, transcript, startListening, stopListening, resetTranscript, isSupported } = useDictation();
  const [activeField, setActiveField] = useState<SimpleField>('subjective');
  const [selectedTemplate, setSelectedTemplate] = useState(templates[0]?.id || '');

  const lastNote = patient.notes.length > 0
    ? [...patient.notes].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
    : null;

  // Parse Chief Complaint out of prior subjective so we can prefill it cleanly.
  const splitCC = (text: string): { cc: string; rest: string } => {
    if (!text) return { cc: '', rest: '' };
    const m = text.match(/^\s*Chief Complaint:\s*([^\n]*)\n*([\s\S]*)$/i);
    return m ? { cc: m[1].trim(), rest: m[2].trim() } : { cc: '', rest: text };
  };
  const priorParsed = splitCC(lastNote?.subjective || '');

  const [chiefComplaint, setChiefComplaint] = useState(priorParsed.cc);
  const [subjective, setSubjective] = useState(priorParsed.rest);
  const DEFAULT_OBJECTIVE_TEMPLATE =
    `General: No acute distress. Awake and conversant.
Psych: Alert and oriented. Cooperative, Appropriate mood and affect, Normal judgment.
Eyes: Normal conjunctiva, anicteric. Round symmetric pupils.
ENT: Hearing grossly intact. No nasal discharge. Oral mucosa is moist. Neck is supple. No masses or thyromegaly.
Respiratory: Respirations are non-labored. Lungs are clear to auscultation.
CV: Normal S1 and S2. No S3, S4 or murmurs. Rhythm is regular. There is no peripheral edema, cyanosis or pallor. Extremities are warm and well perfused. Capillary refill is less than 2 seconds.
Abdomen: Positive bowel sounds. Soft, nondistended, nontender. No guarding or rebound. No masses. MSK: Normal ambulation. No clubbing or cyanosis.
Skin: Warm and intact. No rashes or ulcers.
Neuro: Sensation and CN II-XII grossly normal.`;
  const [objective, setObjective] = useState(lastNote?.objective || DEFAULT_OBJECTIVE_TEMPLATE);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);

  const [wasDictated, setWasDictated] = useState(false);
  const [dictationMode, setDictationMode] = useState<'field' | 'ambient'>('ambient');
  const [icdLoading, setIcdLoading] = useState(false);
  const [icdSuggestions, setIcdSuggestions] = useState<
    Array<{ code: string; description: string; confidence: string; rationale: string }>
  >([]);
  const [programSuggestions, setProgramSuggestions] = useState<
    Array<{
      program: 'CCM' | 'RPM';
      eligible: boolean;
      confidence: string;
      rationale: string;
      qualifying_codes: string[];
      care_plan_focus: string;
    }>
  >([]);
  const [cptLoading, setCptLoading] = useState(false);
  const [visitMinutes, setVisitMinutes] = useState<string>('');
  const [patientStatus, setPatientStatus] = useState<'new' | 'established'>('established');
  const [cptResult, setCptResult] = useState<{
    codes: Array<{
      code: string; description: string; category: string; units?: number;
      modifiers?: string[]; confidence: string; rationale: string; time_or_mdm?: string;
      est_revenue_usd?: number;
    }>;
    documentation_gaps: string[];
    estimated_total_rvu_band?: string;
    estimated_total_revenue_usd?: number;
  } | null>(null);
  const [mipsLoading, setMipsLoading] = useState(false);
  const [mipsResult, setMipsResult] = useState<{
    measures: Array<{
      measure_id: string; title: string; category: string;
      status: 'met' | 'not_met' | 'eligible_not_documented';
      rationale: string; action: string;
    }>;
    documentation_gaps?: string[];
  } | null>(null);
  const [forceSave, setForceSave] = useState(false);
  // Accumulated medication changes from this visit (extracted from note or added manually)
  // — forwarded to the PF Chrome extension alongside the SOAP note.
  const pendingMedChangesRef = useRef<MedData[]>([]);



  const serializeAssessment = (dx: Diagnosis[]) =>
    dx.length
      ? dx.map((d, i) => `${i + 1}. ${d.code} — ${d.description}`).join('\n')
      : '';

  const serializePlan = (dx: Diagnosis[]) =>
    dx.length
      ? dx.map((d) => `${d.code} — ${d.description}:\n${d.plan || '(no plan documented)'}`).join('\n\n')
      : '';

  // Append a new ambient-dictated chunk onto the existing chart context with a dated
  // separator so the SOAP note grows as a continuous, timestamped patient timeline.
  const handleApplyAmbient = (ambientNote: Pick<ClinicalNote, 'subjective' | 'objective' | 'assessment' | 'plan'> & { chiefComplaint?: string }) => {
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const stamp = (label: string) => `\n\n— ${today} · ${label} —\n`;

    const appendSection = (prev: string, next: string, label: string) => {
      const incoming = (next || '').trim();
      if (!incoming) return prev;
      const base = (prev || '').trimEnd();
      return base ? `${base}${stamp(label)}${incoming}` : `${label === 'New entry' ? '' : stamp(label).trim() + '\n'}${incoming}`;
    };

    // Prefer the dedicated chiefComplaint field from the ambient AI; fall back to
    // parsing any "Chief Complaint:" line embedded in subjective for older callers.
    const incomingParsed = splitCC(ambientNote.subjective || '');
    const incomingCC = (ambientNote.chiefComplaint || '').trim() || incomingParsed.cc;
    if (incomingCC) {
      setChiefComplaint((prev) => (prev?.trim() ? prev : incomingCC));
    }
    setSubjective((p) => appendSection(p, incomingParsed.rest, 'New entry'));
    setObjective((p) => appendSection(p, ambientNote.objective, 'New entry'));

    if (ambientNote.assessment || ambientNote.plan) {
      setDiagnoses((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          code: '',
          description: `[${today}] ${ambientNote.assessment || 'Unassigned'}`,
          plan: ambientNote.plan || '',
        },
      ]);
    }
    setWasDictated(true);
    toast.success('Appended dictation to continuous patient timeline');

    // Auto-insert HHF2F certification when the visit discusses initiating home health
    const combined = `${ambientNote.subjective || ''}\n${ambientNote.objective || ''}\n${ambientNote.assessment || ''}\n${ambientNote.plan || ''}`.toLowerCase();
    // Normalize common synonyms/abbreviations to "home health" for proximity matching
    const normalized = combined
      .replace(/\bhome\s*health\s*(care|agency|services?|aide|nursing|nurse|team)\b/g, 'home health')
      .replace(/\bhha\b|\bvna\b|\bhhc\b/g, 'home health')
      .replace(/\bskilled\s+(nursing|home)\s+(care|services?)\b/g, 'home health');
    const hasHH = /\bhome health\b/.test(normalized);
    // Broad set of initiation verbs/phrases with variants and common misspellings
    const initiationRe = /\b(start\w*|initiat\w*|begin\w*|commenc\w*|refer\w*|refferal|referral|order\w*|enroll\w*|enrol\w*|sign\w*\s*(her|him|them|pt|patient)?\s*up|set\w*\s*up|setting\s*up|arrang\w*|coordinat\w*|consult\w*|request\w*|recommend\w*|qualif\w*|eligib\w*|certif\w*|recertif\w*|prescrib\w*|activat\w*|get\w*\s*(her|him|them|pt|patient)\s*on|put\w*\s*(her|him|them|pt|patient)\s*on|send\w*\s*(her|him|them|pt|patient)?\s*(to|for)|f2f|face[-\s]*to[-\s]*face|plan\s*of\s*care)\b/;
    // Require verb within ~80 chars of "home health" for relevance
    let triggers = false;
    if (hasHH) {
      const idx = normalized.indexOf('home health');
      const window = normalized.slice(Math.max(0, idx - 80), idx + 'home health'.length + 80);
      triggers = initiationRe.test(window);
    }
    if (triggers) {
      setTimeout(() => {
        if (!diagnoses.some((d) => d.plan.includes('HOME HEALTH FACE-TO-FACE CERTIFICATION'))) {
          insertHHF2FTemplate();
        }
      }, 0);
    }
  };



  const handleScreeningsExtracted = async (
    screenings: Array<{ assessment_type: string; score?: string; severity?: string; findings: string; completed: boolean; partial?: boolean }>,
  ) => {
    if (!screenings.length || !patient?.id) return;
    const today = new Date().toISOString().split('T')[0];

    // Pull existing assessment rows for this patient so we can match by exact type.
    const { data: existing } = await supabase
      .from('patient_assessments')
      .select('id, assessment_type, notes, status, completed_at')
      .eq('patient_id', patient.id);
    const byType = new Map((existing || []).map((r) => [r.assessment_type, r]));

    let completedCount = 0;
    let partialCount = 0;
    for (const s of screenings) {
      // Only mark complete when AI confirmed completion AND (a numeric score is present
      // OR it's a non-scored instrument). Otherwise treat as in-progress / partial.
      const SCORED = new Set([
        'Depression Screening (PHQ-9)',
        'Anxiety Screening (GAD-7)',
        'Cognitive Screening',
        'Alcohol Use Screening (AUDIT-C)',
      ]);
      const needsScore = SCORED.has(s.assessment_type);
      const hasScore = !!(s.score && /\d/.test(s.score));
      const isComplete = s.completed && !s.partial && (!needsScore || hasScore);

      const tag = isComplete ? 'completed' : 'partial';
      const findingsLine = [
        s.score ? `Score ${s.score}` : null,
        s.severity ? `Severity ${s.severity}` : null,
        s.findings,
        `(${tag} ${today} via ambient note)`,
      ].filter(Boolean).join(' — ');

      const row = byType.get(s.assessment_type);
      if (row) {
        const mergedNotes = [row.notes, findingsLine].filter(Boolean).join('\n');
        const update: Record<string, unknown> = { notes: mergedNotes };
        if (isComplete) {
          update.status = 'completed';
          update.completed_at = today;
        } else if (row.status !== 'completed') {
          // Don't downgrade a previously completed row.
          update.status = 'in_progress';
        }
        const { error } = await supabase
          .from('patient_assessments')
          .update(update)
          .eq('id', row.id);
        if (!error) isComplete ? completedCount++ : partialCount++;
      } else {
        const { error } = await supabase.from('patient_assessments').insert({
          patient_id: patient.id,
          assessment_type: s.assessment_type,
          cadence: 'Annual',
          status: isComplete ? 'completed' : 'in_progress',
          completed_at: isComplete ? today : null,
          notes: findingsLine,
        });
        if (!error) isComplete ? completedCount++ : partialCount++;
      }
    }
    const parts: string[] = [];
    if (completedCount) parts.push(`${completedCount} completed`);
    if (partialCount) parts.push(`${partialCount} partial`);
    if (parts.length) toast.success(`Screenings updated: ${parts.join(', ')}`);
  };

  const normalizeMedName = (s: string) =>
    (s || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  const handleMedicationsExtracted = async (
    meds: Array<{ name: string; dosage?: string; frequency?: string; route?: string; action: 'start' | 'change' | 'stop' | 'continue'; instructions?: string }>,
  ) => {
    if (!meds.length || !patient?.id) return;
    const today = new Date().toISOString().split('T')[0];
    let added = 0, changed = 0, stopped = 0, skipped = 0;

    for (const m of meds) {
      if (!m.name?.trim()) continue;
      const key = normalizeMedName(m.name);
      const existing = patient.medications.find(em => normalizeMedName(em.name) === key);

      if (m.action === 'stop') {
        if (existing && existing.active) {
          await updateMedication(patient.id, existing.id, { active: false });
          stopped++;
          pendingMedChangesRef.current.push({
            name: existing.name, dosage: existing.dosage, frequency: existing.frequency,
            route: existing.route, action: 'stop', instructions: m.instructions,
          });
        }
        continue;
      }

      if (m.action === 'change' && existing) {
        await updateMedication(patient.id, existing.id, {
          dosage: m.dosage || existing.dosage,
          frequency: m.frequency || existing.frequency,
          route: m.route || existing.route,
          active: true,
          prescribedDate: today,
        });
        changed++;
        pendingMedChangesRef.current.push({
          name: existing.name,
          dosage: m.dosage || existing.dosage,
          frequency: m.frequency || existing.frequency,
          route: m.route || existing.route,
          action: 'change',
          instructions: m.instructions,
        });
        continue;
      }

      // start / continue
      if (existing && existing.active) {
        // already on the list with same name — skip to avoid duplicates
        skipped++;
        if (m.action === 'continue') {
          pendingMedChangesRef.current.push({
            name: existing.name, dosage: existing.dosage, frequency: existing.frequency,
            route: existing.route, action: 'continue', instructions: m.instructions,
          });
        }
        continue;
      }
      await addMedication(patient.id, {
        id: crypto.randomUUID(),
        name: m.name.trim(),
        dosage: m.dosage || '',
        frequency: m.frequency || '',
        route: m.route || 'oral',
        prescribedDate: today,
        active: true,
      });
      added++;
      pendingMedChangesRef.current.push({
        name: m.name.trim(),
        dosage: m.dosage || '',
        frequency: m.frequency || '',
        route: m.route || 'oral',
        action: 'start',
        instructions: m.instructions,
      });
    }

    const parts: string[] = [];
    if (added) parts.push(`${added} added`);
    if (changed) parts.push(`${changed} updated`);
    if (stopped) parts.push(`${stopped} discontinued`);
    if (parts.length) toast.success(`Medication list: ${parts.join(', ')}`);
    else if (skipped) toast.message(`Medications already on list (${skipped} skipped)`);
  };

  const handleDictate = () => {
    if (isListening) {
      stopListening();
      if (transcript) {
        if (activeField === 'subjective') {
          setSubjective((p) => (p ? `${p} ${transcript}` : transcript));
        } else {
          setObjective((p) => (p ? `${p} ${transcript}` : transcript));
        }
        setWasDictated(true);
        resetTranscript();
      }
    } else {
      startListening();
    }
  };

  const handlePrefill = () => {
    if (!lastNote) return;
    setObjective(lastNote.objective || '');
    toast.success('Prefilled Objective from last encounter');
  };

  const handleSuggestICD = async () => {
    const payload = {
      subjective,
      objective,
      assessment: serializeAssessment(diagnoses),
      plan: serializePlan(diagnoses),
      patient_id: patient.id,
    };
    if (!subjective && !objective && !diagnoses.length) {
      toast.error('Add some visit content first');
      return;
    }
    setIcdLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('suggest-icd', { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setIcdSuggestions(data?.codes || []);
      setProgramSuggestions(data?.programs || []);
      if (!data?.codes?.length) toast.message('No diagnosis codes suggested');
    } catch (err: any) {
      toast.error('Diagnosis suggestion failed: ' + (err.message || 'Unknown error'));
    } finally {
      setIcdLoading(false);
    }
  };

  const handleSuggestCPT = async () => {
    if (!subjective && !objective && !diagnoses.length) {
      toast.error('Add some visit content first');
      return;
    }
    setCptLoading(true);
    try {
      const payload = {
        subjective,
        objective,
        assessment: serializeAssessment(diagnoses),
        plan: serializePlan(diagnoses),
        diagnoses: diagnoses.map((d) => ({ code: d.code, description: d.description })),
        patientStatus,
        visitMinutes: visitMinutes ? Number(visitMinutes) : null,
        setting: 'home',
      };
      const { data, error } = await supabase.functions.invoke('suggest-cpt', { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCptResult(data);
      if (!data?.codes?.length) toast.message('No CPT codes suggested');
    } catch (err: any) {
      toast.error('CPT suggestion failed: ' + (err.message || 'Unknown error'));
    } finally {
      setCptLoading(false);
    }
  };


  // Auto-suggest ICD-10 codes when substantial subjective/assessment content appears
  // (e.g. after AI structures dictation). Debounced; runs only when no diagnoses or
  // suggestions are present yet and no manual run is in flight.
  const autoSuggestSigRef = useRef<string>('');
  useEffect(() => {
    const sig = `${subjective}|${diagnoses.map((d) => d.description).join(',')}`;
    if (icdLoading) return;
    if (diagnoses.length > 0) return;
    if (icdSuggestions.length > 0) return;
    const hasContent =
      (subjective?.trim().length || 0) > 80 || (objective?.trim().length || 0) > 120;
    if (!hasContent) return;
    if (autoSuggestSigRef.current === sig) return;
    autoSuggestSigRef.current = sig;
    const t = setTimeout(() => {
      handleSuggestICD();
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjective, objective, diagnoses.length]);


  const addDiagnosis = (code = '', description = '', plan = '') => {
    setDiagnoses((prev) => [...prev, { id: crypto.randomUUID(), code, description, plan }]);
  };

  const insertAWVTemplate = (type: AWVType) => {
    const tpl = AWV_TEMPLATES[type];
    // Avoid duplicate AWV entries
    if (diagnoses.some((d) => d.plan.includes('MEDICARE') && d.plan.includes('ANNUAL WELLNESS VISIT'))) {
      toast.info('AWV template already added to Assessment');
      return;
    }
    addDiagnosis(tpl.icd10, `Encounter for ${tpl.description} (${tpl.hcpcs})`, tpl.plan);
    toast.success(`Inserted ${tpl.label} template`);
  };

  const HHF2F_TEMPLATE = (dateStr: string) => `HOME HEALTH FACE-TO-FACE CERTIFICATION (HHF2F)

Face-to-Face Encounter:
I certify that this patient had a face-to-face encounter with me on ${dateStr} related to the primary reason for home health services. The clinical findings from this encounter support the patient's need for intermittent skilled nursing and/or therapy services due to:
  [ ] Acute onset of condition
  [ ] Recent exacerbation of chronic illness
  [ ] Recent functional decline
  [ ] Post-hospitalization / recent illness
  [ ] Worsening of baseline medical condition

Diagnoses:
  • Primary diagnosis (PDGM-eligible disease process — not a symptom): [____]
  • Secondary diagnosis(es): [____]
  • Relevant comorbidities: [____]

Clinical Status (Support for Skilled Need):
Patient is experiencing:
  [ ] Acute change in condition
  [ ] Exacerbation of chronic disease
  [ ] Decline in functional status
  [ ] Increased symptom burden
  [ ] Recent fall or safety event
  [ ] New or worsening cognitive impairment
Resulting in:
  • Increased risk for falls, hospitalization, or complications
  • Need for close monitoring and skilled intervention

Homebound Status:
The patient is homebound due to medical condition(s) resulting in functional limitations.
  [ ] Requires assistance of another person to leave the residence
  [ ] Requires assistive device (walker, wheelchair, etc.)
  [ ] Impaired strength, balance, or endurance
  [ ] Cognitive impairment limiting safe navigation outside the home
  [ ] High fall risk
Additionally:
  • Leaving the home requires considerable and taxing effort
  • Absences are infrequent and of short duration

Skilled Need (Medical Necessity):
Skilled Nursing is required for:
  [ ] Skilled assessment and monitoring of acute condition
  [ ] Monitoring of chronic condition with recent exacerbation
  [ ] Medication reconciliation and management
  [ ] Monitoring for adverse effects or clinical changes
  [ ] Disease management and prevention of complications
  [ ] Lab draws / venipuncture
  [ ] Wound care / injections / skilled procedures
  [ ] Patient/caregiver education requiring skilled nursing judgment

Therapy Services (PT/OT/ST) as indicated for:
  [ ] Functional decline following acute illness or exacerbation
  [ ] Gait instability / balance deficits
  [ ] Generalized weakness / deconditioning
  [ ] Fall prevention training
  [ ] ADL/IADL retraining
  [ ] Cognitive or speech/swallow deficits

Plan of Care:
Patient is under my care, and I will establish and periodically review the plan of care.`;

  const insertHHF2FTemplate = () => {
    if (diagnoses.some((d) => d.plan.includes('HOME HEALTH FACE-TO-FACE CERTIFICATION'))) {
      toast.info('HHF2F certification already added to Plan');
      return;
    }
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    addDiagnosis(
      'Z51.89',
      'Home Health Face-to-Face Certification — encounter for other specified aftercare',
      HHF2F_TEMPLATE(today),
    );
    toast.success('Inserted HHF2F certification into Plan of Care');
  };



  const updateDiagnosis = (id: string, patch: Partial<Diagnosis>) => {
    setDiagnoses((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const removeDiagnosis = (id: string) => {
    setDiagnoses((prev) => prev.filter((d) => d.id !== id));
  };

  const appendCodeFromSuggestion = (code: string, description: string) => {
    addDiagnosis(code, description);
    toast.success(`Added ${code} to Assessment`);
  };

  const DICTATION_DISCLAIMER =
    '--- This note was dictated using voice recognition and may contain transcription errors. Reviewed and signed by the provider. ---';

  const ROS_TEMPLATE =
    `Review of Systems (ROS):
- Constitutional: Denies fever, chills, weight loss. Reports fatigue.
- Eyes: Denies vision changes, eye pain, or redness.
- ENT: Reports nasal congestion. Denies sore throat or ear pain.
- Cardiovascular: Denies chest pain or palpitations.
- Respiratory: Reports shortness of breath. Denies cough or wheezing.
- Gastrointestinal: Reports nausea. Denies vomiting, diarrhea, or constipation.
- Genitourinary: Denies dysuria, frequency, or hematuria.
- Musculoskeletal: Reports knee pain. Denies joint swelling or muscle weakness.
- Neurological: Denies headache, dizziness, or numbness.
- Psychiatric: Reports feeling anxious. Denies depression or suicidal ideation.

ROS Summary: A complete 10-point review of systems was performed and is negative except where otherwise noted above. [Insert additional positive findings or state "All other systems negative."]`;

  const insertROSTemplate = () => {
    setSubjective((prev) => {
      if (prev.includes('Review of Systems (ROS):')) {
        toast.message('ROS template already present in Subjective');
        return prev;
      }
      return prev ? `${prev.trimEnd()}\n\n${ROS_TEMPLATE}` : ROS_TEMPLATE;
    });
    setActiveField('subjective');
    toast.success('ROS template inserted');
  };

  const insertObjectiveTemplate = () => {
    setObjective((prev) => {
      if (/^\s*General:/m.test(prev)) {
        toast.message('Objective template already present');
        return prev;
      }
      return prev ? `${prev.trimEnd()}\n${DEFAULT_OBJECTIVE_TEMPLATE}` : DEFAULT_OBJECTIVE_TEMPLATE;
    });
    setActiveField('objective');
    toast.success('Objective template inserted');
  };

  const appendDisclaimer = (planText: string) => {
    const trimmed = (planText || '').trimEnd();
    if (trimmed.includes('This note was dictated using voice recognition')) return trimmed;
    return trimmed ? `${trimmed}\n\n${DICTATION_DISCLAIMER}` : DICTATION_DISCLAIMER;
  };

  const buildNote = (): Omit<ClinicalNote, 'id' | 'date' | 'type' | 'author' | 'dictated'> => {
    const subjectiveFinal = chiefComplaint
      ? `Chief Complaint: ${chiefComplaint}\n\n${subjective}`.trim()
      : subjective;
    return {
      subjective: subjectiveFinal,
      objective,
      assessment: serializeAssessment(diagnoses),
      plan: appendDisclaimer(serializePlan(diagnoses)),
    };
  };


  const handleSave = () => {
    const built = buildNote();
    if (!chiefComplaint && !built.subjective && !built.objective && !built.assessment && !built.plan) {
      toast.error('Please add content to at least one section');
      return;
    }
    const checklist = validateCMSChecklist({
      chiefComplaint, subjective, objective,
      assessment: built.assessment, plan: built.plan,
      diagnoses, visitMinutes: visitMinutes ? Number(visitMinutes) : null, patientStatus,
    });

    // Allow save even when critical CMS items are missing — require an explicit
    // "Save Anyway" confirmation so the provider acknowledges the incomplete state.
    if (!checklist.canSave && !forceSave) {
      setForceSave(true);
      toast.warning(
        `${checklist.criticalCount} critical CMS item${checklist.criticalCount === 1 ? '' : 's'} unresolved. Click Save again to save as incomplete.`,
        { duration: 6000 }
      );
      return;
    }

    const isIncomplete = !checklist.canSave;
    const finalPlan = isIncomplete
      ? `${built.plan}${built.plan ? '\n\n' : ''}[INCOMPLETE DOCUMENTATION — saved with ${checklist.criticalCount} unresolved CMS item${checklist.criticalCount === 1 ? '' : 's'}; provider to complete before billing.]`
      : built.plan;

    const newNote: ClinicalNote = {
      id: crypto.randomUUID(),
      date: new Date().toISOString().split('T')[0],
      type: 'soap',
      ...built,
      plan: finalPlan,
      author: 'Dr. Smith',
      dictated: wasDictated,
    };
    addNote(patient.id, newNote);
    setForceSave(false);
    toast.success(isIncomplete ? 'Note saved as incomplete' : 'Note saved successfully');
    // Sync diagnoses to problem list & surface CCM/RPM/BHI recommendations
    syncProblemsAndRecommend(patient.id, diagnoses);
    // Auto-extract clinical data (meds, allergies, vitals, assessments) from the note
    void runExtraction(newNote, { silent: true });
    onSaved();
  };

  const [extracting, setExtracting] = useState(false);
  async function runExtraction(
    note: { subjective: string; objective: string; assessment: string; plan: string },
    opts: { silent?: boolean } = {},
  ) {
    if (extracting) return;
    setExtracting(true);
    try {
      const r = await extractAndApply(patient.id, note);
      const msg = summarizeResult(r);
      if (opts.silent) {
        if (r.problemsAdded + r.medsAdded + r.medsUpdated + r.allergiesAdded + r.assessmentsAdded > 0 || r.vitalsRecorded) {
          toast.success(msg);
        }
      } else {
        toast.success(msg);
      }
    } catch (e: any) {
      if (!opts.silent) toast.error(e?.message || 'Failed to extract clinical data');
    } finally {
      setExtracting(false);
    }
  }


  async function syncProblemsAndRecommend(
    patientId: string,
    dxs: Diagnosis[],
  ) {
    try {
      const codes = dxs.map((d) => (d.code || '').toUpperCase().trim()).filter(Boolean);
      if (codes.length) {
        const { data: existing } = await supabase
          .from('patient_problems')
          .select('icd_code')
          .eq('patient_id', patientId);
        const existingCodes = new Set(
          (existing || []).map((r: any) => (r.icd_code || '').toUpperCase().trim()),
        );
        const toInsert = dxs
          .filter((d) => d.code && !existingCodes.has(d.code.toUpperCase().trim()))
          .map((d) => ({
            patient_id: patientId,
            icd_code: d.code,
            description: d.description || d.code,
            program_tag: 'CCM',
          }));
        if (toInsert.length) {
          await supabase.from('patient_problems').insert(toInsert);
        }
      }

      // Pull full problem list (codes from this note + pre-existing) and recommend
      const { data: all } = await supabase
        .from('patient_problems')
        .select('icd_code')
        .eq('patient_id', patientId);
      const allCodes = Array.from(
        new Set([
          ...codes,
          ...((all || []).map((r: any) => (r.icd_code || '').toUpperCase().trim())),
        ]),
      ).filter(Boolean);

      const { data: enrollments } = await supabase
        .from('patient_enrollments')
        .select('program, status')
        .eq('patient_id', patientId);
      const enrolledSet = new Set(
        (enrollments || [])
          .filter((e: any) => e.status === 'enrolled' || !e.status)
          .map((e: any) => e.program),
      );

      const recs = recommendPrograms(allCodes).filter(
        (r) => r.recommended && !enrolledSet.has(r.program),
      );
      if (recs.length) {
        const programs = recs.map((r) => r.program).join(' + ');
        toast.message(`Recommend enrolling in ${programs}`, {
          description: recs[0].reasons[0],
          duration: 8000,
          action: {
            label: `Enroll ${recs[0].program}`,
            onClick: async () => {
              const { error } = await supabase
                .from('patient_enrollments')
                .insert({ patient_id: patientId, program: recs[0].program });
              if (error) toast.error(error.message);
              else toast.success(`${recs[0].program} enrolled`);
            },
          },
        });
      }
    } catch (e) {
      console.error('syncProblemsAndRecommend failed', e);
    }
  }


  const handleSuggestMIPS = async () => {
    if (!subjective && !objective && !diagnoses.length) {
      toast.error('Add some visit content first');
      return;
    }
    setMipsLoading(true);
    try {
      const payload = {
        subjective,
        objective,
        assessment: serializeAssessment(diagnoses),
        plan: serializePlan(diagnoses),
        diagnoses: diagnoses.map((d) => ({ code: d.code, description: d.description })),
        patientStatus,
        visitMinutes: visitMinutes ? Number(visitMinutes) : null,
      };
      const { data, error } = await supabase.functions.invoke('suggest-mips', { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMipsResult(data);
      if (!data?.measures?.length) toast.message('No applicable MIPS measures suggested');
      else toast.success(`Identified ${data.measures.length} MIPS measure${data.measures.length === 1 ? '' : 's'}`);
    } catch (err: any) {
      toast.error('MIPS suggestion failed: ' + (err.message || 'Unknown error'));
    } finally {
      setMipsLoading(false);
    }
  };

  const handleSendToPF = async () => {
    const built = buildNote();
    if (!built.subjective && !built.objective && !built.assessment && !built.plan) {
      toast.error('No note content to send');
      return;
    }
    const medChanges = [...pendingMedChangesRef.current];
    await sendSOAPToExtension({
      ...built,
      patientName: `${patient.lastName}, ${patient.firstName}`,
      mrn: patient.mrn,
      date: new Date().toISOString().split('T')[0],
      medicationChanges: medChanges,
    });
    const medMsg = medChanges.length ? ` + ${medChanges.length} med change${medChanges.length === 1 ? '' : 's'}` : '';
    toast.success(`SOAP note sent to Practice Fusion extension${medMsg}`);
  };

  const handleExportToPF = async () => {
    const built = buildNote();
    if (!built.subjective && !built.objective && !built.assessment && !built.plan) {
      toast.error('No note content to export');
      return;
    }
    // 1) Push SOAP (with medication-change block embedded into Plan) into the active PF chart
    await sendSOAPToExtension({
      ...built,
      patientName: `${patient.lastName}, ${patient.firstName}`,
      mrn: patient.mrn,
      date: new Date().toISOString().split('T')[0],
      medicationChanges: [...pendingMedChangesRef.current],
    });


    // 2) Build the faxable orders summary from per-diagnosis plan text
    const summary = buildOrdersSummary({
      patientName: `${patient.lastName}, ${patient.firstName}`,
      mrn: patient.mrn,
      dob: patient.dob,
      diagnoses,
    });

    // 3) Also forward the orders list to the extension for one-click attach
    if (summary.orders.length) {
      await sendOrdersToExtension({
        patientName: `${patient.lastName}, ${patient.firstName}`,
        mrn: patient.mrn,
        date: new Date().toLocaleDateString(),
        facility: '',
        orders: summary.orders,
      });
    }

    // 4) Open the print/fax-ready preview window
    const result = openOrdersPrintWindow({
      patientName: `${patient.lastName}, ${patient.firstName}`,
      mrn: patient.mrn,
      dob: patient.dob,
      diagnoses,
    });

    if (result.opened) {
      toast.success(`Exported to Practice Fusion — ${summary.orders.length} order(s) in fax preview`);
    } else {
      toast.message('SOAP sent. Pop-ups blocked — allow pop-ups to open the fax preview.');
    }
  };


  const template = templates.find((t) => t.id === selectedTemplate);

  const priorEncounterCount = patient.notes.length;

  return (
    <div className="space-y-4">
      {priorEncounterCount > 0 && (
        <Card className="p-3 border-primary/30 bg-primary/5 flex items-center gap-3 flex-wrap">
          <History className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              Continuous patient timeline · building on {priorEncounterCount} prior encounter{priorEncounterCount === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-muted-foreground">
              New dictation is appended with a dated separator so this SOAP grows as one continuous chart. Last visit: {lastNote ? new Date(lastNote.date).toLocaleDateString() : '—'}
            </p>
          </div>
          <Badge variant="outline" className="text-xs gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            Append mode
          </Badge>
        </Card>
      )}

      <Collapsible defaultOpen>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground group w-full">
          <ChevronDown className="w-4 h-4 transition-transform group-data-[state=closed]:-rotate-90" />
          Patient history timeline
          <span className="text-xs text-muted-foreground/70 font-normal">— prior problems, meds & visits feeding this note</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <PatientTimeline patientId={patient.id} compact />
        </CollapsibleContent>
      </Collapsible>

      {/* Prominent template picker — choose BEFORE transcribing so the SOAP is structured correctly */}
      <Card className="p-4 border-primary/30 bg-primary/5">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex items-center gap-2 shrink-0">
            <FileText className="w-4 h-4 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground leading-tight">Note template</p>
              <p className="text-[11px] text-muted-foreground leading-tight">Pick before you transcribe</p>
            </div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
              <SelectTrigger className="w-full bg-background">
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {template && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Using <span className="font-medium text-foreground">{template.name}</span> — structures Subjective / Objective / Assessment / Plan.
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">


          {lastNote && (
            <Button variant="outline" size="sm" onClick={handlePrefill} className="gap-1.5">
              <History className="w-3.5 h-3.5" />
              Prefill from Last Visit
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleSuggestICD}
            disabled={icdLoading}
            className="gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {icdLoading ? 'Analyzing…' : 'Suggest Diagnosis Codes'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSuggestMIPS}
            disabled={mipsLoading}
            className="gap-1.5"
          >
            <Award className="w-3.5 h-3.5" />
            {mipsLoading ? 'Analyzing…' : 'Suggest MIPS Measures'}
          </Button>


          <div className="flex items-center gap-1.5">
            <Select value={patientStatus} onValueChange={(v) => setPatientStatus(v as 'new' | 'established')}>
              <SelectTrigger className="h-9 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="established">Established pt</SelectItem>
                <SelectItem value="new">New patient</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={0}
              placeholder="min"
              value={visitMinutes}
              onChange={(e) => setVisitMinutes(e.target.value)}
              className="h-9 w-16 text-xs"
              aria-label="Total visit minutes"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSuggestCPT}
              disabled={cptLoading}
              className="gap-1.5"
            >
              <Receipt className="w-3.5 h-3.5" />
              {cptLoading ? 'Analyzing…' : 'Suggest CPT Codes'}
            </Button>
          </div>
        </div>
      </div>

      {selectedTemplate === 'tcm-cms' && (
        <TCMBillingPanel
          onInsert={(text, cpt) => {
            // Replace any prior TCM billing block so it stays a single canonical entry.
            setDiagnoses((prev) => {
              const filtered = prev.filter(
                (d) => !(d.description?.startsWith('TCM Billing Summary')),
              );
              return [
                ...filtered,
                {
                  id: crypto.randomUUID(),
                  code: cpt,
                  description: `TCM Billing Summary (CPT ${cpt})`,
                  plan: text,
                },
              ];
            });
            // Also nudge the visit-minutes / patient-status used by CPT suggester.
            setPatientStatus('established');
          }}
        />
      )}

      {cptResult && (
        <Card className="p-4 border-primary/20 bg-primary/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" />
              Recommended CPT / HCPCS Codes
              {cptResult.estimated_total_rvu_band && (
                <Badge variant="outline" className="text-[10px] uppercase">
                  {cptResult.estimated_total_rvu_band} reimbursement band
                </Badge>
              )}
              {typeof cptResult.estimated_total_revenue_usd === 'number' && cptResult.estimated_total_revenue_usd > 0 && (
                <Badge className="text-[10px]">
                  ≈ ${cptResult.estimated_total_revenue_usd.toFixed(0)} est. revenue
                </Badge>
              )}
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setCptResult(null)}>Clear</Button>
          </div>
          <div className="space-y-2">
            {cptResult.codes.map((c, i) => (
              <div
                key={`${c.code}-${i}`}
                className="flex items-start gap-3 p-3 rounded-md border border-border bg-background"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-semibold text-primary">{c.code}</code>
                    {c.units && c.units > 1 && (
                      <span className="text-xs text-muted-foreground">× {c.units}</span>
                    )}
                    {c.modifiers?.map((m) => (
                      <code key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-muted">-{m}</code>
                    ))}
                    <span className="text-sm text-foreground">{c.description}</span>
                    <Badge variant="secondary" className="text-[10px] uppercase">{c.category}</Badge>
                    <Badge
                      variant={c.confidence === 'high' ? 'default' : c.confidence === 'medium' ? 'secondary' : 'outline'}
                      className="text-[10px] uppercase"
                    >
                      {c.confidence}
                    </Badge>
                    {typeof c.est_revenue_usd === 'number' && c.est_revenue_usd > 0 && (
                      <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-600/40">
                        ≈ ${c.est_revenue_usd.toFixed(0)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{c.rationale}</p>
                  {c.time_or_mdm && (
                    <p className="text-[11px] text-muted-foreground italic mt-0.5">Justification: {c.time_or_mdm}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {cptResult.documentation_gaps?.length > 0 && (
            <div className="mt-3 p-3 rounded-md border border-amber-500/30 bg-amber-500/5">
              <p className="text-xs font-semibold text-foreground mb-1.5">Documentation gaps to unlock more billing:</p>
              <ul className="list-disc ml-5 space-y-0.5">
                {cptResult.documentation_gaps.map((g, i) => (
                  <li key={i} className="text-xs text-muted-foreground">{g}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {mipsResult && mipsResult.measures && (
        <Card className="p-4 border-primary/20 bg-primary/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Award className="w-4 h-4 text-primary" />
              Applicable MIPS Measures
              <Badge variant="outline" className="text-[10px] uppercase">
                {mipsResult.measures.filter(m => m.status === 'met').length} met / {mipsResult.measures.length} total
              </Badge>
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setMipsResult(null)}>Clear</Button>
          </div>
          <div className="space-y-2">
            {mipsResult.measures.map((m, i) => (
              <div
                key={`${m.measure_id}-${i}`}
                className="flex items-start gap-3 p-3 rounded-md border border-border bg-background"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-semibold text-primary">{m.measure_id}</code>
                    <span className="text-sm text-foreground">{m.title}</span>
                    <Badge variant="secondary" className="text-[10px] uppercase">{m.category}</Badge>
                    <Badge
                      variant={
                        m.status === 'met'
                          ? 'default'
                          : m.status === 'not_met'
                          ? 'destructive'
                          : 'outline'
                      }
                      className="text-[10px] uppercase"
                    >
                      {m.status === 'eligible_not_documented' ? 'Eligible — not documented' : m.status.replace('_', ' ')}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{m.rationale}</p>
                  {m.status !== 'met' && m.action && (
                    <p className="text-[11px] text-foreground italic mt-1">
                      <span className="font-semibold not-italic">Action: </span>{m.action}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {mipsResult.documentation_gaps && mipsResult.documentation_gaps.length > 0 && (
            <div className="mt-3 p-3 rounded-md border border-amber-500/30 bg-amber-500/5">
              <p className="text-xs font-semibold text-foreground mb-1.5">Documentation gaps:</p>
              <ul className="list-disc ml-5 space-y-0.5">
                {mipsResult.documentation_gaps.map((g, i) => (
                  <li key={i} className="text-xs text-muted-foreground">{g}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}





      {icdSuggestions.length > 0 && (
        <Card className="p-4 border-primary/20 bg-primary/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Suggested ICD-10 Codes
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setIcdSuggestions([])}>
              Clear
            </Button>
          </div>
          <div className="space-y-2">
            {icdSuggestions.map((s, i) => (
              <div
                key={`${s.code}-${i}`}
                className="flex items-start gap-3 p-3 rounded-md border border-border bg-background"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-semibold text-primary">{s.code}</code>
                    <span className="text-sm text-foreground">{s.description}</span>
                    <Badge
                      variant={s.confidence === 'high' ? 'default' : s.confidence === 'medium' ? 'secondary' : 'outline'}
                      className="text-[10px] uppercase"
                    >
                      {s.confidence}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{s.rationale}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 shrink-0"
                  onClick={() => appendCodeFromSuggestion(s.code, s.description)}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {programSuggestions.length > 0 && (
        <Card className="p-4 border-primary/20 bg-primary/5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              CMS Program Eligibility (CCM / RPM)
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setProgramSuggestions([])}>
              Clear
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {programSuggestions.map((p) => (
              <div
                key={p.program}
                className="p-3 rounded-md border border-border bg-background"
              >
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-semibold text-foreground">{p.program}</span>
                  <Badge
                    variant={p.eligible ? 'default' : 'outline'}
                    className="text-[10px] uppercase"
                  >
                    {p.eligible ? 'Eligible' : 'Not eligible'}
                  </Badge>
                  <Badge
                    variant={p.confidence === 'high' ? 'default' : p.confidence === 'medium' ? 'secondary' : 'outline'}
                    className="text-[10px] uppercase"
                  >
                    {p.confidence}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{p.rationale}</p>
                {p.qualifying_codes?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {p.qualifying_codes.map((c) => (
                      <code key={c} className="text-[11px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        {c}
                      </code>
                    ))}
                  </div>
                )}
                {p.care_plan_focus && (
                  <p className="text-xs text-foreground">
                    <span className="font-medium">Care plan focus: </span>
                    {p.care_plan_focus}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-3">
            AI-generated per CMS guidelines. Verify enrollment criteria, consent, and documentation before billing.
          </p>
        </Card>
      )}

      <Tabs value={dictationMode} onValueChange={(v) => setDictationMode(v as 'field' | 'ambient')}>
        <TabsList className="w-full">
          <TabsTrigger value="ambient" className="flex-1 gap-2">
            <Radio className="w-3.5 h-3.5" />
            Ambient Dictation
          </TabsTrigger>
          <TabsTrigger value="field" className="flex-1 gap-2">
            <Mic className="w-3.5 h-3.5" />
            Per-Field Dictation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ambient" className="mt-4">
          <AmbientDictation
            onApplyNote={handleApplyAmbient}
            lastNote={lastNote}
            templateId={selectedTemplate}
            onTemplateChange={setSelectedTemplate}
            onScreeningsExtracted={handleScreeningsExtracted}
            onMedicationsExtracted={handleMedicationsExtracted}
            existingMedications={patient.medications.filter(m => m.active).map(m => ({
              name: m.name, dosage: m.dosage, frequency: m.frequency, route: m.route,
            }))}
          />
        </TabsContent>

        <TabsContent value="field" className="mt-4 space-y-3">
          <div className="flex justify-end">
            {isSupported && (
              <Button
                variant={isListening ? 'destructive' : 'secondary'}
                onClick={handleDictate}
                className="gap-2"
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                {isListening ? 'Stop Dictation' : `Dictate ${activeField === 'subjective' ? 'Subjective' : 'Objective'}`}
              </Button>
            )}
          </div>

          {isListening && (
            <Card className="p-3 border-destructive/30 bg-destructive/5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                <span className="text-sm font-medium text-destructive">Listening...</span>
              </div>
              {transcript && <p className="text-sm text-muted-foreground mt-2 italic">{transcript}</p>}
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Chief Complaint */}
      <Card className="p-4">
        <Label className="text-xs font-semibold text-primary uppercase tracking-wider">Chief Complaint</Label>
        <Input
          value={chiefComplaint}
          onChange={(e) => setChiefComplaint(e.target.value)}
          placeholder="e.g., chest pain x 2 days"
          className="mt-2"
        />
      </Card>

      {/* Subjective */}
      <Card
        className={`p-4 cursor-pointer transition-colors ${activeField === 'subjective' ? 'ring-2 ring-primary/30' : ''}`}
        onClick={() => setActiveField('subjective')}
      >
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs font-semibold text-primary uppercase tracking-wider">Subjective</Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                insertROSTemplate();
              }}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Insert ROS Template
            </Button>
            {activeField === 'subjective' && dictationMode === 'field' && (
              <Badge variant="secondary" className="text-xs">Active</Badge>
            )}
          </div>
        </div>
        <Textarea
          placeholder={(template?.subjectivePrompt || 'HPI, ROS, history...').replace(/^\s*(?:CC|Chief complaint)\s*[:,]?\s*/i, '')}
          value={subjective}
          onChange={(e) => setSubjective(e.target.value)}
          onFocus={() => setActiveField('subjective')}
          className="min-h-[100px] border-0 p-0 focus-visible:ring-0 resize-none"
        />
      </Card>

      {/* Objective */}
      <Card
        className={`p-4 cursor-pointer transition-colors ${activeField === 'objective' ? 'ring-2 ring-primary/30' : ''}`}
        onClick={() => setActiveField('objective')}
      >
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs font-semibold text-primary uppercase tracking-wider">Objective</Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                insertObjectiveTemplate();
              }}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Insert Exam Template
            </Button>
            {activeField === 'objective' && dictationMode === 'field' && (
              <Badge variant="secondary" className="text-xs">Active</Badge>
            )}
          </div>
        </div>
        <Textarea
          placeholder={template?.objectivePrompt || 'Vitals, exam findings...'}
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          onFocus={() => setActiveField('objective')}
          className="min-h-[100px] border-0 p-0 focus-visible:ring-0 resize-none"
        />
      </Card>

      {/* Assessment & Plan (by diagnosis) */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <Label className="text-xs font-semibold text-primary uppercase tracking-wider">
            Assessment &amp; Plan (by Diagnosis)
          </Label>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Stethoscope className="w-3.5 h-3.5" />
                  Medicare Wellness
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem onClick={() => insertAWVTemplate('initial')}>
                  Initial AWV (G0438)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => insertAWVTemplate('subsequent')}>
                  Subsequent AWV (G0439)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={insertHHF2FTemplate} title="Insert Home Health Face-to-Face Certification into Plan of Care">
              <FileText className="w-3.5 h-3.5" />
              HHF2F Cert
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => addDiagnosis()}>
              <Plus className="w-3.5 h-3.5" />
              Add Diagnosis
            </Button>
          </div>

        </div>

        {diagnoses.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No diagnoses yet. Add one manually or use "Suggest Diagnosis Codes".
          </p>
        ) : (
          <div className="space-y-3">
            {diagnoses.map((dx, idx) => (
              <Card key={dx.id} className="p-3 bg-muted/30">
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-sm font-semibold text-muted-foreground mt-2 w-5">{idx + 1}.</span>
                  <Input
                    value={dx.code}
                    onChange={(e) => updateDiagnosis(dx.id, { code: e.target.value.toUpperCase() })}
                    placeholder="ICD-10"
                    className="w-32 font-mono"
                  />
                  <Input
                    value={dx.description}
                    onChange={(e) => updateDiagnosis(dx.id, { description: e.target.value })}
                    placeholder="Diagnosis description"
                    className="flex-1"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeDiagnosis(dx.id)}
                    aria-label="Remove diagnosis"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="pl-7">
                  <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Plan
                  </Label>
                  <Textarea
                    value={dx.plan}
                    onChange={(e) => updateDiagnosis(dx.id, { plan: e.target.value })}
                    placeholder="Workup, medications, referrals, follow-up..."
                    className="mt-1 min-h-[80px]"
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>

      <CMSChecklistCard
        input={{
          chiefComplaint,
          subjective,
          objective,
          assessment: serializeAssessment(diagnoses),
          plan: serializePlan(diagnoses),
          diagnoses,
          visitMinutes: visitMinutes ? Number(visitMinutes) : null,
          patientStatus,
        }}
      />

      <div className="flex flex-wrap justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => runExtraction(buildNote())}
          disabled={extracting}
          className="gap-2"
        >
          <Sparkles className="w-4 h-4" />
          {extracting ? 'Extracting…' : 'Extract clinical data'}
        </Button>
        <Button variant="outline" onClick={handleSendToPF} className="gap-2">
          <Send className="w-4 h-4" />
          Send SOAP to PF
        </Button>
        <Button variant="secondary" onClick={handleExportToPF} className="gap-2">
          <FileOutput className="w-4 h-4" />
          Export to PF + Fax Orders
        </Button>
        <Button onClick={handleSave} className="gap-2">
          <Save className="w-4 h-4" />
          Save Note
        </Button>
      </div>

    </div>
  );
}
