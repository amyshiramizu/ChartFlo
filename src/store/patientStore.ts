import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import type { Patient, ClinicalNote, Medication, NoteTemplate } from '@/types/patient';

interface PatientStore {
  patients: Patient[];
  templates: NoteTemplate[];
  selectedPatientId: string | null;
  loading: boolean;
  fetchPatients: () => Promise<void>;
  fetchTemplates: () => Promise<void>;
  addPatient: (patient: Omit<Patient, 'medications' | 'notes'>) => Promise<void>;
  updatePatient: (id: string, updates: Partial<Patient>) => Promise<boolean | void>;
  selectPatient: (id: string | null) => void;
  addNote: (patientId: string, note: ClinicalNote) => Promise<void>;
  deleteNote: (patientId: string, noteId: string) => Promise<void>;
  updateNote: (patientId: string, noteId: string, updates: Partial<ClinicalNote>) => Promise<void>;
  addMedication: (patientId: string, med: Medication) => Promise<void>;
  updateMedication: (patientId: string, medId: string, updates: Partial<Medication>) => Promise<void>;
  addTemplate: (template: NoteTemplate) => Promise<void>;
  updateTemplate: (id: string, updates: Partial<NoteTemplate>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  getSelectedPatient: () => Patient | undefined;
}

const defaultTemplates: NoteTemplate[] = [
  {
    id: 'default-soap',
    name: 'Standard SOAP Note',
    type: 'soap',
    subjectivePrompt: 'Chief complaint, HPI, ROS...',
    objectivePrompt: 'Vitals, physical exam findings...',
    assessmentPrompt: 'Diagnosis, differential...',
    planPrompt: 'Instruction:\nAlways include the Plan directly beneath the Assessment section, with every ICD-10 diagnosis listed in numbered format from the assessment section. Under each diagnosis, clearly list all relevant orders and recommendations specific to that diagnosis.\n\nMedical decision-making during this visit was of moderate/high complexity, involving the evaluation and management of multiple problems, interpretation of diagnostic results, and formulation of a treatment plan. The visit required a detailed review of the patient\'s history, discussion of risks and benefits, and coordination of care.\n\nTotal time spent: [insert time here], including time spent reviewing records, interacting with the patient, and documenting the encounter.\n\nPt is homebound. It takes a taxing effort and pt relies on others to get out to office visits and qualifies for home visits. Discussed plan of care and symptoms at length with patient and orders as above. More than half of this patient\'s visit was spent face to face with patient/family/facility staff in counseling and/or coordination of care.\n\nSuggested billing codes for optimal reimbursement (provider to verify):\n- Primary E/M / visit code: [____]\n- Add-on / G-codes as applicable: [G2211 visit complexity], [G0506 care planning], [G0444 depression screening], [G0442 alcohol screening], [G0136 SDOH assessment], [G0438/G0439 AWV], [99497/99498 ACP], [prolonged services G2212]\n- Quality / MIPS measures addressed: [____]\n\nThis note was prepared using ChartFlo AI Scribe. Some errors in transcription may be present.',
  },
  {
    id: 'follow-up',
    name: 'Follow-Up Visit',
    type: 'progress',
    subjectivePrompt:
      'FORMAT THE SUBJECTIVE SECTION EXACTLY AS FOLLOWS:\n\n' +
      '1) Opening paragraph: A single paragraph that includes the patient\'s age, pertinent past medical history (PMH), and relevant social history, followed by the relevant subjective content for this visit. Do NOT use bullet points here — write as a flowing paragraph.\n\n' +
      '2) Problem-based subjective: Detect every distinct clinical issue mentioned by the patient and group the subjective information under each diagnosis using this exact structure:\n\n' +
      '1. [Medical Problem / Diagnosis]\n' +
      '   Assessment/Diagnosis: [Diagnosis or working diagnosis]\n' +
      '   Subjective Information:\n' +
      '   [Symptoms, complaints, duration, related history, patient\'s description, etc.]\n\n' +
      '2. [Next Medical Problem / Diagnosis]\n' +
      '   Assessment/Diagnosis: [Diagnosis or working diagnosis]\n' +
      '   Subjective Information:\n' +
      '   [...]\n\n' +
      'RULES:\n' +
      '- Do NOT list vital signs that are within normal range as a diagnosis.\n' +
      '- Only create a numbered problem when there is real subjective content tied to it.\n' +
      '- Keep wording concise and clinical.\n\n' +
      '3) Review of Systems (ROS) — include the following block at the end of the Subjective section:\n\n' +
      'Review of Systems (ROS):\n' +
      'Constitutional: [e.g., Denies fever, chills, weight loss. Reports fatigue.]\n' +
      'Eyes: [e.g., Denies vision changes, eye pain, or redness.]\n' +
      'ENT: [e.g., Reports nasal congestion. Denies sore throat or ear pain.]\n' +
      'Cardiovascular: [e.g., Denies chest pain or palpitations.]\n' +
      'Respiratory: [e.g., Reports shortness of breath. Denies cough or wheezing.]\n' +
      'Gastrointestinal: [e.g., Reports nausea. Denies vomiting, diarrhea, or constipation.]\n' +
      'Genitourinary: [e.g., Denies dysuria, frequency, or hematuria.]\n' +
      'Musculoskeletal: [e.g., Reports knee pain. Denies joint swelling or muscle weakness.]\n' +
      'Neurological: [e.g., Denies headache, dizziness, or numbness.]\n' +
      'Psychiatric: [e.g., Reports feeling anxious. Denies depression or suicidal ideation.]\n\n' +
      'ROS: A complete 10-point review of systems was performed and is negative except where otherwise noted: [Insert positive findings or state "All systems negative"].',
    objectivePrompt: 'Interval vitals, focused exam...',
    assessmentPrompt: 'Updated assessment...',
    planPrompt: 'Instruction:\nAlways include the Plan directly beneath the Assessment section, with every ICD-10 diagnosis listed in numbered format from the assessment section. Under each diagnosis, clearly list all relevant orders and recommendations specific to that diagnosis.\n\nMedical decision-making during this visit was of moderate/high complexity, involving the evaluation and management of multiple problems, interpretation of diagnostic results, and formulation of a treatment plan. The visit required a detailed review of the patient\'s history, discussion of risks and benefits, and coordination of care.\n\nTotal time spent: [insert time here], including time spent reviewing records, interacting with the patient, and documenting the encounter.\n\nPt is homebound. It takes a taxing effort and pt relies on others to get out to office visits and qualifies for home visits. Discussed plan of care and symptoms at length with patient and orders as above. More than half of this patient\'s visit was spent face to face with patient/family/facility staff in counseling and/or coordination of care.\n\nSuggested billing codes for optimal reimbursement (provider to verify):\n- Primary E/M / visit code: [____]\n- Add-on / G-codes as applicable: [G2211 visit complexity], [G0506 care planning], [G0444 depression screening], [G0442 alcohol screening], [G0136 SDOH assessment], [G0438/G0439 AWV], [99497/99498 ACP], [prolonged services G2212]\n- Quality / MIPS measures addressed: [____]\n\nThis note was prepared using ChartFlo AI Scribe. Some errors in transcription may be present.',
  },
  {
    id: 'establish-care-primary',
    name: 'Establish Care — Primary Care',
    type: 'soap',
    subjectivePrompt:
      'FORMAT THE SUBJECTIVE SECTION EXACTLY AS FOLLOWS:\n\n' +
      '1) Opening paragraph: Write a SINGLE FLOWING PARAGRAPH (no bullet points, no length restriction) that includes ALL pertinent information across these elements — Allergies, PMH, PSH, FH, SH, Habits, and Meds. Include every relevant detail; do not truncate.\n\n' +
      '2) Disease-specific, problem-focused content in numbered format. For each active diagnosis, use:\n' +
      '   1. [Diagnosis]\n' +
      '      Subjective Information: [symptoms, complaints, duration, related history, patient\'s description]\n' +
      '   2. [Next Diagnosis]\n' +
      '      Subjective Information: [...]\n\n' +
      '3) Review of Systems (ROS) — list each system on its own line with "Denies ..." or "Reports ..." phrasing:\n' +
      'Constitutional:\nEyes:\nENT:\nCardiovascular:\nRespiratory:\nGastrointestinal:\nGenitourinary:\nMusculoskeletal:\nNeurological:\nPsychiatric:\n\n' +
      'Then add: "A 10-point review of systems was performed and is negative except as noted above."\n\n' +
      '4) End the Subjective with this line exactly:\nInterviewed staff, reviewed MAR.',
    objectivePrompt:
      'Vitals: BP, HR, RR, Temp, SpO2, Wt, Ht, BMI.\n' +
      'General: Well-appearing, NAD.\n' +
      'HEENT: NCAT, PERRL, EOMI, oropharynx clear, TMs intact.\n' +
      'Neck: Supple, no LAD, no thyromegaly, no JVD/bruits.\n' +
      'CV: RRR, no m/r/g, normal S1/S2.\n' +
      'Pulm: CTA bilaterally, no wheezes/rales/rhonchi.\n' +
      'Abd: Soft, NT/ND, +BS, no HSM.\n' +
      'Ext: No edema, pulses 2+, no cyanosis.\n' +
      'Skin: No suspicious lesions or rashes.\n' +
      'Neuro: A&Ox3, CN II-XII intact, strength 5/5, sensation intact, gait normal.\n' +
      'Psych: Mood/affect appropriate, normal insight/judgment.\n' +
      'In-office: POC labs, EKG if indicated.',
    assessmentPrompt:
      '1. Adult health maintenance / establish care (Z00.00 — general adult medical exam w/o abnormal findings; Z02.89 if exam for admin purposes).\n' +
      '2. Chronic problem list with ICD-10 (e.g., I10 essential HTN, E11.9 T2DM w/o complications, E78.5 HLD).\n' +
      '3. Tobacco/alcohol/substance use status (F17.210, F10.10).\n' +
      '4. BMI category if abnormal (E66.9 obesity, Z68.xx).\n' +
      '5. Mental health screen results (PHQ-9, GAD-7).\n' +
      '6. Vaccination/screening gaps to address.',
    planPrompt:
      'Instruction:\n' +
      'Always include the Plan directly beneath the Assessment section, with every ICD-10 diagnosis listed in numbered format from the assessment section. Under each diagnosis, clearly list all relevant orders and recommendations specific to that diagnosis.\n\n' +
      'Medical decision-making during this visit was of moderate/high complexity, involving the evaluation and management of multiple problems, interpretation of diagnostic results, and formulation of a treatment plan. The visit required a detailed review of the patient\'s history, discussion of risks and benefits, and coordination of care.\n\n' +
      'Total time spent: [insert time here], including time spent reviewing records, interacting with the patient, and documenting the encounter.\n\n' +
      'Pt is homebound. It takes a taxing effort and pt relies on others to get out to office visits and qualifies for home visits. Discussed plan of care and symptoms at length with patient and orders as above. More than half of this patient\'s visit was spent face to face with patient/family/facility staff in counseling and/or coordination of care.\n\n' +
      'Suggested billing codes for optimal reimbursement (provider to verify):\n' +
      '- Primary E/M / visit code: [____]\n' +
      '- Add-on / G-codes as applicable: [G2211 visit complexity], [G0506 care planning], [G0444 depression screening], [G0442 alcohol screening], [G0136 SDOH assessment], [G0438/G0439 AWV], [99497/99498 ACP], [prolonged services G2212]\n' +
      '- Quality / MIPS measures addressed: [____]\n\n' +
      'This note was prepared using ChartFlo AI Scribe. Some errors in transcription may be present.',
  },
  {
    id: 'awv-cms',
    name: 'Annual Wellness Visit (AWV) — CMS',
    type: 'soap',
    subjectivePrompt:
      'Visit type: ☐ Initial AWV (G0438, once per lifetime, >12 mo after IPPE/Part B enrollment) ☐ Subsequent AWV (G0439, annually).\n' +
      'CC: Medicare Annual Wellness Visit.\n' +
      'HRA (Health Risk Assessment) completed: demographics, self-assessed health, psychosocial risks (depression, stress, anger, loneliness), behavioral risks (tobacco, alcohol, physical activity, nutrition, seat belt, home safety), ADLs/IADLs (bathing, dressing, eating, transferring, toileting, telephone, finances, shopping, meds, transportation).\n' +
      'PMH / Chronic conditions with current status and control.\n' +
      'PSH; Medications (incl. OTC/supplements) with adherence; Allergies + reactions.\n' +
      'FHx: First-degree relatives — CAD, CVA, CA, DM, hereditary conditions.\n' +
      'SHx: Tobacco (pack-years), alcohol (AUDIT-C), substance use, occupation, living situation, caregiver/social support, advance directives status.\n' +
      'Preventive hx: Prior screenings (colonoscopy, mammogram, Pap, DEXA, AAA, LDCT), immunizations (flu, pneumo, shingles, Tdap, COVID, RSV ≥60), dental/vision/hearing.\n' +
      'Cognitive concerns: Patient/family/caregiver report of memory or function changes.\n' +
      'Fall hx in past 12 mo; gait/balance concerns.\n' +
      'Mood: PHQ-2/PHQ-9 screen.\n' +
      'ROS: 10-point review.',
    objectivePrompt:
      'Vitals: BP, HR, RR, Temp, SpO2, Wt, Ht, BMI, waist circumference, visual acuity.\n' +
      'General: Well-appearing, NAD.\n' +
      'HEENT: NCAT, PERRL, EOMI, oropharynx clear, TMs intact, hearing grossly intact (whisper test).\n' +
      'Neck: Supple, no LAD, no thyromegaly, no JVD/bruits.\n' +
      'CV: RRR, no m/r/g, normal S1/S2, peripheral pulses 2+.\n' +
      'Pulm: CTA bilaterally, no wheezes/rales/rhonchi.\n' +
      'Abd: Soft, NT/ND, +BS, no HSM, no masses.\n' +
      'Ext: No edema, no cyanosis, skin intact.\n' +
      'Skin: No suspicious lesions or rashes.\n' +
      'Neuro: A&Ox3, CN II-XII intact, strength 5/5, sensation intact.\n' +
      'Psych: Mood/affect appropriate, normal insight/judgment.\n' +
      'Functional assessment: ADLs/IADLs reviewed; fall risk (Timed Up & Go / gait & balance observed); hearing/vision screen.\n' +
      'Cognitive assessment (required): Mini-Cog / GPCOG / MIS — score documented.\n' +
      'Depression screen (required): PHQ-2/PHQ-9 — score documented.\n' +
      'Substance use screen: AUDIT-C, tobacco, opioid/SUD risk.',
    assessmentPrompt:
      '1. Encounter for Medicare Annual Wellness Visit (Z00.00 general adult exam w/o abnormal findings, or Z00.01 with abnormal findings).\n' +
      '2. Chronic problem list with ICD-10 and current control status.\n' +
      '3. Cognitive screen result (normal vs. impairment — R41.81, F03.90 if applicable).\n' +
      '4. Depression screen result (Z13.31, F32.x if positive).\n' +
      '5. Fall risk status (Z91.81 hx of falls; R29.6 repeated falls).\n' +
      '6. BMI category (Z68.xx; E66.9 obesity if applicable).\n' +
      '7. Tobacco/alcohol/substance use status (F17.210, F10.10, Z72.0).\n' +
      '8. Functional status / ADL limitations if any.\n' +
      '9. Preventive screening and immunization gaps identified.\n' +
      '10. Advance care planning discussion (if performed, bill +99497).',
    planPrompt:
      'Personalized Prevention Plan Services (PPPS) provided — written 5–10 yr schedule of screenings/immunizations given to patient.\n' +
      'Screening schedule:\n' +
      '  • Colorectal (≥45): FIT annually / Cologuard q3y / colonoscopy q10y.\n' +
      '  • Mammogram q1-2y (women ≥40).\n' +
      '  • Cervical: Pap q3y or Pap+HPV q5y (21-65).\n' +
      '  • DEXA (women ≥65, men ≥70, or risk).\n' +
      '  • AAA US one-time (men 65-75 ever-smoker).\n' +
      '  • LDCT lung cancer (50-80, 20 pack-yr, current or quit ≤15 yr).\n' +
      '  • HIV, Hep C (one-time adult); HepB screen if risk.\n' +
      '  • Diabetes / lipid / HTN screening per USPSTF.\n' +
      'Immunizations (Medicare-covered): Influenza annually, pneumococcal (PCV20 or PCV15+PPSV23), shingles (Shingrix ≥50), Tdap q10y, COVID-19, RSV (≥60 shared decision), HepB if risk.\n' +
      'Counseling (Medicare-covered when indicated): Tobacco cessation (G0436/G0437), obesity (G0447), alcohol misuse (G0442/G0443), depression (G0444), CV disease behavioral therapy (G0446), STI (G0445).\n' +
      'Fall prevention: Vitamin D / strength & balance / med review for high-risk meds; PT referral if indicated.\n' +
      'Cognitive: If abnormal Mini-Cog → schedule detailed cognitive evaluation (G0505 / CPT 99483).\n' +
      'Depression: Treat or refer per PHQ-9 severity; safety plan if SI.\n' +
      'Advance Care Planning: Discussed goals of care, healthcare proxy, MOLST/POLST, advance directive — document time spent (≥16 min for +99497).\n' +
      'Chronic disease management continued; medication reconciliation completed.\n' +
      'CCM/RPM eligibility reviewed and offered if ≥2 chronic conditions.\n' +
      'PPPS handed to patient. Questions answered. Verbal consent obtained.\n' +
      'Instruction:\nAlways include the Plan directly beneath the Assessment section, with every ICD-10 diagnosis listed in numbered format from the assessment section. Under each diagnosis, clearly list all relevant orders and recommendations specific to that diagnosis.\n\nMedical decision-making during this visit was of moderate/high complexity, involving the evaluation and management of multiple problems, interpretation of diagnostic results, and formulation of a treatment plan. The visit required a detailed review of the patient\'s history, discussion of risks and benefits, and coordination of care.\n\nTotal time spent: [insert time here], including time spent reviewing records, interacting with the patient, and documenting the encounter.\n\nPt is homebound. It takes a taxing effort and pt relies on others to get out to office visits and qualifies for home visits. Discussed plan of care and symptoms at length with patient and orders as above. More than half of this patient\'s visit was spent face to face with patient/family/facility staff in counseling and/or coordination of care.\n\nSuggested billing codes for optimal reimbursement (provider to verify):\n- Primary E/M / visit code: [____]\n- Add-on / G-codes as applicable: [G2211 visit complexity], [G0506 care planning], [G0444 depression screening], [G0442 alcohol screening], [G0136 SDOH assessment], [G0438/G0439 AWV], [99497/99498 ACP], [prolonged services G2212]\n- Quality / MIPS measures addressed: [____]\n\nThis note was prepared using ChartFlo AI Scribe. Some errors in transcription may be present.',
  },
  {
    id: 'tcm-cms',
    name: 'Transitional Care Management (TCM) — CMS',
    type: 'soap',
    subjectivePrompt:
      'Visit type: ☐ TCM Moderate complexity (CPT 99495 — face-to-face within 14 days of discharge) ☐ TCM High complexity (CPT 99496 — face-to-face within 7 days of discharge).\n' +
      'Discharge details:\n' +
      '  • Discharging facility: [hospital / SNF / observation / partial hospitalization / CMHC].\n' +
      '  • Admission date: [____]   Discharge date: [____]   Days since discharge: [____].\n' +
      '  • Discharge diagnoses: [____].\n' +
      '  • Discharging provider: [____].\n' +
      'Interactive contact (required ≤2 business days post-discharge): ☐ Phone ☐ Email ☐ Face-to-face — Date/time: [____], with: [patient / caregiver]. Summary of contact: [____].\n' +
      'Reason for admission and hospital course (brief): [____].\n' +
      'Discharge summary reviewed: ☐ Yes ☐ Pending — date reviewed: [____].\n' +
      'Patient/caregiver understanding of diagnoses, discharge instructions, and red-flag symptoms: [____].\n' +
      'Current symptoms / interval changes since discharge: [____].\n' +
      'New or changed medications since admission; adherence and any side effects: [____].\n' +
      'Pending labs, imaging, biopsies, or consults from hospitalization: [____].\n' +
      'Durable medical equipment, home health, hospice, PT/OT, infusion, or community services in place or needed: [____].\n' +
      'Caregiver / social support, transportation, housing, food, and financial barriers (SDOH): [____].\n' +
      'Advance directive / code status / goals of care reviewed: [____].\n' +
      'ROS: 10-point review with focus on discharge diagnoses.',
    objectivePrompt:
      'Vitals: BP, HR, RR, Temp, SpO2, Wt (compare to discharge weight), BMI, pain score.\n' +
      'General: Well-appearing vs. ill-appearing, NAD vs. distress.\n' +
      'HEENT, Neck, CV, Pulm, Abd, Ext, Skin (incl. surgical wounds / pressure injuries / IV sites), Neuro, Psych — focused exam relevant to discharge diagnoses.\n' +
      'Functional status: ambulation, ADLs/IADLs vs. baseline, fall risk (Timed Up & Go if indicated).\n' +
      'Cognitive screen if AMS or new cognitive concern (Mini-Cog).\n' +
      'Depression screen (PHQ-2/PHQ-9) — post-hospitalization depression risk.\n' +
      'In-office: review discharge summary, hospital labs/imaging, medication list reconciliation (compare pre-admission, discharge, and current med lists — document discrepancies).',
    assessmentPrompt:
      '1. Encounter for Transitional Care Management following discharge from [facility] on [date] — list primary discharge diagnosis with ICD-10.\n' +
      '2. Each active chronic and acute problem from the hospitalization with ICD-10 and current status (improving / stable / worsening).\n' +
      '3. Medication reconciliation status: ☐ Completed on date of face-to-face visit (REQUIRED for TCM billing) ☐ Discrepancies identified and resolved.\n' +
      '4. Complexity of medical decision-making: ☐ Moderate (99495) ☐ High (99496) — justify based on number/severity of problems, data reviewed, and risk.\n' +
      '5. Risk of readmission: ☐ Low ☐ Moderate ☐ High — drivers: [____].\n' +
      '6. SDOH / functional / cognitive / behavioral health issues identified (Z-codes as applicable).\n' +
      '7. Goals of care / advance directive status.',
    planPrompt:
      'TCM service period: 30 days beginning on date of discharge. Bill TCM code (99495 or 99496) on the 30th day post-discharge; do NOT bill same-day E/M.\n\n' +
      'Required TCM elements documented:\n' +
      '  • Interactive contact within 2 business days of discharge (date, method, with whom).\n' +
      '  • Face-to-face visit within 7 days (99496 high complexity) or 14 days (99495 moderate complexity) of discharge.\n' +
      '  • Medication reconciliation and management performed no later than the date of the face-to-face visit.\n' +
      '  • Review of discharge summary, diagnostic tests, and pending results.\n' +
      '  • Education to patient/caregiver re: diagnoses, self-management, activity, diet, danger signs, and when to seek care.\n' +
      '  • Establishment or re-establishment of referrals and arrangement of community resources.\n' +
      '  • Assistance scheduling follow-up with providers and services.\n\n' +
      'Plan by problem (list every ICD-10 from the Assessment, then orders/recommendations beneath each):\n' +
      '1. [Discharge diagnosis] — meds, monitoring, labs, follow-up, red flags.\n' +
      '2. [Next problem] — ...\n\n' +
      'Medication changes: discontinue [____], start [____], dose-adjust [____]. Updated med list provided to patient/caregiver.\n' +
      'Pending results to track: [____] — responsible clinician: [____].\n' +
      'Referrals / consults: [Cardiology / Pulm / PT / OT / SW / Home Health / Hospice / Palliative / Behavioral Health].\n' +
      'Home health orders / DME / oxygen / infusion certified: [____].\n' +
      'Follow-up: next PCP visit on [date]; specialist follow-up on [date].\n' +
      'Patient/caregiver education: written discharge instructions reviewed, teach-back used, red-flag symptoms reviewed (e.g., chest pain, SOB, fever, bleeding, confusion, falls).\n' +
      'Advance care planning revisited (bill +99497 if ≥16 min spent and separately documented).\n' +
      'CCM / RPM / PCM eligibility reviewed and offered if ≥1-2 chronic conditions.\n' +
      'Readmission-risk mitigation: medication adherence support, transportation, caregiver coaching, scale/BP cuff use, SDOH referrals.\n\n' +
      'Instruction:\n' +
      'Always include the Plan directly beneath the Assessment section, with every ICD-10 diagnosis listed in numbered format from the assessment section. Under each diagnosis, clearly list all relevant orders and recommendations specific to that diagnosis.\n\n' +
      'Medical decision-making during this TCM visit was of moderate (99495) / high (99496) complexity, involving reconciliation of a transition of care, evaluation and management of multiple active problems, interpretation of hospital diagnostic data, coordination with discharging providers and community services, and formulation of a post-discharge treatment plan.\n\n' +
      'Total time spent on TCM activities during the 30-day service period (non-face-to-face + face-to-face): [insert minutes here], including chart and discharge summary review, medication reconciliation, patient/caregiver communication, care coordination, and documentation.\n\n' +
      'Pt is homebound. It takes a taxing effort and pt relies on others to get out to office visits and qualifies for home visits. Discussed plan of care and symptoms at length with patient and orders as above. More than half of this patient\'s visit was spent face to face with patient/family/facility staff in counseling and/or coordination of care.\n\n' +
      'Suggested billing codes for optimal reimbursement (provider to verify):\n' +
      '- TCM code (bill on day 30): [99495 moderate / 99496 high]\n' +
      '- Add-on / G-codes as applicable: [G2211 visit complexity], [99497/99498 ACP], [G0506 care planning], [G0444 depression screening], [G0136 SDOH assessment], [prolonged services G2212]\n' +
      '- Concurrent care management programs (cannot overlap TCM 30-day period for same time): [CCM 99490/99439, PCM 99426/99427, RPM 99457/99458]\n' +
      '- Quality / MIPS measures addressed: [____]\n\n' +
      'This note was prepared using ChartFlo AI Scribe. Some errors in transcription may be present.',
  },
  {
    id: 'ccm-monthly-visit',
    name: 'CCM Monthly Visit (single-section)',
    type: 'soap',
    subjectivePrompt:
      'CCM visit:\n\n' +
      'Date:\n\n' +
      'Met with patient today and discussed the chronic care management program and that I would make a monthly visit; patient reports that would be fine. Vital signs obtained.\n\n' +
      'BP:\n' +
      'HR:\n' +
      'O2:\n' +
      'Insight Monitor:\n' +
      'Allergies to meds:\n\n' +
      '1.) Hospitalizations-\n' +
      '2.) HH-\n' +
      "3.) Specialists- If they saw any special doctor's example: Cardiologist\n" +
      '4.) Medications-\n' +
      '5.) Falls-\n' +
      '6.) Labs-\n' +
      '7.) Weight/Appetite-\n' +
      '8.) Vision/hearing-\n' +
      '9.) Skin (lesions, swelling, bruising)-\n' +
      '10.) Pain/Sleep-\n' +
      '11.) Oxygen-\n' +
      '12.) Urine and bowels-\n' +
      '13.) Review for SLUMS eval\n' +
      '14.) Any changes with insurance-\n' +
      '15.) Environmental conditions (lives at home, ALF, SNF)-\n' +
      '16.) New Concerns-\n' +
      '17.) Any follow up items with outside providers/clinics/hospitals (list date and time)-\n' +
      '18.) Request any H&P from outside doctors/clinics/hospitals-\n' +
      '19.) Followed up with provider regarding listed concerns (list date and time)-\n' +
      '20.) Planned interventions-\n' +
      '21.) Treatment plan/prognosis-\n' +
      '22.) Prior month concerns addressed-\n' +
      '24.) Attach medical records obtained to chart, blood sugar log, rpm readings document to CCM encounter.\n' +
      "25.) Document patient's social situation, include that patient lives in an assisted living facility and does not have access to outside providers due to no longer driving, family is unable to transport patient to appointments, so care is provided in the home.\n\n" +
      'CCM Conditions (please list each condition is assessed and the plan of care moving forward, if stable/managed, please describe):\n\n' +
      'Total time spent with patient discussing chronic conditions and concerns and communicating with NP. mins. -\n\n\n' +
      'Total CCM Time for the Month:',
    objectivePrompt: '',
    assessmentPrompt: '',
    planPrompt: '',
  },
];

export const usePatientStore = create<PatientStore>()((set, get) => ({
  patients: [],
  templates: defaultTemplates,
  selectedPatientId: null,
  loading: false,

  fetchPatients: async () => {
    set({ loading: true });
    try {
      const activeClinicId = localStorage.getItem('chart_scribe_active_clinic');

      // Paginate through patients to break the Supabase 1000-row default cap.
      const PAGE = 1000;
      const patientsData: any[] = [];
      for (let from = 0; ; from += PAGE) {
        let query = supabase
          .from('patients')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + PAGE - 1);
        if (activeClinicId) query = query.eq('clinic_id', activeClinicId);
        const { data, error } = await query;
        if (error) throw error;
        if (!data || data.length === 0) break;
        patientsData.push(...data);
        if (data.length < PAGE) break;
      }

      // Bulk-fetch meds + notes for ALL patients in batched IN() queries (avoids N+1).
      const ids = patientsData.map((p: any) => p.id);
      const medsByPatient = new Map<string, any[]>();
      const notesByPatient = new Map<string, any[]>();
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const [{ data: meds }, { data: notes }] = await Promise.all([
          supabase.from('medications').select('*').in('patient_id', slice),
          supabase.from('clinical_notes').select('*').in('patient_id', slice).order('date', { ascending: false }),
        ]);
        (meds || []).forEach((m: any) => {
          const arr = medsByPatient.get(m.patient_id) || [];
          arr.push(m); medsByPatient.set(m.patient_id, arr);
        });
        (notes || []).forEach((n: any) => {
          const arr = notesByPatient.get(n.patient_id) || [];
          arr.push(n); notesByPatient.set(n.patient_id, arr);
        });
      }

      const patients: Patient[] = patientsData.map((p: any) => ({
        id: p.id,
        firstName: p.first_name,
        lastName: p.last_name,
        dob: p.dob,
        mrn: p.mrn,
        gender: p.gender as 'male' | 'female',
        phone: p.phone || undefined,
        allergies: p.allergies || [],
        createdAt: p.created_at,
        provider: p.provider || undefined,
        location: p.location || undefined,
        // Tolerate databases where the status migration hasn't run yet
        status: p.status === 'inactive' ? 'inactive' : 'active',
        insurance: p.insurance || undefined,
        zipCode: p.zip_code || undefined,
        dischargeDate: p.discharge_date || undefined,
        medications: (medsByPatient.get(p.id) || []).map((m: any) => ({
          id: m.id,
          name: m.name,
          dosage: m.dosage,
          frequency: m.frequency,
          route: m.route,
          prescribedDate: m.prescribed_date,
          active: m.active,
        })),
        notes: (notesByPatient.get(p.id) || []).map((n: any) => ({
          id: n.id,
          date: n.date,
          type: n.type as 'soap' | 'progress' | 'procedure',
          subjective: n.subjective,
          objective: n.objective,
          assessment: n.assessment,
          plan: n.plan,
          author: n.author,
          dictated: n.dictated,
        })),
      }));

      set({ patients, loading: false });
    } catch (err) {
      console.error('Failed to fetch patients:', err);
      set({ loading: false });
    }
  },

  fetchTemplates: async () => {
    const { data, error } = await supabase.from('note_templates').select('*');
    if (error) {
      console.error('Failed to fetch templates:', error);
      return;
    }
    const dbTemplates: NoteTemplate[] = (data || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      subjectivePrompt: t.subjective_prompt,
      objectivePrompt: t.objective_prompt,
      assessmentPrompt: t.assessment_prompt,
      planPrompt: t.plan_prompt,
    }));

