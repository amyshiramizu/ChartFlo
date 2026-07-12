// Port of supabase/functions/group-plan-by-dx — prompt preserved verbatim.
// Uses ctx.aiText (plain chat completion, no tool).

const SYSTEM_PROMPT = `You are a clinical documentation assistant. Reorganize the visit Plan so it is broken out by each recommended ICD-10 diagnosis.

Rules:
- For each diagnosis below, list ONLY the plan items that pertain to that diagnosis.
- Use this exact format per diagnosis:
  CODE — Description
    - plan item 1
    - plan item 2
- If a plan item applies to multiple diagnoses, place it under the most relevant one (do not duplicate).
- Put any remaining items that don't fit a specific diagnosis under a final "General" heading.
- Do not invent new plan items. Only reorganize what's already in the Plan (you may lightly clean wording).
- Output plain text only, no markdown headings (#).`;

export default async function handler(body, ctx) {
  const { plan = "", assessment = "", codes = [] } = body;
  if (!plan.trim() || !Array.isArray(codes) || codes.length === 0) {
    return ctx.json(200, { plan });
  }

  const codeList = codes
    .map((c) => `- ${c.code} — ${c.description}`)
    .join("\n");

  const userPrompt = `Recommended diagnoses:\n${codeList}\n\nAssessment:\n${assessment}\n\nPlan to reorganize:\n${plan}`;

  let content;
  try {
    content = await ctx.aiText({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      model: "fast",
    });
  } catch (e) {
    // Original degraded gracefully on AI-gateway errors: 200 with the plan untouched.
    console.error("AI gateway error:", e);
    return ctx.json(200, { plan, error: e && e.message ? e.message : "AI error" });
  }

  const grouped = (content || "").trim() || plan;

  return ctx.json(200, { plan: grouped });
}
