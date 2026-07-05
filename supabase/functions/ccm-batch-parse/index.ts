// Parse a free-text patient list with notes into structured SOAP entries
// for batch documentation into Practice Fusion.
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;

    const { rawText, instructions } = await req.json();
    if (!rawText || typeof rawText !== "string") {
      return new Response(JSON.stringify({ error: "rawText is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const system = `You are a clinical documentation assistant.
You receive a free-form list of patients with brief notes (one patient per block, separated by blank lines, dashes, numbers, or names).
For EACH patient, produce a structured SOAP note suitable for pasting into Practice Fusion AND classify what kind of chart entry it is.

Return STRICT JSON of shape:
{
  "patients": [
    {
      "patientName": "First Last",
      "mrn": "optional",
      "chartType": "ccm_visit | encounter | med_list | tcm | rpm_review",
      "subjective": "patient-reported info / HPI / chief complaint",
      "objective": "vitals, exam findings, lab/imaging results from the note",
      "assessment": "diagnoses / clinical impressions",
      "plan": "medications, orders, follow-up, patient education"
    }
  ]
}

chartType rules:
- "ccm_visit" — monthly CCM check-in, care coordination, chronic disease management call.
- "encounter" — in-person/telehealth office visit, new problem, acute complaint.
- "med_list" — only medication reconciliation, refills, dose changes, no other clinical work.
- "tcm" — transitional care after discharge from hospital/SNF.
- "rpm_review" — remote patient monitoring data review (BP, glucose, weight).
Default to "ccm_visit" if uncertain.

Rules:
- Expand shorthand into complete clinical sentences.
- Never invent vitals, labs, or diagnoses that are not in the source note. If a section has no source info, write "No new findings reported." (objective) or "Continue current plan." (plan).
- Keep each section concise (1-4 short sentences).
- Preserve the patient's original order.
- Output ONLY the JSON object, no prose.`;

    const userMsg = `${instructions ? `Additional instructions from provider: ${instructions}\n\n` : ""}Patient list / notes:\n${rawText}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(JSON.stringify({ error: "AI gateway error", detail: text }), {
        status: resp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { patients?: unknown[] } = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { patients: [] };
    }

    return new Response(
      JSON.stringify({ patients: Array.isArray(parsed.patients) ? parsed.patients : [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
