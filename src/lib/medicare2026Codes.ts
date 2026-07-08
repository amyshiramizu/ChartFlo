/**
 * Medicare 2026 CPT / HCPCS reference for care-management & primary-care
 * services used by ChartFlo.
 *
 * Rates are NATIONAL, NON-FACILITY allowed amounts derived from the
 * CY2026 Medicare Physician Fee Schedule final rule (conversion factor
 * ~$33.42 non-QP / ~$33.59 QP). Treat them as planning estimates — actual
 * payment depends on the MAC, locality (GPCI), modifiers, and whether the
 * billing practitioner is a Qualifying APM Participant.
 *
 * Last updated for CY2026 PFS final rule.
 */

export interface MedicareCode {
  code: string;
  shortLabel: string;
  description: string;
  category:
    | 'CCM'
    | 'PCM'
    | 'APCM'
    | 'RPM'
    | 'RTM'
    | 'BHI'
    | 'TCM'
    | 'AWV'
    | 'ACP'
    | 'E/M Add-on'
    | 'Cognitive'
    | 'Preventive';
  /** Threshold minutes that unlock this code in a calendar month, if time-based. */
  minMinutes?: number;
  /** Approx. 2026 national non-facility Medicare allowed amount, USD. */
  rate2026: number;
  notes?: string;
}

// ─── CCM ──────────────────────────────────────────────────────────────────
export const CCM_CODES_2026: MedicareCode[] = [
  { code: '99490', shortLabel: 'CCM staff 20 min',  description: 'CCM, first 20 min/month (clinical staff)',           category: 'CCM', minMinutes: 20, rate2026: 60.49 },
  { code: '99439', shortLabel: "CCM staff +20",     description: "Each add'l 20 min CCM (clinical staff, max 2 units)", category: 'CCM', minMinutes: 40, rate2026: 45.93 },
  { code: '99491', shortLabel: 'CCM provider 30',   description: 'CCM personally performed by physician/QHP, 30 min',  category: 'CCM', minMinutes: 30, rate2026: 76.94 },
  { code: '99437', shortLabel: 'CCM provider +30',  description: "Each add'l 30 min CCM by physician/QHP",              category: 'CCM', minMinutes: 60, rate2026: 57.94 },
  { code: '99487', shortLabel: 'Complex CCM 60',    description: 'Complex CCM, first 60 min/month (moderate–high MDM)', category: 'CCM', minMinutes: 60, rate2026: 128.42 },
  { code: '99489', shortLabel: 'Complex CCM +30',   description: "Complex CCM, each add'l 30 min",                      category: 'CCM', minMinutes: 90, rate2026: 69.18 },
  { code: 'G0511', shortLabel: 'RHC/FQHC care mgmt', description: 'RHC/FQHC care management bundle (per encounter)',    category: 'CCM',                  rate2026: 72.43, notes: 'RHC/FQHC only; 2026 bundle rate.' },
];

// ─── PCM (Principal Care Management) ──────────────────────────────────────
export const PCM_CODES_2026: MedicareCode[] = [
  { code: '99424', shortLabel: 'PCM provider 30',  description: 'PCM personally performed, 30 min (single high-risk condition)', category: 'PCM', minMinutes: 30, rate2026: 81.18 },
  { code: '99425', shortLabel: 'PCM provider +30', description: "PCM personally performed, each add'l 30 min",                  category: 'PCM', minMinutes: 60, rate2026: 58.62 },
  { code: '99426', shortLabel: 'PCM staff 30',     description: 'PCM clinical staff, first 30 min',                             category: 'PCM', minMinutes: 30, rate2026: 60.83 },
  { code: '99427', shortLabel: 'PCM staff +30',    description: "PCM clinical staff, each add'l 30 min (max 2)",                category: 'PCM', minMinutes: 60, rate2026: 47.95 },
];

// ─── APCM (NEW 2025, refined 2026) ────────────────────────────────────────
export const APCM_CODES_2026: MedicareCode[] = [
  { code: 'G0556', shortLabel: 'APCM Level 1', description: 'Advanced Primary Care Management — Level 1 (1 chronic condition)',           category: 'APCM', rate2026: 15.20, notes: 'No time threshold; monthly per beneficiary.' },
  { code: 'G0557', shortLabel: 'APCM Level 2', description: 'Advanced Primary Care Management — Level 2 (≥2 chronic conditions)',         category: 'APCM', rate2026: 50.10 },
  { code: 'G0558', shortLabel: 'APCM Level 3', description: 'Advanced Primary Care Management — Level 3 (QMB / dual-eligible, ≥2 chronic)', category: 'APCM', rate2026: 110.42 },
];

// ─── RPM ──────────────────────────────────────────────────────────────────
export const RPM_CODES_2026: MedicareCode[] = [
  { code: '99453', shortLabel: 'RPM setup',     description: 'RPM setup & patient education (one-time per episode)',                  category: 'RPM',                  rate2026: 19.04 },
  { code: '99454', shortLabel: 'RPM device 30d', description: 'Device supply with ≥16 days of readings in 30 days',                   category: 'RPM',                  rate2026: 43.02 },
  { code: '99457', shortLabel: 'RPM mgmt 20',   description: 'RPM treatment mgmt, first 20 min/month (interactive communication req.)', category: 'RPM', minMinutes: 20, rate2026: 48.14 },
  { code: '99458', shortLabel: 'RPM mgmt +20',  description: "RPM treatment mgmt, each add'l 20 min (max 2 units)",                   category: 'RPM', minMinutes: 40, rate2026: 38.49 },
  { code: '99091', shortLabel: 'Data review 30', description: 'Collection & interpretation of physiologic data by physician/QHP ≥30 min/30d', category: 'RPM', minMinutes: 30, rate2026: 53.16 },
];

