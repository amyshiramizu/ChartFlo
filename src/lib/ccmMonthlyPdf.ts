import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '@/integrations/supabase/client';

export interface MonthlyPdfOptions {
  patientId: string;
  patient: { firstName: string; lastName: string; dob?: string; mrn?: string; provider?: string };
  year: number;
  month: number; // 0-11
  clinicName?: string;
  practitionerName?: string;
}

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function monthRange(y: number, m: number) {
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { start: toIso(start), end: toIso(end), label: `${MONTHS[m]} ${y}` };
}

const PLAN_FIELDS: { key: string; label: string }[] = [
  { key: 'expected_outcomes', label: 'Expected outcomes & overall prognosis' },
  { key: 'symptom_plan', label: 'Symptom management plan' },
  { key: 'med_mgmt', label: 'Medication management & reconciliation' },
  { key: 'preventive', label: 'Preventive care services' },
  { key: 'caregivers', label: 'Caregiver(s) & support system' },
  { key: 'advance_dir', label: 'Advance directives' },
  { key: 'psychosocial', label: 'Psychosocial & behavioral health needs' },
  { key: 'education', label: 'Patient / caregiver education provided' },
];

export async function generateMonthlyCcmPdf(opts: MonthlyPdfOptions): Promise<Blob> {
  const { patientId, patient, year, month, clinicName, practitionerName } = opts;
  const { start, end, label } = monthRange(year, month);

  // Pull everything in parallel
  const [teRes, cpRes, prRes, medRes, asmRes, vitRes, noteRes, avsRes] = await Promise.all([
    supabase.from('ccm_time_entries').select('*').eq('patient_id', patientId).gte('date', start).lte('date', end).order('date'),
    supabase.from('patient_care_plans').select('*').eq('patient_id', patientId).maybeSingle(),
    supabase.from('patient_problems').select('*').eq('patient_id', patientId).order('created_at'),
    supabase.from('medications').select('*').eq('patient_id', patientId).order('name'),
    supabase.from('patient_assessments').select('*').eq('patient_id', patientId),
    supabase.from('patient_vitals').select('*').eq('patient_id', patientId).order('recorded_at', { ascending: false }).limit(1),
    supabase.from('clinical_notes').select('*').eq('patient_id', patientId).gte('created_at', start).lte('created_at', end + 'T23:59:59').order('created_at', { ascending: false }),
    supabase.from('patient_avs').select('*').eq('patient_id', patientId).gte('created_at', start).lte('created_at', end + 'T23:59:59').order('created_at', { ascending: false }).limit(3),
  ]);

  const entries = teRes.data || [];
  const carePlan: any = cpRes.data || { data: {}, problem_plans: {} };
  const problems = prRes.data || [];
  const meds = medRes.data || [];
  const assessments = asmRes.data || [];
  const vitals: any = vitRes.data?.[0] || {};
  const notes = noteRes.data || [];
  const avs = avsRes.data || [];

  const totalMinutes = entries.reduce((s, e: any) => s + (e.minutes || 0), 0);

  // ─── Build PDF ────────────────────────────────────────────
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  const navy: [number, number, number] = [12, 35, 64];
  const teal: [number, number, number] = [45, 138, 158];
  const muted: [number, number, number] = [110, 120, 135];

  function ensureSpace(needed: number) {
    if (y + needed > doc.internal.pageSize.getHeight() - 50) {
      doc.addPage();
      y = margin;
    }
  }

  function sectionHeader(title: string) {
    ensureSpace(36);
    doc.setFillColor(...navy);
    doc.rect(margin, y, pageW - margin * 2, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(title.toUpperCase(), margin + 8, y + 15);
    y += 30;
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
  }

  function bodyText(text: string, opts: { bold?: boolean; size?: number; color?: [number, number, number] } = {}) {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size ?? 10);
    if (opts.color) doc.setTextColor(...opts.color); else doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(text, pageW - margin * 2);
    lines.forEach((ln: string) => {
      ensureSpace(14);
      doc.text(ln, margin, y);
      y += 13;
    });
  }

  function kv(k: string, v: string) {
    ensureSpace(14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...muted);
    doc.text(k, margin, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30); doc.setFontSize(10);
    doc.text(v || '—', margin + 130, y);
    y += 14;
  }

  // ── Header banner
  doc.setFillColor(...navy);
  doc.rect(0, 0, pageW, 70, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text('Chronic Care Management — Monthly Summary', margin, 32);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`${label}  ·  ${clinicName || 'Clinic'}`, margin, 50);
  doc.text(`Generated ${new Date().toLocaleString()}`, pageW - margin, 50, { align: 'right' });
  y = 90;

  // ── Patient block
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(`${patient.lastName}, ${patient.firstName}`, margin, y);
  y += 18;
  kv('DOB', patient.dob ? new Date(patient.dob).toLocaleDateString() : '—');
  kv('MRN', patient.mrn || '—');
  kv('Provider', patient.provider || practitionerName || '—');
  kv('Service period', `${new Date(start).toLocaleDateString()} – ${new Date(end).toLocaleDateString()}`);
  y += 4;

  // ── Billing summary box
  ensureSpace(80);
  doc.setDrawColor(...teal); doc.setLineWidth(1);
  doc.roundedRect(margin, y, pageW - margin * 2, 64, 6, 6);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...teal);
  doc.text('CCM SERVICE TIME — MEDICARE BILLING ATTESTATION', margin + 12, y + 18);
  doc.setFontSize(22); doc.setTextColor(...navy);
  doc.text(`${totalMinutes} min`, margin + 12, y + 46);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(...muted);
  const tier =
    totalMinutes >= 60 ? '99490 + 99439 ×2 (60+ min staff-directed)' :
    totalMinutes >= 40 ? '99490 + 99439 (40-59 min staff-directed)' :
    totalMinutes >= 20 ? '99490 (20-39 min staff-directed)' :
    'Below 20-min threshold — not billable';
  doc.text(`Eligible code(s): ${tier}`, margin + 12, y + 60);
  doc.text(`${entries.length} time entries`, pageW - margin - 12, y + 46, { align: 'right' });
  y += 78;

  // ── Time log table
  sectionHeader('Time log');
  if (entries.length === 0) {
    bodyText('No time entries recorded for this period.', { color: muted });
  } else {
    autoTable(doc, {
      startY: y,
      head: [['Date', 'Min', 'Staff', 'Program', 'Activity / Note']],
      body: entries.map((e: any) => [
        new Date(e.date).toLocaleDateString(),
        String(e.minutes),
        e.staff || '—',
        e.program || 'CCM',
        e.description || '—',
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: teal, textColor: 255 },
      columnStyles: { 0: { cellWidth: 65 }, 1: { cellWidth: 32, halign: 'right' }, 2: { cellWidth: 80 }, 3: { cellWidth: 45 } },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 14;
  }

  // ── Problem list
  sectionHeader('Chronic problem list');
  if (problems.length === 0) {
    bodyText('No chronic problems documented.', { color: muted });
  } else {
    autoTable(doc, {
      startY: y,
      head: [['ICD-10', 'Description', 'Program']],
      body: problems.map((p: any) => [p.icd_code, p.description, p.program_tag || 'CCM']),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: teal, textColor: 255 },
      columnStyles: { 0: { cellWidth: 75 }, 2: { cellWidth: 60 } },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 14;
  }

  // ── Comprehensive Care Plan
  sectionHeader('Comprehensive care plan');
  const cpData = carePlan.data || {};
  PLAN_FIELDS.forEach(f => {
    const val = (cpData[f.key] || '').toString().trim();
    if (!val) return;
    bodyText(f.label, { bold: true, size: 10, color: navy });
    bodyText(val);
    y += 4;
  });
  if (carePlan.next_review_date) kv('Next review', new Date(carePlan.next_review_date).toLocaleDateString());
  if (carePlan.shared_date) kv('Shared with patient', `${new Date(carePlan.shared_date).toLocaleDateString()} (${carePlan.shared_method || 'method n/a'})`);

  // Per-problem plans
  const probPlans = carePlan.problem_plans || {};
  const probKeys = Object.keys(probPlans).filter(k => probPlans[k] && typeof probPlans[k] === 'object');
  if (probKeys.length) {
    y += 6;
    bodyText('Goals & interventions by problem', { bold: true, color: navy });
    probKeys.forEach(k => {
      const p: any = probPlans[k];
      bodyText(`• ${k}`, { bold: true });
      if (p.goal) bodyText(`  Goal: ${p.goal}`);
      if (p.intervention) bodyText(`  Intervention: ${p.intervention}`);
      if (p.outcome) bodyText(`  Expected outcome: ${p.outcome}`);
      y += 2;
    });
  }

  // ── Medications
  sectionHeader('Current medications');
  const activeMeds = meds.filter((m: any) => m.active !== false);
  if (activeMeds.length === 0) {
    bodyText('No active medications on file.', { color: muted });
  } else {
    autoTable(doc, {
      startY: y,
      head: [['Medication', 'Dosage', 'Frequency', 'Route', 'Started']],
      body: activeMeds.map((m: any) => [m.name, m.dosage, m.frequency, m.route, m.prescribed_date || '—']),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: teal, textColor: 255 },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 14;
  }

  // ── Vitals snapshot
  if (vitals && Object.keys(vitals).length) {
    sectionHeader('Most recent vitals');
    const pairs: [string, string][] = [
      ['Blood pressure', vitals.blood_pressure || '—'],
      ['Heart rate', vitals.heart_rate || '—'],
      ['Weight', vitals.weight || '—'],
      ['Height', vitals.height || '—'],
      ['A1C', vitals.a1c || '—'],
      ['SpO₂', vitals.o2_saturation || '—'],
      ['Respiratory rate', vitals.respiratory_rate || '—'],
    ];
    pairs.forEach(([k, v]) => kv(k, v));
  }

  // ── Assessments
  sectionHeader('Assessments & screenings');
  if (assessments.length === 0) {
    bodyText('No assessments on file.', { color: muted });
  } else {
    autoTable(doc, {
      startY: y,
      head: [['Assessment', 'Cadence', 'Status', 'Last completed']],
      body: assessments.map((a: any) => [
        a.assessment_type,
        a.cadence || '—',
        a.status || 'pending',
        a.completed_at ? new Date(a.completed_at).toLocaleDateString() : '—',
      ]),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: teal, textColor: 255 },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 14;
  }

  // ── Communications / clinical notes this period
  sectionHeader('Communications & clinical notes this period');
  if (notes.length === 0) {
    bodyText('No clinical notes recorded in this period.', { color: muted });
  } else {
    notes.forEach((n: any) => {
      bodyText(new Date(n.created_at).toLocaleDateString() + (n.title ? ` — ${n.title}` : ''), { bold: true, color: navy });
      const sections = [
        ['S', n.subjective], ['O', n.objective], ['A', n.assessment], ['P', n.plan],
      ].filter(([_, v]) => v) as [string, string][];
      sections.forEach(([k, v]) => bodyText(`${k}: ${v}`));
      y += 4;
    });
  }

  // ── After-visit summaries shared with patient
  if (avs.length) {
    sectionHeader('After-visit summaries shared with patient');
    avs.forEach((a: any) => {
      bodyText(`${new Date(a.created_at).toLocaleDateString()} — ${(a.language || 'en').toUpperCase()}`, { bold: true, color: navy });
      bodyText((a.summary_md || '').slice(0, 1200));
      y += 4;
    });
  }

  // ── CMS attestation
  sectionHeader('CMS CCM attestation');
  bodyText(
    `I attest that ${totalMinutes} minutes of non-face-to-face chronic care management services were ` +
    `furnished to this patient during ${label}. The patient has ≥ 2 chronic conditions expected to last ` +
    `at least 12 months that place them at significant risk. A comprehensive care plan was established, ` +
    `implemented, revised, or monitored, and the plan is available to the patient and care team. ` +
    `24/7 access to care and continuity with a designated care team member were available.`
  );
  y += 18;
  ensureSpace(60);
  doc.setDrawColor(...muted); doc.line(margin, y, margin + 240, y);
  doc.line(pageW - margin - 240, y, pageW - margin, y);
  doc.setFontSize(9); doc.setTextColor(...muted);
  doc.text('Billing practitioner signature', margin, y + 12);
  doc.text(practitionerName || '', margin, y + 26);
  doc.text('Date', pageW - margin - 240, y + 12);
  doc.text(new Date().toLocaleDateString(), pageW - margin - 240, y + 26);

  // ── Footer (page numbers)
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(...muted);
    doc.text(
      `${patient.lastName}, ${patient.firstName}  ·  CCM ${label}  ·  Page ${i} of ${pageCount}`,
      pageW / 2, doc.internal.pageSize.getHeight() - 20, { align: 'center' }
    );
  }

  return doc.output('blob');
}
