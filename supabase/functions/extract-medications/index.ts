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

    const { transcript = "", existingMedications = [] } = await req.json();
    if (!transcript.trim()) {
      return new Response(JSON.stringify({ medications: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const existingBlock = existingMedications.length
      ? `\n\nPATIENT'S EXISTING ACTIVE MEDICATION LIST (do NOT re-add these unless dose/frequency is being CHANGED — in that case mark action="change"):\n${existingMedications
          .map((m: any) => `- ${m.name}${m.dosage ? ` ${m.dosage}` : ''}${m.frequency ? ` ${m.frequency}` : ''}${m.route ? ` ${m.route}` : ''}`)
          .join('\n')}`
      : '';

    const systemPrompt = `You extract medications that the provider is PRESCRIBING, STARTING, CONTINUING WITH CHANGES, or DISCONTINUING during this encounter from an ambient visit transcript.

STRICT RULES:
- Only return a medication if the provider explicitly orders/prescribes/starts/changes/stops it during this visit. Do NOT extract meds that are only mentioned as past history, allergies, or "patient is on X" with no change.
- Distinguish each med's action: "start" (new med), "change" (dose/frequency/route change to an existing med), "stop" (discontinue), "continue" (explicitly re-prescribed/refilled this visit). Default to "start" if a brand-new med is begun.
- Skip vague references like "we'll consider an antibiotic" or "may need a statin in the future".
- Use generic drug names when possible, with brand in parentheses if helpful (e.g., "metoprolol tartrate").
- Dosage MUST include units (e.g., "25 mg", "10 mg/5 mL").
- Frequency MUST be plain language (e.g., "twice daily", "every 8 hours as needed", "at bedtime"). NEVER use Joint Commission "Do Not Use" abbreviations (QD, QOD, etc.).
- Route examples: "oral", "subcutaneous", "topical", "inhaled", "intramuscular", "intravenous", "sublingual", "rectal", "ophthalmic", "otic", "nasal". Default to "oral" only if clearly an oral medication and route was not stated.
- If duration or refills were stated, include them in 'instructions'.
- Be conservative: when unsure, omit the medication rather than guess.${existingBlock}

Return one entry per medication ordered in this encounter.`;

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
              name: "extract_medications",
              description: "Return medications ordered/changed/stopped in this encounter",
              parameters: {
                type: "object",
                properties: {
                  medications: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        dosage: { type: "string" },
                        frequency: { type: "string" },
                        route: { type: "string" },
                        action: { type: "string", enum: ["start", "change", "stop", "continue"] },
                        instructions: { type: "string" },
                      },
                      required: ["name", "action"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["medications"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_medications" } },
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
      return new Response(JSON.stringify({ medications: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-medications error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
