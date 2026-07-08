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
  { key: 'patients', label: 'Pts', title: 'Distinct patients with time logged in this period' },
  { key: 'compliancePct', label: 'Compl', title: 'Patients with time logged this period, as a share of all patients', pct: true },
  { key: 'billablePct', label: 'Billable', title: 'Patients worked this period who have reached 20 billable minutes month-to-date, as a share of all patients', pct: true },
] as const;

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
    <div className="flex items-center gap-2">
      <div className="flex-1 flex gap-2 overflow-x-auto pb-1 -mb-1">
        {metrics.map(({ period, stats }) => (
          <PeriodCard key={period.key} period={period} stats={stats} loading={loading} />
        ))}
      </div>
      <Button
        size="icon"
        variant="outline"
        className="h-9 w-9 shrink-0"
        onClick={fetchWindow}
        title="Refresh metrics"
      >
        <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
      </Button>
    </div>
  );
}

function PeriodCard({ period, stats, loading }: {
  period: PeriodDef;
  stats: ReturnType<typeof computePeriodMetrics>;
  loading: boolean;
}) {
  const isToday = period.key === 'today';
  return (
    <div
      className={cn(
        'flex shrink-0 rounded-lg border overflow-hidden bg-card shadow-sm',
        isToday ? 'border-primary/60 ring-1 ring-primary/30' : 'border-border',
      )}
    >
      <div
        className={cn(
          'flex items-center px-3 text-xs font-bold leading-tight',
          isToday ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-foreground',
        )}
      >
        <span className="whitespace-pre-line">{period.label.replace(' ', '\n')}</span>
      </div>
      {STAT_DEFS.map(def => (
        <div
          key={def.key}
          title={def.title}
          className="flex flex-col items-center justify-center px-3 py-1.5 border-l border-border/60 min-w-[58px]"
        >
          <span className="text-[10px] font-medium text-muted-foreground truncate max-w-[64px]">{def.label}</span>
          <span className="text-sm font-bold tabular-nums">
            {loading ? '·' : `${stats[def.key]}${'pct' in def && def.pct ? '%' : ''}`}
          </span>
        </div>
      ))}
    </div>
  );
}
