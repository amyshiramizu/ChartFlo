// Medicare Annual Wellness Visit (AWV) templates
// Reference: CMS AWV elements (HRA, screenings, cognitive, functional, preventive schedule)

export type AWVType = 'initial' | 'subsequent';

export interface AWVTemplate {
  type: AWVType;
  hcpcs: string;
  icd10: string;
  label: string;
  description: string;
  plan: string;
}

const INITIAL_PLAN = `MEDICARE INITIAL ANNUAL WELLNESS VISIT (G0438)

1. HEALTH RISK ASSESSMENT (HRA)
   - Demographics / self-assessed health status: ____
   - Psychosocial risks (depression, stress, anger, loneliness, isolation): ____
   - Behavioral risks (tobacco, alcohol, physical activity, seat belt, home safety): ____
   - ADLs (bathing, dressing, eating, transferring, toileting): ____
   - IADLs (cooking, shopping, finances, medications, transportation, phone): ____

2. MEDICAL & FAMILY HISTORY
   - Past medical / surgical history reviewed: ____
   - Family history reviewed: ____
   - Current providers & suppliers list updated: ____

3. CURRENT MEDICATIONS & SUPPLEMENTS
   - Reconciled with patient: ____

4. VITAL SIGNS / MEASUREMENTS
   - Height ____  Weight ____  BMI ____  BP ____  HR ____

5. COGNITIVE ASSESSMENT
   - Method (Mini-Cog / direct observation / informant report): ____
   - Result: ____

6. DEPRESSION SCREENING (PHQ-2 / PHQ-9)
   - Score: ____   Action: ____

7. FUNCTIONAL ABILITY & SAFETY
   - Hearing impairment screen: ____
   - Fall risk (history of falls in past year, gait/balance): ____
   - Home safety: ____

8. END-OF-LIFE / ADVANCE CARE PLANNING
   - Advance directive on file: [ ] Yes  [ ] No
   - Discussion offered: ____

9. WRITTEN SCREENING SCHEDULE (next 5–10 years)
   - Colorectal cancer screening: ____
   - Mammography: ____
   - Cervical cancer screening: ____
   - Bone density (DEXA): ____
   - AAA screening (one-time if eligible): ____
   - Lung cancer screening (LDCT if eligible): ____
   - Diabetes / lipid screening: ____

10. PREVENTIVE SERVICES / IMMUNIZATIONS
    - Influenza: ____
    - Pneumococcal (PCV20 / PCV15 + PPSV23): ____
    - COVID-19: ____
    - Tdap / Td: ____
    - Shingles (RZV): ____
    - RSV (age ≥60): ____

11. PERSONALIZED HEALTH ADVICE & REFERRALS
    - Counseling provided: ____
    - Referrals / community resources: ____

Instruction:
Always include the Plan directly beneath the Assessment section, with every ICD-10 diagnosis listed in numbered format from the assessment section. Under each diagnosis, clearly list all relevant orders and recommendations specific to that diagnosis.

Medical decision-making during this visit was of moderate/high complexity, involving the evaluation and management of multiple problems, interpretation of diagnostic results, and formulation of a treatment plan. The visit required a detailed review of the patient's history, discussion of risks and benefits, and coordination of care.

Total time spent: [insert time here], including time spent reviewing records, interacting with the patient, and documenting the encounter.

Pt is homebound. It takes a taxing effort and pt relies on others to get out to office visits and qualifies for home visits. Discussed plan of care and symptoms at length with patient and orders as above. More than half of this patient's visit was spent face to face with patient/family/facility staff in counseling and/or coordination of care.

Suggested billing codes for optimal reimbursement (provider to verify):
- Primary E/M / visit code: [____]
- Add-on / G-codes as applicable: [G2211 visit complexity], [G0506 care planning], [G0444 depression screening], [G0442 alcohol screening], [G0136 SDOH assessment], [G0438/G0439 AWV], [99497/99498 ACP], [prolonged services G2212]
- Quality / MIPS measures addressed: [____]

This note was prepared using ChartFlo AI Scribe. Some errors in transcription may be present.`;

const SUBSEQUENT_PLAN = `MEDICARE SUBSEQUENT ANNUAL WELLNESS VISIT (G0439)

1. UPDATE HEALTH RISK ASSESSMENT (HRA)
   - Changes since last AWV: ____

2. UPDATE MEDICAL / FAMILY HISTORY
   - New diagnoses, surgeries, hospitalizations: ____
   - Family history changes: ____

3. UPDATE PROVIDERS / SUPPLIERS LIST: ____

4. MEDICATION RECONCILIATION: ____

5. VITALS
   - Weight ____  BMI ____  BP ____

6. COGNITIVE ASSESSMENT
   - Method: ____   Result: ____

7. DEPRESSION SCREENING (PHQ-2/9)
   - Score: ____   Action: ____

8. FUNCTIONAL & SAFETY UPDATE
   - Falls in past year: ____
   - Hearing / vision changes: ____
   - ADL / IADL changes: ____

9. ADVANCE CARE PLANNING
   - Advance directive reviewed/updated: ____

10. UPDATE WRITTEN SCREENING SCHEDULE
    - Screenings due / completed since last visit: ____

11. PREVENTIVE SERVICES / IMMUNIZATIONS UPDATE
    - Vaccines due / administered: ____

12. PERSONALIZED HEALTH ADVICE & REFERRALS
    - Counseling: ____
    - Referrals: ____

Instruction:
Always include the Plan directly beneath the Assessment section, with every ICD-10 diagnosis listed in numbered format from the assessment section. Under each diagnosis, clearly list all relevant orders and recommendations specific to that diagnosis.

Medical decision-making during this visit was of moderate/high complexity, involving the evaluation and management of multiple problems, interpretation of diagnostic results, and formulation of a treatment plan. The visit required a detailed review of the patient's history, discussion of risks and benefits, and coordination of care.

Total time spent: [insert time here], including time spent reviewing records, interacting with the patient, and documenting the encounter.

Pt is homebound. It takes a taxing effort and pt relies on others to get out to office visits and qualifies for home visits. Discussed plan of care and symptoms at length with patient and orders as above. More than half of this patient's visit was spent face to face with patient/family/facility staff in counseling and/or coordination of care.

Suggested billing codes for optimal reimbursement (provider to verify):
- Primary E/M / visit code: [____]
- Add-on / G-codes as applicable: [G2211 visit complexity], [G0506 care planning], [G0444 depression screening], [G0442 alcohol screening], [G0136 SDOH assessment], [G0438/G0439 AWV], [99497/99498 ACP], [prolonged services G2212]
- Quality / MIPS measures addressed: [____]

This note was prepared using ChartFlo AI Scribe. Some errors in transcription may be present.`;

export const AWV_TEMPLATES: Record<AWVType, AWVTemplate> = {
  initial: {
    type: 'initial',
    hcpcs: 'G0438',
    icd10: 'Z00.00',
    label: 'Initial AWV (G0438)',
    description: 'Initial Medicare Annual Wellness Visit',
    plan: INITIAL_PLAN,
  },
  subsequent: {
    type: 'subsequent',
    hcpcs: 'G0439',
    icd10: 'Z00.00',
    label: 'Subsequent AWV (G0439)',
    description: 'Subsequent Medicare Annual Wellness Visit',
    plan: SUBSEQUENT_PLAN,
  },
};
