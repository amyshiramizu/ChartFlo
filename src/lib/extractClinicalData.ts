import { supabase } from '@/integrations/supabase/client';

export interface ExtractedClinicalData {
  problems?: Array<{ icd_code?: string; description: string }>;
  medications?: Array<{
    name: string;
    dosage?: string;
    frequency?: string;
    route?: string;
    action: 'start' | 'change' | 'stop' | 'continue';
  }>;
  allergies?: string[];
  vitals?: {
    blood_pressure?: string;
    heart_rate?: string;
    respiratory_rate?: string;
    o2_saturation?: string;
    weight?: string;
    height?: string;
    a1c?: string;
  } | null;
  assessments?: Array<{
    assessment_type: string;
    status?: 'pending' | 'completed';
    cadence?: string;
    notes?: string;
  }>;
}

export interface ApplyResult {
  problemsAdded: number;
  medsAdded: number;
  medsUpdated: number;
  allergiesAdded: number;
  vitalsRecorded: boolean;
  assessmentsAdded: number;
}

const ZERO: ApplyResult = {
  problemsAdded: 0, medsAdded: 0, medsUpdated: 0,
  allergiesAdded: 0, vitalsRecorded: false, assessmentsAdded: 0,
};

function buildNoteText(n: {
  subjective?: string; objective?: string; assessment?: string; plan?: string;
}): string {
  return [
    n.subjective ? `Subjective:\n${n.subjective}` : '',
    n.objective ? `Objective:\n${n.objective}` : '',
    n.assessment ? `Assessment:\n${n.assessment}` : '',
    n.plan ? `Plan:\n${n.plan}` : '',
  ].filter(Boolean).join('\n\n');
}

async function loadContext(patientId: string) {
  const [{ data: probs }, { data: meds }, { data: pt }] = await Promise.all([
    supabase.from('patient_problems').select('icd_code, description').eq('patient_id', patientId),
    supabase.from('medications').select('name, dosage, frequency, route, active').eq('patient_id', patientId).eq('active', true),
    supabase.from('patients').select('allergies').eq('id', patientId).maybeSingle(),
  ]);
  return {
    existingProblems: probs || [],
    existingMedications: meds || [],
    existingAllergies: (pt?.allergies as string[]) || [],
  };
}

