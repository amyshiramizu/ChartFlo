import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_MODEL = "google/gemini-2.5-flash";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;

    const { subjective = "", objective = "", assessment = "", plan = "", patientFirstName = "", extraInstructions = "" } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit reached. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in workspace settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `AI gateway ${response.status}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || "";

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("summarize-for-family error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
