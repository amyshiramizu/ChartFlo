import { supabase } from '@/integrations/supabase/client';

export interface PriorVisitContext {
  recentNotes: Array<{ date: string; subjective: string; assessment: string; plan: string }>;
  activeProblems: string[];
  currentMeds: Array<{ name: string; dosage?: string; frequency?: string }>;
  lastCarePlanSummary?: string;
}

/** Builds prior-visit context for AI prompts. Returns concise structured data. */
export async function buildPriorVisitContext(patientId: string): Promise<PriorVisitContext> {
  const [notesRes, problemsRes, medsRes, planRes] = await Promise.all([
    supabase.from('clinical_notes')
      .select('date,subjective,assessment,plan')
      .eq('patient_id', patientId)
      .order('date', { ascending: false })
      .limit(2),
    supabase.from('patient_problems').select('description,status').eq('patient_id', patientId).limit(20),
    supabase.from('medications').select('name,dosage,frequency').eq('patient_id', patientId).eq('active', true).limit(30),
    supabase.from('patient_care_plans').select('data,updated_at').eq('patient_id', patientId).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const recentNotes = (notesRes.data || []).map((n: any) => ({
    date: n.date,
    subjective: (n.subjective || '').slice(0, 600),
    assessment: (n.assessment || '').slice(0, 400),
    plan: (n.plan || '').slice(0, 400),
  }));
  const activeProblems = (problemsRes.data || [])
    .filter((p: any) => (p.status || 'active') === 'active')
    .map((p: any) => p.description);
  const currentMeds = (medsRes.data || []).map((m: any) => ({
    name: m.name, dosage: m.dosage, frequency: m.frequency,
  }));
  let lastCarePlanSummary: string | undefined;
  const planRow = planRes.data as any;
  const plan = planRow?.data;
  if (plan && typeof plan === 'object') {
    const summaryBits: string[] = [];
    if (plan.expected_outcomes) summaryBits.push(`Outcomes: ${String(plan.expected_outcomes).slice(0, 200)}`);
    if (plan.symptom_plan) summaryBits.push(`Symptoms: ${String(plan.symptom_plan).slice(0, 200)}`);
    if (plan.med_mgmt) summaryBits.push(`Meds: ${String(plan.med_mgmt).slice(0, 200)}`);
    lastCarePlanSummary = summaryBits.join(' | ');
  }
  return { recentNotes, activeProblems, currentMeds, lastCarePlanSummary };
}

export function formatPriorVisitContextForPrompt(ctx: PriorVisitContext): string {
  if (!ctx.recentNotes.length && !ctx.activeProblems.length && !ctx.currentMeds.length) return '';
  const lines: string[] = ['## Prior visit context (read-only, do not invent new facts):'];
  if (ctx.activeProblems.length) {
    lines.push(`Active problems: ${ctx.activeProblems.join('; ')}`);
  }
  if (ctx.currentMeds.length) {
    lines.push(`Current meds: ${ctx.currentMeds.map(m => `${m.name}${m.dosage ? ' ' + m.dosage : ''}${m.frequency ? ' ' + m.frequency : ''}`).join('; ')}`);
  }
  if (ctx.lastCarePlanSummary) lines.push(`Last care plan: ${ctx.lastCarePlanSummary}`);
  if (ctx.recentNotes.length) {
    lines.push('Recent notes:');
    ctx.recentNotes.forEach(n => {
      lines.push(`- [${n.date}] A: ${n.assessment} | P: ${n.plan}`);
    });
  }
  return lines.join('\n');
}
