// Port of supabase/functions/generate-ccm-care-plan — prompt preserved verbatim.

export default async function handler(body, ctx) {
  const { patient, problems, medications, allergies, recentNotes, templateContent } = body;

  if (!problems || !Array.isArray(problems) || problems.length === 0) {
    return ctx.json(400, { error: "At least one problem (diagnosis) is required to generate a care plan." });
  }

  const problemList = problems.map((p, i) => `${i + 1}. ${p.icd_code} — ${p.description} (id: ${p.id})`).join("\n");
  const medsList = (medications || []).map((m) => `- ${m.name} ${m.dosage} ${m.frequency}`).join("\n") || "None on file";
  const allergyList = (allergies || []).join(", ") || "NKDA";
  const notesContext = (recentNotes || []).slice(0, 5).map((n) =>
    `[${n.date}]\nS: ${n.subjective || ''}\nO: ${n.objective || ''}\nA: ${n.assessment || ''}\nP: ${n.plan || ''}`
  ).join("\n\n---\n\n");

  const systemPrompt = `You are an expert chronic care management (CCM) clinician generating a CMS-compliant, personalized comprehensive care plan for a Medicare beneficiary.

CMS REQUIREMENTS the plan must satisfy:
- Each chronic condition must have a measurable, time-bound goal AND a specific planned intervention.
- Plan-level elements: expected outcomes & prognosis, symptom management, medication management & reconciliation, preventive care, caregiver/support, advance directives, psychosocial/behavioral health needs, patient education.
- Use evidence-based clinical guidance (ADA, AHA/ACC, GOLD, KDIGO, USPSTF) appropriate to each diagnosis.
- Reference specific patient data (current meds, allergies, vitals, recent SOAP notes) — do NOT generate generic boilerplate.
- Never fabricate data not present. If something is unknown, write "To be assessed at next visit."
- Avoid Joint Commission "Do Not Use" abbreviations.${templateContent ? `\n\nUSE THIS TEMPLATE AS STRUCTURAL GUIDANCE:\n${templateContent}` : ''}`;

  const userPrompt = `PATIENT: ${patient?.firstName || ''} ${patient?.lastName || ''}, DOB ${patient?.dob || 'unknown'}
ALLERGIES: ${allergyList}

ACTIVE PROBLEM LIST:
${problemList}

CURRENT MEDICATIONS:
${medsList}

RECENT CLINICAL NOTES:
${notesContext || 'No recent notes available.'}

Generate a personalized CCM care plan. For each problem, produce a measurable goal and a specific intervention tied to this patient's data. Then produce the plan-level elements.`;

  const plan = await ctx.aiTool({
    system: systemPrompt,
    user: userPrompt,
    toolName: "build_care_plan",
    schema: {
      type: "object",
      properties: {
        problem_plans: {
          type: "array",
          description: "Per-problem goal and intervention.",
          items: {
            type: "object",
            properties: {
              problem_id: { type: "string", description: "Matches the id provided in the problem list." },
              goal: { type: "string", description: "Measurable, time-bound SMART goal." },
              intervention: { type: "string", description: "Specific evidence-based intervention." },
            },
            required: ["problem_id", "goal", "intervention"],
            additionalProperties: false,
          },
        },
        expected_outcomes: { type: "string", description: "Expected outcomes & overall prognosis across all conditions." },
        symptom_plan: { type: "string", description: "Symptom management plan, red flags, when to call/ED." },
        med_mgmt: { type: "string", description: "Medication management & reconciliation, adherence, pharmacy, allergy review." },
        preventive: { type: "string", description: "Preventive services due — vaccines, screenings (age/sex appropriate)." },
        community: { type: "string", description: "Community / social services referrals (SDoH-informed)." },
        care_coordination: { type: "string", description: "Coordination with specialists, hospital follow-up, communication plan." },
        caregivers: { type: "string", description: "Caregiver(s) & support system, contact, role, consent." },
        advance_dir: { type: "string", description: "Advance directives, code status, healthcare proxy." },
        psychosocial: { type: "string", description: "Psychosocial / behavioral health needs (PHQ-9, GAD-7, SDoH)." },
        education: { type: "string", description: "Patient / caregiver education topics and teach-back results." },
      },
      required: [
        "problem_plans", "expected_outcomes", "symptom_plan", "med_mgmt",
        "preventive", "community", "care_coordination", "caregivers",
        "advance_dir", "psychosocial", "education",
      ],
      additionalProperties: false,
    },
    model: "smart",
    maxTokens: 8192,
  });

  return ctx.json(200, plan);
}
