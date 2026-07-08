import { addDays, addWeeks, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';

export interface MetricEntry {
  patient_id: string;
  date: string; // yyyy-MM-dd
  minutes: number;
}

export interface PeriodDef {
  key: 'lastWeek' | 'thisWeek' | 'today' | 'nextWeek';
  label: string;
  start: string; // yyyy-MM-dd inclusive
  end: string;   // yyyy-MM-dd inclusive
}

export interface PeriodMetrics {
  minutes: number;
  patients: number;
  /** Completed 20-minute billing blocks, summed per patient over the period. */
  periods: number;
  compliancePct: number;
  billablePct: number;
}

/** Minutes a patient must accumulate in a month to be billable (99490 / 99457). */
export const BILLABLE_THRESHOLD_MIN = 20;

const fmt = (d: Date) => format(d, 'yyyy-MM-dd');

/** Sunday-start weeks, matching common US practice calendars. */
export function buildPeriods(today: Date): PeriodDef[] {
  const weekOpts = { weekStartsOn: 0 as const };
  const thisWeekStart = startOfWeek(today, weekOpts);
  const thisWeekEnd = endOfWeek(today, weekOpts);
  return [
    {
      key: 'lastWeek', label: 'Last Week',
      start: fmt(addWeeks(thisWeekStart, -1)), end: fmt(addDays(thisWeekStart, -1)),
    },
    {
      key: 'thisWeek', label: 'This Week',
      start: fmt(thisWeekStart), end: fmt(thisWeekEnd),
    },
    {
      key: 'today', label: 'Today',
      start: fmt(today), end: fmt(today),
    },
    {
      key: 'nextWeek', label: 'Next Week',
      start: fmt(addWeeks(thisWeekStart, 1)), end: fmt(addWeeks(thisWeekEnd, 1)),
    },
  ];
}

/**
 * Date window that must be fetched to compute every period's metrics,
 * including month-to-date totals for the billable calculation.
 */
export function metricsWindow(today: Date): { start: string; end: string } {
  const periods = buildPeriods(today);
  const earliestPeriodStart = periods[0].start;
  // Month-to-date needs the start of the month containing each period's end;
  // the earliest such month is the month of last week's start.
  const monthStart = fmt(startOfMonth(new Date(`${earliestPeriodStart}T00:00:00`)));
  const start = monthStart < earliestPeriodStart ? monthStart : earliestPeriodStart;
  return { start, end: periods[periods.length - 1].end };
}

/**
 * Metrics for one period:
 * - minutes: total minutes logged in the period
 * - patients: distinct enrolled patients with time logged in the period
 * - periods: completed 20-minute billing blocks within the period, counted
 *   per patient (a patient at 10 minutes contributes 0; at 45 minutes, 2)
 * - compliancePct: patients touched in the period / enrolled patients
 * - billablePct: patients touched in the period who reach the billable
 *   threshold in any calendar month the period overlaps, counting that
 *   month's minutes through the period's end / enrolled patients
 */
export function computePeriodMetrics(
  entries: MetricEntry[],
  enrolledIds: Set<string>,
  period: PeriodDef,
): PeriodMetrics {
  const inPeriod = entries.filter(
    e => enrolledIds.has(e.patient_id) && e.date >= period.start && e.date <= period.end,
  );

  const minutes = inPeriod.reduce((s, e) => s + e.minutes, 0);
  const touched = new Set(inPeriod.map(e => e.patient_id));

  const perPatientMinutes = new Map<string, number>();
  for (const e of inPeriod) {
    perPatientMinutes.set(e.patient_id, (perPatientMinutes.get(e.patient_id) || 0) + e.minutes);
  }
  const periods = Array.from(perPatientMinutes.values())
    .reduce((s, m) => s + Math.floor(m / BILLABLE_THRESHOLD_MIN), 0);

  // A period (e.g. a week) can span a month boundary; billing accrues per
  // calendar month, so check each overlapped month's total independently.
  const monthStarts = new Set([
    fmt(startOfMonth(new Date(`${period.start}T00:00:00`))),
    fmt(startOfMonth(new Date(`${period.end}T00:00:00`))),
  ]);
  const billablePatients = new Set<string>();
  for (const monthStart of monthStarts) {
    const monthEnd = fmt(endOfMonth(new Date(`${monthStart}T00:00:00`)));
    const windowEnd = period.end < monthEnd ? period.end : monthEnd;
    const totals = new Map<string, number>();
    for (const e of entries) {
      if (!touched.has(e.patient_id)) continue;
      if (e.date < monthStart || e.date > windowEnd) continue;
      totals.set(e.patient_id, (totals.get(e.patient_id) || 0) + e.minutes);
    }
    for (const [id, total] of totals) {
      if (total >= BILLABLE_THRESHOLD_MIN) billablePatients.add(id);
    }
  }
  const billable = billablePatients.size;

  const denom = enrolledIds.size;
  const pct = (n: number) => (denom > 0 ? Math.round((n / denom) * 100) : 0);

  return {
    minutes,
    patients: touched.size,
    periods,
    compliancePct: pct(touched.size),
    billablePct: pct(billable),
  };
}
