import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePatientStore } from '@/store/patientStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  buildPeriods, computePeriodMetrics, metricsWindow,
  type MetricEntry, type PeriodDef,
} from '@/lib/periodMetrics';

const STAT_DEFS = [
  { key: 'minutes', label: 'Mins', title: 'Total minutes logged in this period' },
  { key: 'periods', label: 'Periods', title: 'Completed 20-minute billing blocks in this period, counted per patient' },
  { key: 'compliancePct', label: 'Compliant', title: 'Patients with time logged this period, as a share of all patients', pct: true },
  { key: 'billablePct', label: 'Billable', title: 'Patients worked this period who have reached 20 billable minutes month-to-date, as a share of all patients', pct: true },
] as const;

const CURRENT_PERIODS = new Set(['thisWeek', 'today']);
const PROGRAM_FILTERS = ['All', 'CCM', 'RPM'] as const;
type ProgramFilter = (typeof PROGRAM_FILTERS)[number];
const FILTER_STORAGE_KEY = 'period_metrics_program';

/**
 * Full-width time-tracking strip pinned to the top of the screen.
 * Pass `program` to lock it to one program (CCM/RPM dashboards);
 * omit it to show an All/CCM/RPM toggle (app-wide pages).
 */
export default function PeriodMetricsBar({ program }: { program?: 'CCM' | 'RPM' }) {
  const { patients, fetchPatients } = usePatientStore();
  const [entries, setEntries] = useState<MetricEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ProgramFilter>(() => {
    if (program) return program;
    const saved = localStorage.getItem(FILTER_STORAGE_KEY) as ProgramFilter | null;
    return saved && PROGRAM_FILTERS.includes(saved) ? saved : 'All';
  });

  const today = useMemo(() => new Date(), []);
  const periods = useMemo(() => buildPeriods(today), [today]);
  const activeProgram = program ?? filter;

  const fetchWindow = useCallback(async () => {
    setLoading(true);
    const { start, end } = metricsWindow(today);
    let query = supabase
      .from('ccm_time_entries')
      .select('patient_id, date, minutes')
      .gte('date', start)
      .lte('date', end);
    if (activeProgram !== 'All') query = query.eq('program', activeProgram);
    const { data, error } = await query;
    if (error) console.error('Failed to fetch period metrics:', error);
    else setEntries((data || []) as MetricEntry[]);
    setLoading(false);
  }, [activeProgram, today]);

  useEffect(() => { fetchWindow(); }, [fetchWindow]);

  useEffect(() => {
    if (patients.length === 0) fetchPatients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeFilter(f: ProgramFilter) {
    setFilter(f);
    localStorage.setItem(FILTER_STORAGE_KEY, f);
  }

  const enrolledIds = useMemo(() => new Set(patients.map(p => p.id)), [patients]);
  const metrics = useMemo(
    () => periods.map(p => ({ period: p, stats: computePeriodMetrics(entries, enrolledIds, p) })),
    [periods, entries, enrolledIds],
  );

  return (
    <div className="bg-card border-b border-border flex items-stretch">
      <div className="flex-1 flex items-stretch overflow-x-auto">
        {metrics.map(({ period, stats }, i) => (
          <div
            key={period.key}
            className={cn(
              'flex items-stretch shrink-0 py-1.5',
              i > 0 && 'border-l-4 border-border/40',
            )}
          >
            <div className="flex items-center px-2">
              <span
                className={cn(
                  'text-xs font-semibold leading-tight text-center rounded px-2.5 py-1.5 whitespace-pre-line',
                  CURRENT_PERIODS.has(period.key)
                    ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {period.label.replace(' ', '\n')}
              </span>
            </div>
            {STAT_DEFS.map(def => (
              <div
                key={def.key}
                title={def.title}
                className="flex flex-col items-center justify-center px-4 border-l border-border/60 min-w-[72px]"
              >
                <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">{def.label}</span>
                <span className="text-sm font-bold tabular-nums">
                  {loading ? '·' : `${stats[def.key]}${'pct' in def && def.pct ? '%' : ''}`}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1 px-2 border-l border-border/60">
        {!program && (
          <div className="hidden sm:flex rounded-md border border-border overflow-hidden">
            {PROGRAM_FILTERS.map(f => (
              <button
                key={f}
                onClick={() => changeFilter(f)}
                className={cn(
                  'px-2 py-1 text-[11px] font-semibold transition-colors',
                  filter === f
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {f}
              </button>
            ))}
          </div>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={fetchWindow}
          title="Refresh metrics"
        >
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </Button>
      </div>
    </div>
  );
}

export type { PeriodDef };
