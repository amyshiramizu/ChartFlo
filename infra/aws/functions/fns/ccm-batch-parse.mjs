// Port of supabase/functions/ccm-batch-parse — prompt preserved verbatim.
// Uses ctx.aiText (the original used a plain chat completion with
// response_format json_object, not tools). Bedrock has no JSON mode, so the
// parse fallback below also tries to pull a JSON object out of code fences /
// surrounding prose before falling back to the original behavior of
// returning an empty patient list.

const SYSTEM_PROMPT = `You are a clinical documentation assistant.
You receive a free-form list of patients with brief notes (one patient per block, separated by blank lines, dashes, numbers, or names).
For EACH patient, produce a structured SOAP note suitable for pasting into Practice Fusion AND classify what kind of chart entry it is.

Return STRICT JSON of shape:
{
  "patients": [
    {
      "patientName": "First Last",
      "mrn": "optional",
      "chartType": "ccm_visit | encounter | med_list | tcm | rpm_review",
      "subjective": "patient-reported info / HPI / chief complaint",
      "objective": "vitals, exam findings, lab/imaging results from the note",
      "assessment": "diagnoses / clinical impressions",
      "plan": "medications, orders, follow-up, patient education"
    }
  ]
}

chartType rules:
- "ccm_visit" — monthly CCM check-in, care coordination, chronic disease management call.
- "encounter" — in-person/telehealth office visit, new problem, acute complaint.
- "med_list" — only medication reconciliation, refills, dose changes, no other clinical work.
- "tcm" — transitional care after discharge from hospital/SNF.
- "rpm_review" — remote patient monitoring data review (BP, glucose, weight).
Default to "ccm_visit" if uncertain.

Rules:
- Expand shorthand into complete clinical sentences.
- Never invent vitals, labs, or diagnoses that are not in the source note. If a section has no source info, write "No new findings reported." (objective) or "Continue current plan." (plan).
- Keep each section concise (1-4 short sentences).
- Preserve the patient's original order.
- Output ONLY the JSON object, no prose.`;

export default async function handler(body, ctx) {
  const { rawText, instructions } = body;
  if (!rawText || typeof rawText !== "string") {
    return ctx.json(400, { error: "rawText is required" });
  }

  const userMsg = `${instructions ? `Additional instructions from provider: ${instructions}\n\n` : ""}Patient list / notes:\n${rawText}`;

  const content = (await ctx.aiText({
    system: SYSTEM_PROMPT,
    user: userMsg,
    model: "smart",
    maxTokens: 8192,
  })) ?? "{}";

  let parsed = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = { patients: [] };
      }
    } else {
      parsed = { patients: [] };
    }
  }

  return ctx.json(200, { patients: Array.isArray(parsed.patients) ? parsed.patients : [] });
}
