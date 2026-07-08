/**
 * Lightweight MIPS/HEDIS-style quality measures evaluated client-side
 * from the data we already capture (problems, vitals, meds, assessments,
 * billed codes). Each measure returns whether the patient is in the
 * denominator and whether they meet the numerator.
 */

export interface QualityPatientContext {
  patientId: string;
  age?: number;
  sex?: string;
  problems: string[]; // descriptions or ICD codes
  meds: Array<{ name: string; active?: boolean }>;
  vitals: Array<{ type: string; value: number; date: string }>;
  assessments: Array<{ type: string; completed_at?: string | null; status?: string | null }>;
  awvBilledThisYear?: boolean;
}

export interface QualityMeasureDef {
  id: string;
  label: string;
  description: string;
  inDenominator: (p: QualityPatientContext) => boolean;
  meetsNumerator: (p: QualityPatientContext) => boolean;
  gapAction?: string;
}

const hasProblem = (p: QualityPatientContext, ...keywords: string[]) =>
  p.problems.some(prob => keywords.some(k => prob.toLowerCase().includes(k.toLowerCase())));

const hasMedClass = (p: QualityPatientContext, ...keywords: string[]) =>
  p.meds.some(m => (m.active ?? true) && keywords.some(k => m.name.toLowerCase().includes(k.toLowerCase())));

const recentVital = (p: QualityPatientContext, type: string, withinDays: number) => {
  const cutoff = Date.now() - withinDays * 86400000;
  return p.vitals
    .filter(v => v.type.toLowerCase().includes(type.toLowerCase()) && Date.parse(v.date) >= cutoff)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
};

const assessmentDone = (p: QualityPatientContext, typeKeyword: string, withinDays: number) => {
  const cutoff = Date.now() - withinDays * 86400000;
  return p.assessments.some(a =>
    a.type.toLowerCase().includes(typeKeyword.toLowerCase()) &&
    a.completed_at && Date.parse(a.completed_at) >= cutoff
  );
};

export const QUALITY_MEASURES: QualityMeasureDef[] = [
  {
    id: 'a1c_control',
    label: 'A1c < 8% in diabetics',
    description: 'Most recent A1c (12 mo) is below 8% for patients with diabetes.',
    inDenominator: p => hasProblem(p, 'diabetes', 'E11', 'E10'),
    meetsNumerator: p => {
      const a1c = recentVital(p, 'a1c', 365);
      return !!a1c && a1c.value < 8;
    },
    gapAction: 'Order A1c, intensify therapy, or schedule diabetes education.',
  },
  {
    id: 'bp_control',
    label: 'BP < 140/90 in hypertension',
    description: 'Most recent BP (12 mo) under 140/90 for patients with HTN.',
    inDenominator: p => hasProblem(p, 'hypertension', 'I10'),
    meetsNumerator: p => {
      const sys = recentVital(p, 'systolic', 365);
      const dia = recentVital(p, 'diastolic', 365);
      return !!sys && !!dia && sys.value < 140 && dia.value < 90;
    },
    gapAction: 'Recheck BP, optimize antihypertensives, lifestyle counseling.',
  },
  {
    id: 'depression_screen',
    label: 'Annual depression screening',
    description: 'PHQ-9 or PHQ-2 completed in last 12 months (age ≥ 12).',
    inDenominator: p => (p.age ?? 0) >= 12,
    meetsNumerator: p => assessmentDone(p, 'phq', 365) || assessmentDone(p, 'depression', 365),
    gapAction: 'Administer PHQ-9 at next visit.',
  },
  {
    id: 'tobacco_screen',
    label: 'Tobacco use screening',
    description: 'Tobacco status documented in last 24 months.',
    inDenominator: p => (p.age ?? 0) >= 18,
    meetsNumerator: p => assessmentDone(p, 'tobacco', 730),
    gapAction: 'Document tobacco status; offer cessation counseling (99406/99407).',
  },
  {
    id: 'fall_risk',
    label: 'Fall risk assessment',
    description: 'Fall risk screen in last 12 months for adults ≥ 65.',
    inDenominator: p => (p.age ?? 0) >= 65,
    meetsNumerator: p => assessmentDone(p, 'fall', 365),
    gapAction: 'Perform a fall risk screen (Timed Up & Go).',
  },
  {
    id: 'awv',
    label: 'Annual Wellness Visit',
    description: 'AWV billed (G0438/G0439) in current calendar year.',
    inDenominator: p => (p.age ?? 0) >= 65,
    meetsNumerator: p => !!p.awvBilledThisYear,
    gapAction: 'Schedule AWV — adds care plan, prevention review, and revenue.',
  },
  {
    id: 'statin_ascvd',
    label: 'Statin in ASCVD',
    description: 'Patients with ASCVD are on a statin.',
    inDenominator: p => hasProblem(p, 'I25', 'CAD', 'coronary', 'atherosclero'),
    meetsNumerator: p => hasMedClass(p, 'atorvastatin', 'rosuvastatin', 'simvastatin', 'pravastatin', 'lovastatin', 'pitavastatin', 'statin'),
    gapAction: 'Start a high-intensity statin unless contraindicated.',
  },
  {
    id: 'acearb_chf',
    label: 'ACE/ARB/ARNi in HFrEF',
    description: 'Patients with HF are on a renin-angiotensin therapy.',
    inDenominator: p => hasProblem(p, 'heart failure', 'I50'),
    meetsNumerator: p => hasMedClass(p, 'lisinopril', 'enalapril', 'losartan', 'valsartan', 'sacubitril', 'entresto', 'ramipril', 'olmesartan'),
    gapAction: 'Add ACEi / ARB / ARNi per HF guidelines.',
  },
  {
    id: 'colorectal_screen',
    label: 'Colorectal cancer screening',
    description: 'Documented CRC screen in last 10 years (age 45-75).',
    inDenominator: p => (p.age ?? 0) >= 45 && (p.age ?? 0) <= 75,
    meetsNumerator: p => assessmentDone(p, 'colon', 365 * 10) || assessmentDone(p, 'fit', 365),
    gapAction: 'Order FIT, Cologuard, or refer for colonoscopy.',
  },
  {
    id: 'med_recon',
    label: 'Medication reconciliation',
    description: 'Med reconciliation documented in last 6 months.',
    inDenominator: () => true,
    meetsNumerator: p => assessmentDone(p, 'medication recon', 180),
    gapAction: 'Reconcile meds at next encounter.',
  },
];

export interface MeasureResult {
  measure: QualityMeasureDef;
  inDenom: boolean;
  meets: boolean;
}

export function evaluateAllMeasures(p: QualityPatientContext): MeasureResult[] {
  return QUALITY_MEASURES.map(m => ({
    measure: m,
    inDenom: m.inDenominator(p),
    meets: m.inDenominator(p) ? m.meetsNumerator(p) : false,
  }));
}
