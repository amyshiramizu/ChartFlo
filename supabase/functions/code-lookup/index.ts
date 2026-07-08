import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;

    const { query = "", type = "ALL" } = await req.json();
    if (!String(query).trim()) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a CPT/HCPCS and ICD-10 reference assistant similar to AAPC Codify.
Given a code or keyword, return up to 8 relevant matches.

For each match include:
- code: the exact CPT/HCPCS/ICD-10 code
- type: "CPT", "HCPCS", or "ICD10"
- description: official short descriptor
- category: short clinical category (e.g. "E/M Office", "Cardiovascular", "Preventive")
- rate2026_usd: Medicare 2026 national non-facility allowed amount in USD (CPT/HCPCS only; use the CY2026 PFS final rule; null if not separately payable or for ICD-10)
- hcc: CMS-HCC v28 risk-adjustment category if applicable (ICD-10 only; null otherwise)
- notes: brief documentation cues, common modifiers, NCCI/bundling hints, or coverage caveats
- official_descriptor: full long descriptor when materially different from "description"

Filter by type when the caller restricts to CPT, HCPCS, or ICD10. Be accurate; if unsure say so in "notes" and lower confidence. Do not invent codes. Prefer commonly-billed primary care, internal medicine, and care-management codes.`;

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
          { role: "user", content: `Type filter: ${type}\nQuery: ${query}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_code_matches",
            description: "Return matching CPT/HCPCS/ICD-10 codes",
            parameters: {
              type: "object",
              properties: {
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      code: { type: "string" },
                      type: { type: "string", enum: ["CPT", "HCPCS", "ICD10"] },
                      description: { type: "string" },
                      official_descriptor: { type: "string" },
                      category: { type: "string" },
                      rate2026_usd: { type: ["number", "null"] },
                      hcc: { type: ["string", "null"] },
                      notes: { type: "string" },
                      confidence: { type: "string", enum: ["high", "medium", "low"] },
                    },
                    required: ["code", "type", "description", "confidence"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["results"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_code_matches" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      throw new Error(`AI gateway returned ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("AI did not return structured output");
    const result = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("code-lookup error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
