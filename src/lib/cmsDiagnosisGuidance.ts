// CMS-aligned per-diagnosis documentation & testing recommendations.
// Sources: CMS MIPS quality measures, USPSTF, ADA, ACC/AHA, GOLD, KDIGO, NKF.
// Matched by ICD-10 prefix on the patient problem list.

export interface DiagnosisGuidance {
  /** ICD-10 prefix (e.g. "E11", "I10", "N18") */
  prefix: string;
  /** Human label shown to the provider */
  label: string;
  /** Recommended documentation elements for the chart */
  documentation: string[];
  /** Recommended labs / tests / screenings with cadence */
  testing: { name: string; cadence: string }[];
}

export const DIAGNOSIS_GUIDANCE: DiagnosisGuidance[] = [
  {
    prefix: 'E11',
    label: 'Type 2 Diabetes Mellitus',
    documentation: [
      'Self-management goals & diabetes education',
      'Hypoglycemia risk + sick-day plan',
      'Smoking status & cessation counseling',
      'Statin therapy decision (ASCVD)',
    ],
    testing: [
      { name: 'HbA1c', cadence: 'Every 3 months (q6mo if at goal)' },
      { name: 'Lipid panel', cadence: 'Annual' },
      { name: 'Urine albumin/creatinine ratio (UACR)', cadence: 'Annual' },
      { name: 'eGFR / serum creatinine', cadence: 'Annual' },
      { name: 'Dilated retinal eye exam', cadence: 'Annual' },
      { name: 'Comprehensive foot exam (monofilament)', cadence: 'Annual' },
      { name: 'BP measurement', cadence: 'Every visit' },
      { name: 'Flu vaccine / Pneumococcal / Hep B', cadence: 'Per schedule' },
    ],
  },
  {
    prefix: 'E10',
    label: 'Type 1 Diabetes Mellitus',
    documentation: ['Insulin regimen reviewed', 'CGM/pump data reviewed', 'DKA prevention plan'],
    testing: [
      { name: 'HbA1c', cadence: 'Every 3 months' },
      { name: 'Lipid panel', cadence: 'Annual' },
      { name: 'UACR + eGFR', cadence: 'Annual' },
      { name: 'Dilated eye exam', cadence: 'Annual' },
      { name: 'Foot exam', cadence: 'Annual' },
    ],
  },
  {
    prefix: 'I10',
    label: 'Essential Hypertension',
    documentation: [
      'BP goal documented (<130/80 typical)',
      'Lifestyle counseling (DASH, Na, exercise)',
      'Medication adherence reviewed',
      'Home BP log reviewed',
    ],
    testing: [
      { name: 'BP measurement', cadence: 'Every visit' },
      { name: 'Basic metabolic panel (K, Cr, eGFR)', cadence: 'Annual' },
      { name: 'Lipid panel', cadence: 'Annual' },
      { name: 'ECG', cadence: 'Baseline & as indicated' },
      { name: 'UACR', cadence: 'Annual if diabetic/CKD' },
    ],
  },
  {
    prefix: 'I50',
    label: 'Heart Failure',
    documentation: [
      'NYHA class documented',
      'LVEF documented (HFrEF vs HFpEF)',
      'GDMT (ACEi/ARB/ARNI, BB, MRA, SGLT2i) reconciled',
      'Daily weight log + diuretic action plan',
      'Sodium/fluid restriction counseling',
    ],
    testing: [
      { name: 'BNP / NT-proBNP', cadence: 'With status change' },
      { name: 'Echocardiogram', cadence: 'Baseline; repeat with status change' },
      { name: 'BMP (K, Cr, eGFR)', cadence: 'Every 3–6 months on GDMT' },
      { name: 'Daily weights', cadence: 'Daily at home' },
    ],
  },
  {
    prefix: 'J44',
    label: 'COPD',
    documentation: [
      'GOLD group documented',
      'Inhaler technique reviewed',
      'Smoking cessation counseling',
      'Pulmonary rehab considered',
      'Exacerbation action plan',
    ],
    testing: [
      { name: 'Spirometry (FEV1/FVC)', cadence: 'Annual or with change' },
      { name: 'O2 saturation', cadence: 'Every visit' },
      { name: 'Flu vaccine', cadence: 'Annual' },
      { name: 'Pneumococcal + COVID vaccines', cadence: 'Per schedule' },
    ],
  },
  {
    prefix: 'J45',
    label: 'Asthma',
    documentation: [
      'Asthma Control Test (ACT) score',
      'Asthma action plan on file',
      'Trigger identification & avoidance',
      'Inhaler technique demo',
    ],
    testing: [
      { name: 'Spirometry', cadence: 'At diagnosis and q1–2yr' },
      { name: 'Peak flow log', cadence: 'As indicated' },
    ],
  },
  {
    prefix: 'N18',
    label: 'Chronic Kidney Disease',
    documentation: [
      'CKD stage (G/A category) documented',
      'Nephrotoxin avoidance reviewed (NSAIDs, contrast)',
      'BP & glycemic targets',
      'Nephrology referral if stage ≥4',
    ],
    testing: [
      { name: 'eGFR / serum creatinine', cadence: 'Every 3–6 months' },
      { name: 'UACR', cadence: 'Annual (more if albuminuria)' },
      { name: 'BMP + Phosphorus + PTH', cadence: 'Per stage' },
      { name: 'Hemoglobin (anemia screen)', cadence: 'Annual stage ≥3' },
    ],
  },
  {
    prefix: 'I48',
    label: 'Atrial Fibrillation',
    documentation: [
      'CHA₂DS₂-VASc score documented',
      'HAS-BLED bleeding risk',
      'Anticoagulation decision & shared decision-making note',
      'Rate vs rhythm strategy',
    ],
    testing: [
      { name: 'ECG', cadence: 'With symptoms or annually' },
      { name: 'TSH', cadence: 'Baseline' },
      { name: 'Echocardiogram', cadence: 'Baseline' },
      { name: 'INR (if warfarin)', cadence: 'Monthly when stable' },
      { name: 'CBC + Cr (DOAC monitoring)', cadence: 'Annual' },
    ],
  },
  {
    prefix: 'E78',
    label: 'Hyperlipidemia',
    documentation: [
      'ASCVD 10-yr risk documented',
      'Statin intensity & indication',
      'Lifestyle counseling',
    ],
    testing: [
      { name: 'Lipid panel', cadence: 'Annual (or 4–12wk after statin change)' },
      { name: 'LFTs', cadence: 'Baseline; PRN symptoms' },
      { name: 'CK', cadence: 'PRN myalgia' },
    ],
  },
  {
    prefix: 'F32',
    label: 'Depression',
    documentation: [
      'Suicide risk assessment',
      'Functional impairment',
      'Response to treatment plan',
    ],
    testing: [{ name: 'PHQ-9', cadence: 'Every visit until remission, then q3mo' }],
  },
  {
    prefix: 'F33',
    label: 'Recurrent Depression',
    documentation: ['Suicide risk', 'Relapse-prevention plan'],
    testing: [{ name: 'PHQ-9', cadence: 'Every visit' }],
  },
  {
    prefix: 'F41',
    label: 'Anxiety Disorder',
    documentation: ['Trigger review', 'CBT/therapy referral status'],
    testing: [{ name: 'GAD-7', cadence: 'Every visit until remission' }],
  },
  {
    prefix: 'G30',
    label: 'Alzheimer / Dementia',
    documentation: [
      'Caregiver identified & burden assessed',
      'Advance directives / MOLST',
      'Safety: driving, wandering, firearms',
      'Behavioral symptoms reviewed',
    ],
    testing: [
      { name: 'MoCA / Mini-Cog', cadence: 'Annual' },
      { name: 'Medication review (Beers criteria)', cadence: 'Annual' },
    ],
  },
  {
    prefix: 'M81',
    label: 'Osteoporosis',
    documentation: ['Fracture history', 'Fall risk', 'Calcium/Vit D intake', 'FRAX score'],
    testing: [
      { name: 'DEXA scan', cadence: 'Every 2 years' },
      { name: '25-OH Vitamin D', cadence: 'Baseline + PRN' },
    ],
  },
  {
    prefix: 'M17',
    label: 'Knee Osteoarthritis',
    documentation: ['Pain/function (WOMAC)', 'PT trial documented', 'Weight management'],
    testing: [{ name: 'Knee X-ray', cadence: 'At diagnosis / with change' }],
  },
  {
    prefix: 'Z79',
    label: 'Long-term Drug Therapy',
    documentation: ['Indication for chronic medication', 'Monitoring plan'],
    testing: [{ name: 'Drug-specific labs', cadence: 'Per medication' }],
  },
];

