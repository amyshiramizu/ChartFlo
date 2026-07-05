import { rate2026 } from '@/lib/medicare2026Codes';
import type { MonthlyBillable } from '@/lib/billingEngine';

export interface ApcmRecommendation {
  recommend: 'APCM' | 'CCM_STACK' | 'EITHER';
  apcmLevel?: 'G0556' | 'G0557' | 'G0558';
  apcmRevenue: number;
  ccmStackRevenue: number;
  reason: string;
}

/**
 * Compare APCM vs CCM/PCM stack revenue for a patient in a month.
 * - chronicConditionCount: # of qualifying chronic conditions from problem list
 * - isQmbOrDual: dual-eligible / QMB?
 */
export function optimizeApcmVsCcm(
  bill: MonthlyBillable,
  opts: { chronicConditionCount: number; isQmbOrDual?: boolean },
): ApcmRecommendation {
  const { chronicConditionCount, isQmbOrDual } = opts;
  let apcmLevel: 'G0556' | 'G0557' | 'G0558' = 'G0556';
  if (isQmbOrDual && chronicConditionCount >= 2) apcmLevel = 'G0558';
  else if (chronicConditionCount >= 2) apcmLevel = 'G0557';
  const apcmRevenue = rate2026(apcmLevel);

  const ccmStackRevenue = bill.programs
    .filter(p => p.program === 'CCM' || p.program === 'PCM' || p.program === 'CCO')
    .reduce((s, p) => s + p.unlocked.reduce((a, c) => a + c.revenue, 0), 0);

  if (apcmRevenue > ccmStackRevenue * 1.1) {
    return {
      recommend: 'APCM',
      apcmLevel,
      apcmRevenue,
      ccmStackRevenue,
      reason: `APCM ${apcmLevel} ($${apcmRevenue.toFixed(2)}) beats current CCM/PCM stack ($${ccmStackRevenue.toFixed(2)}) and avoids time-tracking burden.`,
    };
  }
  if (ccmStackRevenue > apcmRevenue * 1.1) {
    return {
      recommend: 'CCM_STACK',
      apcmLevel,
      apcmRevenue,
      ccmStackRevenue,
      reason: `Current CCM/PCM stack ($${ccmStackRevenue.toFixed(2)}) outperforms APCM ${apcmLevel} ($${apcmRevenue.toFixed(2)}). Keep stacking.`,
    };
  }
  return {
    recommend: 'EITHER',
    apcmLevel,
    apcmRevenue,
    ccmStackRevenue,
    reason: `APCM ${apcmLevel} ($${apcmRevenue.toFixed(2)}) and CCM stack ($${ccmStackRevenue.toFixed(2)}) are roughly equivalent. APCM has less compliance burden.`,
  };
}
