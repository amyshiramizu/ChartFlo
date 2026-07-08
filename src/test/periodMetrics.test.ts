import { describe, expect, it } from 'vitest';
import {
  buildPeriods, computePeriodMetrics, metricsWindow, type MetricEntry,
} from '@/lib/periodMetrics';

// Wednesday 2026-07-08 → this week is Sun 07-05 .. Sat 07-11
const TODAY = new Date('2026-07-08T12:00:00');

describe('buildPeriods', () => {
  it('builds Sunday-start weeks around today', () => {
    const [lastWeek, thisWeek, today, nextWeek] = buildPeriods(TODAY);
    expect(lastWeek).toMatchObject({ start: '2026-06-28', end: '2026-07-04' });
    expect(thisWeek).toMatchObject({ start: '2026-07-05', end: '2026-07-11' });
    expect(today).toMatchObject({ start: '2026-07-08', end: '2026-07-08' });
    expect(nextWeek).toMatchObject({ start: '2026-07-12', end: '2026-07-18' });
  });
});

describe('metricsWindow', () => {
  it('starts at the month start when last week begins mid-month', () => {
    // Last week starts 2026-06-28, so the window must reach back to 2026-06-01
    // for June month-to-date totals.
    expect(metricsWindow(TODAY)).toEqual({ start: '2026-06-01', end: '2026-07-18' });
  });
});

describe('computePeriodMetrics', () => {
  const enrolled = new Set(['p1', 'p2', 'p3', 'p4']);
  const entries: MetricEntry[] = [
    // p1: 15 min early July + 10 min today → 25 MTD (billable)
    { patient_id: 'p1', date: '2026-07-06', minutes: 15 },
    { patient_id: 'p1', date: '2026-07-08', minutes: 10 },
    // p2: 5 min today only → not billable yet
    { patient_id: 'p2', date: '2026-07-08', minutes: 5 },
    // p3: worked last week (June dates), 30 min in June → billable in June
    { patient_id: 'p3', date: '2026-06-29', minutes: 30 },
    // not enrolled → ignored entirely
    { patient_id: 'ghost', date: '2026-07-08', minutes: 60 },
  ];
  const [lastWeek, thisWeek, today, nextWeek] = buildPeriods(TODAY);

  it('computes today: mins, patients, periods, compliance, billable', () => {
    const m = computePeriodMetrics(entries, enrolled, today);
    expect(m.minutes).toBe(15); // p1 10 + p2 5
    expect(m.patients).toBe(2);
    expect(m.periods).toBe(0); // no patient reaches 20 min today alone
    expect(m.compliancePct).toBe(50); // 2 of 4
    expect(m.billablePct).toBe(25); // only p1 has ≥20 MTD
  });

  it('computes this week including earlier-in-week entries', () => {
    const m = computePeriodMetrics(entries, enrolled, thisWeek);
    expect(m.minutes).toBe(30);
    expect(m.patients).toBe(2);
    expect(m.periods).toBe(1); // p1: 25 min → one 20-min block; p2: 5 min → none
  });

  it('credits billable status from any month a spanning period overlaps', () => {
    const m = computePeriodMetrics(entries, enrolled, lastWeek);
    expect(m.minutes).toBe(30); // p3 in June
    expect(m.patients).toBe(1);
    expect(m.periods).toBe(1); // p3: 30 min → one 20-min block
    expect(m.billablePct).toBe(25); // p3: 30 min in June ≥ 20
  });

  it('counts multiple completed blocks per patient', () => {
    const heavy: MetricEntry[] = [{ patient_id: 'p1', date: '2026-07-08', minutes: 45 }];
    const m = computePeriodMetrics(heavy, enrolled, today);
    expect(m.periods).toBe(2); // 45 min → two 20-min blocks
  });

  it('returns zeros for a future period with no entries', () => {
    const m = computePeriodMetrics(entries, enrolled, nextWeek);
    expect(m).toEqual({ minutes: 0, patients: 0, periods: 0, compliancePct: 0, billablePct: 0 });
  });

  it('handles an empty panel without dividing by zero', () => {
    const m = computePeriodMetrics(entries, new Set(), today);
    expect(m).toEqual({ minutes: 0, patients: 0, periods: 0, compliancePct: 0, billablePct: 0 });
  });
});
