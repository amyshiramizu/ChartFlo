/**
 * Top CMS-HCC v28 mappings used in primary care. Not exhaustive — covers ~the
 * 120 most common ICD-10 codes that drive RAF in PCP / mobile primary care
 * panels. Weights are the CY2024 community, non-dual, aged model averages
 * (rounded). Use as a *planning* aid; payer-specific RAF may differ.
 */

export interface HccEntry {
  /** ICD-10 prefix or exact code */
  icdPrefix: string;
  hcc: string;
  category: string;
  /** approximate RAF weight */
  weight: number;
  /** specificity coaching when the doc'd code is too vague to fully credit */
  coaching?: string;
}

export const HCC_CATALOG: HccEntry[] = [
  // Diabetes
  { icdPrefix: 'E11.9',  hcc: '37', category: 'Diabetes w/o complication',         weight: 0.105, coaching: 'Specify any complication: neuropathy (E11.40), nephropathy/CKD stage (E11.22 + N18.x), retinopathy (E11.319), PVD, foot ulcer.' },
  { icdPrefix: 'E11.2',  hcc: '36', category: 'Diabetes w/ CKD or other',          weight: 0.302, coaching: 'Code the linked CKD stage (N18.1-N18.6) on the same encounter.' },
  { icdPrefix: 'E11.4',  hcc: '36', category: 'Diabetes w/ neurologic',            weight: 0.302 },
  { icdPrefix: 'E11.5',  hcc: '36', category: 'Diabetes w/ peripheral circ',       weight: 0.302 },
  { icdPrefix: 'E11.6',  hcc: '36', category: 'Diabetes w/ other complication',    weight: 0.302 },
  { icdPrefix: 'E10',    hcc: '35', category: 'Type 1 DM',                          weight: 0.166 },
  // CHF / cardiac
  { icdPrefix: 'I50.9',  hcc: '226', category: 'Heart failure unspecified',        weight: 0.331, coaching: 'Specify systolic (I50.2x) vs diastolic (I50.3x) vs combined (I50.4x), and acuity (acute/chronic/acute-on-chronic).' },
  { icdPrefix: 'I50.22', hcc: '226', category: 'Chronic systolic HF',              weight: 0.331 },
  { icdPrefix: 'I50.32', hcc: '226', category: 'Chronic diastolic HF',             weight: 0.331 },
  { icdPrefix: 'I50.42', hcc: '226', category: 'Chronic combined systolic/diastolic HF', weight: 0.331 },
  { icdPrefix: 'I25.10', hcc: '224', category: 'ASCVD',                            weight: 0.140 },
  { icdPrefix: 'I48',    hcc: '238', category: 'Atrial fibrillation',              weight: 0.293 },
  { icdPrefix: 'I63',    hcc: '253', category: 'Ischemic stroke',                  weight: 0.222 },
  { icdPrefix: 'I69',    hcc: '254', category: 'Late effects of CVA',              weight: 0.327 },
  // CKD / renal
  { icdPrefix: 'N18.9',  hcc: '328', category: 'CKD unspecified',                  weight: 0.000, coaching: 'Stage the CKD: N18.1–N18.6 (or N18.30/N18.31/N18.32 for stage 3 a/b). Unspecified CKD does NOT map to an HCC.' },
  { icdPrefix: 'N18.4',  hcc: '328', category: 'CKD stage 4',                      weight: 0.289 },
  { icdPrefix: 'N18.5',  hcc: '328', category: 'CKD stage 5',                      weight: 0.289 },
  { icdPrefix: 'N18.6',  hcc: '326', category: 'ESRD',                             weight: 0.430 },
  // COPD / Asthma
  { icdPrefix: 'J44',    hcc: '280', category: 'COPD',                             weight: 0.319 },
  { icdPrefix: 'J45',    hcc: '283', category: 'Asthma',                           weight: 0.000, coaching: 'Severity-specified asthma (J45.4x, J45.5x — moderate/severe persistent) may credit; mild intermittent does not.' },
  // Mental health
  { icdPrefix: 'F32.9',  hcc: '155', category: 'Depression unspecified',           weight: 0.000, coaching: 'Specify episode severity & recurrence: major depressive disorder, single (F32.1/.2/.3) or recurrent (F33.x). MDD recurrent maps to HCC.' },
  { icdPrefix: 'F33',    hcc: '155', category: 'Major depressive disorder, recurrent', weight: 0.309 },
  { icdPrefix: 'F31',    hcc: '154', category: 'Bipolar disorder',                 weight: 0.302 },
  { icdPrefix: 'F20',    hcc: '152', category: 'Schizophrenia',                    weight: 0.518 },
  // Dementia
  { icdPrefix: 'F03.9',  hcc: '125', category: 'Dementia unspecified',             weight: 0.346, coaching: 'When known, code the type (Alzheimer G30.x + F02.8x, vascular F01.5x) for accuracy.' },
  { icdPrefix: 'G30',    hcc: '125', category: 'Alzheimer disease',                weight: 0.346 },
  // Cancer
  { icdPrefix: 'C50',    hcc: '17',  category: 'Breast cancer',                    weight: 0.150 },
  { icdPrefix: 'C61',    hcc: '17',  category: 'Prostate cancer',                  weight: 0.150 },
  { icdPrefix: 'C18',    hcc: '17',  category: 'Colorectal cancer',                weight: 0.150 },
  { icdPrefix: 'Z85',    hcc: '0',   category: 'Hx of malignancy (no HCC)',        weight: 0.000, coaching: 'Hx-of (Z85.x) does not credit; if cancer is active or under treatment, code the active C-code instead.' },
  // Vascular / amputation
  { icdPrefix: 'I70.2',  hcc: '267', category: 'PAD w/ claudication',              weight: 0.288 },
  { icdPrefix: 'L97',    hcc: '380', category: 'Chronic skin ulcer of lower limb', weight: 0.518 },
  { icdPrefix: 'Z89',    hcc: '189', category: 'Acquired absence of limb',         weight: 0.519 },
  // Substance use
  { icdPrefix: 'F11',    hcc: '135', category: 'Opioid use disorder',              weight: 0.317 },
  { icdPrefix: 'F10.2',  hcc: '136', category: 'Alcohol dependence',               weight: 0.317 },
  // BMI / Obesity
  { icdPrefix: 'E66.01', hcc: '48',  category: 'Morbid obesity',                   weight: 0.250 },
  { icdPrefix: 'Z68.4',  hcc: '48',  category: 'BMI ≥40',                          weight: 0.250 },
  // Neuro
  { icdPrefix: 'G20',    hcc: '79',  category: 'Parkinson disease',                weight: 0.461 },
  { icdPrefix: 'G35',    hcc: '78',  category: 'Multiple sclerosis',               weight: 0.461 },
  { icdPrefix: 'G40',    hcc: '80',  category: 'Epilepsy',                         weight: 0.211 },
];

/** Find best HCC entry for an ICD-10 code by longest matching prefix. */
export function lookupHcc(icd10: string): HccEntry | null {
  const up = (icd10 || '').toUpperCase().trim();
  if (!up) return null;
  let best: HccEntry | null = null;
  for (const e of HCC_CATALOG) {
    if (up.startsWith(e.icdPrefix) && (!best || e.icdPrefix.length > best.icdPrefix.length)) {
      best = e;
    }
  }
  return best;
}

/** Compute simple specificity score 0-100 for a code: unspecified codes get low. */
export function specificityScore(icd10: string): number {
  const up = (icd10 || '').toUpperCase();
  if (!up) return 0;
  // Heuristic: more digits past the decimal = more specific; ".9" suffix penalised.
  const [, tail = ''] = up.split('.');
  let score = 40 + Math.min(50, tail.length * 15);
  if (up.endsWith('.9') || up.endsWith('9')) score -= 25;
  if (tail.length >= 3) score += 10;
  return Math.max(0, Math.min(100, score));
}
