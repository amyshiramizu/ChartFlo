import { requireUser } from "../_shared/auth.ts";
// AI assistant to help summarize CCM/RPM minutes captured on Practice Fusion,
// Updox, or CoverMyMeds into a Medicare-compliant activity note.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;

    const { site, minutes, patientName, recentLog, userNote } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const system = `You are a clinical documentation assistant helping a provider log Medicare CCM/RPM time.
You will be given the EHR/portal site the time was spent on, the number of minutes captured, optional patient name, and optional user notes.
Return STRICT JSON with this shape:
{
  "activities": ["..."],   // 1-4 short Medicare CCM-aligned activity labels (Chart Review, Care Plan Update, Medication Management, Care Coordination, Patient/Caregiver Communication, Lab/Diagnostic Review, Referral Management, Prior Authorization, Documentation)
  "note": "..."            // 1-3 sentence clinical note suitable for the time-entry description
}
Do not include any text outside the JSON.`;

    const userMsg = `Site: ${site || "Unknown"}
Minutes captured: ${minutes ?? "?"}
Patient: ${patientName || "Unspecified"}
User note: ${userNote || "(none)"}
Recent activity log: ${recentLog ? JSON.stringify(recentLog).slice(0, 800) : "(none)"}`;

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
    let parsed: { activities?: string[]; note?: string } = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { note: content };
    }

    return new Response(
      JSON.stringify({
        activities: parsed.activities ?? [],
        note: parsed.note ?? "",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
