// Port of supabase/functions/extract-medications — prompt preserved verbatim.

export default async function handler(body, ctx) {
  const { transcript = "", existingMedications = [] } = body;
  if (!transcript.trim()) {
    return ctx.json(200, { medications: [] });
  }

  const existingBlock = existingMedications.length
    ? `\n\nPATIENT'S EXISTING ACTIVE MEDICATION LIST (do NOT re-add these unless dose/frequency is being CHANGED — in that case mark action="change"):\n${existingMedications
        .map((m) => `- ${m.name}${m.dosage ? ` ${m.dosage}` : ''}${m.frequency ? ` ${m.frequency}` : ''}${m.route ? ` ${m.route}` : ''}`)
        .join('\n')}`
    : '';

  const systemPrompt = `You extract medications that the provider is PRESCRIBING, STARTING, CONTINUING WITH CHANGES, or DISCONTINUING during this encounter from an ambient visit transcript.

STRICT RULES:
- Only return a medication if the provider explicitly orders/prescribes/starts/changes/stops it during this visit. Do NOT extract meds that are only mentioned as past history, allergies, or "patient is on X" with no change.
- Distinguish each med's action: "start" (new med), "change" (dose/frequency/route change to an existing med), "stop" (discontinue), "continue" (explicitly re-prescribed/refilled this visit). Default to "start" if a brand-new med is begun.
- Skip vague references like "we'll consider an antibiotic" or "may need a statin in the future".
- Use generic drug names when possible, with brand in parentheses if helpful (e.g., "metoprolol tartrate").
- Dosage MUST include units (e.g., "25 mg", "10 mg/5 mL").
- Frequency MUST be plain language (e.g., "twice daily", "every 8 hours as needed", "at bedtime"). NEVER use Joint Commission "Do Not Use" abbreviations (QD, QOD, etc.).
- Route examples: "oral", "subcutaneous", "topical", "inhaled", "intramuscular", "intravenous", "sublingual", "rectal", "ophthalmic", "otic", "nasal". Default to "oral" only if clearly an oral medication and route was not stated.
- If duration or refills were stated, include them in 'instructions'.
- Be conservative: when unsure, omit the medication rather than guess.${existingBlock}

Return one entry per medication ordered in this encounter.`;

  let result;
  try {
    result = await ctx.aiTool({
      system: systemPrompt,
      user: `Visit transcript:\n${transcript}`,
      toolName: "extract_medications",
      schema: {
        type: "object",
        properties: {
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
                instructions: { type: "string" },
              },
              required: ["name", "action"],
              additionalProperties: false,
            },
          },
        },
        required: ["medications"],
        additionalProperties: false,
      },
      model: "fast",
    });
  } catch (e) {
    // Original returned an empty list when the model produced no tool call.
    if (e && e.message === "AI did not return structured output") {
      return ctx.json(200, { medications: [] });
    }
    throw e;
  }

  return ctx.json(200, result);
}
