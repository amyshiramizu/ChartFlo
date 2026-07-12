// Port of supabase/functions/resolve-active-patient.
//
// Resolve a detected patient (from the Chrome extension on PF, Updox,
// CoverMyMeds, Impact RPM, etc.) to a ChartFlo patient record and, when a
// dispatch batch share code is provided, link the matching dispatch job.
//
// Returns: { patientId, patientName, mrn, dob, jobId, batchId }
//
// The original queried through the caller's JWT (anon key + RLS). The Lambda
// runs as the master role, so the patients RLS scope — own patients
// (user_id = caller) OR patients of clinics the caller is a member of — is
// re-applied explicitly in SQL. The original also silently discarded query
// errors (supabase-js returns { error } which was never checked), so each
// query here swallows failures the same way.

function norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function splitName(full) {
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

// RLS-equivalent visibility scope for the patients table ("p" alias).
const PATIENT_SCOPE = `(p.user_id = :userId::uuid or (p.clinic_id is not null and exists (
  select 1 from clinic_members cm
  where cm.user_id = :userId::uuid and cm.clinic_id = p.clinic_id)))`;

export default async function handler(body, ctx, event) {
  const method = event?.requestContext?.http?.method || "POST";
  if (method !== "POST") return ctx.json(405, { error: "POST only" });

  try {
    const userId = event?.requestContext?.authorizer?.jwt?.claims?.["custom:legacy_id"];
    if (!userId) return ctx.json(401, { error: "Invalid session" });

    // Original discarded per-query errors; mirror that.
    const trySql = async (query, params) => {
      try { return await ctx.sql(query, params); } catch { return []; }
    };

    const name = String(body?.name || "").trim();
    const mrn = String(body?.mrn || "").trim();
    const dob = String(body?.dob || "").trim();
    const shareCode = String(body?.shareCode || "").trim().toUpperCase();

    if (!name && !mrn) return ctx.json(400, { error: "name or mrn required" });

    const { first, last } = splitName(name);

    // 1) Try MRN match (scoped like RLS to the user's clinics)
    let patient = null;
    if (mrn) {
      const rows = await trySql(
        `select p.id, p.first_name, p.last_name, p.mrn, p.dob from patients p
         where p.mrn = :mrn and ${PATIENT_SCOPE} limit 1`,
        { mrn, userId },
      );
      if (rows[0]) patient = rows[0];
    }

    // 2) Try name (+ optional dob)
    if (!patient && (first || last)) {
      let where = PATIENT_SCOPE;
      const params = { userId };
      if (first) { where += " and p.first_name ilike :first"; params.first = first; }
      if (last) { where += " and p.last_name ilike :last"; params.last = last; }
      if (dob) { where += " and p.dob = :dob::date"; params.dob = dob; }
      const data = await trySql(
        `select p.id, p.first_name, p.last_name, p.mrn, p.dob from patients p
         where ${where} limit 10`,
        params,
      );
      if (data && data.length > 0) {
        // Prefer dob match, otherwise first
        patient = data.find((p) => !dob || p.dob === dob) ?? data[0];
      }
    }

    // 3) Find dispatch job in batch if share code provided
    let jobId = null;
    let batchId = null;
    if (shareCode) {
      const batches = await trySql(
        "select id, user_id from dispatch_batches where share_code = :shareCode limit 1",
        { shareCode },
      );
      const batch = batches[0] || null;
      if (batch && batch.user_id === userId) {
        batchId = batch.id;
        const jobs = await trySql(
          "select id, patient_name, mrn, patient_id from dispatch_jobs where batch_id = :batchId::uuid",
          { batchId: batch.id },
        );
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
            await trySql(
              "update dispatch_jobs set patient_id = :patientId::uuid where id = :jobId::uuid",
              { patientId: patient.id, jobId: candidate.id },
            );
          }
        }
      }
    }

    return ctx.json(200, {
      patientId: patient?.id ?? null,
      patientName: patient ? `${patient.first_name} ${patient.last_name}`.trim() : null,
      mrn: patient?.mrn ?? null,
      dob: patient?.dob ?? null,
      jobId,
      batchId,
    });
  } catch (e) {
    return ctx.json(500, { error: String(e) });
  }
}
