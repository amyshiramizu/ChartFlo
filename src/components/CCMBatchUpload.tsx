import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { Upload, FileJson, Send, CheckCircle2, FileText } from 'lucide-react';
import { sendSOAPToExtension, isExtensionAvailable } from '@/lib/practiceFusionBridge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useClinic } from '@/hooks/useClinic';
import { normalizeDob } from '@/lib/pfDob';

interface TimeEntry {
  id: string;
  patient_id: string;
  date: string;
  minutes: number;
  staff: string | null;
  description: string | null;
  program: string;
}

interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  dob: string;
  mrn: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: TimeEntry[];
  patients: Patient[];
  month: string;
  year: number;
}

interface GeneratedNote {
  patientId: string;
  patientName: string;
  mrn: string;
  date: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  totalMinutes: number;
  program: string;
  selected: boolean;
  pushed: boolean;
}

export default function CCMBatchUpload({ open, onOpenChange, entries, patients, month, year }: Props) {
  const { user } = useAuth();
  const { activeClinic } = useClinic();
  const [mode, setMode] = useState<'individual' | 'summary'>('summary');
  const [generatedNotes, setGeneratedNotes] = useState<GeneratedNote[]>([]);
  const [pushing, setPushing] = useState(false);
  const [exportFormat, setExportFormat] = useState<'extension' | 'fhir'>('extension');

  // Group entries by patient
  const patientGroups = useMemo(() => {
    const groups = new Map<string, { patient: Patient | undefined; entries: TimeEntry[]; totalMinutes: number }>();
    entries.forEach(e => {
      const existing = groups.get(e.patient_id) || {
        patient: patients.find(p => p.id === e.patient_id),
        entries: [],
        totalMinutes: 0,
      };
      existing.entries.push(e);
      existing.totalMinutes += e.minutes;
      groups.set(e.patient_id, existing);
    });
    return groups;
  }, [entries, patients]);

  function generateNotes() {
    const notes: GeneratedNote[] = [];

    if (mode === 'summary') {
      // One note per patient for the month
      patientGroups.forEach((group, patientId) => {
        if (!group.patient || group.totalMinutes === 0) return;
        const p = group.patient;
        const descriptions = group.entries
          .filter(e => e.description)
          .map(e => `${e.date}: ${e.description} (${e.minutes} min)`)
          .join('\n');
        const programs = [...new Set(group.entries.map(e => e.program))].join('/');
        const staffList = [...new Set(group.entries.filter(e => e.staff).map(e => e.staff!))].join(', ');

        notes.push({
          patientId,
          patientName: `${p.lastName}, ${p.firstName}`,
          mrn: p.mrn,
          date: `${year}-${String(new Date(`${month} 1`).getMonth() + 1).padStart(2, '0')}-${String(new Date(year, new Date(`${month} 1`).getMonth() + 1, 0).getDate()).padStart(2, '0')}`,
          subjective: `Monthly ${programs} care management summary for ${month} ${year}.\nTotal time: ${group.totalMinutes} minutes across ${group.entries.length} sessions.\n${staffList ? `Staff involved: ${staffList}` : ''}`,
          objective: `${programs} program - ${group.totalMinutes} total minutes logged.\nNumber of interactions: ${group.entries.length}.\nBilling threshold: ${group.totalMinutes >= 20 ? 'Met (20+ min)' : 'Not met'}${group.totalMinutes >= 40 ? ' | Additional 20 min threshold: Met' : ''}.`,
          assessment: `Patient actively enrolled in ${programs} program. Care management activities performed as documented below.\n\nActivity Log:\n${descriptions || 'No detailed descriptions recorded.'}`,
          plan: `Continue ${programs} care management activities.\nNext month target: maintain ${group.totalMinutes >= 20 ? 'current engagement' : 'increase engagement to meet 20-minute billing threshold'}.`,
          totalMinutes: group.totalMinutes,
          program: programs,
          selected: group.totalMinutes >= 20, // Auto-select billable patients
          pushed: false,
        });
      });
    } else {
      // Individual notes per entry
      entries.forEach(e => {
        const p = patients.find(pt => pt.id === e.patient_id);
        if (!p) return;
        notes.push({
          patientId: e.patient_id,
          patientName: `${p.lastName}, ${p.firstName}`,
          mrn: p.mrn,
          date: e.date,
          subjective: `${e.program} care management session.\n${e.description || 'Routine care management activity.'}`,
          objective: `Time spent: ${e.minutes} minutes.\n${e.staff ? `Staff: ${e.staff}` : ''}`,
          assessment: `${e.program} care management activity completed as documented.`,
          plan: `Continue ${e.program} care management per care plan.`,
          totalMinutes: e.minutes,
          program: e.program,
          selected: true,
          pushed: false,
        });
      });
    }

    setGeneratedNotes(notes.sort((a, b) => a.patientName.localeCompare(b.patientName)));
    toast.success(`${notes.length} notes generated`);
  }

  function toggleNote(index: number) {
    setGeneratedNotes(prev => prev.map((n, i) => i === index ? { ...n, selected: !n.selected } : n));
  }

  function selectAll(val: boolean) {
    setGeneratedNotes(prev => prev.map(n => ({ ...n, selected: val })));
  }

  async function pushToExtension() {
    const selected = generatedNotes.filter(n => n.selected && !n.pushed);
    if (selected.length === 0) { toast.error('No notes selected'); return; }
    if (!user) { toast.error('Sign in first.'); return; }
    if (!activeClinic) { toast.error('Select an active clinic first.'); return; }

    setPushing(true);
    let success = 0;
    let failed = 0;

    for (const note of selected) {
      // Look up patient DOB + verify the patient belongs to the active clinic.
      const { data: pat } = await supabase
        .from('patients')
        .select('dob, clinic_id')
        .eq('id', note.patientId)
        .maybeSingle();

      if (!pat || pat.clinic_id !== activeClinic.id) {
        failed++;
        continue;
      }

      const payload = {
        user_id: user.id,
        clinic_id: activeClinic.id,
        patient_id: note.patientId,
        patient_name: note.patientName,
        mrn: note.mrn,
        patient_dob: normalizeDob(pat.dob),
        encounter_date: note.date,
        minutes: note.totalMinutes,
        program: note.program || 'CCM',
        note: [
          note.subjective && `SUBJECTIVE:\n${note.subjective}`,
          note.objective && `OBJECTIVE:\n${note.objective}`,
          note.assessment && `ASSESSMENT:\n${note.assessment}`,
          note.plan && `PLAN:\n${note.plan}`,
        ].filter(Boolean).join('\n\n'),
        subjective: note.subjective || null,
        objective: note.objective || null,
        assessment: note.assessment || null,
        plan: note.plan || null,
        status: 'pending',
        error: null,
      };

      const up = await supabase.from('pf_push_queue').upsert(payload as any, {
        onConflict: 'user_id,patient_id,encounter_date' as any,
        ignoreDuplicates: false,
      } as any);

      let ok = !up.error;
      if (up.error) {
        const ins = await supabase.from('pf_push_queue').insert(payload as any);
        ok = !ins.error;
      }

      // Also stash the most recent one as the popup "draft" so a single-encounter
      // push from the Push tab still works for the last patient queued.
      if (ok) {
        await sendSOAPToExtension({
          subjective: note.subjective,
          objective: note.objective,
          assessment: note.assessment,
          plan: note.plan,
          patientName: note.patientName,
          mrn: note.mrn,
          date: note.date,
        });
        success++;
        setGeneratedNotes(prev => prev.map(n => n === note ? { ...n, pushed: true } : n));
      } else {
        failed++;
      }
    }

    setPushing(false);
    if (success > 0) {
      toast.success(
        `Queued ${success} note${success === 1 ? '' : 's'} into Practice Fusion. ` +
        `Open each patient's chart in PF — the Chart Flo side panel will auto-fill it.` +
        (failed ? ` (${failed} failed)` : '')
      );
    } else {
      toast.error(`Failed to queue notes${failed ? ` (${failed} failed)` : ''}`);
    }
  }

  async function exportFHIR() {
    const selected = generatedNotes.filter(n => n.selected);
    if (selected.length === 0) { toast.error('No notes selected'); return; }

    // Group by patient for FHIR bundle
    const patientMap = new Map<string, GeneratedNote[]>();
    selected.forEach(n => {
      const existing = patientMap.get(n.patientId) || [];
      existing.push(n);
      patientMap.set(n.patientId, existing);
    });

    const bundles: object[] = [];

    for (const [patientId, notes] of patientMap) {
      const patient = patients.find(p => p.id === patientId);
      if (!patient) continue;

      try {
        const { data, error } = await supabase.functions.invoke('export-fhir', {
          body: {
            firstName: patient.firstName,
            lastName: patient.lastName,
            dob: patient.dob,
            mrn: patient.mrn,
            gender: 'unknown',
            allergies: [],
            medications: [],
            notes: notes.map(n => ({
              date: n.date,
              type: 'soap',
              subjective: n.subjective,
              objective: n.objective,
              assessment: n.assessment,
              plan: n.plan,
              author: 'CCM Care Team',
            })),
          },
        });

        if (!error && data) bundles.push(data);
      } catch (err) {
        console.error('FHIR export error for patient:', patientId, err);
      }
    }

    if (bundles.length === 0) { toast.error('Failed to generate FHIR bundles'); return; }

    // Download combined bundle
    const combined = {
      resourceType: 'Bundle',
      type: 'collection',
      timestamp: new Date().toISOString(),
      entry: bundles.map(b => ({ resource: b })),
    };

    const blob = new Blob([JSON.stringify(combined, null, 2)], { type: 'application/fhir+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ccm-notes-${month}-${year}-fhir.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`FHIR bundle exported with ${bundles.length} patient records`);
  }

  const selectedCount = generatedNotes.filter(n => n.selected).length;
  const pushedCount = generatedNotes.filter(n => n.pushed).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            CCM Batch Upload to Practice Fusion — {month} {year}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {/* Step 1: Configure */}
          {generatedNotes.length === 0 && (
            <div className="space-y-4">
              <Card className="p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Note Generation Mode</h3>
                <Tabs value={mode} onValueChange={v => setMode(v as 'individual' | 'summary')}>
                  <TabsList className="w-full">
                    <TabsTrigger value="summary" className="flex-1">Monthly Summary</TabsTrigger>
                    <TabsTrigger value="individual" className="flex-1">Individual Sessions</TabsTrigger>
                  </TabsList>
                  <TabsContent value="summary">
                    <p className="text-xs text-muted-foreground mt-2">
                      Creates one consolidated SOAP note per patient summarizing all CCM/RPM activities for {month} {year}. 
                      Patients with 20+ minutes are auto-selected.
                    </p>
                  </TabsContent>
                  <TabsContent value="individual">
                    <p className="text-xs text-muted-foreground mt-2">
                      Creates a separate note for each time entry. Best for detailed per-session documentation.
                    </p>
                  </TabsContent>
                </Tabs>
              </Card>

              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-foreground">Patients with Time Entries</h3>
                  <Badge variant="secondary">{patientGroups.size} patients · {entries.length} entries</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                  {Array.from(patientGroups.entries()).map(([id, g]) => (
                    <div key={id} className="flex items-center justify-between p-2 rounded bg-muted/50 text-xs">
                      <span className="font-medium text-foreground truncate">
                        {g.patient ? `${g.patient.lastName}, ${g.patient.firstName}` : 'Unknown'}
                      </span>
                      <Badge variant={g.totalMinutes >= 20 ? 'default' : 'secondary'} className="text-xs ml-1 shrink-0">
                        {g.totalMinutes} min
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>

              <Button onClick={generateNotes} className="w-full gap-2">
                <FileText className="w-4 h-4" />
                Generate {mode === 'summary' ? 'Monthly Summary' : 'Individual'} Notes
              </Button>
            </div>
          )}

          {/* Step 2: Review & Send */}
          {generatedNotes.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedCount === generatedNotes.length}
                    onCheckedChange={v => selectAll(!!v)}
                  />
                  <span className="text-sm text-foreground font-medium">
                    {selectedCount} of {generatedNotes.length} selected
                  </span>
                  {pushedCount > 0 && (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="w-3 h-3" /> {pushedCount} sent
                    </Badge>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => setGeneratedNotes([])}>
                  Back
                </Button>
              </div>

              <ScrollArea className="flex-1 min-h-0">
                <div className="space-y-2 pr-3">
                  {generatedNotes.map((note, i) => (
                    <Card key={i} className={`p-3 transition-colors ${note.pushed ? 'bg-[hsl(var(--success))]/5 border-[hsl(var(--success))]/30' : ''}`}>
                      <div className="flex items-start gap-3">
                        <Checkbox
                          checked={note.selected}
                          onCheckedChange={() => toggleNote(i)}
                          disabled={note.pushed}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm text-foreground">{note.patientName}</span>
                            <Badge variant="outline" className="text-xs">{note.mrn}</Badge>
                            <Badge variant="secondary" className="text-xs">{note.program}</Badge>
                            <Badge variant="secondary" className="text-xs">{note.totalMinutes} min</Badge>
                            {note.pushed && (
                              <Badge className="text-xs bg-[hsl(var(--success))] text-white gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Sent
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{note.subjective}</p>
                          <details className="mt-1">
                            <summary className="text-xs text-primary cursor-pointer hover:underline">View full note</summary>
                            <div className="mt-2 space-y-2 text-xs bg-muted/50 rounded-lg p-3">
                              <div><span className="font-semibold text-foreground">S:</span> <span className="text-muted-foreground whitespace-pre-line">{note.subjective}</span></div>
                              <div><span className="font-semibold text-foreground">O:</span> <span className="text-muted-foreground whitespace-pre-line">{note.objective}</span></div>
                              <div><span className="font-semibold text-foreground">A:</span> <span className="text-muted-foreground whitespace-pre-line">{note.assessment}</span></div>
                              <div><span className="font-semibold text-foreground">P:</span> <span className="text-muted-foreground whitespace-pre-line">{note.plan}</span></div>
                            </div>
                          </details>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </ScrollArea>

              <Card className="p-3">
                <div className="flex items-center gap-2">
                  <Select value={exportFormat} onValueChange={v => setExportFormat(v as 'extension' | 'fhir')}>
                    <SelectTrigger className="w-[220px] h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="extension">
                        <span className="flex items-center gap-2"><Send className="w-3.5 h-3.5" /> Chrome Extension</span>
                      </SelectItem>
                      <SelectItem value="fhir">
                        <span className="flex items-center gap-2"><FileJson className="w-3.5 h-3.5" /> FHIR R4 Bundle</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    className="flex-1 gap-2"
                    onClick={exportFormat === 'extension' ? pushToExtension : exportFHIR}
                    disabled={pushing || selectedCount === 0}
                  >
                    {exportFormat === 'extension' ? (
                      <>
                        <Send className="w-4 h-4" />
                        {pushing ? 'Sending...' : `Push ${selectedCount} Notes to Practice Fusion`}
                      </>
                    ) : (
                      <>
                        <FileJson className="w-4 h-4" />
                        Export {selectedCount} Notes as FHIR Bundle
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
