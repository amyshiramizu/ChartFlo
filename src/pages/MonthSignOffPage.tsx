import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageLayout } from '@/components/MobileLayout';
import { supabase } from '@/integrations/supabase/client';
import { usePatientStore } from '@/store/patientStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { CheckCircle2, ClipboardCheck, Loader2, Lock } from 'lucide-react';

interface TimeEntry {
  patient_id: string;
  user_id: string | null;
  staff: string | null;
  minutes: number;
  program: string;
  date: string;
}

interface Signoff {
  patient_id: string;
  minutes_at_signoff: number;
  signed_by_name: string;
  created_at: string;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function lastNMonths(n: number): { key: string; label: string }[] {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: monthKey(d), label: d.toLocaleString('default', { month: 'long', year: 'numeric' }) });
  }
  return out;
}

export default function MonthSignOffPage() {
  const { patients, fetchPatients } = usePatientStore();
  const [month, setMonth] = useState(monthKey(new Date()));
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [signoffs, setSignoffs] = useState<Map<string, Signoff>>(new Map());
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState<string | null>(null);

  useEffect(() => { if (patients.length === 0) fetchPatients(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true);
    const start = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const end = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

    const [entriesRes, signoffsRes] = await Promise.all([
      supabase.from('ccm_time_entries')
        .select('patient_id, user_id, staff, minutes, program, date')
        .gte('date', start).lte('date', end),
      supabase.from('month_signoffs' as any)
        .select('patient_id, minutes_at_signoff, signed_by_name, created_at')
        .eq('month', month),
    ]);
    setEntries((entriesRes.data || []) as TimeEntry[]);
    const soMap = new Map<string, Signoff>();
    ((signoffsRes.data || []) as unknown as Signoff[]).forEach(s => soMap.set(s.patient_id, s));
    setSignoffs(soMap);

    // Resolve user_id -> display name for the per-user rollup
    const ids = Array.from(new Set((entriesRes.data || []).map((e: any) => e.user_id).filter(Boolean)));
    if (ids.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', ids);
      setUserNames(new Map((profiles || []).map((p: any) => [p.user_id, p.full_name || p.email || p.user_id.slice(0, 8)])));
    }
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const enrolledIds = useMemo(() => new Set(patients.map(p => p.id)), [patients]);

  // ── Per chart (patient) rollup ──
  const perChart = useMemo(() => {
    const map = new Map<string, { minutes: number; entries: number; programs: Set<string> }>();
    for (const e of entries) {
      if (!enrolledIds.has(e.patient_id)) continue;
      const x = map.get(e.patient_id) || { minutes: 0, entries: 0, programs: new Set<string>() };
      x.minutes += e.minutes; x.entries += 1; x.programs.add(e.program);
      map.set(e.patient_id, x);
    }
    return Array.from(map.entries()).map(([patientId, x]) => {
      const p = patients.find(pt => pt.id === patientId);
      return {
        patientId,
        name: p ? `${p.lastName}, ${p.firstName}` : 'Unknown',
        minutes: x.minutes,
        entries: x.entries,
        programs: Array.from(x.programs).join(', '),
        signoff: signoffs.get(patientId),
      };
    }).sort((a, b) => b.minutes - a.minutes);
  }, [entries, patients, enrolledIds, signoffs]);

  // ── Per user (staff) rollup ──
  const perUser = useMemo(() => {
    const map = new Map<string, { minutes: number; entries: number; charts: Set<string> }>();
    for (const e of entries) {
      if (!enrolledIds.has(e.patient_id)) continue;
      // Prefer the free-text staff attribution when present; fall back to the login user
      const key = (e.staff && e.staff.trim()) || (e.user_id ? `uid:${e.user_id}` : 'Unattributed');
      const x = map.get(key) || { minutes: 0, entries: 0, charts: new Set<string>() };
      x.minutes += e.minutes; x.entries += 1; x.charts.add(e.patient_id);
      map.set(key, x);
    }
    return Array.from(map.entries()).map(([key, x]) => ({
      name: key.startsWith('uid:') ? (userNames.get(key.slice(4)) || 'Unknown user') : key,
      minutes: x.minutes,
      entries: x.entries,
      charts: x.charts.size,
    })).sort((a, b) => b.minutes - a.minutes);
  }, [entries, enrolledIds, userNames]);

  const totalMinutes = perChart.reduce((s, c) => s + c.minutes, 0);
  const signedCount = perChart.filter(c => c.signoff).length;
  const pendingCount = perChart.length - signedCount;

  async function signOff(patientId: string, name: string, minutes: number) {
    setSigning(patientId);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSigning(null); return; }
    const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('user_id', user.id).maybeSingle();
    const { error } = await supabase.from('month_signoffs' as any).insert({
      patient_id: patientId,
      month,
      minutes_at_signoff: minutes,
      signed_by: user.id,
      signed_by_name: profile?.full_name || profile?.email || 'Unknown',
    });
    setSigning(null);
    if (error) {
      toast.error(error.message.includes('duplicate') || error.message.includes('unique')
        ? 'Already signed off for this month'
        : `Sign-off failed: ${error.message}. If you just added this feature, run the latest database migration in Supabase.`);
      return;
    }
    toast.success(`${name} signed off for ${month} (${minutes} min)`);
    load();
  }

  async function signOffAll() {
    const pending = perChart.filter(c => !c.signoff);
    if (pending.length === 0) return;
    if (!confirm(`Sign off ${pending.length} chart${pending.length > 1 ? 's' : ''} for ${month}? This attests the logged time is accurate and ready for billing.`)) return;
    for (const c of pending) {
      await signOff(c.patientId, c.name, c.minutes);
    }
  }

  return (
    <PageLayout>
      <div className="flex-1 p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2">
                <ClipboardCheck className="w-6 h-6 text-primary" /> Month Sign Off
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Review logged minutes per chart and per staff member, then sign off each chart for billing.
              </p>
            </div>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {lastNMonths(12).map(m => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4"><p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Minutes</p><p className="text-2xl font-bold font-mono">{totalMinutes}</p></Card>
            <Card className="p-4"><p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Charts Worked</p><p className="text-2xl font-bold font-mono">{perChart.length}</p></Card>
            <Card className="p-4"><p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Signed Off</p><p className="text-2xl font-bold font-mono text-emerald-600">{signedCount}</p></Card>
            <Card className="p-4"><p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Pending</p><p className="text-2xl font-bold font-mono text-amber-600">{pendingCount}</p></Card>
          </div>

          <Tabs defaultValue="charts">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <TabsList>
                <TabsTrigger value="charts">Per Chart</TabsTrigger>
                <TabsTrigger value="users">Per User</TabsTrigger>
              </TabsList>
              {pendingCount > 0 && (
                <Button onClick={signOffAll} className="gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Sign Off All Pending ({pendingCount})
                </Button>
              )}
            </div>

            <TabsContent value="charts" className="mt-4">
              <Card className="p-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Patient</TableHead><TableHead>Programs</TableHead>
                        <TableHead className="text-right">Entries</TableHead>
                        <TableHead className="text-right">Minutes</TableHead>
                        <TableHead>Status</TableHead><TableHead className="w-32" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {perChart.map(c => (
                        <TableRow key={c.patientId}>
                          <TableCell>
                            <Link to={`/ccm/patient/${c.patientId}`} className="font-medium hover:underline">{c.name}</Link>
                          </TableCell>
                          <TableCell>{c.programs}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.entries}</TableCell>
                          <TableCell className="text-right font-bold tabular-nums">{c.minutes}</TableCell>
                          <TableCell>
                            {c.signoff
                              ? <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600" title={`Signed by ${c.signoff.signed_by_name} on ${new Date(c.signoff.created_at).toLocaleDateString()} at ${c.signoff.minutes_at_signoff} min`}>
                                  <Lock className="w-3 h-3" /> Signed
                                </Badge>
                              : <Badge variant="outline" className="text-amber-600 border-amber-300">Pending</Badge>}
                          </TableCell>
                          <TableCell>
                            {!c.signoff && (
                              <Button size="sm" variant="outline" disabled={signing === c.patientId}
                                onClick={() => signOff(c.patientId, c.name, c.minutes)} className="gap-1.5">
                                {signing === c.patientId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                Sign Off
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {perChart.length === 0 && !loading && (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No time logged in this month.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="users" className="mt-4">
              <Card className="p-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Staff Member</TableHead>
                        <TableHead className="text-right">Charts Touched</TableHead>
                        <TableHead className="text-right">Entries</TableHead>
                        <TableHead className="text-right">Minutes</TableHead>
                        <TableHead className="text-right">Avg Min / Chart</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {perUser.map(u => (
                        <TableRow key={u.name}>
                          <TableCell className="font-medium">{u.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{u.charts}</TableCell>
                          <TableCell className="text-right tabular-nums">{u.entries}</TableCell>
                          <TableCell className="text-right font-bold tabular-nums">{u.minutes}</TableCell>
                          <TableCell className="text-right tabular-nums">{u.charts > 0 ? Math.round(u.minutes / u.charts) : 0}</TableCell>
                        </TableRow>
                      ))}
                      {perUser.length === 0 && !loading && (
                        <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No time logged in this month.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </PageLayout>
  );
}
