// Resolve a detected patient (from the Chrome extension on PF, Updox,
// CoverMyMeds, Impact RPM, etc.) to a ChartFlo patient record and, when a
// dispatch batch share code is provided, link the matching dispatch job.
//
// Returns: { patientId, patientName, mrn, dob, jobId, batchId }
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser, corsHeaders } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function norm(s: string | null | undefined) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function splitName(full: string): { first: string; last: string } {
  const parts = (full || "").trim().split(/\s+/);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  // Handle "Last, First"
  if (/,/.test(full)) {
    const [last, ...rest] = full.split(",").map((p) => p.trim());
    return { first: rest.join(" "), last };
  }
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;

    const authHeader = req.headers.get("Authorization")!;
    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name || "").trim();
    const mrn = String(body?.mrn || "").trim();
    const dob = String(body?.dob || "").trim();
    const shareCode = String(body?.shareCode || "").trim().toUpperCase();

    if (!name && !mrn) return json({ error: "name or mrn required" }, 400);

    const { first, last } = splitName(name);

    // 1) Try MRN match (scoped by RLS to the user's clinics)
    let patient: { id: string; first_name: string; last_name: string; mrn: string | null; dob: string | null } | null = null;
    if (mrn) {
      const { data } = await supabase
        .from("patients")
        .select("id, first_name, last_name, mrn, dob")
        .eq("mrn", mrn)
        .limit(1)
        .maybeSingle();
      if (data) patient = data;
    }

    // 2) Try name (+ optional dob)
    if (!patient && (first || last)) {
      let q = supabase
        .from("patients")
        .select("id, first_name, last_name, mrn, dob")
        .limit(10);
      if (first) q = q.ilike("first_name", first);
      if (last) q = q.ilike("last_name", last);
      if (dob) q = q.eq("dob", dob);
      const { data } = await q;
      if (data && data.length > 0) {
        // Prefer dob match, otherwise first
        patient = data.find((p) => !dob || p.dob === dob) ?? data[0];
      }
    }

    // 3) Find dispatch job in batch if share code provided
    let jobId: string | null = null;
    let batchId: string | null = null;
    if (shareCode) {
      const { data: batch } = await supabase
        .from("dispatch_batches")
        .select("id, user_id")
        .eq("share_code", shareCode)
        .maybeSingle();
      if (batch && batch.user_id === auth.userId) {
        batchId = batch.id;
        const { data: jobs } = await supabase
          .from("dispatch_jobs")
          .select("id, patient_name, mrn, patient_id")
          .eq("batch_id", batch.id);
        const candidate = (jobs ?? []).find((j) => {
          if (mrn && j.mrn && j.mrn.trim() === mrn) return true;
          if (patient?.id && j.patient_id === patient.id) return true;
          if (name && j.patient_name && norm(j.patient_name) === norm(name)) return true;
          // last+first fallback
          if (last && j.patient_name && norm(j.patient_name).includes(norm(last))) {
            if (!first || norm(j.patient_name).includes(norm(first))) return true;
          }
          return false;
        });
        if (candidate) {
          jobId = candidate.id;
          // Link patient_id if we resolved one and the job has none (or stale)
          if (patient?.id && candidate.patient_id !== patient.id) {
            await supabase
              .from("dispatch_jobs")
              .update({ patient_id: patient.id })
              .eq("id", candidate.id);
          }
        }
      }
    }

    return json({
      patientId: patient?.id ?? null,
      patientName: patient ? `${patient.first_name} ${patient.last_name}`.trim() : null,
      mrn: patient?.mrn ?? null,
      dob: patient?.dob ?? null,
      jobId,
      batchId,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
