import { describe, expect, it } from 'vitest';
import { evaluateCriticalVitals } from '@/lib/criticalAlerts';

describe('evaluateCriticalVitals', () => {
  it('returns nothing for normal vitals', () => {
    expect(evaluateCriticalVitals({ bp: '123/77', hr: '70', temp: '98.6', spo2: '97%' })).toEqual([]);
  });

  it('returns nothing when vitals are empty', () => {
    expect(evaluateCriticalVitals({})).toEqual([]);
    expect(evaluateCriticalVitals({ bp: '', hr: '', temp: '', spo2: '' })).toEqual([]);
  });

  it('flags hypertensive crisis systolic and diastolic', () => {
    const f = evaluateCriticalVitals({ bp: '184/122' });
    expect(f).toHaveLength(2);
    expect(f[0]).toContain('high systolic');
    expect(f[1]).toContain('high diastolic');
  });

  it('flags critically low BP', () => {
    const f = evaluateCriticalVitals({ bp: '88/48' });
    expect(f.some(x => x.includes('low systolic'))).toBe(true);
    expect(f.some(x => x.includes('low diastolic'))).toBe(true);
  });

  it('flags tachycardia and bradycardia at thresholds', () => {
    expect(evaluateCriticalVitals({ hr: '130' })[0]).toContain('high heart rate');
    expect(evaluateCriticalVitals({ hr: '40' })[0]).toContain('low heart rate');
    expect(evaluateCriticalVitals({ hr: '129' })).toEqual([]);
    expect(evaluateCriticalVitals({ hr: '41' })).toEqual([]);
  });

  it('flags hypoxia below 88, tolerating a % sign', () => {
    expect(evaluateCriticalVitals({ spo2: '87%' })[0]).toContain('SpO₂');
    expect(evaluateCriticalVitals({ spo2: '88' })).toEqual([]);
  });

  it('flags critical temperature', () => {
    expect(evaluateCriticalVitals({ temp: '103.2' })[0]).toContain('high temperature');
    expect(evaluateCriticalVitals({ temp: '94.5' })[0]).toContain('low temperature');
  });

  it('ignores unparseable blood pressure', () => {
    expect(evaluateCriticalVitals({ bp: 'refused' })).toEqual([]);
  });
});
