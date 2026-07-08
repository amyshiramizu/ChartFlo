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

export default function PeriodMetricsBar({ program }: { program: 'CCM' | 'RPM' }) {
  const { patients } = usePatientStore();
  const [entries, setEntries] = useState<MetricEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => new Date(), []);
  const periods = useMemo(() => buildPeriods(today), [today]);

  const fetchWindow = useCallback(async () => {
    setLoading(true);
    const { start, end } = metricsWindow(today);
    const { data, error } = await supabase
      .from('ccm_time_entries')
      .select('patient_id, date, minutes')
      .eq('program', program)
      .gte('date', start)
      .lte('date', end);
    if (error) console.error('Failed to fetch period metrics:', error);
    else setEntries((data || []) as MetricEntry[]);
    setLoading(false);
  }, [program, today]);

  useEffect(() => { fetchWindow(); }, [fetchWindow]);

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
      <div className="flex items-center px-2 border-l border-border/60">
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
