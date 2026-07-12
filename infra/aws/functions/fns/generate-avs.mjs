// Port of supabase/functions/generate-avs — prompt preserved verbatim.
// Uses ctx.aiText (plain chat completion, no tool). DB portions ported to
// ctx.sql:
//  - Fallback fetch of the latest clinical_notes row when only patientId (or
//    noteId) is given. NOTE: the original ordered by created_at, a column the
//    clinical_notes table does not have, and never checked the query error —
//    so in production the patientId-only fallback silently found nothing.
//    The query (and the error-swallowing) is reproduced faithfully.
//  - Best-effort insert into patient_avs (original swallowed failures).

const LANG_NAMES = {
  en: "English", es: "Spanish", zh: "Mandarin Chinese", vi: "Vietnamese", tl: "Tagalog", ru: "Russian",
};

export default async function handler(body, ctx, event) {
  const userId = event?.requestContext?.authorizer?.jwt?.claims?.["custom:legacy_id"] ?? null;
  const { patientId, noteId, clinicId, language = "en", note = {} } = body;
  const langName = LANG_NAMES[language] || "English";

  let text = [note.subjective, note.objective, note.assessment, note.plan].filter(Boolean).join("\n\n").trim();

  // Fallback: pull latest clinical note for the patient (or the specified noteId)
  if (!text && patientId) {
    let rows = [];
    try {
      rows = noteId
        ? await ctx.sql(
            "select subjective, objective, assessment, plan from clinical_notes where id = :noteId::uuid limit 1",
            { noteId })
        : await ctx.sql(
            "select subjective, objective, assessment, plan from clinical_notes where patient_id = :patientId::uuid order by created_at desc limit 1",
            { patientId });
    } catch { /* original ignored the query error */ }
    const n = rows?.[0];
    if (n) text = [n.subjective, n.objective, n.assessment, n.plan].filter(Boolean).join("\n\n").trim();
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

  // Persist (best-effort, like the original)
  try {
    await ctx.sql(
      `insert into patient_avs (patient_id, clinic_id, note_id, language, summary_md, created_by)
       values (:patientId::uuid, :clinicId::uuid, :noteId::uuid, :language, :summary, :createdBy::uuid)`,
      {
        patientId: patientId ?? null,
        clinicId: clinicId || null,
        noteId: noteId || null,
        language,
        summary,
        createdBy: userId,
      },
    );
  } catch (e) { console.error("avs save failed", e); }

  return ctx.json(200, { summary });
}
