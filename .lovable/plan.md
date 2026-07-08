# Implementation Plan — 8 Features

Grouping by shared infrastructure so we ship in coherent phases. Each phase is independently usable.

---

## Phase 1 — AI Scribe Upgrades (#15, #16, #18, #19)

**#18 Prior-visit context injection**
- New helper `src/lib/priorVisitContext.ts`: pulls the last 2 SOAP notes, active problems, current meds, and last care plan for a patient.
- Wire into `structure-soap`, `suggest-icd`, `suggest-cpt`, and ambient transcription edge functions as additional context.

**#15 Speaker diarization (ambient)**
- Update `supabase/functions/transcribe-audio/index.ts` to request word-level diarization from Gemini 2.5 Pro (or fall back to a second pass that labels speakers from transcript heuristics: provider vs patient vs caregiver).
- Update `AmbientDictation.tsx` to render speaker-tagged segments and let the user re-assign a speaker.

**#16 Auto-ICD-10 + HCC capture with specificity coaching**
- Extend `suggest-icd` to also return: HCC category, RAF weight, specificity score (0-100), and concrete coaching ("Type 2 DM → add neuropathy/CKD stage for higher specificity").
- Add `src/lib/hccCatalog.ts` with CMS-HCC v28 mappings for the top ~200 codes used in primary care.
- New `ICDCoachingCard` shown next to the diagnosis list on the chart page.

**#19 Patient after-visit summary (6th-grade, multilingual)**
- New edge function `generate-avs` → takes the SOAP note + meds + plan, returns plain-language summary.
- Language selector (English/Spanish default; extensible).
- Print/share button on the chart page; saved to `patient_avs` table.

---

## Phase 2 — Billing Optimization (#1, #2, #3)

**Shared foundation — `src/lib/billingEngine.ts`**
- Pure function `computeMonthlyBillable(patientId, month)` → returns:
  - Minutes accrued per program (CCM/PCM/RPM/BHI)
  - Unlocked codes + units this month
  - Minutes-to-next-threshold per code family
  - Projected revenue using `medicare2026Codes`
- Reused by all 3 features.

**#1 Real-time CPT eligibility meter**
- New component `BillingMeterCard.tsx` on `CCMPatientChartPage` and patient chart.
- Live progress bars per program with unlocked code chips and "X more min → +$Y" hints.
- Subscribes to `ccm_time_entries` realtime so it updates as minutes are logged.

**#3 APCM vs CCM optimizer**
- New `src/lib/apcmOptimizer.ts`: for each enrolled patient, compute projected APCM (G0556/7/8) revenue vs current CCM/PCM stack, and recommend the higher path.
- Surfaced as a callout inside `BillingMeterCard` and as a column in the monthly batch view.

**#2 End-of-month auto-billing batch**
- New page `/billing` (`src/pages/BillingPage.tsx`) with month picker.
- New edge function `compute-monthly-superbill` → runs `billingEngine` for every patient in the clinic, returns rows.
- Table: Patient | Program | Codes | Units | Modifiers | Est $ | Notes/Time-log evidence | APCM recommendation.
- "Export CSV" + "Export 837P-ready JSON" actions. Persist results into a new `monthly_superbills` table for audit.
- Sidebar nav entry under the existing billing section.

---

## Phase 3 — Quality Dashboard (#11)

**#11 MIPS/HEDIS quality measures**
- New `src/lib/qualityMeasures.ts` with definitions for ~10 high-yield measures:
  - A1c control (<8), BP control (<140/90), depression screening (PHQ-9), tobacco screening/cessation, fall risk, AWV completion, colorectal/breast cancer screening, statin in ASCVD, ACE/ARB in CHF.
- Each measure: `numerator()`, `denominator()` over the patient's data (problems, vitals, meds, screenings, AWV codes billed).
- New page `/quality` (`src/pages/QualityPage.tsx`):
  - Clinic-wide compliance % per measure with trend.
  - Drilldown list of non-compliant patients with one-click "address gap" → opens chart.

---

## Data model additions

```sql
-- Phase 1
patient_avs(id, patient_id, clinic_id, language, summary_md, created_at)

-- Phase 2
monthly_superbills(id, clinic_id, patient_id, month, codes_jsonb,
                   projected_revenue_cents, apcm_recommended boolean,
                   evidence_jsonb, created_at, finalized_at)

-- Phase 3 — reuse existing patient_assessments / vitals / problems; no new tables
```
All with proper RLS, GRANTs, and clinic_id scoping per project memory.

---

## Suggested merge order
1. Phase 1 (scribe) — improves quality of every downstream feature.
2. Phase 2 (billing) — biggest immediate ROI.
3. Phase 3 (quality) — depends on screening/vital data already captured.

**Approve to proceed, or tell me which phase to start with / drop.**
