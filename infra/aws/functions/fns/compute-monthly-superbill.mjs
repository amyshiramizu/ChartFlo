// Port of supabase/functions/compute-monthly-superbill.
// The original's service_role Supabase queries map 1:1 to ctx.sql (master
// role, RLS bypassed — same trust level). Caller identity comes from the
// gateway-verified JWT (custom:legacy_id claim) instead of requireUser().

// 2026 rate lookup (subset). Keep in sync with src/lib/medicare2026Codes.ts.
const RATE = {
  "99490": 60.49, "99439": 45.93, "99491": 76.94, "99437": 57.94,
  "99487": 128.42, "99489": 69.18, "G0511": 72.43,
  "99424": 81.18, "99425": 58.62, "99426": 60.83, "99427": 47.95,
  "G0556": 15.20, "G0557": 50.10, "G0558": 110.42,
  "99453": 19.04, "99454": 43.02, "99457": 48.14, "99458": 38.49,
  "99484": 47.97,
};

const LADDERS = {
  CCM: [{ min: 20, code: "99490" }, { min: 40, code: "99439" }, { min: 60, code: "99439" }],
  CCO: [{ min: 60, code: "99487" }, { min: 90, code: "99489" }, { min: 120, code: "99489" }],
  PCM: [{ min: 30, code: "99426" }, { min: 60, code: "99427" }],
  BHI: [{ min: 20, code: "99484" }],
  RPM: [{ min: 20, code: "99457" }, { min: 40, code: "99458" }, { min: 60, code: "99458" }],
};

function unlocked(program, minutes) {
  const ladder = LADDERS[program] || [];
  const counts = {};
  for (const step of ladder) if (minutes >= step.min) counts[step.code] = (counts[step.code] || 0) + 1;
  return Object.entries(counts).map(([code, units]) => ({
    code, units, rate: RATE[code] || 0, revenue: (RATE[code] || 0) * units,
  }));
}

function monthRange(month) {
  const [y, m] = month.split("-").map(Number);
  return {
    from: new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
  };
}

export default async function handler(body, ctx, event) {
  try {
    const userId = event?.requestContext?.authorizer?.jwt?.claims?.["custom:legacy_id"];
    if (!userId) return ctx.json(401, { error: "Invalid session" });

    const { month, clinicId, persist = false } = body || {};
    if (!month) return ctx.json(400, { error: "month (YYYY-MM) required" });
    const { from, to } = monthRange(month);

    // Patients in scope: enrolled patients for this user's clinic.
    // (Same as the original: clinicId filter when given, otherwise user_id.)
    const patients = clinicId
      ? await ctx.sql(
          "select id, first_name, last_name, mrn, clinic_id from patients where clinic_id = :clinicId::uuid",
          { clinicId })
      : await ctx.sql(
          "select id, first_name, last_name, mrn, clinic_id from patients where user_id = :userId::uuid",
          { userId });
    const patientIds = (patients || []).map((p) => p.id);
    if (!patientIds.length) return ctx.json(200, { month, rows: [] });

    // Fetch time entries in month + problem counts + enrollments.
    const ids = patientIds.join(",");
    const inIds = "any(string_to_array(:ids, ',')::uuid[])";
    const [entries, problems, enrolls] = await Promise.all([
      ctx.sql(`select patient_id, program, minutes from ccm_time_entries where patient_id = ${inIds} and date >= :from::date and date < :to::date`, { ids, from, to }),
      ctx.sql(`select patient_id, status from patient_problems where patient_id = ${inIds}`, { ids }),
      ctx.sql(`select patient_id, program, status from patient_enrollments where patient_id = ${inIds}`, { ids }),
    ]);

    const minutesMap = {};
    (entries || []).forEach((e) => {
      minutesMap[e.patient_id] ||= {};
      minutesMap[e.patient_id][e.program || "CCM"] = (minutesMap[e.patient_id][e.program || "CCM"] || 0) + (e.minutes || 0);
    });

    const problemCount = {};
    (problems || []).forEach((p) => {
      if ((p.status || "active") === "active") problemCount[p.patient_id] = (problemCount[p.patient_id] || 0) + 1;
    });

    const enrollMap = {};
    (enrolls || []).forEach((e) => {
      if (e.status === "enrolled") {
        enrollMap[e.patient_id] ||= new Set();
        enrollMap[e.patient_id].add(e.program);
      }
    });

    const rows = (patients || []).map((p) => {
      const programs = minutesMap[p.id] || {};
      const codes = [];
      let revenue = 0;
      for (const [prog, mins] of Object.entries(programs)) {
        const u = unlocked(prog, mins);
        u.forEach((c) => { codes.push({ ...c, program: prog, minutes: mins }); revenue += c.revenue; });
      }
      const cc = problemCount[p.id] || 0;
      const ccmStack = codes.filter((c) => ["CCM", "PCM", "CCO"].includes(c.program)).reduce((s, c) => s + c.revenue, 0);
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
    }).filter((r) => r.codes.length > 0 || r.apcm_recommended);

    if (persist && rows.length) {
      // Best-effort upsert (original swallowed the error and only logged it).
      // Supabase .upsert(onConflict: 'clinic_id,patient_id,month') → INSERT
      // ... ON CONFLICT DO UPDATE. Note: rows with NULL clinic_id never match
      // the unique constraint — identical Postgres semantics to the original.
      const monthDate = `${month}-01`;
      try {
        for (const r of rows) {
          await ctx.sql(
            `insert into monthly_superbills
               (clinic_id, patient_id, month, codes_jsonb, projected_revenue_cents,
                apcm_recommended, apcm_level, evidence_jsonb, created_by)
             values
               (:clinicId::uuid, :patientId::uuid, :month::date, :codes::jsonb, :revenueCents,
                :apcmRecommended, :apcmLevel, :evidence::jsonb, :createdBy::uuid)
             on conflict (clinic_id, patient_id, month) do update set
               codes_jsonb = excluded.codes_jsonb,
               projected_revenue_cents = excluded.projected_revenue_cents,
               apcm_recommended = excluded.apcm_recommended,
               apcm_level = excluded.apcm_level,
               evidence_jsonb = excluded.evidence_jsonb,
               created_by = excluded.created_by`,
            {
              clinicId: r.clinic_id ?? null,
              patientId: r.patient_id,
              month: monthDate,
              codes: r.codes,
              revenueCents: Math.round(r.projected_revenue * 100),
              apcmRecommended: r.apcm_recommended,
              apcmLevel: r.apcm_level,
              evidence: { chronic_condition_count: r.chronic_condition_count, enrolled_programs: r.enrolled_programs },
              createdBy: userId,
            },
          );
        }
      } catch (e) { console.error("superbill upsert failed", e.message); }
    }

    return ctx.json(200, { month, rows });
  } catch (e) {
    console.error("compute-monthly-superbill error:", e);
    return ctx.json(500, { error: e instanceof Error ? e.message : "Unknown" });
  }
}
