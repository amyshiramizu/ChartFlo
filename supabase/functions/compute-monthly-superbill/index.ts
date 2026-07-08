import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 2026 rate lookup (subset). Keep in sync with src/lib/medicare2026Codes.ts.
const RATE: Record<string, number> = {
  "99490": 60.49, "99439": 45.93, "99491": 76.94, "99437": 57.94,
  "99487": 128.42, "99489": 69.18, "G0511": 72.43,
  "99424": 81.18, "99425": 58.62, "99426": 60.83, "99427": 47.95,
  "G0556": 15.20, "G0557": 50.10, "G0558": 110.42,
  "99453": 19.04, "99454": 43.02, "99457": 48.14, "99458": 38.49,
  "99484": 47.97,
};

interface Ladder { min: number; code: string; }
const LADDERS: Record<string, Ladder[]> = {
  CCM: [{ min: 20, code: "99490" }, { min: 40, code: "99439" }, { min: 60, code: "99439" }],
  CCO: [{ min: 60, code: "99487" }, { min: 90, code: "99489" }, { min: 120, code: "99489" }],
  PCM: [{ min: 30, code: "99426" }, { min: 60, code: "99427" }],
  BHI: [{ min: 20, code: "99484" }],
  RPM: [{ min: 20, code: "99457" }, { min: 40, code: "99458" }, { min: 60, code: "99458" }],
};

function unlocked(program: string, minutes: number) {
  const ladder = LADDERS[program] || [];
  const counts: Record<string, number> = {};
  for (const step of ladder) if (minutes >= step.min) counts[step.code] = (counts[step.code] || 0) + 1;
  return Object.entries(counts).map(([code, units]) => ({
    code, units, rate: RATE[code] || 0, revenue: (RATE[code] || 0) * units,
  }));
}

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return {
    from: new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;
    const userId = auth.userId;

    const { month, clinicId, persist = false } = await req.json();
    if (!month) {
      return new Response(JSON.stringify({ error: "month (YYYY-MM) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { from, to } = monthRange(month);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    // Patients in scope: enrolled patients for this user's clinic.
    let patientQuery = admin.from("patients").select("id, first_name, last_name, mrn, clinic_id");
    if (clinicId) patientQuery = patientQuery.eq("clinic_id", clinicId);
    else patientQuery = patientQuery.eq("user_id", userId);
    const { data: patients, error: pErr } = await patientQuery;
    if (pErr) throw pErr;
    const patientIds = (patients || []).map((p: any) => p.id);
    if (!patientIds.length) {
      return new Response(JSON.stringify({ month, rows: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch time entries in month + problem counts + enrollments.
    const [{ data: entries }, { data: problems }, { data: enrolls }] = await Promise.all([
      admin.from("ccm_time_entries").select("patient_id, program, minutes").in("patient_id", patientIds).gte("date", from).lt("date", to),
      admin.from("patient_problems").select("patient_id, status").in("patient_id", patientIds),
      admin.from("patient_enrollments").select("patient_id, program, status").in("patient_id", patientIds),
    ]);

    const minutesMap: Record<string, Record<string, number>> = {};
    (entries || []).forEach((e: any) => {
      minutesMap[e.patient_id] ||= {};
      minutesMap[e.patient_id][e.program || "CCM"] = (minutesMap[e.patient_id][e.program || "CCM"] || 0) + (e.minutes || 0);
    });

    const problemCount: Record<string, number> = {};
    (problems || []).forEach((p: any) => {
      if ((p.status || "active") === "active") problemCount[p.patient_id] = (problemCount[p.patient_id] || 0) + 1;
    });

    const enrollMap: Record<string, Set<string>> = {};
    (enrolls || []).forEach((e: any) => {
      if (e.status === "enrolled") {
        enrollMap[e.patient_id] ||= new Set();
        enrollMap[e.patient_id].add(e.program);
      }
    });

    const rows = (patients || []).map((p: any) => {
      const programs = minutesMap[p.id] || {};
      const codes: any[] = [];
      let revenue = 0;
      for (const [prog, mins] of Object.entries(programs)) {
        const u = unlocked(prog, mins as number);
        u.forEach(c => { codes.push({ ...c, program: prog, minutes: mins }); revenue += c.revenue; });
      }
      const cc = problemCount[p.id] || 0;
      const ccmStack = codes.filter(c => ["CCM", "PCM", "CCO"].includes(c.program)).reduce((s, c) => s + c.revenue, 0);
      const apcmLevel = cc >= 2 ? "G0557" : "G0556";
      const apcmRevenue = RATE[apcmLevel];
      const apcmRecommended = apcmRevenue > ccmStack * 1.1;
      return {
        patient_id: p.id,
        patient_name: `${p.first_name} ${p.last_name}`,
        mrn: p.mrn,
        clinic_id: p.clinic_id,
        codes,
        projected_revenue: revenue,
        apcm_recommended: apcmRecommended,
        apcm_level: apcmLevel,
        chronic_condition_count: cc,
        enrolled_programs: Array.from(enrollMap[p.id] || []),
      };
    }).filter(r => r.codes.length > 0 || r.apcm_recommended);

    if (persist && rows.length) {
      const monthDate = `${month}-01`;
      const upserts = rows.map(r => ({
        clinic_id: r.clinic_id,
        patient_id: r.patient_id,
        month: monthDate,
        codes_jsonb: r.codes,
        projected_revenue_cents: Math.round(r.projected_revenue * 100),
        apcm_recommended: r.apcm_recommended,
        apcm_level: r.apcm_level,
        evidence_jsonb: { chronic_condition_count: r.chronic_condition_count, enrolled_programs: r.enrolled_programs },
        created_by: userId,
      }));
      const { error: upErr } = await admin.from("monthly_superbills").upsert(upserts, { onConflict: "clinic_id,patient_id,month" });
      if (upErr) console.error("superbill upsert failed", upErr.message);
    }

    return new Response(JSON.stringify({ month, rows }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("compute-monthly-superbill error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
