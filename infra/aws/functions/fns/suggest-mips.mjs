// Port of supabase/functions/suggest-mips — prompt preserved verbatim.

const SYSTEM_PROMPT = `You are a CMS MIPS (Merit-based Incentive Payment System) quality reporting assistant for the 2025 program year.
Given an outpatient encounter note and its diagnoses, recommend MIPS Quality measures that are clinically applicable to THIS visit (denominator-eligible), and identify which are already met or need documentation to be performance-met.

Rules:
- Only suggest measures that are plausibly applicable based on the documentation and diagnoses.
- Use real MIPS Quality measure numbers (e.g. "MIPS #134 — Preventive Care and Screening: Screening for Depression and Follow-Up Plan").
- For each measure: report MIPS measure number, short title, the measure's category (Quality / Promoting Interoperability / Improvement Activities / Cost), whether it is "met", "not_met", or "eligible_not_documented" in this visit, a one-line rationale tied to the note, and a concrete action to close the gap if not met.
- Also include applicable Improvement Activities (IA) when the visit clearly supports one (e.g. care coordination, BH integration).
- Return 1-8 items, ordered: not_met first, then eligible_not_documented, then met.`;

export default async function handler(body, ctx) {
  const {
    subjective = "",
    objective = "",
    assessment = "",
    plan = "",
    diagnoses = [],
    patientStatus = "established",
    visitMinutes = null,
  } = body;

  const visitText = [subjective, objective, assessment, plan].filter(Boolean).join("\n\n");
  const dxText = diagnoses
    .map((d) => `${d.code} — ${d.description}`)
    .join("\n");

  if (!visitText.trim() && !dxText.trim()) {
    return ctx.json(400, { error: "No visit content provided" });
  }

  const result = await ctx.aiTool({
    system: SYSTEM_PROMPT,
    user: `Patient status: ${patientStatus}\nVisit minutes: ${visitMinutes ?? "n/a"}\n\nDiagnoses:\n${dxText || "(none provided)"}\n\nVisit note:\n${visitText}`,
    toolName: "suggest_mips_measures",
    schema: {
      type: "object",
      properties: {
        measures: {
          type: "array",
          items: {
            type: "object",
            properties: {
              measure_id: { type: "string", description: "e.g. MIPS #134 or IA_BE_22" },
              title: { type: "string" },
              category: {
                type: "string",
                enum: ["Quality", "Promoting Interoperability", "Improvement Activities", "Cost"],
              },
              status: {
                type: "string",
                enum: ["met", "not_met", "eligible_not_documented"],
              },
              rationale: { type: "string" },
              action: { type: "string", description: "What to add to the note to satisfy the measure" },
            },
            required: ["measure_id", "title", "category", "status", "rationale", "action"],
            additionalProperties: false,
          },
        },
        documentation_gaps: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["measures"],
      additionalProperties: false,
    },
    model: "fast",
  });

  return ctx.json(200, result);
}
