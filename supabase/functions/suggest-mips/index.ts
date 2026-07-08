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

    const {
      subjective = "",
      objective = "",
      assessment = "",
      plan = "",
      diagnoses = [],
      patientStatus = "established",
      visitMinutes = null,
    } = await req.json();

    const visitText = [subjective, objective, assessment, plan].filter(Boolean).join("\n\n");
    const dxText = (diagnoses as Array<{ code: string; description: string }>)
      .map((d) => `${d.code} — ${d.description}`)
      .join("\n");

    if (!visitText.trim() && !dxText.trim()) {
      return new Response(JSON.stringify({ error: "No visit content provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a CMS MIPS (Merit-based Incentive Payment System) quality reporting assistant for the 2025 program year.
Given an outpatient encounter note and its diagnoses, recommend MIPS Quality measures that are clinically applicable to THIS visit (denominator-eligible), and identify which are already met or need documentation to be performance-met.

Rules:
- Only suggest measures that are plausibly applicable based on the documentation and diagnoses.
- Use real MIPS Quality measure numbers (e.g. "MIPS #134 — Preventive Care and Screening: Screening for Depression and Follow-Up Plan").
- For each measure: report MIPS measure number, short title, the measure's category (Quality / Promoting Interoperability / Improvement Activities / Cost), whether it is "met", "not_met", or "eligible_not_documented" in this visit, a one-line rationale tied to the note, and a concrete action to close the gap if not met.
- Also include applicable Improvement Activities (IA) when the visit clearly supports one (e.g. care coordination, BH integration).
- Return 1-8 items, ordered: not_met first, then eligible_not_documented, then met.`;

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
          {
            role: "user",
            content: `Patient status: ${patientStatus}\nVisit minutes: ${visitMinutes ?? "n/a"}\n\nDiagnoses:\n${dxText || "(none provided)"}\n\nVisit note:\n${visitText}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "suggest_mips_measures",
              description: "Return applicable MIPS measures for this visit",
              parameters: {
                type: "object",
                properties: {
                  measures: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        measure_id: { type: "string", description: "e.g. MIPS #134 or IA_BE_22" },
                        title: { type: "string" },
                        category: {
                          type: "string",
                          enum: ["Quality", "Promoting Interoperability", "Improvement Activities", "Cost"],
                        },
                        status: {
                          type: "string",
                          enum: ["met", "not_met", "eligible_not_documented"],
                        },
                        rationale: { type: "string" },
                        action: { type: "string", description: "What to add to the note to satisfy the measure" },
                      },
                      required: ["measure_id", "title", "category", "status", "rationale", "action"],
                      additionalProperties: false,
                    },
                  },
                  documentation_gaps: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["measures"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "suggest_mips_measures" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds in Settings > Workspace > Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway returned ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("AI did not return structured output");

    const result = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("suggest-mips error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
