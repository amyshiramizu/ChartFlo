import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePatientStore } from '@/store/patientStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Lock, Plus, Trash2, X, FilePlus2, Mic, MicOff } from 'lucide-react';
import { useDictation } from '@/hooks/useDictation';
import type { Patient } from '@/types/patient';

// ─── domain constants ────────────────────────────────────

const ENCOUNTER_TYPES = [
  { label: 'CCM Care Management — 99490', cpt: '99490' },
  { label: 'CCM Additional 20 min — 99439', cpt: '99439' },
  { label: 'RPM Device Setup — 99453', cpt: '99453' },
  { label: 'RPM Management — 99457', cpt: '99457' },
  { label: 'RPM Additional 20 min — 99458', cpt: '99458' },
  { label: 'Hybrid — 99202 / 99453', cpt: '99202 / 99453' },
  { label: 'Telehealth E/M New — 99202', cpt: '99202' },
  { label: 'Telehealth E/M Established — 99213', cpt: '99213' },
  { label: 'Annual Wellness Visit — G0438', cpt: 'G0438' },
  { label: 'Other', cpt: '' },
];

const PLACES_OF_SERVICE = [
  'Office (11)',
  'Telehealth – Home (10)',
  'Telehealth – Other (02)',
  'Home (12)',
  'Assisted Living (13)',
];

const CHIEF_COMPLAINTS = [
  'Establishment of Care',
  'Routine Follow-up',
  'Medication Review',
  'Device Setup / Education',
  'New or Worsening Symptom',
  'Care Plan Review',
  'Other',
];

interface Encounter {
  id: string;
  encounter_type: string | null;
  cpt_code: string | null;
  date_of_service: string;
  provider: string | null;
  place_of_service: string | null;
  total_minutes: number;
  diagnoses: string[];
  no_medications: boolean;
  chief_complaint: string | null;
  vitals: { bp?: string; hr?: string; temp?: string; spo2?: string };
  vitals_refused: boolean;
  soap_note: string | null;
  status: 'draft' | 'signed';
  signed_at: string | null;
}

const EMPTY_FORM = {
  encounter_type: ENCOUNTER_TYPES[0].label,
  cpt_code: ENCOUNTER_TYPES[0].cpt,
  date_of_service: new Date().toISOString().split('T')[0],
  provider: '',
  place_of_service: PLACES_OF_SERVICE[0],
  total_minutes: '20',
  diagnoses: [] as string[],
  no_medications: false,
  chief_complaint: CHIEF_COMPLAINTS[0],
  bp: '', hr: '', temp: '', spo2: '',
  vitals_refused: false,
  soap_note: '',
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-sky-100 dark:bg-sky-900/40 text-sky-950 dark:text-sky-100 font-semibold text-sm rounded-md px-4 py-2.5">
      {children}
    </div>
  );
}