    // Apply per-user overrides for built-in default templates. Cloud copy in
    // user_settings wins so edits follow the user across devices; localStorage
    // is a fallback for databases that predate the template_overrides column.
    let overrides: Record<string, Partial<NoteTemplate>> = {};
    try {
      overrides = JSON.parse(localStorage.getItem('chart_scribe_default_template_overrides') || '{}');
    } catch {}
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: settings } = await supabase
          .from('user_settings')
          .select('template_overrides' as any)
          .eq('user_id', user.id)
          .maybeSingle();
        const cloud = (settings as any)?.template_overrides;
        if (cloud && Object.keys(cloud).length > 0) {
          overrides = cloud;
          localStorage.setItem('chart_scribe_default_template_overrides', JSON.stringify(cloud));
        } else if (Object.keys(overrides).length > 0) {
          // One-time upload of pre-existing local overrides to the cloud.
          await supabase.from('user_settings').upsert(
            { user_id: user.id, template_overrides: overrides } as any,
            { onConflict: 'user_id' },
          );
        }
      }
    } catch (e) {
      console.warn('Template override sync skipped (run latest DB migration to enable):', e);
    }
    const mergedDefaults = defaultTemplates.map(t =>
      overrides[t.id] ? { ...t, ...overrides[t.id] } : t
    );

    set({ templates: [...mergedDefaults, ...dbTemplates] });
  },


  addPatient: async (patient) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Get active clinic from localStorage
    const activeClinicId = localStorage.getItem('chart_scribe_active_clinic');

    const { data, error } = await supabase.from('patients').insert({
      user_id: user.id,
      first_name: patient.firstName,
      last_name: patient.lastName,
      dob: patient.dob,
      mrn: patient.mrn,
      gender: patient.gender,
      phone: patient.phone || null,
      allergies: patient.allergies,
      ...(activeClinicId ? { clinic_id: activeClinicId } : {}),
    }).select().single();

    if (error) {
      console.error('Failed to add patient:', error);
      return;
    }

    const newPatient: Patient = {
      id: data.id,
      firstName: data.first_name,
      lastName: data.last_name,
      dob: data.dob,
      mrn: data.mrn,
      gender: data.gender as 'male' | 'female',
      phone: data.phone || undefined,
      allergies: data.allergies || [],
      medications: [],
      notes: [],
      createdAt: data.created_at,
      status: (data as any).status === 'inactive' ? 'inactive' : 'active',
    };

    set((s) => ({ patients: [newPatient, ...s.patients] }));
  },

  updatePatient: async (id, updates) => {
    const dbUpdates: any = {};
    if (updates.firstName !== undefined) dbUpdates.first_name = updates.firstName;
    if (updates.lastName !== undefined) dbUpdates.last_name = updates.lastName;
    if (updates.dob !== undefined) dbUpdates.dob = updates.dob;
    if (updates.mrn !== undefined) dbUpdates.mrn = updates.mrn;
    if (updates.gender !== undefined) dbUpdates.gender = updates.gender;
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
    if (updates.allergies !== undefined) dbUpdates.allergies = updates.allergies;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.provider !== undefined) dbUpdates.provider = updates.provider;
    if (updates.location !== undefined) dbUpdates.location = updates.location;
    if (updates.insurance !== undefined) dbUpdates.insurance = updates.insurance;
    if (updates.zipCode !== undefined) dbUpdates.zip_code = updates.zipCode;
    if (updates.dischargeDate !== undefined) dbUpdates.discharge_date = updates.dischargeDate || null;

    if (Object.keys(dbUpdates).length > 0) {
      const { error } = await supabase.from('patients').update(dbUpdates).eq('id', id);
      if (error) {
        console.error('Failed to update patient:', error);
        return false;
      }
    }

    set((s) => ({
      patients: s.patients.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
    return true;
  },

  selectPatient: (id) => set({ selectedPatientId: id }),

  addNote: async (patientId, note) => {
    const { data, error } = await supabase.from('clinical_notes').insert({
      patient_id: patientId,
      date: note.date,
      type: note.type,
      subjective: note.subjective,
      objective: note.objective,
      assessment: note.assessment,
      plan: note.plan,
      author: note.author,
      dictated: note.dictated,
    }).select().single();

    if (error) {
      console.error('Failed to add note:', error);
      return;
    }

    const savedNote: ClinicalNote = {
      id: data.id,
      date: data.date,
      type: data.type as 'soap' | 'progress' | 'procedure',
      subjective: data.subjective,
      objective: data.objective,
      assessment: data.assessment,
      plan: data.plan,
      author: data.author,
      dictated: data.dictated,
    };

    set((s) => ({
      patients: s.patients.map((p) =>
        p.id === patientId ? { ...p, notes: [savedNote, ...p.notes] } : p
      ),
    }));
  },

  deleteNote: async (patientId, noteId) => {
    const { error } = await supabase.from('clinical_notes').delete().eq('id', noteId);
    if (error) {
      console.error('Failed to delete note:', error);
      return;
    }
    set((s) => ({
      patients: s.patients.map((p) =>
        p.id === patientId ? { ...p, notes: p.notes.filter((n) => n.id !== noteId) } : p
      ),
    }));
  },

  updateNote: async (patientId, noteId, updates) => {
    const dbUpdates: any = {};
    if (updates.subjective !== undefined) dbUpdates.subjective = updates.subjective;
    if (updates.objective !== undefined) dbUpdates.objective = updates.objective;
    if (updates.assessment !== undefined) dbUpdates.assessment = updates.assessment;
    if (updates.plan !== undefined) dbUpdates.plan = updates.plan;
    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.author !== undefined) dbUpdates.author = updates.author;
    if (updates.dictated !== undefined) dbUpdates.dictated = updates.dictated;

    if (Object.keys(dbUpdates).length > 0) {
      const { error } = await supabase.from('clinical_notes').update(dbUpdates).eq('id', noteId);
      if (error) {
        console.error('Failed to update note:', error);
        throw error;
      }
    }
    set((s) => ({
      patients: s.patients.map((p) =>
        p.id === patientId
          ? { ...p, notes: p.notes.map((n) => (n.id === noteId ? { ...n, ...updates } : n)) }
          : p
      ),
    }));
  },

  addMedication: async (patientId, med) => {
    const { data, error } = await supabase.from('medications').insert({
      patient_id: patientId,
      name: med.name,
      dosage: med.dosage,
      frequency: med.frequency,
      route: med.route,
      prescribed_date: med.prescribedDate,
      active: med.active,
    }).select().single();

    if (error) {
      console.error('Failed to add medication:', error);
      return;
    }

    const savedMed: Medication = {
      id: data.id,
      name: data.name,
      dosage: data.dosage,
      frequency: data.frequency,
      route: data.route,
      prescribedDate: data.prescribed_date,
      active: data.active,
    };

    set((s) => ({
      patients: s.patients.map((p) =>
        p.id === patientId ? { ...p, medications: [...p.medications, savedMed] } : p
      ),
    }));
  },

  updateMedication: async (patientId, medId, updates) => {
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.dosage !== undefined) dbUpdates.dosage = updates.dosage;
    if (updates.frequency !== undefined) dbUpdates.frequency = updates.frequency;
    if (updates.route !== undefined) dbUpdates.route = updates.route;
    if (updates.prescribedDate !== undefined) dbUpdates.prescribed_date = updates.prescribedDate;
    if (updates.active !== undefined) dbUpdates.active = updates.active;

    const { error } = await supabase.from('medications').update(dbUpdates).eq('id', medId);
    if (error) {
      console.error('Failed to update medication:', error);
      return;
    }

    set((s) => ({
      patients: s.patients.map((p) =>
        p.id === patientId
          ? { ...p, medications: p.medications.map((m) => (m.id === medId ? { ...m, ...updates } : m)) }
          : p
      ),
    }));
  },

  addTemplate: async (template) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase.from('note_templates').insert({
      user_id: user.id,
      name: template.name,
      type: template.type,
      subjective_prompt: template.subjectivePrompt,
      objective_prompt: template.objectivePrompt,
      assessment_prompt: template.assessmentPrompt,
      plan_prompt: template.planPrompt,
    }).select().single();

    if (error) {
      console.error('Failed to add template:', error);
      return;
    }

    const savedTemplate: NoteTemplate = {
      id: data.id,
      name: data.name,
      type: data.type as 'soap' | 'progress' | 'procedure',
      subjectivePrompt: data.subjective_prompt,
      objectivePrompt: data.objective_prompt,
      assessmentPrompt: data.assessment_prompt,
      planPrompt: data.plan_prompt,
    };

    set((s) => ({ templates: [...s.templates, savedTemplate] }));
  },

  updateTemplate: async (id, updates) => {
    const isDefault = defaultTemplates.some(t => t.id === id);
    if (isDefault) {
      // Built-in defaults aren't rows in note_templates — persist edits as a
      // per-user override in user_settings (cloud, follows the user across
      // devices), with localStorage as a same-device fallback/cache.
      let overrides: Record<string, Partial<NoteTemplate>> = {};
      try {
        overrides = JSON.parse(localStorage.getItem('chart_scribe_default_template_overrides') || '{}');
      } catch {}
      overrides[id] = { ...(overrides[id] || {}), ...updates };
      try {
        localStorage.setItem('chart_scribe_default_template_overrides', JSON.stringify(overrides));
      } catch (e) {
        console.error('Failed to persist default template override locally:', e);
      }
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { error } = await supabase.from('user_settings').upsert(
            { user_id: user.id, template_overrides: overrides } as any,
            { onConflict: 'user_id' },
          );
          if (error) console.warn('Cloud template override sync failed (run latest DB migration to enable):', error.message);
        }
      } catch (e) {
        console.warn('Cloud template override sync failed:', e);
      }
      set((s) => ({
        templates: s.templates.map(t => t.id === id ? { ...t, ...updates } : t),
      }));
      return;
    }

    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.type !== undefined) dbUpdates.type = updates.type;
    if (updates.subjectivePrompt !== undefined) dbUpdates.subjective_prompt = updates.subjectivePrompt;
    if (updates.objectivePrompt !== undefined) dbUpdates.objective_prompt = updates.objectivePrompt;
    if (updates.assessmentPrompt !== undefined) dbUpdates.assessment_prompt = updates.assessmentPrompt;
    if (updates.planPrompt !== undefined) dbUpdates.plan_prompt = updates.planPrompt;

    const { error } = await supabase.from('note_templates').update(dbUpdates).eq('id', id);
    if (error) {
      console.error('Failed to update template:', error);
      return;
    }
    set((s) => ({
      templates: s.templates.map(t => t.id === id ? { ...t, ...updates } : t),
    }));
  },

  deleteTemplate: async (id) => {
    const { error } = await supabase.from('note_templates').delete().eq('id', id);
    if (error) {
      console.error('Failed to delete template:', error);
      return;
    }
    set((s) => ({ templates: s.templates.filter(t => t.id !== id) }));
  },

  getSelectedPatient: () => {
    const state = get();
    return state.patients.find((p) => p.id === state.selectedPatientId);
  },
}));
