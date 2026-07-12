// Port of supabase/functions/extract-clinical-data — prompt preserved verbatim.
// (The original's local `ctx` context-lines variable is renamed to
// `contextLines` here to avoid shadowing the injected helpers `ctx`.)

export default async function handler(body, ctx) {
  const {
    noteText = "",
    existingProblems = [],
    existingMedications = [],
    existingAllergies = [],
  } = body;

  if (!noteText.trim()) {
    return ctx.json(200, { problems: [], medications: [], allergies: [], vitals: null, assessments: [] });
  }

  const contextLines = [
    existingProblems.length
      ? `Existing problems (do NOT re-add): ${existingProblems.map((p) => `${p.icd_code} ${p.description}`).join("; ")}`
      : "",
    existingMedications.length
      ? `Existing active meds (do NOT re-add unless dose/frequency changed): ${existingMedications.map((m) => `${m.name} ${m.dosage || ""} ${m.frequency || ""}`).join("; ")}`
      : "",
    existingAllergies.length
      ? `Known allergies (do NOT re-add): ${existingAllergies.join(", ")}`
      : "",
  ].filter(Boolean).join("\n");

  const systemPrompt = `You are a clinical data extractor. Given a SOAP note (any sections), pull structured clinical data that should populate the patient chart.

EXTRACT:
- problems: active diagnoses/problems from Assessment. Include ICD-10 code if stated or strongly implied; description plain text.
- medications: meds being prescribed, started, changed, refilled, or stopped in this encounter. Skip mentions in past history only.
- allergies: drug/food/environmental allergies the patient is documented to have (NOT denials like "NKDA").
- vitals: BP, HR, RR, temp, SpO2, weight, height, A1c — ONLY if explicitly stated in the note.
- assessments: preventive screenings, health risk assessments, or care assessments mentioned as ordered, due, or completed (e.g., "Annual Wellness Visit", "Depression PHQ-9", "Mammogram", "Colonoscopy", "A1c", "Fall risk").

RULES:
- Be conservative. When unsure, omit.
- Use generic drug names; dosage MUST include units; frequency in plain language (no QD/QOD).
- Vitals: return only the fields explicitly stated. Leave others null.
- Assessment status: "completed" if done this visit, "pending" if ordered/due, otherwise "pending".
- Do NOT duplicate items already present in the context below.

${contextLines}`;

  let result;
  try {
    result = await ctx.aiTool({
      system: systemPrompt,
      user: `SOAP NOTE:\n${noteText}`,
      toolName: "extract_clinical_data",
      schema: {
        type: "object",
        properties: {
          problems: {
            type: "array",
            items: {
              type: "object",
              properties: {
                icd_code: { type: "string" },
                description: { type: "string" },
              },
              required: ["description"],
            },
          },
          medications: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                dosage: { type: "string" },
                frequency: { type: "string" },
                route: { type: "string" },
                action: { type: "string", enum: ["start", "change", "stop", "continue"] },
              },
              required: ["name", "action"],
            },
          },
          allergies: { type: "array", items: { type: "string" } },
          vitals: {
            type: "object",
            properties: {
              blood_pressure: { type: "string" },
              heart_rate: { type: "string" },
              respiratory_rate: { type: "string" },
              o2_saturation: { type: "string" },
              weight: { type: "string" },
              height: { type: "string" },
              a1c: { type: "string" },
            },
          },
          assessments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                assessment_type: { type: "string" },
                status: { type: "string", enum: ["pending", "completed"] },
                cadence: { type: "string" },
                notes: { type: "string" },
              },
              required: ["assessment_type"],
            },
          },
        },
        required: ["problems", "medications", "allergies", "assessments"],
      },
      model: "smart",
    });
  } catch (e) {
    // Original returned the empty shape when the model produced no tool call.
    if (e && e.message === "AI did not return structured output") {
      return ctx.json(200, { problems: [], medications: [], allergies: [], vitals: null, assessments: [] });
    }
    throw e;
  }

  return ctx.json(200, result);
}
