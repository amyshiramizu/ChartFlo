/**
 * Local CPT/HCPCS + ICD-10 catalog used by the Code Lookup tool (Codify-style).
 *
 * Built-in entries are returned instantly; anything not found here falls back to
 * the `code-lookup` edge function (Lovable AI).
 *
 * 2026 Medicare allowed amounts are NATIONAL NON-FACILITY estimates derived
 * from the CY2026 PFS final rule. Adjust for locality (GPCI) and provider type.
 */

import { ALL_2026_CODES, type MedicareCode } from './medicare2026Codes';

export type CodeType = 'CPT' | 'HCPCS' | 'ICD10';

export interface CatalogEntry {
  code: string;
  type: CodeType;
  description: string;
  category?: string;
  /** 2026 Medicare national non-facility allowed amount, USD (CPT/HCPCS only). */
  rate2026?: number;
  /** Common HCC / risk-adjustment crosswalk hint (ICD-10 only). */
  hcc?: string;
  /** Free-text guidance: modifiers, bundling notes, documentation cues. */
  notes?: string;
}

// ─── CPT E/M — Office / Outpatient ────────────────────────────────────────
const EM_OFFICE: CatalogEntry[] = [
  { code: '99202', type: 'CPT', description: 'Office/outpatient visit, new pt, straightforward MDM (15-29 min)',  category: 'E/M Office', rate2026: 72.20 },
  { code: '99203', type: 'CPT', description: 'Office/outpatient visit, new pt, low MDM (30-44 min)',              category: 'E/M Office', rate2026: 111.55 },
  { code: '99204', type: 'CPT', description: 'Office/outpatient visit, new pt, moderate MDM (45-59 min)',         category: 'E/M Office', rate2026: 167.10 },
  { code: '99205', type: 'CPT', description: 'Office/outpatient visit, new pt, high MDM (60-74 min)',             category: 'E/M Office', rate2026: 220.95 },
  { code: '99211', type: 'CPT', description: 'Office/outpatient visit, est pt, minimal (nurse visit)',            category: 'E/M Office', rate2026: 23.70 },
  { code: '99212', type: 'CPT', description: 'Office/outpatient visit, est pt, straightforward MDM (10-19 min)',  category: 'E/M Office', rate2026: 57.32 },
  { code: '99213', type: 'CPT', description: 'Office/outpatient visit, est pt, low MDM (20-29 min)',              category: 'E/M Office', rate2026: 92.51 },
  { code: '99214', type: 'CPT', description: 'Office/outpatient visit, est pt, moderate MDM (30-39 min)',         category: 'E/M Office', rate2026: 130.59 },
  { code: '99215', type: 'CPT', description: 'Office/outpatient visit, est pt, high MDM (40-54 min)',             category: 'E/M Office', rate2026: 184.45 },
];

// ─── CPT E/M — Home / Domiciliary / Residence ─────────────────────────────
const EM_HOME: CatalogEntry[] = [
  { code: '99341', type: 'CPT', description: 'Home/residence visit, new pt, straightforward MDM or 15 min',  category: 'E/M Home', rate2026: 87.92 },
  { code: '99342', type: 'CPT', description: 'Home/residence visit, new pt, low MDM or 30 min',              category: 'E/M Home', rate2026: 133.27 },
  { code: '99344', type: 'CPT', description: 'Home/residence visit, new pt, moderate MDM or 60 min',         category: 'E/M Home', rate2026: 215.93 },
  { code: '99345', type: 'CPT', description: 'Home/residence visit, new pt, high MDM or 75 min',             category: 'E/M Home', rate2026: 269.78 },
  { code: '99347', type: 'CPT', description: 'Home/residence visit, est pt, straightforward MDM or 20 min',  category: 'E/M Home', rate2026: 89.93 },
  { code: '99348', type: 'CPT', description: 'Home/residence visit, est pt, low MDM or 30 min',              category: 'E/M Home', rate2026: 138.62 },
  { code: '99349', type: 'CPT', description: 'Home/residence visit, est pt, moderate MDM or 40 min',         category: 'E/M Home', rate2026: 209.91 },
  { code: '99350', type: 'CPT', description: 'Home/residence visit, est pt, high MDM or 60 min',             category: 'E/M Home', rate2026: 283.16 },
  { code: '99417', type: 'CPT', description: "Prolonged outpatient/home E/M, each add'l 15 min (non-Medicare)", category: 'E/M Add-on', rate2026: 32.91 },
];

