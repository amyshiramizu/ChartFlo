import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;

    const {
      noteText = "",
      existingProblems = [],
      existingMedications = [],
      existingAllergies = [],
    } = await req.json();

    if (!noteText.trim()) {
      return new Response(
        JSON.stringify({ problems: [], medications: [], allergies: [], vitals: null, assessments: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const ctx = [
      existingProblems.length
        ? `Existing problems (do NOT re-add): ${existingProblems.map((p: any) => `${p.icd_code} ${p.description}`).join("; ")}`
        : "",
      existingMedications.length
        ? `Existing active meds (do NOT re-add unless dose/frequency changed): ${existingMedications.map((m: any) => `${m.name} ${m.dosage || ""} ${m.frequency || ""}`).join("; ")}`
        : "",
      existingAllergies.length
        ? `Known allergies (do NOT re-add): ${existingAllergies.join(", ")}`
        : "",
    ].filter(Boolean).join("\n");

    const systemPrompt = `You are a clinical data extractor. Given a SOAP note (any sections), pull structured clinical data that should populate the patient chart.

EXTRACT:
- problems: active diagnoses/problems from Assessment. Include ICD-10 code if stated or strongly implied; description plain text.
- medications: meds being prescribed, started, changed, refilled, or stopped in this encounter. Skip mentions in past history only.
- allergies: drug/food/environmental allergies the patient is documented to have (NOT denials like "NKDA").
- vitals: BP, HR, RR, temp, SpO2, weight, height, A1c — ONLY if explicitly stated in the note.
- assessments: preventive screenings, health risk assessments, or care assessments mentioned as ordered, due, or completed (e.g., "Annual Wellness Visit", "Depression PHQ-9", "Mammogram", "Colonoscopy", "A1c", "Fall risk").

RULES:
- Be conservative. When unsure, omit.
- Use generic drug names; dosage MUST include units; frequency in plain language (no QD/QOD).
- Vitals: return only the fields explicitly stated. Leave others null.
- Assessment status: "completed" if done this visit, "pending" if ordered/due, otherwise "pending".
- Do NOT duplicate items already present in the context below.

${ctx}`;

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
          { role: "user", content: `SOAP NOTE:\n${noteText}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_clinical_data",
              description: "Return structured clinical data extracted from the SOAP note",
              parameters: {
                type: "object",
                properties: {
                  problems: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        icd_code: { type: "string" },
                        description: { type: "string" },
                      },
                      required: ["description"],
                    },
                  },
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
                      },
                      required: ["name", "action"],
                    },
                  },
                  allergies: { type: "array", items: { type: "string" } },
                  vitals: {
                    type: "object",
                    properties: {
                      blood_pressure: { type: "string" },
                      heart_rate: { type: "string" },
                      respiratory_rate: { type: "string" },
                      o2_saturation: { type: "string" },
                      weight: { type: "string" },
                      height: { type: "string" },
                      a1c: { type: "string" },
                    },
                  },
                  assessments: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        assessment_type: { type: "string" },
                        status: { type: "string", enum: ["pending", "completed"] },
                        cadence: { type: "string" },
                        notes: { type: "string" },
                      },
                      required: ["assessment_type"],
                    },
                  },
                },
                required: ["problems", "medications", "allergies", "assessments"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_clinical_data" } },
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
      return new Response(
        JSON.stringify({ problems: [], medications: [], allergies: [], vitals: null, assessments: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const result = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-clinical-data error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