// ─── RTM ──────────────────────────────────────────────────────────────────
export const RTM_CODES_2026: MedicareCode[] = [
  { code: '98975', shortLabel: 'RTM setup',     description: 'RTM setup & patient education',                                 category: 'RTM',                  rate2026: 18.71 },
  { code: '98976', shortLabel: 'RTM respiratory device', description: 'RTM device, respiratory system, 30 days',              category: 'RTM',                  rate2026: 42.36 },
  { code: '98977', shortLabel: 'RTM MSK device',         description: 'RTM device, musculoskeletal system, 30 days',          category: 'RTM',                  rate2026: 42.36 },
  { code: '98980', shortLabel: 'RTM mgmt 20',   description: 'RTM treatment mgmt, first 20 min/month',                        category: 'RTM', minMinutes: 20, rate2026: 47.13 },
  { code: '98981', shortLabel: 'RTM mgmt +20',  description: "RTM treatment mgmt, each add'l 20 min",                         category: 'RTM', minMinutes: 40, rate2026: 37.81 },
];

// ─── BHI / CoCM ───────────────────────────────────────────────────────────
export const BHI_CODES_2026: MedicareCode[] = [
  { code: '99484', shortLabel: 'BHI 20',       description: 'General BHI care mgmt, 20 min/month',                  category: 'BHI', minMinutes: 20, rate2026: 47.97 },
  { code: '99492', shortLabel: 'CoCM initial', description: 'CoCM initial month, 70 min',                           category: 'BHI', minMinutes: 70, rate2026: 162.34 },
  { code: '99493', shortLabel: 'CoCM subseq',  description: 'CoCM subsequent month, 60 min',                        category: 'BHI', minMinutes: 60, rate2026: 129.07 },
  { code: '99494', shortLabel: 'CoCM +30',     description: "CoCM each add'l 30 min, same month",                   category: 'BHI', minMinutes: 30, rate2026: 65.93 },
];

// ─── TCM ──────────────────────────────────────────────────────────────────
export const TCM_CODES_2026: MedicareCode[] = [
  { code: '99495', shortLabel: 'TCM moderate', description: 'TCM moderate MDM, face-to-face within 14 days of d/c', category: 'TCM', rate2026: 202.17 },
  { code: '99496', shortLabel: 'TCM high',     description: 'TCM high MDM, face-to-face within 7 days of d/c',      category: 'TCM', rate2026: 271.83 },
];

// ─── AWV / Preventive / ACP ───────────────────────────────────────────────
export const AWV_CODES_2026: MedicareCode[] = [
  { code: 'G0438', shortLabel: 'AWV initial',    description: 'Initial Annual Wellness Visit (once per lifetime)',  category: 'AWV', rate2026: 165.42 },
  { code: 'G0439', shortLabel: 'AWV subsequent', description: 'Subsequent Annual Wellness Visit (annual)',          category: 'AWV', rate2026: 131.27 },
  { code: 'G0468', shortLabel: 'FQHC AWV',       description: 'FQHC AWV (initial or subsequent)',                   category: 'AWV', rate2026: 236.18 },
  { code: 'G0402', shortLabel: 'IPPE',           description: 'Initial Preventive Physical Exam ("Welcome to Medicare")', category: 'Preventive', rate2026: 174.83 },
  { code: '99497', shortLabel: 'ACP 30',         description: 'Advance Care Planning, first 30 min',                category: 'ACP', minMinutes: 16, rate2026: 84.92 },
  { code: '99498', shortLabel: 'ACP +30',        description: "ACP each add'l 30 min",                              category: 'ACP', minMinutes: 46, rate2026: 74.81 },
  { code: '99483', shortLabel: 'Cognitive eval', description: 'Cognitive assessment & care-plan visit (≥50 min)',   category: 'Cognitive', minMinutes: 50, rate2026: 271.95 },
];

// ─── E/M add-ons commonly missed ──────────────────────────────────────────
export const EM_ADDON_CODES_2026: MedicareCode[] = [
  { code: 'G2211', shortLabel: 'Visit complexity', description: 'Add-on for longitudinal care of a serious/complex condition', category: 'E/M Add-on', rate2026: 16.05 },
  { code: 'G0506', shortLabel: 'Care plan add-on', description: 'Comprehensive care-plan add-on at CCM initiating visit',      category: 'E/M Add-on', rate2026: 64.18 },
  { code: 'G2212', shortLabel: 'Prolonged E/M (Medicare)', description: 'Prolonged office/outpatient E/M, each addl 15 min',   category: 'E/M Add-on', rate2026: 32.91 },
];

export const ALL_2026_CODES: MedicareCode[] = [
  ...CCM_CODES_2026,
  ...PCM_CODES_2026,
  ...APCM_CODES_2026,
  ...RPM_CODES_2026,
  ...RTM_CODES_2026,
  ...BHI_CODES_2026,
  ...TCM_CODES_2026,
  ...AWV_CODES_2026,
  ...EM_ADDON_CODES_2026,
];

export const RATE_LOOKUP_2026: Record<string, number> = Object.fromEntries(
  ALL_2026_CODES.map((c) => [c.code, c.rate2026]),
);

export function rate2026(code: string, fallback = 0): number {
  return RATE_LOOKUP_2026[code] ?? fallback;
}