export default function EncounterPanel({ patient, problems }: {
  patient: Patient;
  problems: { icd_code: string; description: string }[];
}) {
  const { fetchPatients } = usePatientStore();
  const [tab, setTab] = useState<'edit' | 'previous'>('edit');
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingSigned, setViewingSigned] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, provider: patient.provider || '' });
  const [newDx, setNewDx] = useState('');
  const [attest, setAttest] = useState(false);
  const [logToTracker, setLogToTracker] = useState(true);
  const [saving, setSaving] = useState(false);
  const [medDialogOpen, setMedDialogOpen] = useState(false);
  const [medForm, setMedForm] = useState({ name: '', dosage: '', frequency: '' });
  const { isListening, transcript, startListening, stopListening, resetTranscript, isSupported } = useDictation();

  // Same behavior as chart notes (NoteEditor): toggle the mic, and on stop
  // append the transcript to the SOAP note.
  const handleDictate = () => {
    if (isListening) {
      stopListening();
      if (transcript) {
        setForm(f => ({ ...f, soap_note: f.soap_note ? `${f.soap_note} ${transcript}` : transcript }));
        resetTranscript();
      }
    } else {
      startListening();
    }
  };

  const fetchEncounters = useCallback(async () => {
    const { data, error } = await supabase
      .from('encounters' as any)
      .select('*')
      .eq('patient_id', patient.id)
      .order('date_of_service', { ascending: false });
    if (error) { console.error(error); return; }
    setEncounters((data || []) as unknown as Encounter[]);
  }, [patient.id]);

  useEffect(() => { fetchEncounters(); }, [fetchEncounters]);

  const activeMeds = patient.medications.filter(m => m.active);

  // ── form helpers ──
  function loadEncounter(e: Encounter) {
    setForm({
      encounter_type: e.encounter_type || ENCOUNTER_TYPES[0].label,
      cpt_code: e.cpt_code || '',
      date_of_service: e.date_of_service,
      provider: e.provider || '',
      place_of_service: e.place_of_service || PLACES_OF_SERVICE[0],
      total_minutes: String(e.total_minutes ?? 0),
      diagnoses: e.diagnoses || [],
      no_medications: e.no_medications,
      chief_complaint: e.chief_complaint || CHIEF_COMPLAINTS[0],
      bp: e.vitals?.bp || '', hr: e.vitals?.hr || '', temp: e.vitals?.temp || '', spo2: e.vitals?.spo2 || '',
      vitals_refused: e.vitals_refused,
      soap_note: e.soap_note || '',
    });
    setEditingId(e.id);
    setViewingSigned(e.status === 'signed');
    setAttest(false);
    setTab('edit');
  }

  function newEncounter() {
    setForm({ ...EMPTY_FORM, provider: patient.provider || '', diagnoses: problems.map(p => p.icd_code) });
    setEditingId(null);
    setViewingSigned(false);
    setAttest(false);
    setTab('edit');
  }

  function setType(label: string) {
    const t = ENCOUNTER_TYPES.find(x => x.label === label);
    setForm(f => ({ ...f, encounter_type: label, cpt_code: t?.cpt ?? f.cpt_code }));
  }

  function addDx(code: string) {
    const c = code.trim();
    if (!c || form.diagnoses.includes(c)) return;
    setForm(f => ({ ...f, diagnoses: [...f.diagnoses, c] }));
    setNewDx('');
  }

  const payload = () => ({
    patient_id: patient.id,
    encounter_type: form.encounter_type,
    cpt_code: form.cpt_code || null,
    date_of_service: form.date_of_service,
    provider: form.provider || null,
    place_of_service: form.place_of_service,
    total_minutes: parseInt(form.total_minutes) || 0,
    diagnoses: form.diagnoses,
    no_medications: form.no_medications,
    chief_complaint: form.chief_complaint,
    vitals: { bp: form.bp, hr: form.hr, temp: form.temp, spo2: form.spo2 },
    vitals_refused: form.vitals_refused,
    soap_note: form.soap_note || null,
  });

  async function persist(status: 'draft' | 'signed') {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const row: any = { ...payload(), status };
    if (status === 'signed') row.signed_at = new Date().toISOString();

    const { data, error } = editingId
      ? await supabase.from('encounters' as any).update(row).eq('id', editingId).select().maybeSingle()
      : await supabase.from('encounters' as any).insert({ ...row, user_id: user.id }).select().maybeSingle();
    setSaving(false);
    if (error) {
      toast.error(`Save failed: ${error.message}. If you just added this feature, run the latest database migration in Supabase.`);
      return;
    }

    if (status === 'signed') {
      const minutes = parseInt(form.total_minutes) || 0;
      if (logToTracker && minutes > 0) {
        const program = /rpm|99453|99457|99458/i.test(`${form.encounter_type} ${form.cpt_code}`) ? 'RPM' : 'CCM';
        const { error: teErr } = await supabase.from('ccm_time_entries').insert({
          patient_id: patient.id,
          user_id: user.id,
          date: form.date_of_service,
          minutes,
          program,
          description: `Encounter: ${form.encounter_type}${form.cpt_code ? ` (CPT ${form.cpt_code})` : ''}`,
        });
        if (teErr) toast.error(`Encounter signed, but time logging failed: ${teErr.message}`);
      }
      toast.success('Encounter signed & locked');
      setViewingSigned(true);
    } else {
      toast.success('Encounter draft saved');
    }
    if (data) setEditingId((data as any).id);
    fetchEncounters();
  }

  async function addMedication() {
    if (!medForm.name.trim()) { toast.error('Medication name is required'); return; }
    const { error } = await supabase.from('medications').insert({
      patient_id: patient.id,
      name: medForm.name.trim(),
      dosage: medForm.dosage || '',
      frequency: medForm.frequency || '',
      route: 'PO',
      prescribed_date: new Date().toISOString().split('T')[0],
      active: true,
    });
    if (error) { toast.error(`Add failed: ${error.message}`); return; }
    setMedDialogOpen(false);
    setMedForm({ name: '', dosage: '', frequency: '' });
    await fetchPatients();
    toast.success('Medication added');
  }

  async function removeMedication(medId: string) {
    const { error } = await supabase.from('medications').delete().eq('id', medId);
    if (error) { toast.error(`Remove failed: ${error.message}`); return; }
    await fetchPatients();
  }

  const locked = viewingSigned;

  return (
    <div className="space-y-4">
      {/* Edit / Previous sub-tabs */}
      <div className="grid grid-cols-2 border-b border-border">
        <button
          onClick={() => setTab('edit')}
          className={`py-3 text-sm font-semibold text-center transition-colors ${tab === 'edit' ? 'text-primary border-b-2 border-primary bg-sky-50 dark:bg-sky-950/30' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {locked ? 'View Encounter' : 'Edit Encounter'}
        </button>
        <button
          onClick={() => setTab('previous')}
          className={`py-3 text-sm font-semibold text-center transition-colors ${tab === 'previous' ? 'text-primary border-b-2 border-primary bg-sky-50 dark:bg-sky-950/30' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Previous Encounters {encounters.length > 0 && `(${encounters.length})`}
        </button>
      </div>

      {tab === 'previous' ? (
        <div className="space-y-2">
          <Button onClick={newEncounter} className="gap-2 mb-2"><FilePlus2 className="w-4 h-4" /> New Encounter</Button>
          {encounters.map(e => (
            <Card key={e.id} className="p-4 flex items-center justify-between cursor-pointer hover:shadow-md transition-shadow" onClick={() => loadEncounter(e)}>
              <div>
                <p className="font-medium">{e.encounter_type || 'Encounter'}</p>
                <p className="text-sm text-muted-foreground">
                  {e.date_of_service} · {e.cpt_code || 'no CPT'} · {e.total_minutes} min{e.provider ? ` · ${e.provider}` : ''}
                </p>
              </div>
              {e.status === 'signed'
                ? <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600"><Lock className="w-3 h-3" /> Signed</Badge>
                : <Badge variant="outline">Draft</Badge>}
            </Card>
          ))}
          {encounters.length === 0 && (
            <p className="text-center text-muted-foreground py-8">No encounters yet. Start one with “New Encounter”.</p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {locked && (
            <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-md px-4 py-2.5 text-sm">
              <span className="flex items-center gap-2 font-medium text-emerald-800 dark:text-emerald-200">
                <Lock className="w-4 h-4" /> This encounter is signed and locked.
              </span>
              <Button size="sm" variant="outline" onClick={newEncounter} className="gap-1"><FilePlus2 className="w-3.5 h-3.5" /> New Encounter</Button>
            </div>
          )}

          {/* ── Encounter Information ── */}
          <SectionHeader>Encounter Information</SectionHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-1">
            <div>
              <Label>Encounter Type</Label>
              <Select value={form.encounter_type} onValueChange={setType} disabled={locked}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ENCOUNTER_TYPES.map(t => <SelectItem key={t.label} value={t.label}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Date of Service</Label>
              <Input type="date" value={form.date_of_service} onChange={e => setForm({ ...form, date_of_service: e.target.value })} disabled={locked} />
            </div>
            <div>
              <Label>Provider</Label>
              <Input value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })} placeholder="Provider name" disabled={locked} />
            </div>
            <div>
              <Label>Place of Service</Label>
              <Select value={form.place_of_service} onValueChange={v => setForm({ ...form, place_of_service: v })} disabled={locked}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PLACES_OF_SERVICE.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>CPT Code</Label>
              <Input value={form.cpt_code} onChange={e => setForm({ ...form, cpt_code: e.target.value })} className="font-mono" disabled={locked} />
            </div>
            <div>
              <Label>Total Minutes</Label>
              <Input type="number" min="0" value={form.total_minutes} onChange={e => setForm({ ...form, total_minutes: e.target.value })} disabled={locked} />
            </div>
          </div>

          {/* ── Diagnoses ── */}
          <SectionHeader>Diagnoses</SectionHeader>
          <div className="px-1 space-y-2">
            <Label>Diagnoses (ICD-10)</Label>
            <div className="flex flex-wrap items-center gap-2 border border-input rounded-md p-2 min-h-[46px]">
              {form.diagnoses.map(dx => (
                <Badge key={dx} variant="secondary" className="gap-1 font-mono">
                  {dx}
                  {!locked && (
                    <button onClick={() => setForm(f => ({ ...f, diagnoses: f.diagnoses.filter(d => d !== dx) }))}>
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </Badge>
              ))}
              {!locked && (
                <Input
                  value={newDx}
                  onChange={e => setNewDx(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDx(newDx); } }}
                  placeholder="Add ICD-10 and press Enter…"
                  className="border-0 shadow-none focus-visible:ring-0 flex-1 min-w-[180px] h-8"
                />
              )}
            </div>
            {!locked && problems.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {problems.filter(p => !form.diagnoses.includes(p.icd_code)).map(p => (
                  <button key={p.icd_code} onClick={() => addDx(p.icd_code)}
                    className="text-xs border border-dashed border-border rounded-full px-2.5 py-1 text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
                    title={p.description}>
                    + {p.icd_code}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Medications ── */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1"><SectionHeader>Medications</SectionHeader></div>
            {!locked && (
              <Button onClick={() => setMedDialogOpen(true)} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 shrink-0">
                <Plus className="w-4 h-4" /> Add Medication
              </Button>
            )}
          </div>
          <div className="px-1 space-y-3">
            {activeMeds.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-sky-50 dark:bg-sky-950/30 text-left">
                    <th className="py-2 px-3 font-semibold">Name</th>
                    <th className="py-2 px-3 font-semibold">Dose</th>
                    <th className="py-2 px-3 font-semibold">Frequency</th>
                    {!locked && <th className="py-2 px-3 font-semibold w-16">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {activeMeds.map(m => (
                    <tr key={m.id} className="border-b border-border/40">
                      <td className="py-2.5 px-3 font-medium">{m.name}</td>
                      <td className="py-2.5 px-3">{m.dosage}</td>
                      <td className="py-2.5 px-3">{m.frequency}</td>
                      {!locked && (
                        <td className="py-2.5 px-3">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeMedication(m.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <Checkbox checked={form.no_medications} onCheckedChange={v => setForm({ ...form, no_medications: !!v })} disabled={locked} />
              Patient indicated they do not take any medication
            </label>
          </div>

          {/* ── SOAP ── */}
          <SectionHeader>SOAP Clinical Documentation</SectionHeader>
          <div className="px-1 space-y-4">
            <div className="max-w-md">
              <Label>Chief Complaint <span className="text-muted-foreground">(S)</span></Label>
              <Select value={form.chief_complaint} onValueChange={v => setForm({ ...form, chief_complaint: v })} disabled={locked}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CHIEF_COMPLAINTS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Card className="p-4 bg-sky-50/50 dark:bg-sky-950/20">
              <p className="font-medium text-sm mb-3">Vitals <span className="text-muted-foreground">(O)</span></p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><Label className="text-xs">BP</Label><Input placeholder="120/80" value={form.bp} onChange={e => setForm({ ...form, bp: e.target.value })} disabled={locked} /></div>
                <div><Label className="text-xs">HR</Label><Input placeholder="70" value={form.hr} onChange={e => setForm({ ...form, hr: e.target.value })} disabled={locked} /></div>
                <div><Label className="text-xs">Temp</Label><Input placeholder="98.6" value={form.temp} onChange={e => setForm({ ...form, temp: e.target.value })} disabled={locked} /></div>
                <div><Label className="text-xs">SpO₂</Label><Input placeholder="%" value={form.spo2} onChange={e => setForm({ ...form, spo2: e.target.value })} disabled={locked} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm mt-3 cursor-pointer select-none">
                <Checkbox checked={form.vitals_refused} onCheckedChange={v => setForm({ ...form, vitals_refused: !!v })} disabled={locked} />
                Patient refused taking measurements
              </label>
            </Card>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>SOAP Note</Label>
                {!locked && isSupported && (
                  <Button
                    type="button"
                    size="sm"
                    variant={isListening ? 'destructive' : 'secondary'}
                    onClick={handleDictate}
                    className="gap-2"
                  >
                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    {isListening ? 'Stop Dictation' : 'Dictate SOAP Note'}
                  </Button>
                )}
              </div>
              {isListening && (
                <Card className="p-3 border-destructive/30 bg-destructive/5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                    <span className="text-sm font-medium text-destructive">Listening...</span>
                  </div>
                  {transcript && <p className="text-sm text-muted-foreground mt-2 italic">{transcript}</p>}
                </Card>
              )}
              <Textarea rows={6} value={form.soap_note} onChange={e => setForm({ ...form, soap_note: e.target.value })} disabled={locked} placeholder="Subjective, Objective, Assessment, Plan…" />
            </div>
          </div>

          {/* ── Sign ── */}
          {!locked && (
            <>
              <SectionHeader>Encounter Sign</SectionHeader>
              <div className="px-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <Checkbox checked={attest} onCheckedChange={v => setAttest(!!v)} />
                    I attest that the documentation is accurate.
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                    <Checkbox checked={logToTracker} onCheckedChange={v => setLogToTracker(!!v)} />
                    Log Total Minutes to the CCM/RPM time tracker on sign
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => persist('draft')} disabled={saving}>Save Draft</Button>
                  <Button onClick={() => persist('signed')} disabled={!attest || saving} className="gap-2">
                    <Lock className="w-4 h-4" /> Sign &amp; Lock Encounter
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Add medication dialog */}
      <Dialog open={medDialogOpen} onOpenChange={setMedDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Medication</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div><Label>Name</Label><Input value={medForm.name} onChange={e => setMedForm({ ...medForm, name: e.target.value })} placeholder="Metformin HCl ER" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Dose</Label><Input value={medForm.dosage} onChange={e => setMedForm({ ...medForm, dosage: e.target.value })} placeholder="500 mg" /></div>
              <div><Label>Frequency</Label><Input value={medForm.frequency} onChange={e => setMedForm({ ...medForm, frequency: e.target.value })} placeholder="QD" /></div>
            </div>
            <Button onClick={addMedication} className="w-full">Add Medication</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
