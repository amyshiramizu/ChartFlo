import { useEffect, useMemo, useState } from 'react';
import { PageLayout } from '@/components/MobileLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, RefreshCw, Save, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useClinic } from '@/hooks/useClinic';
import { toast } from 'sonner';
import { currentMonthString } from '@/lib/billingEngine';

interface Row {
  patient_id: string;
  patient_name: string;
  mrn?: string;
  codes: Array<{ code: string; units: number; revenue: number; program: string; minutes: number }>;
  projected_revenue: number;
  apcm_recommended: boolean;
  apcm_level: string;
  chronic_condition_count: number;
  enrolled_programs: string[];
}

export default function BillingPage() {
  const { activeClinic } = useClinic();
  const [month, setMonth] = useState(currentMonthString());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async (persist = false) => {
    if (persist) setSaving(true); else setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('compute-monthly-superbill', {
        body: { month, clinicId: activeClinic?.id, persist },
      });
      if (error) throw error;
      setRows(data?.rows || []);
      if (persist) toast.success('Superbill finalized');
    } catch (e: any) {
      toast.error(e.message || 'Failed to compute');
    } finally {
      setLoading(false); setSaving(false);
    }
  };

  useEffect(() => { load(false); /* eslint-disable-next-line */ }, [month, activeClinic?.id]);

  const totals = useMemo(() => {
    const projected = rows.reduce((s, r) => s + r.projected_revenue, 0);
    const apcmAdds = rows.filter(r => r.apcm_recommended).length;
    return { projected, apcmAdds };
  }, [rows]);

  const exportCsv = () => {
    const header = ['Patient', 'MRN', 'Code', 'Units', 'Program', 'Minutes', 'Revenue', 'APCM Recommended'];
    const lines = [header.join(',')];
    rows.forEach(r => {
      if (!r.codes.length && r.apcm_recommended) {
        lines.push([r.patient_name, r.mrn || '', r.apcm_level, 1, 'APCM', '', '', 'YES'].join(','));
      }
      r.codes.forEach(c => {
        lines.push([
          `"${r.patient_name}"`, r.mrn || '', c.code, c.units, c.program, c.minutes,
          c.revenue.toFixed(2), r.apcm_recommended ? 'YES' : ''
        ].join(','));
      });
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `superbill-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <PageLayout>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-2xl font-semibold">End-of-Month Superbill</h1>
            <p className="text-sm text-muted-foreground">Projected billable codes and revenue for every enrolled patient.</p>
          </div>
          <div className="ml-auto flex items-end gap-2">
            <Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="w-44" />
            <Button variant="outline" onClick={() => load(false)} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
              <Download className="w-4 h-4 mr-2" /> CSV
            </Button>
            <Button onClick={() => load(true)} disabled={saving || !rows.length}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Finalize
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="p-4"><div className="text-xs text-muted-foreground">Projected revenue</div><div className="text-2xl font-mono font-semibold">${totals.projected.toFixed(2)}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">Patients billable</div><div className="text-2xl font-semibold">{rows.length}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">APCM-recommended</div><div className="text-2xl font-semibold">{totals.apcmAdds}</div></Card>
        </div>

        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="text-left p-2">Patient</th>
                <th className="text-left p-2">Codes</th>
                <th className="text-right p-2">Revenue</th>
                <th className="text-left p-2">APCM</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="p-8 text-center text-muted-foreground"><Loader2 className="inline w-4 h-4 animate-spin mr-2" />Computing…</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No billable activity for {month}.</td></tr>
              ) : rows.map(r => (
                <tr key={r.patient_id} className="border-t">
                  <td className="p-2">
                    <div className="font-medium">{r.patient_name}</div>
                    {r.mrn && <div className="text-xs text-muted-foreground font-mono">{r.mrn}</div>}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {r.codes.map((c, i) => (
                        <Badge key={i} variant="secondary" className="font-mono text-[10px]">
                          {c.code}×{c.units} · {c.program} · {c.minutes}m
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="p-2 text-right font-mono">${r.projected_revenue.toFixed(2)}</td>
                  <td className="p-2">
                    {r.apcm_recommended && (
                      <Badge variant="default" className="gap-1"><Sparkles className="w-3 h-3" /> {r.apcm_level}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </PageLayout>
  );
}