// ─── Common immunizations / counseling / screenings ───────────────────────
const ANCILLARY: CatalogEntry[] = [
  { code: '90471', type: 'CPT', description: 'Immunization administration, 1 vaccine (percutaneous, IM, SQ)', category: 'Immunization', rate2026: 17.06 },
  { code: '90472', type: 'CPT', description: "Immunization administration, each add'l vaccine",              category: 'Immunization', rate2026: 16.05 },
  { code: '96127', type: 'CPT', description: 'Brief emotional/behavioral assessment (PHQ-9, GAD-7)',         category: 'Screening',    rate2026: 4.68 },
  { code: '99406', type: 'CPT', description: 'Tobacco cessation counseling, 3-10 min',                       category: 'Counseling',   rate2026: 14.71 },
  { code: '99407', type: 'CPT', description: 'Tobacco cessation counseling, >10 min',                        category: 'Counseling',   rate2026: 28.73 },
  { code: 'G0444', type: 'HCPCS', description: 'Annual depression screening, 15 min',                        category: 'Preventive',   rate2026: 17.39 },
  { code: 'G0442', type: 'HCPCS', description: 'Annual alcohol misuse screening, 15 min',                    category: 'Preventive',   rate2026: 17.39 },
  { code: 'G0443', type: 'HCPCS', description: 'Brief alcohol misuse counseling, 15 min',                    category: 'Counseling',   rate2026: 26.39 },
  { code: 'G0108', type: 'HCPCS', description: 'Diabetes self-management training, individual, 30 min',      category: 'DSMT',         rate2026: 56.94 },
  { code: 'G0109', type: 'HCPCS', description: 'Diabetes self-management training, group, 30 min',           category: 'DSMT',         rate2026: 16.05 },
];

// Pull in the curated 2026 Medicare care-mgmt catalog
const MEDICARE: CatalogEntry[] = ALL_2026_CODES.map((c: MedicareCode) => ({
  code: c.code,
  type: c.code.startsWith('G') ? 'HCPCS' as const : 'CPT' as const,
  description: c.description,
  category: c.category,
  rate2026: c.rate2026,
  notes: c.notes,
}));

