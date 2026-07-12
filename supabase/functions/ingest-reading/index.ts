import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/auth.ts";

/**
 * Device reading ingestion endpoint.
 *
 * Point your device vendor's webhook here. Readings are matched to the
 * patient via the device IMEI, stored in patient_vitals, and checked
 * against critical thresholds (critical values create alerts that show
 * in the app until acknowledged).
 *
 * POST JSON:
 *   {
 *     "imei": "356938035643809",
 *     "systolic": 152, "diastolic": 91,   // blood pressure, OR
 *     "heart_rate": 72,                    // pulse, OR
 *     "spo2": 96,                          // oxygen saturation, OR
 *     "weight": 183.2,                     // pounds
 *     "recorded_at": "2026-07-12T14:03:00Z" // optional
 *   }
 *
 * Auth: set an INGEST_SECRET in the function's environment and send it
 * as the "x-ingest-secret" header. Requests without a matching secret
 * are rejected.
 */

const CRITICAL = {
  systolicHigh: 180, systolicLow: 90,
  diastolicHigh: 120, diastolicLow: 50,
  hrHigh: 130, hrLow: 40,
  spo2Low: 88,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }

  const secret = Deno.env.get("INGEST_SECRET");
  if (!secret || req.headers.get("x-ingest-secret") !== secret) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const imei = String(body.imei || "").trim();
  if (!imei) return json({ error: "imei is required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Match device (must be active) → patient
  const { data: device, error: devErr } = await supabase
    .from("rpm_devices")
    .select("id, patient_id, device_type, status")
    .eq("imei", imei)
    .maybeSingle();
  if (devErr) return json({ error: devErr.message }, 500);
  if (!device) return json({ error: `No device registered with IMEI ${imei}` }, 404);
  if (device.status !== "active") return json({ error: "Device is not active" }, 409);

  const { data: patient } = await supabase
    .from("patients")
    .select("id, first_name, last_name, user_id")
    .eq("id", device.patient_id)
    .maybeSingle();
  if (!patient) return json({ error: "Device has no linked patient" }, 404);

  // Store the reading as a vitals row
  const systolic = num(body.systolic);
  const diastolic = num(body.diastolic);
  const hr = num(body.heart_rate ?? body.pulse);
  const spo2 = num(body.spo2 ?? body.oxygen_saturation);
  const weight = num(body.weight);

  const vitals: Record<string, string> = {};
  if (systolic !== null && diastolic !== null) vitals.blood_pressure = `${systolic}/${diastolic}`;
  if (hr !== null) vitals.heart_rate = String(hr);
  if (spo2 !== null) vitals.o2_saturation = String(spo2);
  if (weight !== null) vitals.weight = String(weight);
  if (Object.keys(vitals).length === 0) {
    return json({ error: "No reading values found (expected systolic+diastolic, heart_rate, spo2, or weight)" }, 400);
  }

  const { error: insErr } = await supabase.from("patient_vitals").insert({
    patient_id: patient.id,
    ...vitals,
    ...(body.recorded_at ? { recorded_at: body.recorded_at } : {}),
  });
  if (insErr) return json({ error: insErr.message }, 500);

  // Critical threshold check → alerts
  const findings: string[] = [];
  if (systolic !== null) {
    if (systolic >= CRITICAL.systolicHigh) findings.push(`Critical high systolic BP: ${systolic}/${diastolic}`);
    else if (systolic <= CRITICAL.systolicLow) findings.push(`Critical low systolic BP: ${systolic}/${diastolic}`);
  }
  if (diastolic !== null) {
    if (diastolic >= CRITICAL.diastolicHigh) findings.push(`Critical high diastolic BP: ${systolic}/${diastolic}`);
    else if (diastolic <= CRITICAL.diastolicLow) findings.push(`Critical low diastolic BP: ${systolic}/${diastolic}`);
  }
  if (hr !== null) {
    if (hr >= CRITICAL.hrHigh) findings.push(`Critical high heart rate: ${hr} bpm`);
    else if (hr <= CRITICAL.hrLow) findings.push(`Critical low heart rate: ${hr} bpm`);
  }
  if (spo2 !== null && spo2 < CRITICAL.spo2Low) findings.push(`Critical low SpO2: ${spo2}%`);

  if (findings.length > 0) {
    await supabase.from("alerts").insert(findings.map((message) => ({
      patient_id: patient.id,
      patient_name: `${patient.last_name}, ${patient.first_name}`,
      user_id: patient.user_id,
      type: "critical_reading",
      message: `${message} (device ${device.device_type}, IMEI ${imei})`,
    })));
  }

  return json({ ok: true, patient_id: patient.id, stored: vitals, critical_findings: findings });
});

function num(v: unknown): number | null {
  const n = parseFloat(String(v ?? ""));
  return isNaN(n) ? null : n;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
