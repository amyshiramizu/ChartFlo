import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LANG_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", zh: "Mandarin Chinese", vi: "Vietnamese", tl: "Tagalog", ru: "Russian",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;
    const userId = auth.userId;

    const { patientId, noteId, clinicId, language = "en", note = {} } = await req.json();
    const langName = LANG_NAMES[language] || "English";

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    let text = [note.subjective, note.objective, note.assessment, note.plan].filter(Boolean).join("\n\n").trim();

    // Fallback: pull latest clinical note for the patient (or the specified noteId)
    if (!text && patientId) {
      let q = admin.from("clinical_notes").select("subjective,objective,assessment,plan").limit(1);
      q = noteId ? q.eq("id", noteId) : q.eq("patient_id", patientId).order("created_at", { ascending: false });
      const { data: rows } = await q;
      const n = rows?.[0];
      if (n) text = [n.subjective, n.objective, n.assessment, n.plan].filter(Boolean).join("\n\n").trim();
    }

    if (!text) {
      return new Response(JSON.stringify({ error: "No clinical note found for this patient. Create a SOAP note first." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You write patient-friendly After-Visit Summaries (AVS).
- Write in ${langName} at a 6th-grade reading level.
- Use short sentences and simple words. Avoid medical jargon; when a term is needed, explain it in plain words.
- Structure with these sections: "Why you came in today", "What we found", "Your medicines", "What to do at home", "When to call us or go to the ER", "Your next steps".
- Be specific (dose, frequency, days) when the note states it. Never invent doses or instructions.
- Use bullet points where helpful.
- Add a short closing line of encouragement.
- Output plain text or simple markdown — no HTML.`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Visit note:\n\n${text}` },
        ],
      }),
    });

    if (!resp.ok) {
      if (resp.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (resp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error(`AI gateway ${resp.status}`);
    }

    const data = await resp.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || "";

    // Persist
    try {
      await admin.from("patient_avs").insert({
        patient_id: patientId,
        clinic_id: clinicId || null,
        note_id: noteId || null,
        language,
        summary_md: summary,
        created_by: userId,
      });
    } catch (e) { console.error("avs save failed", e); }


    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-avs error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