export async function extractAndApply(
  patientId: string,
  note: { subjective?: string; objective?: string; assessment?: string; plan?: string },
  options: { visitDate?: string } = {},
): Promise<ApplyResult> {
  const noteText = buildNoteText(note);
  if (!noteText.trim()) return ZERO;

  const ctx = await loadContext(patientId);

  const { data, error } = await supabase.functions.invoke('extract-clinical-data', {
    body: { noteText, ...ctx },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  return await applyExtracted(patientId, data as ExtractedClinicalData, {
    existingAllergies: ctx.existingAllergies,
    visitDate: options.visitDate,
  });
}

export async function applyExtracted(
  patientId: string,
  ed: ExtractedClinicalData,
  opts: { existingAllergies?: string[]; visitDate?: string } = {},
): Promise<ApplyResult> {
  const result: ApplyResult = { ...ZERO };
  const visitDate = opts.visitDate || new Date().toISOString().split('T')[0];

  // Problems
  if (ed.problems?.length) {
    const { data: existing } = await supabase
      .from('patient_problems')
      .select('icd_code, description')
      .eq('patient_id', patientId);
    const existingCodes = new Set(
      (existing || []).map((p) => (p.icd_code || '').toUpperCase().trim()).filter(Boolean),
    );
    const existingDescs = new Set(
      (existing || []).map((p) => (p.description || '').toLowerCase().trim()),
    );
    const toInsert = ed.problems
      .filter((p) => {
        const code = (p.icd_code || '').toUpperCase().trim();
        const desc = (p.description || '').toLowerCase().trim();
        if (code && existingCodes.has(code)) return false;
        if (!code && existingDescs.has(desc)) return false;
        return !!desc;
      })
      .map((p) => ({
        patient_id: patientId,
        icd_code: p.icd_code || 'R69',
        description: p.description,
        program_tag: 'CCM',
      }));
    if (toInsert.length) {
      await supabase.from('patient_problems').insert(toInsert);
      result.problemsAdded = toInsert.length;
    }
  }

  // Medications
  if (ed.medications?.length) {
    const { data: meds } = await supabase
      .from('medications')
      .select('id, name, dosage, frequency, route, active')
      .eq('patient_id', patientId);
    const byName = new Map<string, any>();
    (meds || []).forEach((m) => byName.set((m.name || '').toLowerCase().trim(), m));

    for (const med of ed.medications) {
      const key = (med.name || '').toLowerCase().trim();
      if (!key) continue;
      const existing = byName.get(key);
      if (med.action === 'stop') {
        if (existing?.active) {
          await supabase.from('medications').update({ active: false }).eq('id', existing.id);
          result.medsUpdated++;
        }
        continue;
      }
      if (med.action === 'change' && existing) {
        await supabase.from('medications').update({
          dosage: med.dosage || existing.dosage,
          frequency: med.frequency || existing.frequency,
          route: med.route || existing.route,
          active: true,
        }).eq('id', existing.id);
        result.medsUpdated++;
        continue;
      }
      if (existing?.active && med.action !== 'change') continue; // already active, skip
      await supabase.from('medications').insert({
        patient_id: patientId,
        name: med.name,
        dosage: med.dosage || '',
        frequency: med.frequency || '',
        route: med.route || 'PO',
        prescribed_date: visitDate,
        active: true,
      });
      result.medsAdded++;
    }
  }

  // Allergies
  if (ed.allergies?.length) {
    const existing = (opts.existingAllergies || []).map((a) => a.toLowerCase().trim());
    const toAdd = ed.allergies.filter((a) => a && !existing.includes(a.toLowerCase().trim()));
    if (toAdd.length) {
      const merged = [...(opts.existingAllergies || []), ...toAdd];
      await supabase.from('patients').update({ allergies: merged }).eq('id', patientId);
      result.allergiesAdded = toAdd.length;
    }
  }

  // Vitals
  if (ed.vitals && Object.values(ed.vitals).some((v) => v && String(v).trim())) {
    const row: Record<string, any> = { patient_id: patientId };
    for (const k of ['blood_pressure', 'heart_rate', 'respiratory_rate', 'o2_saturation', 'weight', 'height', 'a1c'] as const) {
      const v = ed.vitals[k];
      if (v && String(v).trim()) row[k] = String(v).trim();
    }
    if (Object.keys(row).length > 1) {
      await supabase.from('patient_vitals').insert(row as any);
      result.vitalsRecorded = true;
    }
  }

  // Assessments
  if (ed.assessments?.length) {
    const { data: existing } = await supabase
      .from('patient_assessments')
      .select('assessment_type, status')
      .eq('patient_id', patientId);
    const existingTypes = new Set(
      (existing || []).map((a) => (a.assessment_type || '').toLowerCase().trim()),
    );
    const toInsert = ed.assessments
      .filter((a) => a.assessment_type && !existingTypes.has(a.assessment_type.toLowerCase().trim()))
      .map((a) => ({
        patient_id: patientId,
        assessment_type: a.assessment_type,
        status: a.status || 'pending',
        cadence: a.cadence || 'Annual',
        notes: a.notes || '',
        completed_at: a.status === 'completed' ? visitDate : null,
      }));
    if (toInsert.length) {
      await supabase.from('patient_assessments').insert(toInsert);
      result.assessmentsAdded = toInsert.length;
    }
  }

  return result;
}

export function summarizeResult(r: ApplyResult): string {
  const parts: string[] = [];
  if (r.problemsAdded) parts.push(`${r.problemsAdded} problem${r.problemsAdded === 1 ? '' : 's'}`);
  if (r.medsAdded) parts.push(`${r.medsAdded} med${r.medsAdded === 1 ? '' : 's'}`);
  if (r.medsUpdated) parts.push(`${r.medsUpdated} med change${r.medsUpdated === 1 ? '' : 's'}`);
  if (r.allergiesAdded) parts.push(`${r.allergiesAdded} allerg${r.allergiesAdded === 1 ? 'y' : 'ies'}`);
  if (r.vitalsRecorded) parts.push('vitals');
  if (r.assessmentsAdded) parts.push(`${r.assessmentsAdded} assessment${r.assessmentsAdded === 1 ? '' : 's'}`);
  return parts.length ? `Picked up ${parts.join(', ')}` : 'No new clinical data found';
}

export async function backfillFromAllNotes(patientId: string): Promise<ApplyResult> {
  const { data: notes, error } = await supabase
    .from('clinical_notes')
    .select('date, subjective, objective, assessment, plan')
    .eq('patient_id', patientId)
    .order('date', { ascending: true });
  if (error) throw error;

  const total: ApplyResult = { ...ZERO };
  for (const n of notes || []) {
    try {
      const r = await extractAndApply(patientId, n as any, { visitDate: n.date as string });
      total.problemsAdded += r.problemsAdded;
      total.medsAdded += r.medsAdded;
      total.medsUpdated += r.medsUpdated;
      total.allergiesAdded += r.allergiesAdded;
      total.vitalsRecorded = total.vitalsRecorded || r.vitalsRecorded;
      total.assessmentsAdded += r.assessmentsAdded;
    } catch (e) {
      console.error('Backfill note failed', e);
    }
  }
  return total;
}
