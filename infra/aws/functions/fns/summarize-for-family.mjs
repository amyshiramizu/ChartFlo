// Port of supabase/functions/summarize-for-family — prompt preserved verbatim.
// Uses ctx.aiText (plain chat completion, no tool).

export default async function handler(body, ctx) {
  const { subjective = "", objective = "", assessment = "", plan = "", patientFirstName = "", extraInstructions = "" } = body;

  const systemPrompt = `You write short, warm visit summaries that families can read by text message.

Rules:
- Write at about a 3rd grade reading level: short sentences, simple words, no medical jargon. If a medical word is needed, put a simple meaning in parentheses.
- Be warm and respectful. Never talk down to the family. Do not say things like "in simple words" or "easy to understand". Just write it that way.
- Do not use baby talk, emojis, or exclamation marks beyond one friendly closing.
- Keep it under about 160 words so it works as a text message.
- Use this structure with these exact labels on their own lines:
  Hi ${patientFirstName ? patientFirstName + "'s family," : "from the care team,"}
  What we did today:
  How they are doing:
  What to watch for:
  Next steps:
  Call us if:
- End with one short friendly closing line. Do not include a signature, provider name, or phone number (the app adds those).
- Use only information from the note. Do not invent results, doses, or plans.
- Output plain text only. No markdown, no headings with #.`;

  const userPrompt = `Visit note:
Subjective: ${subjective}
Objective: ${objective}
Assessment: ${assessment}
Plan: ${plan}

${extraInstructions ? `Extra instructions from the clinician: ${extraInstructions}` : ""}`;

  const content = await ctx.aiText({
    system: systemPrompt,
    user: userPrompt,
    model: "smart",
  });
  const summary = (content || "").trim();

  return ctx.json(200, { summary });
}
