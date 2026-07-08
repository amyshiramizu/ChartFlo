import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, TrendingUp, Sparkles } from 'lucide-react';
import { computeMonthlyBillable, currentMonthString, type MonthlyBillable } from '@/lib/billingEngine';
import { optimizeApcmVsCcm } from '@/lib/apcmOptimizer';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  patientId: string;
  chronicConditionCount?: number;
  isQmbOrDual?: boolean;
}

export function BillingMeterCard({ patientId, chronicConditionCount = 0, isQmbOrDual = false }: Props) {
  const [bill, setBill] = useState<MonthlyBillable | null>(null);
  const [loading, setLoading] = useState(true);
  const month = currentMonthString();

  const load = async () => {
    setLoading(true);
    const b = await computeMonthlyBillable(patientId, month);
    setBill(b);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`billing-meter-${patientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ccm_time_entries', filter: `patient_id=eq.${patientId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const apcm = useMemo(() => bill ? optimizeApcmVsCcm(bill, { chronicConditionCount, isQmbOrDual }) : null, [bill, chronicConditionCount, isQmbOrDual]);

  if (loading || !bill) {
    return (
      <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Computing billing eligibility…
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="w-4 h-4 text-primary" />
          Billing meter — {month}
        </div>
        <div className="text-sm font-mono">${bill.totalRevenue.toFixed(2)}</div>
      </div>

      <div className="space-y-2">
        {bill.programs.filter(p => p.minutesAccrued > 0 || p.nextThreshold).map(p => {
          const next = p.nextThreshold;
          const denom = next ? p.minutesAccrued + next.minutes : Math.max(p.minutesAccrued, 1);
          const pct = Math.min(100, (p.minutesAccrued / denom) * 100);
          return (
            <div key={p.program} className="text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">{p.program} — {p.minutesAccrued} min</span>
                <span className="text-muted-foreground">
                  {next ? `+${next.minutes} min → ${next.code} (+$${next.addsRevenue.toFixed(2)})` : 'max codes unlocked'}
                </span>
              </div>
              <Progress value={pct} className="h-1.5 mt-1" />
              {p.unlocked.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {p.unlocked.map(c => (
                    <Badge key={c.code} variant="secondary" className="text-[10px] font-mono">
                      {c.code}×{c.units} · ${c.revenue.toFixed(0)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {apcm && apcm.recommend !== 'CCM_STACK' && (
        <div className="text-xs p-2 rounded-md bg-primary/5 border border-primary/20 flex gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">APCM optimizer</div>
            <div className="text-muted-foreground">{apcm.reason}</div>
          </div>
        </div>
      )}
    </Card>
  );
}
