import { supabase } from '@/integrations/supabase/client';

/**
 * Critical vital-sign thresholds. A reading at or beyond any of these
 * creates a critical alert that surfaces app-wide until acknowledged.
 */
export const CRITICAL_THRESHOLDS = {
  systolicHigh: 180,
  systolicLow: 90,
  diastolicHigh: 120,
  diastolicLow: 50,
  hrHigh: 130,
  hrLow: 40,
  spo2Low: 88,
  tempHigh: 103,
  tempLow: 95,
};

export interface ReadingInput {
  bp?: string;   // "123/77"
  hr?: string;
  spo2?: string;
  temp?: string;
}

/** Returns a human-readable finding per critical value; empty when all safe. */
export function evaluateCriticalVitals(v: ReadingInput): string[] {
  const findings: string[] = [];
  const t = CRITICAL_THRESHOLDS;

  const bpMatch = (v.bp || '').match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  if (bpMatch) {
    const sys = parseInt(bpMatch[1]);
    const dia = parseInt(bpMatch[2]);
    if (sys >= t.systolicHigh) findings.push(`Critical high systolic BP: ${v.bp}`);
    else if (sys <= t.systolicLow) findings.push(`Critical low systolic BP: ${v.bp}`);
    if (dia >= t.diastolicHigh) findings.push(`Critical high diastolic BP: ${v.bp}`);
    else if (dia <= t.diastolicLow) findings.push(`Critical low diastolic BP: ${v.bp}`);
  }

  const hr = parseFloat(v.hr || '');
  if (!isNaN(hr) && hr > 0) {
    if (hr >= t.hrHigh) findings.push(`Critical high heart rate: ${hr} bpm`);
    else if (hr <= t.hrLow) findings.push(`Critical low heart rate: ${hr} bpm`);
  }

  const spo2 = parseFloat((v.spo2 || '').replace('%', ''));
  if (!isNaN(spo2) && spo2 > 0 && spo2 < t.spo2Low) {
    findings.push(`Critical low SpO₂: ${spo2}%`);
  }

  const temp = parseFloat(v.temp || '');
  if (!isNaN(temp) && temp > 0) {
    if (temp >= t.tempHigh) findings.push(`Critical high temperature: ${temp}°F`);
    else if (temp <= t.tempLow) findings.push(`Critical low temperature: ${temp}°F`);
  }

  return findings;
}

/**
 * Persist one alert per critical finding. Silently no-ops when there are no
 * findings; logs (but does not throw) if the alerts table is missing so vitals
 * saving never breaks.
 */
export async function createCriticalAlerts(
  patientId: string,
  patientName: string,
  findings: string[],
): Promise<number> {
  if (findings.length === 0) return 0;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { error } = await supabase.from('alerts' as any).insert(
    findings.map(message => ({
      patient_id: patientId,
      patient_name: patientName,
      user_id: user.id,
      type: 'critical_reading',
      message,
    })),
  );
  if (error) {
    console.warn('Failed to create critical alerts (run latest DB migration to enable):', error.message);
    return 0;
  }
  return findings.length;
}
