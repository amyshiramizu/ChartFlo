// CMS / Medicare documentation checklist for home-based (HCPCS 99341–99350)
// E/M visits. Returns per-section findings to gate Save and show fixes.

export type Severity = 'critical' | 'warning';
export type Section = 'subjective' | 'objective' | 'assessment' | 'plan' | 'visit';

export interface ChecklistItem {
  id: string;
  section: Section;
  label: string;
  severity: Severity;
  passed: boolean;
  fix?: string;
}

export interface ChecklistResult {
  items: ChecklistItem[];
  criticalCount: number;
  warningCount: number;
  passedCount: number;
  byEction?: never;
  bySection: Record<Section, ChecklistItem[]>;
  canSave: boolean; // false if any critical fails
}

export interface ValidatorInput {
  chiefComplaint: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  diagnoses: Array<{ code: string; description: string; plan: string }>;
  visitMinutes?: number | null;
  patientStatus?: 'new' | 'established';
}

const has = (s: string, re: RegExp) => re.test(s || '');
const wordCount = (s: string) => (s || '').trim().split(/\s+/).filter(Boolean).length;

export function validateCMSChecklist(input: ValidatorInput): ChecklistResult {
  const { chiefComplaint, subjective, objective, assessment, plan, diagnoses, visitMinutes } = input;

  const items: ChecklistItem[] = [];

  // ---------- VISIT-LEVEL ----------
  items.push({
    id: 'cc',
    section: 'visit',
    label: 'Chief Complaint documented',
    severity: 'critical',
    passed: !!chiefComplaint.trim() || /chief complaint/i.test(subjective),
    fix: 'Add a Chief Complaint (reason for the home visit).',
  });

  items.push({
    id: 'visit-minutes',
    section: 'visit',
    label: 'Total visit time recorded (required for time-based E/M)',
    severity: 'warning',
    passed: !!visitMinutes && visitMinutes > 0,
    fix: 'Enter total visit minutes — required when billing by time (99341–99350).',
  });

  // ---------- SUBJECTIVE ----------
  items.push({
    id: 'hpi',
    section: 'subjective',
    label: 'HPI present (≥30 words)',
    severity: 'critical',
    passed: wordCount(subjective) >= 30,
    fix: 'Expand the History of Present Illness with onset, duration, severity, context, modifying factors.',
  });
  items.push({
    id: 'pmh',
    section: 'subjective',
    label: 'PMH / past medical history referenced',
    severity: 'warning',
    passed: has(subjective, /\b(PMH|past medical history|history of|h\/o)\b/i),
    fix: 'Reference relevant PMH (e.g., "PMH: HTN, DM2").',
  });
  items.push({
    id: 'social',
    section: 'subjective',
    label: 'Social history referenced (home setting context)',
    severity: 'warning',
    passed: has(subjective, /\b(social|lives|home|caregiver|tobacco|alcohol|smoking)\b/i),
    fix: 'Add social history / living situation — supports medical necessity for home visit.',
  });
  items.push({
    id: 'ros',
    section: 'subjective',
    label: 'Review of Systems documented',
    severity: 'critical',
    passed: has(subjective, /review of systems|\bROS\b/i),
    fix: 'Insert ROS (use the "Insert ROS Template" button).',
  });

  // ---------- OBJECTIVE ----------
  items.push({
    id: 'vitals',
    section: 'objective',
    label: 'Vital signs (BP, HR or pulse)',
    severity: 'critical',
    passed: has(objective, /\b(BP|blood pressure|\d{2,3}\/\d{2,3})\b/i) &&
            has(objective, /\b(HR|heart rate|pulse|bpm)\b/i),
    fix: 'Document at least BP and HR/pulse in the Objective section.',
  });
  items.push({
    id: 'exam-systems',
    section: 'objective',
    label: 'Multi-system physical exam (≥4 systems)',
    severity: 'critical',
    passed:
      [/general:/i, /psych:/i, /eyes:/i, /ent:/i, /resp/i, /\bcv\b|cardio/i, /abdomen/i, /skin/i, /neuro/i, /msk|musculoskeletal/i]
        .filter((r) => r.test(objective)).length >= 4,
    fix: 'Document at least 4 organ systems on exam (use "Insert Exam Template").',
  });

  // ---------- ASSESSMENT ----------
  items.push({
    id: 'dx-present',
    section: 'assessment',
    label: 'At least one diagnosis with ICD-10 code',
    severity: 'critical',
    passed: diagnoses.some((d) => /^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/i.test(d.code.trim())),
    fix: 'Add at least one diagnosis with a valid ICD-10 code (e.g., I10, E11.9).',
  });
  items.push({
    id: 'dx-described',
    section: 'assessment',
    label: 'Every diagnosis has a description',
    severity: 'critical',
    passed: diagnoses.length === 0 || diagnoses.every((d) => d.description.trim().length > 2),
    fix: 'Add a description for each diagnosis row.',
  });

  // ---------- PLAN ----------
  items.push({
    id: 'plan-per-dx',
    section: 'plan',
    label: 'Plan documented for each diagnosis',
    severity: 'critical',
    passed: diagnoses.length > 0 && diagnoses.every((d) => d.plan.trim().length >= 10),
    fix: 'Every diagnosis must have a Plan (workup, meds, referrals, or follow-up).',
  });


  items.push({
    id: 'meds-reviewed',
    section: 'plan',
    label: 'Medications addressed (start/continue/stop/refill)',
    severity: 'warning',
    passed: has(plan + '\n' + assessment, /\b(continue|start|stop|refill|titrate|d\/c|discontinue|prescrib)\b/i),
    fix: 'Document medication decisions (continue, start, stop, refill, titrate).',
  });

  // ---------- AGGREGATES ----------
  const bySection: Record<Section, ChecklistItem[]> = {
    visit: [], subjective: [], objective: [], assessment: [], plan: [],
  };
  for (const it of items) bySection[it.section].push(it);

  const criticalCount = items.filter((i) => !i.passed && i.severity === 'critical').length;
  const warningCount = items.filter((i) => !i.passed && i.severity === 'warning').length;
  const passedCount = items.filter((i) => i.passed).length;

  return {
    items,
    criticalCount,
    warningCount,
    passedCount,
    bySection,
    canSave: criticalCount === 0,
  };
}

export const SECTION_LABELS: Record<Section, string> = {
  visit: 'Visit Metadata',
  subjective: 'Subjective',
  objective: 'Objective',
  assessment: 'Assessment',
  plan: 'Plan',
};
