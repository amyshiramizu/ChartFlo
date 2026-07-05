import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  CalendarClock,
  Stethoscope,
  Pill,
  ClipboardList,
  Activity,
  ChevronDown,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  patientId: string;
  /** Compact sidebar variant (used inside NoteEditor) vs full tab variant */
  compact?: boolean;
  /** Refresh trigger — bump to force re-fetch (e.g., after saving a note) */
  refreshKey?: number;
}

interface Note {
  id: string;
  date: string;
  type: string | null;
  author: string | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
}
interface Problem { id: string; description: string; icd_code: string | null; created_at: string; }
interface Med {
  id: string; name: string; dosage: string | null; frequency: string | null;
  route: string | null; active: boolean; prescribed_date: string | null;
}
interface Vital {
  id: string; recorded_at: string;
  blood_pressure: string | null; heart_rate: string | null;
  o2_saturation: string | null; weight: string | null;
}

interface TimelineEntry {
  date: string; // ISO date for sorting
  kind: 'note' | 'problem' | 'med-start' | 'med-stop' | 'vitals';
  payload: any;
}

export function PatientTimeline({ patientId, compact = false, refreshKey = 0 }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [meds, setMeds] = useState<Med[]>([]);
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [n, p, m, v] = await Promise.all([
        supabase.from('clinical_notes').select('id,date,type,author,subjective,objective,assessment,plan')
          .eq('patient_id', patientId).order('date', { ascending: false }).limit(compact ? 5 : 100),
        supabase.from('patient_problems').select('id,description,icd_code,created_at')
          .eq('patient_id', patientId).order('created_at', { ascending: false }),
        supabase.from('medications').select('id,name,dosage,frequency,route,active,prescribed_date')
          .eq('patient_id', patientId).order('prescribed_date', { ascending: false }),
        supabase.from('patient_vitals').select('id,recorded_at,blood_pressure,heart_rate,o2_saturation,weight')
          .eq('patient_id', patientId).order('recorded_at', { ascending: false }).limit(compact ? 3 : 30),
      ]);
      if (cancelled) return;
      setNotes((n.data || []) as Note[]);
      setProblems((p.data || []) as Problem[]);
      setMeds((m.data || []) as Med[]);
      setVitals((v.data || []) as Vital[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [patientId, refreshKey, compact]);

  const activeMeds = useMemo(() => meds.filter(m => m.active), [meds]);

  const entries = useMemo<TimelineEntry[]>(() => {
    const out: TimelineEntry[] = [];
    notes.forEach(n => out.push({ date: n.date, kind: 'note', payload: n }));
    problems.forEach(p => out.push({ date: p.created_at, kind: 'problem', payload: p }));
    meds.forEach(m => {
      if (m.prescribed_date) out.push({ date: m.prescribed_date, kind: 'med-start', payload: m });
    });
    vitals.forEach(v => out.push({ date: v.recorded_at, kind: 'vitals', payload: v }));
    return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [notes, problems, meds, vitals]);

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading timeline…</div>;
  }

  // ---------- Compact sidebar variant ----------
  if (compact) {
    return (
      <Card className="p-3 space-y-3 text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-sm">
          <CalendarClock className="w-4 h-4 text-primary" />
          Patient History
        </div>

        <Section icon={<Stethoscope className="w-3 h-3" />} label={`Active problems (${problems.length})`}>
          {problems.length === 0 ? (
            <Empty>None recorded</Empty>
          ) : (
            <ul className="space-y-0.5">
              {problems.slice(0, 8).map(p => (
                <li key={p.id} className="text-foreground">
                  {p.icd_code && <span className="font-mono text-[10px] text-muted-foreground mr-1">{p.icd_code}</span>}
                  {p.description}
                </li>
              ))}
              {problems.length > 8 && <li className="text-muted-foreground italic">+{problems.length - 8} more</li>}
            </ul>
          )}
        </Section>

        <Section icon={<Pill className="w-3 h-3" />} label={`Current meds (${activeMeds.length})`}>
          {activeMeds.length === 0 ? (
            <Empty>None active</Empty>
          ) : (
            <ul className="space-y-0.5">
              {activeMeds.slice(0, 8).map(m => (
                <li key={m.id}>
                  <span className="text-foreground">{m.name}</span>
                  {(m.dosage || m.frequency) && (
                    <span className="text-muted-foreground"> — {[m.dosage, m.frequency].filter(Boolean).join(' ')}</span>
                  )}
                </li>
              ))}
              {activeMeds.length > 8 && <li className="text-muted-foreground italic">+{activeMeds.length - 8} more</li>}
            </ul>
          )}
        </Section>

        <Section icon={<FileText className="w-3 h-3" />} label={`Recent visits (${notes.length})`}>
          {notes.length === 0 ? (
            <Empty>No prior visits</Empty>
          ) : (
            <ul className="space-y-1.5">
              {notes.slice(0, 4).map(n => (
                <li key={n.id} className="border-l-2 border-primary/40 pl-2">
                  <div className="font-medium text-foreground">
                    {new Date(n.date).toLocaleDateString()}
                    {n.type && <Badge variant="outline" className="ml-1 text-[10px] py-0">{n.type}</Badge>}
                  </div>
                  {n.assessment && (
                    <div className="text-muted-foreground line-clamp-2 mt-0.5">{n.assessment.slice(0, 140)}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <p className="text-[10px] text-muted-foreground italic pt-1 border-t">
          New dictations append to this running record — nothing is overwritten.
        </p>
      </Card>
    );
  }

  // ---------- Full tab variant ----------
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryCard
          icon={<Stethoscope className="w-4 h-4" />}
          label="Active problems"
          count={problems.length}
          items={problems.slice(0, 6).map(p => `${p.icd_code ? p.icd_code + ' · ' : ''}${p.description}`)}
        />
        <SummaryCard
          icon={<Pill className="w-4 h-4" />}
          label="Current medications"
          count={activeMeds.length}
          items={activeMeds.slice(0, 6).map(m => `${m.name}${m.dosage ? ' ' + m.dosage : ''}${m.frequency ? ' · ' + m.frequency : ''}`)}
        />
        <SummaryCard
          icon={<Activity className="w-4 h-4" />}
          label="Visits on record"
          count={notes.length}
          items={notes.slice(0, 6).map(n => `${new Date(n.date).toLocaleDateString()} — ${(n.assessment || n.subjective || '').slice(0, 60) || '(no summary)'}`)}
        />
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <CalendarClock className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">Chronological timeline</h3>
          <Badge variant="secondary" className="ml-auto text-xs">{entries.length} events</Badge>
        </div>

        <ScrollArea className="h-[60vh] pr-3">
          <ol className="relative border-l-2 border-border ml-3 space-y-4">
            {entries.length === 0 && (
              <li className="text-sm text-muted-foreground pl-4">No history yet — start dictating to build the timeline.</li>
            )}
            {entries.map((e, i) => (
              <TimelineRow key={`${e.kind}-${i}`} entry={e} />
            ))}
          </ol>
        </ScrollArea>
      </Card>
    </div>
  );
}

function Section({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-muted-foreground font-medium mb-1">
        {icon}
        <span className="uppercase tracking-wide text-[10px]">{label}</span>
      </div>
      <div className="pl-4">{children}</div>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground italic">{children}</p>;
}

function SummaryCard({ icon, label, count, items }: {
  icon: React.ReactNode; label: string; count: number; items: string[];
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {label}
        <Badge variant="secondary" className="ml-auto text-xs">{count}</Badge>
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        {items.length === 0 && <li className="italic">None</li>}
        {items.map((t, i) => <li key={i} className="truncate">• {t}</li>)}
      </ul>
    </Card>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const date = new Date(entry.date);
  const dateLabel = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  const dotColor = {
    note: 'bg-primary',
    problem: 'bg-destructive',
    'med-start': 'bg-emerald-500',
    'med-stop': 'bg-muted-foreground',
    vitals: 'bg-blue-500',
  }[entry.kind];

  return (
    <li className="pl-4 relative">
      <span className={cn('absolute -left-[7px] top-1.5 w-3 h-3 rounded-full ring-4 ring-background', dotColor)} />
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-mono text-muted-foreground">{dateLabel}</span>
        <KindBadge kind={entry.kind} />
      </div>
      {entry.kind === 'note' && <NoteBlock note={entry.payload} />}
      {entry.kind === 'problem' && (
        <p className="text-sm">
          {entry.payload.icd_code && <span className="font-mono text-xs text-muted-foreground mr-1">{entry.payload.icd_code}</span>}
          {entry.payload.description}
        </p>
      )}
      {entry.kind === 'med-start' && (
        <p className="text-sm">
          <span className="font-medium">{entry.payload.name}</span>
          {entry.payload.dosage && <span className="text-muted-foreground"> · {entry.payload.dosage}</span>}
          {entry.payload.frequency && <span className="text-muted-foreground"> · {entry.payload.frequency}</span>}
          {!entry.payload.active && <Badge variant="outline" className="ml-2 text-xs">discontinued</Badge>}
        </p>
      )}
      {entry.kind === 'vitals' && (
        <p className="text-sm text-muted-foreground">
          {[
            entry.payload.blood_pressure && `BP ${entry.payload.blood_pressure}`,
            entry.payload.heart_rate && `HR ${entry.payload.heart_rate}`,
            entry.payload.o2_saturation && `SpO₂ ${entry.payload.o2_saturation}`,
            entry.payload.weight && `Wt ${entry.payload.weight}`,
          ].filter(Boolean).join(' · ') || 'Vitals recorded'}
        </p>
      )}
    </li>
  );
}

function NoteBlock({ note }: { note: Note }) {
  const [open, setOpen] = useState(false);
  const preview = (note.assessment || note.subjective || note.plan || '').slice(0, 180);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-start gap-1 text-left w-full group">
        <ChevronDown className={cn('w-3.5 h-3.5 mt-1 transition-transform shrink-0', open && 'rotate-180')} />
        <div className="flex-1">
          <div className="text-sm font-medium">
            {note.type ? note.type.toUpperCase() : 'Note'}
            {note.author && <span className="text-muted-foreground font-normal"> · {note.author}</span>}
          </div>
          {!open && preview && (
            <p className="text-xs text-muted-foreground line-clamp-2">{preview}</p>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2 text-xs">
        {note.subjective && <NoteField label="S" text={note.subjective} />}
        {note.objective && <NoteField label="O" text={note.objective} />}
        {note.assessment && <NoteField label="A" text={note.assessment} />}
        {note.plan && <NoteField label="P" text={note.plan} />}
      </CollapsibleContent>
    </Collapsible>
  );
}

function NoteField({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex gap-2">
      <span className="font-bold text-primary w-4 shrink-0">{label}</span>
      <p className="whitespace-pre-wrap text-muted-foreground flex-1">{text}</p>
    </div>
  );
}

function KindBadge({ kind }: { kind: TimelineEntry['kind'] }) {
  const map: Record<TimelineEntry['kind'], { label: string; variant: any }> = {
    note: { label: 'Visit note', variant: 'default' },
    problem: { label: 'Problem added', variant: 'destructive' },
    'med-start': { label: 'Med started', variant: 'secondary' },
    'med-stop': { label: 'Med stopped', variant: 'outline' },
    vitals: { label: 'Vitals', variant: 'secondary' },
  };
  const m = map[kind];
  return <Badge variant={m.variant} className="text-[10px] py-0 px-1.5">{m.label}</Badge>;
}
