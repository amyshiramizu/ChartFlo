import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser, corsHeaders as sharedCors } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;

    const { transcript = "" } = await req.json();
    if (!transcript.trim()) {
      return new Response(JSON.stringify({ screenings: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You extract clinical screening instruments from an ambient visit transcript.
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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Visit transcript:\n${transcript}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_screenings",
              description: "Return completed screenings detected in the transcript",
              parameters: {
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
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_screenings" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits in Settings > Workspace > Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway returned ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ screenings: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-screenings error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
