// Port of supabase/functions/generate-avs — prompt preserved verbatim.
// Uses ctx.aiText (plain chat completion, no tool).
//
// DB portions NOT ported (pending Data API):
//  - Fallback fetch of the latest clinical_notes row when no note text is
//    passed in the request → stubbed with a 501 below.
//  - Best-effort persistence of the generated summary into patient_avs
//    (original swallowed failures) → skipped; see TODO below.

const LANG_NAMES = {
  en: "English", es: "Spanish", zh: "Mandarin Chinese", vi: "Vietnamese", tl: "Tagalog", ru: "Russian",
};

export default async function handler(body, ctx) {
  const { patientId, noteId, clinicId, language = "en", note = {} } = body;
  const langName = LANG_NAMES[language] || "English";

  const text = [note.subjective, note.objective, note.assessment, note.plan].filter(Boolean).join("\n\n").trim();

  if (!text && patientId) {
    // Original fell back to the latest clinical note for the patient (or noteId).
    return ctx.json(501, { error: "generate-avs: DB portion pending port" });
  }
  if (!text) {
    return ctx.json(400, { error: "No clinical note found for this patient. Create a SOAP note first." });
  }

  const systemPrompt = `You write patient-friendly After-Visit Summaries (AVS).
- Write in ${langName} at a 6th-grade reading level.
- Use short sentences and simple words. Avoid medical jargon; when a term is needed, explain it in plain words.
- Structure with these sections: "Why you came in today", "What we found", "Your medicines", "What to do at home", "When to call us or go to the ER", "Your next steps".
- Be specific (dose, frequency, days) when the note states it. Never invent doses or instructions.
- Use bullet points where helpful.
- Add a short closing line of encouragement.
- Output plain text or simple markdown — no HTML.`;

  const content = await ctx.aiText({
    system: systemPrompt,
    user: `Visit note:\n\n${text}`,
    model: "smart",
  });
  const summary = (content || "").trim();

  // TODO(Data API): original inserted a patient_avs row here
  // ({ patient_id: patientId, clinic_id: clinicId || null, note_id: noteId || null,
  //    language, summary_md: summary, created_by: userId }) — best-effort.
  void noteId; void clinicId;

  return ctx.json(200, { summary });
}
