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

    const { plan = "", assessment = "", codes = [] } = await req.json();
    if (!plan.trim() || !Array.isArray(codes) || codes.length === 0) {
      return new Response(JSON.stringify({ plan }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const codeList = codes
      .map((c: any) => `- ${c.code} — ${c.description}`)
      .join("\n");

    const systemPrompt = `You are a clinical documentation assistant. Reorganize the visit Plan so it is broken out by each recommended ICD-10 diagnosis.

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

    const userPrompt = `Recommended diagnoses:\n${codeList}\n\nAssessment:\n${assessment}\n\nPlan to reorganize:\n${plan}`;

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
      return new Response(JSON.stringify({ plan, error: `AI gateway ${response.status}` }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const grouped = data.choices?.[0]?.message?.content?.trim() || plan;

    return new Response(JSON.stringify({ plan: grouped }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("group-plan-by-dx error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
