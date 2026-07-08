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

    const { patient, problems, medications, allergies, recentNotes, templateContent } = await req.json();

    if (!problems || !Array.isArray(problems) || problems.length === 0) {
      return new Response(
        JSON.stringify({ error: "At least one problem (diagnosis) is required to generate a care plan." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const problemList = problems.map((p: any, i: number) => `${i + 1}. ${p.icd_code} — ${p.description} (id: ${p.id})`).join("\n");
    const medsList = (medications || []).map((m: any) => `- ${m.name} ${m.dosage} ${m.frequency}`).join("\n") || "None on file";
    const allergyList = (allergies || []).join(", ") || "NKDA";
    const notesContext = (recentNotes || []).slice(0, 5).map((n: any) =>
      `[${n.date}]\nS: ${n.subjective || ''}\nO: ${n.objective || ''}\nA: ${n.assessment || ''}\nP: ${n.plan || ''}`
    ).join("\n\n---\n\n");

    const systemPrompt = `You are an expert chronic care management (CCM) clinician generating a CMS-compliant, personalized comprehensive care plan for a Medicare beneficiary.

CMS REQUIREMENTS the plan must satisfy:
- Each chronic condition must have a measurable, time-bound goal AND a specific planned intervention.
- Plan-level elements: expected outcomes & prognosis, symptom management, medication management & reconciliation, preventive care, caregiver/support, advance directives, psychosocial/behavioral health needs, patient education.
- Use evidence-based clinical guidance (ADA, AHA/ACC, GOLD, KDIGO, USPSTF) appropriate to each diagnosis.
- Reference specific patient data (current meds, allergies, vitals, recent SOAP notes) — do NOT generate generic boilerplate.
- Never fabricate data not present. If something is unknown, write "To be assessed at next visit."
- Avoid Joint Commission "Do Not Use" abbreviations.${templateContent ? `\n\nUSE THIS TEMPLATE AS STRUCTURAL GUIDANCE:\n${templateContent}` : ''}`;

    const userPrompt = `PATIENT: ${patient?.firstName || ''} ${patient?.lastName || ''}, DOB ${patient?.dob || 'unknown'}
ALLERGIES: ${allergyList}

ACTIVE PROBLEM LIST:
${problemList}

CURRENT MEDICATIONS:
${medsList}

RECENT CLINICAL NOTES:
${notesContext || 'No recent notes available.'}

Generate a personalized CCM care plan. For each problem, produce a measurable goal and a specific intervention tied to this patient's data. Then produce the plan-level elements.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "build_care_plan",
            description: "Build a CMS-compliant personalized CCM care plan.",
            parameters: {
              type: "object",
              properties: {
                problem_plans: {
                  type: "array",
                  description: "Per-problem goal and intervention.",
                  items: {
                    type: "object",
                    properties: {
                      problem_id: { type: "string", description: "Matches the id provided in the problem list." },
                      goal: { type: "string", description: "Measurable, time-bound SMART goal." },
                      intervention: { type: "string", description: "Specific evidence-based intervention." },
                    },
                    required: ["problem_id", "goal", "intervention"],
                    additionalProperties: false,
                  },
                },
                expected_outcomes: { type: "string", description: "Expected outcomes & overall prognosis across all conditions." },
                symptom_plan: { type: "string", description: "Symptom management plan, red flags, when to call/ED." },
                med_mgmt: { type: "string", description: "Medication management & reconciliation, adherence, pharmacy, allergy review." },
                preventive: { type: "string", description: "Preventive services due — vaccines, screenings (age/sex appropriate)." },
                community: { type: "string", description: "Community / social services referrals (SDoH-informed)." },
                care_coordination: { type: "string", description: "Coordination with specialists, hospital follow-up, communication plan." },
                caregivers: { type: "string", description: "Caregiver(s) & support system, contact, role, consent." },
                advance_dir: { type: "string", description: "Advance directives, code status, healthcare proxy." },
                psychosocial: { type: "string", description: "Psychosocial / behavioral health needs (PHQ-9, GAD-7, SDoH)." },
                education: { type: "string", description: "Patient / caregiver education topics and teach-back results." },
              },
              required: [
                "problem_plans", "expected_outcomes", "symptom_plan", "med_mgmt",
                "preventive", "community", "care_coordination", "caregivers",
                "advance_dir", "psychosocial", "education",
              ],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "build_care_plan" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Add funds in Settings > Workspace > Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway returned ${response.status}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("AI did not return structured output");
    const plan = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(plan), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-ccm-care-plan error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
