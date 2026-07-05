import { supabase } from '@/integrations/supabase/client';
import { ALL_2026_CODES, rate2026, CCM_CODES_2026, RPM_CODES_2026, BHI_CODES_2026, PCM_CODES_2026 } from '@/lib/medicare2026Codes';

export type Program = 'CCM' | 'PCM' | 'BHI' | 'RPM' | 'CCO';

export interface UnlockedCode {
  code: string;
  description: string;
  units: number;
  rate: number;
  revenue: number;
}

export interface ProgramStatus {
  program: Program;
  minutesAccrued: number;
  unlocked: UnlockedCode[];
  nextThreshold?: { minutes: number; code: string; addsRevenue: number };
}

export interface MonthlyBillable {
  patientId: string;
  month: string; // YYYY-MM
  programs: ProgramStatus[];
  totalRevenue: number;
}

/** Threshold ladders per program (minutes => code). Order matters. */
const LADDERS: Record<Program, Array<{ min: number; code: string; staff?: boolean }>> = {
  CCM: [
    { min: 20, code: '99490', staff: true },
    { min: 40, code: '99439', staff: true },
    { min: 60, code: '99439', staff: true }, // 99439 max 2 units
  ],
  CCO: [ // Complex CCM
    { min: 60, code: '99487' },
    { min: 90, code: '99489' },
    { min: 120, code: '99489' },
  ],
  PCM: [
    { min: 30, code: '99426', staff: true },
    { min: 60, code: '99427', staff: true },
  ],
  BHI: [
    { min: 20, code: '99484' },
  ],
  RPM: [
    { min: 20, code: '99457' },
    { min: 40, code: '99458' },
    { min: 60, code: '99458' },
  ],
};

function ladderFor(program: Program) { return LADDERS[program] || []; }

function unlockedFromMinutes(program: Program, minutes: number): UnlockedCode[] {
  const ladder = ladderFor(program);
  const codes: UnlockedCode[] = [];
  const counts: Record<string, number> = {};
  for (const step of ladder) {
    if (minutes >= step.min) {
      counts[step.code] = (counts[step.code] || 0) + 1;
    }
  }
  for (const [code, units] of Object.entries(counts)) {
    const def = ALL_2026_CODES.find(c => c.code === code);
    const r = rate2026(code);
    codes.push({
      code,
      description: def?.description || code,
      units,
      rate: r,
      revenue: r * units,
    });
  }
  return codes;
}

function nextStep(program: Program, minutes: number) {
  const ladder = ladderFor(program);
  for (const step of ladder) {
    if (minutes < step.min) {
      return {
        minutes: step.min - minutes,
        code: step.code,
        addsRevenue: rate2026(step.code),
      };
    }
  }
  return undefined;
}

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** Compute billable status for one patient for a calendar month (YYYY-MM). */
export async function computeMonthlyBillable(patientId: string, month: string): Promise<MonthlyBillable> {
  const { from, to } = monthRange(month);
  const { data: entries } = await supabase
    .from('ccm_time_entries')
    .select('program,minutes,date')
    .eq('patient_id', patientId)
    .gte('date', from)
    .lt('date', to);

  const totals: Record<Program, number> = { CCM: 0, PCM: 0, BHI: 0, RPM: 0, CCO: 0 };
  (entries || []).forEach((e: any) => {
    const p = (e.program as Program) || 'CCM';
    totals[p] = (totals[p] || 0) + (e.minutes || 0);
  });

  const programs: ProgramStatus[] = (Object.keys(totals) as Program[])
    .filter(p => totals[p] > 0 || ladderFor(p).length > 0)
    .map(p => ({
      program: p,
      minutesAccrued: totals[p] || 0,
      unlocked: unlockedFromMinutes(p, totals[p] || 0),
      nextThreshold: nextStep(p, totals[p] || 0),
    }));

  const totalRevenue = programs.reduce((s, p) => s + p.unlocked.reduce((a, c) => a + c.revenue, 0), 0);
  return { patientId, month, programs, totalRevenue };
}

export function currentMonthString(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
