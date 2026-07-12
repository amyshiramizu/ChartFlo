// Port of supabase/functions/extract-screenings — prompt preserved verbatim.

const SYSTEM_PROMPT = `You extract clinical screening instruments from an ambient visit transcript.
Be conservative. NEVER fabricate scores. Distinguish three states:
  - completed=true  : the instrument was clearly administered AND a numeric total score is explicitly stated (e.g. "PHQ-9 score is 12", "GAD-7 total 8", "Mini-Cog 4 out of 5"). For Fall Risk / Med Rec / Advance Directives / AWV / Care Plan (no numeric score), completed=true ONLY when the transcript clearly states the activity was finished during this visit (e.g. "we reviewed advance directives today", "medication reconciliation complete", "STEADI screen done, low risk, no falls in past year").
  - completed=false, partial=true : some items were asked but the total score is missing, only a subset of questions was answered, or the clinician said they will finish it later. Capture which items were covered in findings.
  - DO NOT return the screening at all if it was only mentioned in passing, deferred to a future visit, or only listed as "due".

Rules:
- A single item answer (e.g. "patient denies feeling down") is NOT a completed PHQ-9.
- "PHQ-2 positive, will do full PHQ-9" → return PHQ-9 with completed=false, partial=true, score="" and note PHQ-2 was positive.
- Only put a number in 'score' if that exact number was spoken in the transcript. Otherwise leave score="".
- 'severity' must be derivable from the stated score; otherwise leave it blank.
- 'findings' should quote or paraphrase what was actually said (1-2 sentences). If partial, state what is still needed.

Recognized instruments (return assessment_type EXACTLY as listed):
- "Depression Screening (PHQ-9)"  → PHQ-2 / PHQ-9. 0-27. 0-4 minimal, 5-9 mild, 10-14 moderate, 15-19 mod-severe, 20-27 severe.
- "Anxiety Screening (GAD-7)"     → GAD-7. 0-21. 0-4 minimal, 5-9 mild, 10-14 moderate, 15-21 severe.
- "Fall Risk Assessment"          → STEADI / Morse / Tinetti / falls-in-past-year question set.
- "Cognitive Screening"           → Mini-Cog, MoCA, MMSE, SLUMS.
- "Alcohol Use Screening (AUDIT-C)" → AUDIT-C / CAGE.
- "Medication Reconciliation"     → explicit med rec performed this visit.
- "Advance Directives Review"     → ACP / DPOA / DNR / advance directives discussed.
- "Annual Wellness Visit"         → full AWV elements completed.
- "Comprehensive Care Plan"       → care plan reviewed/updated with patient this visit.

Return: assessment_type, score ("" if not stated), severity ("" if not derivable), findings, completed (bool), partial (bool, true when started but not finished/scored).`;

export default async function handler(body, ctx) {
  const { transcript = "" } = body;
  if (!transcript.trim()) {
    return ctx.json(200, { screenings: [] });
  }

  let result;
  try {
    result = await ctx.aiTool({
      system: SYSTEM_PROMPT,
      user: `Visit transcript:\n${transcript}`,
      toolName: "extract_screenings",
      schema: {
        type: "object",
        properties: {
          screenings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                assessment_type: { type: "string" },
                score: { type: "string" },
                severity: { type: "string" },
                findings: { type: "string" },
                completed: { type: "boolean" },
                partial: { type: "boolean" },
              },
              required: ["assessment_type", "findings", "completed", "partial"],
              additionalProperties: false,
            },
          },
        },
        required: ["screenings"],
        additionalProperties: false,
      },
      model: "fast",
    });
  } catch (e) {
    // Original returned an empty list when the model produced no tool call.
    if (e && e.message === "AI did not return structured output") {
      return ctx.json(200, { screenings: [] });
    }
    throw e;
  }

  return ctx.json(200, result);
}
