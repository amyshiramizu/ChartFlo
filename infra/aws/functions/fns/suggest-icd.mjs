// Port of supabase/functions/suggest-icd — prompt preserved verbatim.
// NOTE: the original also inserted a best-effort audit row per program decision
// into eligibility_decision_logs via the Supabase service client (failures were
// swallowed and never affected the response). That DB portion is NOT ported —
// pending the Data API wiring.

const SYSTEM_PROMPT = `You are a medical coding and CMS care-management assistant. Given the contents of a clinical encounter note (SOAP), do TWO things:

1) Suggest the most specific and clinically accurate ICD-10-CM diagnosis codes that describe what is going on with the patient at THIS visit.
   - Prefer the most specific code available (avoid unspecified codes when laterality, acuity, type, or stage is documented).
   - Only suggest codes supported by the note content. Do not fabricate diagnoses.
   - Return 1-8 codes, ordered by clinical relevance (primary diagnosis first).
   - For each code give: the ICD-10-CM code, a short description, a confidence (high/medium/low), and a one-line rationale citing the specific phrase or finding from the note that supports it.
   - ALSO assign: CMS-HCC v28 category number (if any), approximate RAF weight (0 if unmapped), a specificity_score 0-100 (penalize unspecified codes), and specificity_coaching text suggesting how the provider could document more specifically to capture a higher RAF (or empty string if already maximally specific).

2) Evaluate eligibility for CMS care-management programs based ONLY on what is documented in this note. Follow current CMS guidelines (CY 2024/2025 Physician Fee Schedule, MLN 909188 for CCM and MLN 909195 for RPM):

   CCM — Chronic Care Management (CPT 99490, 99439 add-on; 99491, 99437 add-on; complex CCM 99487/99489; G0511 for RHC/FQHC). Eligibility requires ALL of:
     a) TWO OR MORE chronic conditions documented in the note or problem list,
     b) each expected to last AT LEAST 12 months OR until the death of the patient,
     c) that together place the patient at significant risk of death, acute exacerbation/decompensation, or functional decline.
     Also note (do not auto-assume from the note alone): patient consent (verbal or written) and an established/comprehensive electronic care plan are required before billing, and CCM cannot be billed in the same month as TCM, HHC supervision (G0181/G0182), ESRD (90951-90970), or another practitioner's CCM/PCM/BHI for that beneficiary.

   RPM — Remote Physiologic Monitoring (CPT 99453 setup/education one-time per episode; 99454 device supply requiring ≥16 days of readings in 30 days; 99457 first 20 min interactive communication/month; 99458 each additional 20 min). Eligibility requires:
     a) an acute OR chronic condition documented in the note where physiologic data (BP, weight, blood glucose, SpO2, HR, respiratory rate, etc.) collected by an FDA-defined medical device that automatically/electronically transmits the data would meaningfully inform management,
     b) the patient is an established patient of the ordering practitioner (the COVID-19 PHE waiver allowing new patients has ended),
     c) the order is placed by a physician or qualified health professional eligible to bill E/M services,
     d) patient consent is obtained (may be at initiation of services).
     Common qualifying conditions in this app's population: HTN, HF, DM, COPD/asthma, CKD, post-discharge transitions, obesity with comorbidity.

For EACH program (always return one entry for CCM and one for RPM, even when not eligible) return:
   - eligible (true/false) — true only when the documentation in this note meets the criteria above,
   - confidence (high/medium/low),
   - rationale (≤1 sentence) — must cite the specific evidence from the note (chronic condition names, the ≥12-month criterion, risk language, devices/vitals discussed, established-patient context) AND name any CMS criterion that is NOT yet documented (e.g. "consent not documented", "second chronic condition not documented", "device order not documented"). Mirror the evidence-citing style used for the ICD code rationales.
   - qualifying_codes — ICD-10-CM codes drawn from the note/problem list that support eligibility,
   - care_plan_focus (1-2 sentences) — CMS-aligned care plan elements (problem list, measurable goals, interventions/medications, monitoring cadence and parameters, coordination/community resources, who is responsible).`;

export default async function handler(body, ctx) {
  const { subjective = "", objective = "", assessment = "", plan = "", patient_id = null } = body;
  const visitText = [subjective, objective, assessment, plan].filter(Boolean).join("\n\n");

  if (!visitText.trim()) {
    return ctx.json(400, { error: "No visit content provided" });
  }

  const result = await ctx.aiTool({
    system: SYSTEM_PROMPT,
    user: `Visit note:\n\n${visitText}`,
    toolName: "suggest_icd_codes",
    schema: {
      type: "object",
      properties: {
        codes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string", description: "ICD-10-CM code, e.g. E11.9" },
              description: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              rationale: { type: "string" },
              hcc_category: { type: "string", description: "CMS-HCC v28 category number if applicable, else empty string" },
              raf_weight: { type: "number", description: "Approximate RAF weight, or 0 if no HCC mapping" },
              specificity_score: { type: "number", description: "0-100; lower means code is too vague (e.g. unspecified)" },
              specificity_coaching: { type: "string", description: "Concrete suggestion to improve specificity, e.g. 'add CKD stage' or 'specify systolic vs diastolic HF'. Empty string if already specific." },
            },
            required: ["code", "description", "confidence", "rationale"],
            additionalProperties: false,
          },
        },
        programs: {
          type: "array",
          description: "CMS care-management program eligibility (one entry for CCM, one for RPM)",
          items: {
            type: "object",
            properties: {
              program: { type: "string", enum: ["CCM", "RPM"] },
              eligible: { type: "boolean" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              rationale: { type: "string", description: "CMS-grounded rationale (≤1 sentence)" },
              qualifying_codes: {
                type: "array",
                items: { type: "string", description: "ICD-10-CM code from the note that supports eligibility" },
              },
              cpt_hcpcs_rules: {
                type: "array",
                description: "CPT/HCPCS codes and CMS rule citations used to justify this decision (e.g. '99490 — CCM ≥20 min/month', 'MLN 909195 — RPM ≥16 days')",
                items: { type: "string" },
              },
              note_excerpts: {
                type: "array",
                description: "Verbatim short excerpts (≤180 chars) from the SOAP note that were used as evidence for this decision",
                items: { type: "string" },
              },
              care_plan_focus: { type: "string", description: "Brief CMS-aligned care-plan focus (problems, goals, interventions, monitoring)" },
            },
            required: ["program", "eligible", "confidence", "rationale", "qualifying_codes", "cpt_hcpcs_rules", "note_excerpts", "care_plan_focus"],
            additionalProperties: false,
          },
        },
      },
      required: ["codes", "programs"],
      additionalProperties: false,
    },
    model: "fast",
  });

  // TODO(Data API): original inserted one eligibility_decision_logs row per
  // entry in result.programs (user_id, patient_id, program, eligible,
  // confidence, rationale, qualifying_icd_codes, cpt_hcpcs_rules,
  // note_excerpts, care_plan_focus, ai_model, raw_response).
  void patient_id;

  return ctx.json(200, result);
}
