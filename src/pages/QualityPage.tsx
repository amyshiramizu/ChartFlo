import { useEffect, useMemo, useState } from 'react';
import { PageLayout } from '@/components/MobileLayout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useClinic } from '@/hooks/useClinic';
import { Link } from 'react-router-dom';
import { evaluateAllMeasures, QUALITY_MEASURES, type QualityPatientContext, type MeasureResult } from '@/lib/qualityMeasures';

interface AggMeasure {
  id: string;
  label: string;
  description: string;
  numerator: number;
  denominator: number;
  gaps: Array<{ patientId: string; name: string }>;
  gapAction?: string;
}

function ageFromDob(dob?: string): number | undefined {
  if (!dob) return undefined;
  const d = new Date(dob);
  if (isNaN(+d)) return undefined;
  return Math.floor((Date.now() - +d) / (365.25 * 86400000));
}

export default function QualityPage() {
  const { activeClinic } = useClinic();
  const [loading, setLoading] = useState(true);
  const [measures, setMeasures] = useState<AggMeasure[]>([]);
  const [selected, setSelected] = useState<AggMeasure | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const q = supabase.from('patients').select('id,first_name,last_name,dob,gender,clinic_id');
        const { data: patients } = activeClinic?.id ? await q.eq('clinic_id', activeClinic.id) : await q;
        const ids = (patients || []).map(p => p.id);
        if (!ids.length) { setMeasures([]); setLoading(false); return; }

        const [{ data: problems }, { data: meds }, { data: vitals }, { data: assess }, { data: timeEntries }] = await Promise.all([
          supabase.from('patient_problems').select('patient_id,description,status').in('patient_id', ids),
          supabase.from('medications').select('patient_id,name,active').in('patient_id', ids),
          supabase.from('patient_vitals').select('*').in('patient_id', ids),
          supabase.from('patient_assessments').select('patient_id,assessment_type,completed_at,status').in('patient_id', ids),
          supabase.from('ccm_time_entries').select('patient_id,date,description').in('patient_id', ids).gte('date', `${new Date().getFullYear()}-01-01`),
        ]);

        const yearAwvByPatient = new Set(
          (timeEntries || []).filter((t: any) => (t.description || '').toLowerCase().includes('awv')).map((t: any) => t.patient_id)
        );

        const byPatient: Record<string, QualityPatientContext> = {};
        (patients || []).forEach((p: any) => {
          byPatient[p.id] = {
            patientId: p.id,
            age: ageFromDob(p.dob),
            sex: p.gender,
            problems: [],
            meds: [],
            vitals: [],
            assessments: [],
            awvBilledThisYear: yearAwvByPatient.has(p.id),
          };
        });
        (problems || []).forEach((x: any) => { if (byPatient[x.patient_id] && (x.status || 'active') === 'active') byPatient[x.patient_id].problems.push(x.description); });
        (meds || []).forEach((x: any) => { byPatient[x.patient_id]?.meds.push({ name: x.name, active: x.active }); });
        (vitals || []).forEach((x: any) => {
          const pt = byPatient[x.patient_id]; if (!pt) return;
          const date = x.recorded_at || x.created_at;
          // blood_pressure stored as "120/80"
          if (typeof x.blood_pressure === 'string' && x.blood_pressure.includes('/')) {
            const [sys, dia] = x.blood_pressure.split('/').map((s: string) => Number(s.trim()));
            if (!isNaN(sys)) pt.vitals.push({ type: 'systolic', value: sys, date });
            if (!isNaN(dia)) pt.vitals.push({ type: 'diastolic', value: dia, date });
          }
          if (x.a1c != null) pt.vitals.push({ type: 'a1c', value: Number(x.a1c), date });
          if (x.weight != null) pt.vitals.push({ type: 'weight', value: Number(x.weight), date });
        });
        (assess || []).forEach((x: any) => { byPatient[x.patient_id]?.assessments.push({ type: x.assessment_type, completed_at: x.completed_at, status: x.status }); });

        const nameOf = (id: string) => {
          const p: any = (patients || []).find((x: any) => x.id === id);
          return p ? `${p.first_name} ${p.last_name}` : id;
        };

        const agg: Record<string, AggMeasure> = {};
        QUALITY_MEASURES.forEach(m => {
          agg[m.id] = { id: m.id, label: m.label, description: m.description, numerator: 0, denominator: 0, gaps: [], gapAction: m.gapAction };
        });
        Object.values(byPatient).forEach(ctx => {
          const res = evaluateAllMeasures(ctx);
          res.forEach((r: MeasureResult) => {
            if (!r.inDenom) return;
            agg[r.measure.id].denominator++;
            if (r.meets) agg[r.measure.id].numerator++;
            else agg[r.measure.id].gaps.push({ patientId: ctx.patientId, name: nameOf(ctx.patientId) });
          });
        });
        setMeasures(Object.values(agg));
      } finally { setLoading(false); }
    };
    load();
  }, [activeClinic?.id]);

  if (loading) return <PageLayout><div className="p-8 text-center text-muted-foreground"><Loader2 className="inline w-4 h-4 animate-spin mr-2" />Computing quality measures…</div></PageLayout>;

  return (
    <PageLayout>
      <div className="p-4 md:p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Quality Measures</h1>
          <p className="text-sm text-muted-foreground">MIPS/HEDIS-style measures computed from your charts. Click a measure to see open gaps.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {measures.map(m => {
            const pct = m.denominator ? Math.round((m.numerator / m.denominator) * 100) : 0;
            const tone = pct >= 80 ? 'default' : pct >= 60 ? 'secondary' : 'destructive';
            return (
              <Card key={m.id} className="p-4 cursor-pointer hover:bg-accent/40" onClick={() => setSelected(m)}>
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sm">{m.label}</div>
                  <Badge variant={tone as any} className="font-mono">{pct}%</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{m.numerator} / {m.denominator} patients</div>
                <Progress value={pct} className="h-1.5 mt-2" />
                {m.gaps.length > 0 && (
                  <div className="text-xs text-amber-700 dark:text-amber-400 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {m.gaps.length} open gaps
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {selected && (
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{selected.label} — open gaps ({selected.gaps.length})</div>
                {selected.gapAction && <div className="text-xs text-muted-foreground mt-1">Suggested action: {selected.gapAction}</div>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Close</Button>
            </div>
            <ul className="mt-3 divide-y">
              {selected.gaps.map(g => (
                <li key={g.patientId}>
                  <Link to={`/patient/${g.patientId}`} className="flex items-center justify-between py-2 hover:bg-accent/40 px-2 rounded text-sm">
                    <span>{g.name}</span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
