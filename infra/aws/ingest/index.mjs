// Device readings ingestion (AWS) — vendors POST readings keyed by IMEI.
// Matches device -> patient, stores vitals, creates critical alerts.
// Accepts: systolic/diastolic, heart_rate|pulse, spo2|oxygen_saturation,
// weight, blood_glucose|glucose|blood_sugar, afib|irregular_heartbeat.
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

const rds = new RDSDataClient({ region: 'us-east-2' });
const CLUSTER = 'arn:aws:rds:us-east-2:557485610536:cluster:chartflo';
const SECRET = 'arn:aws:secretsmanager:us-east-2:557485610536:secret:rds!cluster-52cb2016-c3c0-4247-a32b-0ba3a7d24143-szaMiY';

const CRIT = { sysHi: 180, sysLo: 90, diaHi: 120, diaLo: 50, hrHi: 130, hrLo: 40, spo2Lo: 88, gluLo: 54, gluHi: 400 };

async function sql(q, params = {}) {
  const parameters = Object.entries(params).map(([name, v]) =>
    v == null ? { name, value: { isNull: true } } : { name, value: { stringValue: String(v) } });
  const r = await rds.send(new ExecuteStatementCommand({
    resourceArn: CLUSTER, secretArn: SECRET, database: 'chartflo',
    sql: q, parameters, formatRecordsAs: 'JSON',
  }));
  return r.formattedRecords ? JSON.parse(r.formattedRecords) : [];
}

const json = (status, body) => ({ statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const num = v => { const n = parseFloat(String(v ?? '')); return isNaN(n) ? null : n; };
const bool = v => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v;
  return ['true', 'yes', 'y', '1', 'detected'].includes(String(v).trim().toLowerCase());
};

export const handler = async (event) => {
  if ((event.requestContext?.http?.method || '') !== 'POST') return json(405, { error: 'POST only' });
  if (event.headers?.['x-ingest-secret'] !== process.env.INGEST_SECRET) return json(401, { error: 'Unauthorized' });

  let body;
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const imei = String(body.imei || '').trim();
  if (!imei) return json(400, { error: 'imei is required' });

  const devices = await sql(`select d.id, d.patient_id, d.device_type, d.status,
      p.first_name, p.last_name, p.user_id
    from rpm_devices d join patients p on p.id = d.patient_id
    where d.imei = :imei limit 1`, { imei });
  if (!devices.length) return json(404, { error: `No device registered with IMEI ${imei}` });
  const d = devices[0];
  if (d.status !== 'active') return json(409, { error: 'Device is not active' });

  const systolic = num(body.systolic), diastolic = num(body.diastolic);
  const hr = num(body.heart_rate ?? body.pulse), spo2 = num(body.spo2 ?? body.oxygen_saturation);
  const weight = num(body.weight);
  const glucose = num(body.blood_glucose ?? body.glucose ?? body.blood_sugar ?? body.bg);
  const afib = bool(body.afib ?? body.afib_detected ?? body.irregular_heartbeat ?? body.ihb);

  const cols = [], vals = {}, names = [];
  if (systolic !== null && diastolic !== null) { cols.push('blood_pressure'); names.push(':bp'); vals.bp = `${systolic}/${diastolic}`; }
  if (hr !== null) { cols.push('heart_rate'); names.push(':hr'); vals.hr = String(hr); }
  if (spo2 !== null) { cols.push('o2_saturation'); names.push(':spo2'); vals.spo2 = String(spo2); }
  if (weight !== null) { cols.push('weight'); names.push(':wt'); vals.wt = String(weight); }
  if (glucose !== null) { cols.push('blood_glucose'); names.push(':glu'); vals.glu = String(glucose); }
  if (afib !== null) { cols.push('afib_detected'); names.push(':afib::boolean'); vals.afib = afib ? 'true' : 'false'; }
  if (!cols.length) return json(400, { error: 'No reading values found' });
  cols.push('source'); names.push(':src'); vals.src = 'device';

  await sql(`insert into patient_vitals (patient_id, ${cols.join(', ')}) values (:pid::uuid, ${names.join(', ')})`,
    { pid: d.patient_id, ...vals });

  const findings = [];
  if (systolic !== null) {
    if (systolic >= CRIT.sysHi) findings.push(`Critical high systolic BP: ${systolic}/${diastolic}`);
    else if (systolic <= CRIT.sysLo) findings.push(`Critical low systolic BP: ${systolic}/${diastolic}`);
  }
  if (diastolic !== null) {
    if (diastolic >= CRIT.diaHi) findings.push(`Critical high diastolic BP: ${systolic}/${diastolic}`);
    else if (diastolic <= CRIT.diaLo) findings.push(`Critical low diastolic BP: ${systolic}/${diastolic}`);
  }
  if (hr !== null) {
    if (hr >= CRIT.hrHi) findings.push(`Critical high heart rate: ${hr} bpm`);
    else if (hr <= CRIT.hrLo) findings.push(`Critical low heart rate: ${hr} bpm`);
  }
  if (spo2 !== null && spo2 < CRIT.spo2Lo) findings.push(`Critical low SpO2: ${spo2}%`);
  if (glucose !== null) {
    if (glucose <= CRIT.gluLo) findings.push(`Critical low blood glucose: ${glucose} mg/dL`);
    else if (glucose >= CRIT.gluHi) findings.push(`Critical high blood glucose: ${glucose} mg/dL`);
  }

  for (const message of findings) {
    await sql(`insert into alerts (patient_id, patient_name, user_id, type, message)
      values (:pid::uuid, :pname, :uid::uuid, 'critical_reading', :msg)`,
      { pid: d.patient_id, pname: `${d.last_name}, ${d.first_name}`, uid: d.user_id, msg: `${message} (device ${d.device_type}, IMEI ${imei})` });
  }

  return json(200, { ok: true, stored: cols, critical_findings: findings });
};
