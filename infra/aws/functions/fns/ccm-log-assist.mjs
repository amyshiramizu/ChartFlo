// Port of supabase/functions/ccm-log-assist — prompt preserved verbatim.
// Uses ctx.aiText (the original used a plain chat completion with
// response_format json_object, not tools). Bedrock has no JSON mode, so the
// parse fallback below also tries to pull a JSON object out of code fences /
// surrounding prose before falling back to the original behavior of
// treating the whole content as the note.

const SYSTEM_PROMPT = `You are a clinical documentation assistant helping a provider log Medicare CCM/RPM time.
You will be given the EHR/portal site the time was spent on, the number of minutes captured, optional patient name, and optional user notes.
Return STRICT JSON with this shape:
{
  "activities": ["..."],   // 1-4 short Medicare CCM-aligned activity labels (Chart Review, Care Plan Update, Medication Management, Care Coordination, Patient/Caregiver Communication, Lab/Diagnostic Review, Referral Management, Prior Authorization, Documentation)
  "note": "..."            // 1-3 sentence clinical note suitable for the time-entry description
}
Do not include any text outside the JSON.`;

export default async function handler(body, ctx) {
  const { site, minutes, patientName, recentLog, userNote } = body;

  const userMsg = `Site: ${site || "Unknown"}
Minutes captured: ${minutes ?? "?"}
Patient: ${patientName || "Unspecified"}
User note: ${userNote || "(none)"}
Recent activity log: ${recentLog ? JSON.stringify(recentLog).slice(0, 800) : "(none)"}`;

  const content = (await ctx.aiText({
    system: SYSTEM_PROMPT,
    user: userMsg,
    model: "fast",
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
        parsed = { note: content };
      }
    } else {
      parsed = { note: content };
    }
  }

  return ctx.json(200, {
    activities: parsed.activities ?? [],
    note: parsed.note ?? "",
  });
}