// ─── ICD-10 (most-used in primary / care-management) ──────────────────────
const ICD10: CatalogEntry[] = [
  { code: 'E11.9',  type: 'ICD10', description: 'Type 2 diabetes mellitus without complications', category: 'Endocrine', hcc: 'HCC 37 (CMS-HCC v28)' },
  { code: 'E11.65', type: 'ICD10', description: 'Type 2 diabetes mellitus with hyperglycemia',     category: 'Endocrine', hcc: 'HCC 37' },
  { code: 'E11.22', type: 'ICD10', description: 'Type 2 diabetes mellitus w/ diabetic CKD',         category: 'Endocrine', hcc: 'HCC 37 + 329' },
  { code: 'E11.40', type: 'ICD10', description: 'Type 2 diabetes mellitus w/ diabetic neuropathy, unspecified', category: 'Endocrine', hcc: 'HCC 37' },
  { code: 'E78.5',  type: 'ICD10', description: 'Hyperlipidemia, unspecified', category: 'Endocrine' },
  { code: 'E78.2',  type: 'ICD10', description: 'Mixed hyperlipidemia', category: 'Endocrine' },
  { code: 'E66.9',  type: 'ICD10', description: 'Obesity, unspecified', category: 'Endocrine' },
  { code: 'E66.01', type: 'ICD10', description: 'Morbid (severe) obesity due to excess calories', category: 'Endocrine', hcc: 'HCC 48' },
  { code: 'I10',    type: 'ICD10', description: 'Essential (primary) hypertension', category: 'Cardiovascular' },
  { code: 'I11.0',  type: 'ICD10', description: 'Hypertensive heart disease with heart failure', category: 'Cardiovascular', hcc: 'HCC 226' },
  { code: 'I12.9',  type: 'ICD10', description: 'Hypertensive CKD with stage 1-4 or unspecified CKD', category: 'Cardiovascular' },
  { code: 'I13.0',  type: 'ICD10', description: 'Hypertensive heart & CKD w/ HF, stage 1-4', category: 'Cardiovascular', hcc: 'HCC 226' },
  { code: 'I25.10', type: 'ICD10', description: 'ASCVD of native coronary artery without angina', category: 'Cardiovascular' },
  { code: 'I48.91', type: 'ICD10', description: 'Unspecified atrial fibrillation', category: 'Cardiovascular', hcc: 'HCC 238' },
  { code: 'I50.22', type: 'ICD10', description: 'Chronic systolic (congestive) heart failure', category: 'Cardiovascular', hcc: 'HCC 226' },
  { code: 'I50.32', type: 'ICD10', description: 'Chronic diastolic (congestive) heart failure', category: 'Cardiovascular', hcc: 'HCC 226' },
  { code: 'I50.42', type: 'ICD10', description: 'Chronic combined systolic & diastolic heart failure', category: 'Cardiovascular', hcc: 'HCC 226' },
  { code: 'I63.9',  type: 'ICD10', description: 'Cerebral infarction, unspecified', category: 'Cardiovascular' },
  { code: 'I69.351',type: 'ICD10', description: 'Hemiplegia following cerebral infarction, dominant side', category: 'Cardiovascular', hcc: 'HCC 253' },
  { code: 'N18.30', type: 'ICD10', description: 'CKD, stage 3 unspecified', category: 'Renal', hcc: 'HCC 329' },
  { code: 'N18.31', type: 'ICD10', description: 'CKD, stage 3a', category: 'Renal', hcc: 'HCC 329' },
  { code: 'N18.32', type: 'ICD10', description: 'CKD, stage 3b', category: 'Renal', hcc: 'HCC 329' },
  { code: 'N18.4',  type: 'ICD10', description: 'CKD, stage 4 (severe)', category: 'Renal', hcc: 'HCC 328' },
  { code: 'N18.5',  type: 'ICD10', description: 'CKD, stage 5', category: 'Renal', hcc: 'HCC 326' },
  { code: 'N18.6',  type: 'ICD10', description: 'End-stage renal disease', category: 'Renal', hcc: 'HCC 326' },
  { code: 'J44.0',  type: 'ICD10', description: 'COPD with (acute) lower respiratory infection', category: 'Pulmonary', hcc: 'HCC 280' },
  { code: 'J44.1',  type: 'ICD10', description: 'COPD with (acute) exacerbation', category: 'Pulmonary', hcc: 'HCC 280' },
  { code: 'J44.9',  type: 'ICD10', description: 'COPD, unspecified', category: 'Pulmonary', hcc: 'HCC 280' },
  { code: 'J45.909',type: 'ICD10', description: 'Unspecified asthma, uncomplicated', category: 'Pulmonary' },
  { code: 'F32.A',  type: 'ICD10', description: 'Depression, unspecified', category: 'Behavioral' },
  { code: 'F32.9',  type: 'ICD10', description: 'Major depressive disorder, single episode, unspecified', category: 'Behavioral', hcc: 'HCC 155' },
  { code: 'F33.1',  type: 'ICD10', description: 'Major depressive disorder, recurrent, moderate', category: 'Behavioral', hcc: 'HCC 155' },
  { code: 'F41.1',  type: 'ICD10', description: 'Generalized anxiety disorder', category: 'Behavioral' },
  { code: 'F03.90', type: 'ICD10', description: 'Unspecified dementia without behavioral disturbance', category: 'Neurocognitive', hcc: 'HCC 125' },
  { code: 'G30.9',  type: 'ICD10', description: "Alzheimer's disease, unspecified", category: 'Neurocognitive', hcc: 'HCC 125' },
  { code: 'G20',    type: 'ICD10', description: "Parkinson's disease", category: 'Neurocognitive', hcc: 'HCC 191' },
  { code: 'M17.11', type: 'ICD10', description: 'Unilateral primary osteoarthritis, right knee', category: 'Musculoskeletal' },
  { code: 'M19.90', type: 'ICD10', description: 'Unspecified osteoarthritis, unspecified site', category: 'Musculoskeletal' },
  { code: 'M81.0',  type: 'ICD10', description: 'Age-related osteoporosis without current pathologic fracture', category: 'Musculoskeletal' },
  { code: 'M54.50', type: 'ICD10', description: 'Low back pain, unspecified', category: 'Musculoskeletal' },
  { code: 'Z79.4',  type: 'ICD10', description: 'Long term (current) use of insulin', category: 'Status' },
  { code: 'Z79.84', type: 'ICD10', description: 'Long term (current) use of oral hypoglycemic drugs', category: 'Status' },
  { code: 'Z79.01', type: 'ICD10', description: 'Long term (current) use of anticoagulants', category: 'Status' },
  { code: 'Z51.81', type: 'ICD10', description: 'Encounter for therapeutic drug monitoring', category: 'Status' },
  { code: 'Z00.00', type: 'ICD10', description: 'Encounter for general adult medical exam w/o abnormal findings', category: 'Encounter' },
];

export const CODE_CATALOG: CatalogEntry[] = [
  ...MEDICARE,
  ...EM_OFFICE,
  ...EM_HOME,
  ...ANCILLARY,
  ...ICD10,
];

const CODE_INDEX = new Map(CODE_CATALOG.map((e) => [e.code.toUpperCase(), e]));

export function findCode(code: string): CatalogEntry | undefined {
  return CODE_INDEX.get(code.trim().toUpperCase());
}

export function searchCatalog(
  query: string,
  type?: CodeType | 'ALL',
  limit = 25,
): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  const filterType = type && type !== 'ALL' ? type : undefined;

  if (!q) {
    return CODE_CATALOG
      .filter((e) => !filterType || e.type === filterType)
      .slice(0, limit);
  }

  const scored: Array<{ entry: CatalogEntry; score: number }> = [];
  for (const e of CODE_CATALOG) {
    if (filterType && e.type !== filterType) continue;
    const codeLc = e.code.toLowerCase();
    const descLc = e.description.toLowerCase();
    const catLc = (e.category ?? '').toLowerCase();
    let score = 0;
    if (codeLc === q) score = 100;
    else if (codeLc.startsWith(q)) score = 80;
    else if (codeLc.includes(q)) score = 60;
    else if (descLc.includes(q)) score = 30;
    else if (catLc.includes(q)) score = 15;
    if (score > 0) scored.push({ entry: e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}
