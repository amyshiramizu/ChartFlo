import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Accepts: { audioBase64: string, mimeType: string, languageHint?: string }
// Returns: { transcript: string }
//
// Primary engine: ElevenLabs Scribe v2 — a medical-grade speech-to-text model
// with diarization and audio-event tagging. Falls back to Lovable AI (Gemini)
// only if ElevenLabs is unavailable or errors out, so accuracy is closer to
// Dragon-class dictation engines.

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function extFromMime(mt: string): string {
  const m = (mt || "").toLowerCase();
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("webm")) return "webm";
  if (m.includes("m4a") || m.includes("mp4") || m.includes("aac")) return "m4a";
  if (m.includes("flac")) return "flac";
  return "mp3";
}

async function transcribeWithElevenLabs(
  bytes: Uint8Array,
  mimeType: string,
  languageHint?: string,
): Promise<string | null> {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) return null;

  const ext = extFromMime(mimeType);
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([bytes], { type: mimeType || "audio/webm" }),
    `chunk.${ext}`,
  );
  fd.append("model_id", "scribe_v2");
  fd.append("tag_audio_events", "false");
  fd.append("diarize", "true");
  // ISO-639-3 — default to English for clinical encounters
  fd.append("language_code", (languageHint || "eng").slice(0, 3));

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: fd,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("ElevenLabs Scribe error:", res.status, errText);
    return null;
  }

  const data = await res.json();
  // Prefer diarized speaker-prefixed text when words are returned.
  const words = Array.isArray(data?.words) ? data.words : [];
  if (words.length) {
    const lines: string[] = [];
    let currentSpeaker: string | null = null;
    let buf: string[] = [];
    const labelFor = (sp: string | undefined) => {
      if (!sp) return "Speaker";
      // ElevenLabs returns labels like "speaker_0" / "speaker_1"
      const idx = /\d+/.exec(sp)?.[0];
      // Heuristic: first speaker = Provider, second = Patient
      if (idx === "0") return "Provider";
      if (idx === "1") return "Patient";
      return `Speaker ${idx ?? sp}`;
    };
    const flush = () => {
      if (!buf.length) return;
      lines.push(`${labelFor(currentSpeaker ?? undefined)}: ${buf.join(" ").replace(/\s+([.,;:?!])/g, "$1").trim()}`);
      buf = [];
    };
    for (const w of words) {
      if (w.type && w.type !== "word") continue;
      const sp = w.speaker_id || w.speaker || null;
      if (sp !== currentSpeaker) {
        flush();
        currentSpeaker = sp;
      }
      buf.push(String(w.text ?? "").trim());
    }
    flush();
    const joined = lines.filter(Boolean).join("\n").trim();
    if (joined) return joined;
  }
  const text: string = String(data?.text ?? "").trim();
  return text || null;
}

async function transcribeWithGemini(
  audioBase64: string,
  mimeType: string,
  languageHint?: string,
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

  const mt = (mimeType || "audio/mpeg").toLowerCase();
  let format = "mp3";
  if (mt.includes("wav")) format = "wav";
  else if (mt.includes("ogg") || mt.includes("opus")) format = "ogg";
  else if (mt.includes("webm")) format = "webm";
  else if (mt.includes("m4a") || mt.includes("mp4") || mt.includes("aac")) format = "m4a";
  else if (mt.includes("flac")) format = "flac";

  const systemPrompt =
    "You are a medical transcription engine. Transcribe the supplied audio of a clinical patient-provider encounter VERBATIM. " +
    "Identify speakers and prefix EVERY sentence with one of these labels: 'Provider:', 'Patient:', 'Caregiver:', or 'Other:'. " +
    "Place a newline before each new speaker turn. " +
    "Do not summarize, translate, or omit content. Spell medical terms, drug names, and dosages carefully. " +
    "Output transcript text only — no commentary, no markdown, no headers.";

  const userText = languageHint
    ? `Transcribe this encounter audio. Likely language: ${languageHint}.`
    : "Transcribe this encounter audio.";

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
          content: [
            { type: "text", text: userText },
            { type: "input_audio", input_audio: { data: audioBase64, format } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("AI gateway error:", response.status, errorText);
    throw new Error(`AI gateway returned ${response.status}`);
  }

  const data = await response.json();
  return String(data.choices?.[0]?.message?.content ?? "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;

    const { audioBase64, mimeType, languageHint } = await req.json();

    if (!audioBase64 || typeof audioBase64 !== "string") {
      return new Response(JSON.stringify({ error: "audioBase64 is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try ElevenLabs Scribe v2 first (medical-grade accuracy, Dragon-class)
    let transcript = "";
    try {
      const bytes = base64ToBytes(audioBase64);
      const elText = await transcribeWithElevenLabs(bytes, mimeType, languageHint);
      if (elText) transcript = elText;
    } catch (e) {
      console.error("ElevenLabs path failed, falling back:", e);
    }

    // Fallback: Lovable AI (Gemini) audio transcription
    if (!transcript.trim()) {
      transcript = await transcribeWithGemini(audioBase64, mimeType, languageHint);
    }

    if (!transcript.trim()) {
      throw new Error("Transcription returned empty content");
    }

    return new Response(JSON.stringify({ transcript }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("transcribe-audio error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