/** Annual / periodic documentation required by CMS for chronic-care populations. */
export const ANNUAL_REQUIRED_DOCS = [
  { key: 'awv', label: 'Annual Wellness Visit (AWV)', cadence: 'Annual', cms: 'G0438/G0439' },
  { key: 'care_plan', label: 'Comprehensive Care Plan reviewed', cadence: 'Annual + with change', cms: 'CCM 99490' },
  { key: 'med_recon', label: 'Medication reconciliation', cadence: 'Quarterly', cms: 'MIPS #46' },
  { key: 'phq9', label: 'Depression screening (PHQ-9)', cadence: 'Annual', cms: 'MIPS #134' },
  { key: 'gad7', label: 'Anxiety screening (GAD-7)', cadence: 'Annual', cms: 'MIPS #431' },
  { key: 'fall_risk', label: 'Fall risk assessment', cadence: 'Annual ≥65yo', cms: 'MIPS #154' },
  { key: 'cognitive', label: 'Cognitive impairment screening', cadence: 'Annual ≥65yo', cms: 'AWV element' },
  { key: 'tobacco', label: 'Tobacco use screening + cessation', cadence: 'Annual', cms: 'MIPS #226' },
  { key: 'audit_c', label: 'Alcohol use screening (AUDIT-C)', cadence: 'Annual', cms: 'USPSTF' },
  { key: 'sdoh', label: 'Social determinants of health screen', cadence: 'Annual', cms: 'HCC/Z-codes' },
  { key: 'advance_dir', label: 'Advance directives reviewed', cadence: 'Annual', cms: 'AWV element' },
  { key: 'bmi', label: 'BMI + nutrition counseling', cadence: 'Annual', cms: 'MIPS #128' },
  { key: 'flu_vax', label: 'Influenza vaccination', cadence: 'Annual (flu season)', cms: 'MIPS #110' },
  { key: 'pneumo_vax', label: 'Pneumococcal vaccination status', cadence: 'Once ≥65', cms: 'MIPS #111' },
  { key: 'colon_cancer', label: 'Colorectal cancer screening', cadence: '45–75', cms: 'MIPS #113' },
  { key: 'breast_cancer', label: 'Breast cancer screening', cadence: '50–74 q2yr', cms: 'MIPS #112' },
];

export function matchGuidance(icdCodes: string[]): DiagnosisGuidance[] {
  const seen = new Set<string>();
  const out: DiagnosisGuidance[] = [];
  for (const code of icdCodes) {
    const normalized = code.trim().toUpperCase().replace(/\./g, '');
    for (const g of DIAGNOSIS_GUIDANCE) {
      if (normalized.startsWith(g.prefix) && !seen.has(g.prefix)) {
        seen.add(g.prefix);
        out.push(g);
      }
    }
  }
  return out;
}
