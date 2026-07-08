// SOAP/diagnosis-driven recommendation for CMS care management programs.
// Determines whether a patient qualifies for CCM, RPM, or BHI based on
// ICD-10 codes present in their problem list (or current SOAP assessment).

export type RecProgram = 'CCM' | 'RPM' | 'BHI';

export interface ProgramRecommendation {
  program: RecProgram;
  recommended: boolean;
  reasons: string[];
  cpt: string;
  blurb: string;
}

// Chronic condition prefixes commonly accepted as qualifying for CCM
// (≥2 chronic conditions expected to last ≥12 months).
const CHRONIC_PREFIXES = [
  'E10', 'E11', 'E66', 'E78', 'E03',                    // Endocrine
  'I10', 'I11', 'I12', 'I13', 'I20', 'I21', 'I25',     // HTN/CAD
  'I48', 'I50', 'I63', 'I65', 'I69', 'I73',            // Cardio/cerebro
  'J44', 'J45', 'J84', 'J96',                           // Pulmonary
  'N18', 'N19', 'N28',                                  // Renal
  'K70', 'K72', 'K74',                                  // Hepatic
  'M05', 'M06', 'M15', 'M16', 'M17', 'M19', 'M81',     // MSK
  'G20', 'G30', 'G35', 'G40', 'G45', 'G62',            // Neuro
  'F00', 'F01', 'F02', 'F03',                           // Dementia
  'C',                                                  // Active malignancy
];

// Diagnoses that benefit from RPM (BP, glucose, weight, SpO2 monitoring).
const RPM_PREFIXES = [
  'I10', 'I11', 'I12', 'I13',   // HTN
  'I50',                         // Heart failure
  'E10', 'E11',                  // Diabetes (CGM/BG)
  'J44', 'J45', 'J96',           // COPD/asthma/respiratory failure (SpO2)
  'I48',                         // Afib (HR monitoring)
  'I25',                         // CAD
  'N18',                         // CKD (BP)
  'E66',                         // Obesity (weight)
];

// Mental/behavioral health diagnoses that qualify for BHI / CoCM.
const BHI_PREFIXES = [
  'F32', 'F33',           // Depression
  'F40', 'F41',           // Anxiety
  'F43',                  // Adjustment/PTSD reactions
  'F31',                  // Bipolar
  'F10', 'F11', 'F17',    // SUD / tobacco
];

const norm = (c: string) => (c || '').toUpperCase().replace(/\./g, '').trim();
const hasPrefix = (codes: string[], prefixes: string[]) =>
  codes.some((c) => prefixes.some((p) => c.startsWith(p)));
const matchedLabels = (codes: string[], prefixes: string[]) =>
  codes.filter((c) => prefixes.some((p) => c.startsWith(p)));

export function recommendPrograms(rawCodes: string[]): ProgramRecommendation[] {
  const codes = Array.from(new Set(rawCodes.map(norm).filter(Boolean)));

  // CCM: ≥2 distinct chronic conditions (by ICD-10 category/prefix).
  const chronicMatches = Array.from(
    new Set(
      codes
        .map((c) => CHRONIC_PREFIXES.find((p) => c.startsWith(p)))
        .filter(Boolean) as string[],
    ),
  );
  const ccmReasons: string[] = [];
  if (chronicMatches.length >= 2) {
    ccmReasons.push(
      `${chronicMatches.length} qualifying chronic conditions on problem list (${chronicMatches.join(', ')})`,
    );
    ccmReasons.push('Expected to last ≥12 months or until death of patient');
    ccmReasons.push('Places patient at significant risk of decline');
  } else if (chronicMatches.length === 1) {
    ccmReasons.push(`Only 1 chronic condition (${chronicMatches[0]}); add another to qualify for CCM`);
  } else {
    ccmReasons.push('No qualifying chronic conditions documented');
  }

  // RPM
  const rpmMatches = matchedLabels(codes, RPM_PREFIXES);
  const rpmReasons: string[] = [];
  if (rpmMatches.length) {
    rpmReasons.push(`Monitorable diagnoses present: ${rpmMatches.join(', ')}`);
    rpmReasons.push('Requires ≥16 days of physiologic data in 30 days (99454)');
    rpmReasons.push('Bill 99457 for first 20 min of monthly mgmt');
  } else {
    rpmReasons.push('No diagnoses typically driving physiologic monitoring');
  }

  // BHI
  const bhiMatches = matchedLabels(codes, BHI_PREFIXES);
  const bhiReasons: string[] = [];
  if (bhiMatches.length) {
    bhiReasons.push(`Behavioral health diagnoses: ${bhiMatches.join(', ')}`);
    bhiReasons.push('Eligible for 99484 (BHI) or 99492/99493 (CoCM)');
  } else {
    bhiReasons.push('No qualifying behavioral health diagnoses');
  }

  return [
    {
      program: 'CCM',
      recommended: chronicMatches.length >= 2,
      reasons: ccmReasons,
      cpt: '99490 / 99439 / 99491 / 99437 · APCM G0556–G0558 (2026)',
      blurb: 'Chronic Care Management — non-face-to-face care coordination ≥20 min/month, or new APCM monthly bundle (no time threshold).',
    },
    {
      program: 'RPM',
      recommended: rpmMatches.length >= 1,
      reasons: rpmReasons,
      cpt: '99453 / 99454 / 99457 / 99458 / 99091',
      blurb: 'Remote Patient Monitoring — physiologic device data review ≥20 min/month',
    },
    {
      program: 'BHI',
      recommended: bhiMatches.length >= 1,
      reasons: bhiReasons,
      cpt: '99484 / 99492 / 99493 / 99494',
      blurb: 'Behavioral Health Integration — care plan + monthly monitoring',
    },
  ];
}
