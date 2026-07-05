import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { usePatientStore } from '@/store/patientStore';
import { PageLayout } from '@/components/MobileLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  User,
  Phone,
  Calendar,
  AlertTriangle,
  Pill,
  FileText,
  Clock,
  Pencil,
  Activity,
  Download,
  Sparkles,

} from 'lucide-react';
import { Mic, Pause, Play, Square, Save, X, Trash2, Wand2, Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EditPatientDialog } from '@/components/EditPatientDialog';
import { useState, useEffect, useMemo, useRef } from 'react';
import type { Patient } from '@/types/patient';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useDictation } from '@/hooks/useDictation';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { backfillFromAllNotes, summarizeResult } from '@/lib/extractClinicalData';




function confidenceTone(c: number) {
  if (c >= 0.85) return { label: 'High', cls: 'border-l-emerald-500 bg-emerald-500/5', badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' };
  if (c >= 0.6) return { label: 'Med', cls: 'border-l-amber-500 bg-amber-500/5', badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' };
  return { label: 'Low', cls: 'border-l-destructive bg-destructive/5', badge: 'bg-destructive/15 text-destructive' };
}

function PatientProfileContent() {
  const { id } = useParams<{ id: string }>();
  const { patients, selectPatient, fetchPatients, addNote, updateNote, loading } = usePatientStore();
  const templates = usePatientStore((s) => s.templates);
  const navigate = useNavigate();
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [exporting, setExporting] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [autoSplit, setAutoSplit] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [parsedSoap, setParsedSoap] = useState<{ subjective: string; objective: string; assessment: string; plan: string } | null>(null);
  const [editMode, setEditMode] = useState<'segments' | 'freeform'>('segments');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  const [noteEditDraft, setNoteEditDraft] = useState<{ subjective: string; objective: string; assessment: string; plan: string }>({ subjective: '', objective: '', assessment: '', plan: '' });
  const [savingNoteEdit, setSavingNoteEdit] = useState(false);
  const [templatePickerNoteId, setTemplatePickerNoteId] = useState<string | null>(null);
  const [reformattingNoteId, setReformattingNoteId] = useState<string | null>(null);
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());

  const handleReformatNote = async (note: any, templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setReformattingNoteId(note.id);
    try {
      const transcript = [
        note.subjective && `SUBJECTIVE:\n${note.subjective}`,
        note.objective && `OBJECTIVE:\n${note.objective}`,
        note.assessment && `ASSESSMENT:\n${note.assessment}`,
        note.plan && `PLAN:\n${note.plan}`,
      ].filter(Boolean).join('\n\n');
      const { data, error } = await supabase.functions.invoke('structure-soap', {
        body: { transcript, template },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const updated = {
        subjective: data.subjective ?? note.subjective,
        objective: data.objective ?? note.objective,
        assessment: data.assessment ?? note.assessment,
        plan: data.plan ?? note.plan,
      };
      await updateNote(patient.id, note.id, updated);
      if (editingNoteId === note.id) setNoteEditDraft(updated);
      toast.success(`Note reformatted with "${template.name}"`);
      setTemplatePickerNoteId(null);
    } catch (e: any) {
      toast.error('Reformat failed: ' + (e?.message || 'Unknown error'));
    } finally {
      setReformattingNoteId(null);
    }
  };
  const {
    isListening,
    isPaused,
    transcript,
    segments,
    startListening,
    stopListening,
    pauseListening,
    resumeListening,
    resetTranscript,
    updateSegment,
    removeSegment,
    setSegmentsFromText,
    isSupported,
  } = useDictation();

  // Keep freeform textarea in sync with segment transcript while dictating
  useEffect(() => {
    if (editMode === 'segments') setNoteDraft(transcript);
  }, [transcript, editMode]);

  const lowConfCount = useMemo(
    () => segments.filter((s) => s.isFinal && s.confidence < 0.6).length,
    [segments]
  );


  useEffect(() => {
    if (patients.length === 0) fetchPatients();
  }, [patients.length, fetchPatients]);

  // Auto-run clinical data extraction across all notes once per patient (silent).
  useEffect(() => {
    if (!id) return;
    const key = `cf:autoExtract:${id}`;
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(key)) return;
    const p = patients.find((x) => x.id === id);
    if (!p || p.notes.length === 0) return;
    localStorage.setItem(key, String(Date.now()));
    (async () => {
      try {
        const r = await backfillFromAllNotes(id);
        const msg = summarizeResult(r);
        if (msg && msg !== 'No new clinical data found') {
          toast.success(msg, { description: 'Auto-extracted from visit history' });
          await fetchPatients();
        }
      } catch (e) {
        console.error('Auto-extract failed', e);
        localStorage.removeItem(key);
      }
    })();
  }, [id, patients, fetchPatients]);

  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('record') === '1' && isSupported && !isListening) {
      startListening();
      setTimeout(() => {
        document.getElementById('quick-voice-note')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      searchParams.delete('record');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupported]);

  const foundPatient = patients.find((p) => p.id === id);
  const lastPatientRef = useRef<Patient | null>(null);
  if (foundPatient) lastPatientRef.current = foundPatient;
  // Keep showing the previous chart during the brief gap between route change
  // and store hydration so the transition feels seamless.
  const patient = foundPatient ?? lastPatientRef.current;

  if (!patient) {
    if (loading || patients.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center text-muted-foreground animate-in fade-in duration-200">
          <p>Loading chart…</p>
        </div>
      );
    }
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>Patient not found.</p>
      </div>
    );
  }

  const sortedNotes = [...patient.notes].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const activeMeds = patient.medications.filter((m) => m.active);
  const inactiveMeds = patient.medications.filter((m) => !m.active);
  const allMedsSorted = [...patient.medications].sort(
    (a, b) => new Date(b.prescribedDate).getTime() - new Date(a.prescribedDate).getTime()
  );

  const age = Math.floor(
    (Date.now() - new Date(patient.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );

  const handleGoToNotes = () => {
    selectPatient(patient.id);
    navigate(`/chart/${patient.id}`);
  };


  const handleExportFHIR = async () => {
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('export-fhir', {
        body: {
          firstName: patient.firstName,
          lastName: patient.lastName,
          dob: patient.dob,
          mrn: patient.mrn,
          gender: patient.gender,
          phone: patient.phone,
          allergies: patient.allergies,
          medications: patient.medications.map((m) => ({
            name: m.name,
            dosage: m.dosage,
            frequency: m.frequency,
            route: m.route,
            prescribedDate: m.prescribedDate,
            active: m.active,
          })),
          notes: patient.notes.map((n) => ({
            date: n.date,
            type: n.type,
            subjective: n.subjective,
            objective: n.objective,
            assessment: n.assessment,
            plan: n.plan,
            author: n.author,
          })),
        },
      });

      if (error) throw error;

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/fhir+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${patient.lastName}_${patient.firstName}_FHIR.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('FHIR bundle exported successfully');
    } catch (err: any) {
      toast.error('Export failed: ' + (err.message || 'Unknown error'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg shrink-0">
              {patient.firstName[0]}
              {patient.lastName[0]}
            </div>
            <div className="min-w-0">
              <h1 className="text-lg md:text-2xl font-semibold text-foreground truncate">
                {patient.lastName}, {patient.firstName}
              </h1>
              <p className="text-xs md:text-sm text-muted-foreground">
                {patient.mrn} · {patient.gender === 'female' ? 'Female' : 'Male'} · {age}yo
              </p>
            </div>
          </div>
          <div className="flex gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setEditingPatient(patient)}
            >
              <Pencil className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Edit Info</span>
            </Button>
            <Button size="sm" className="gap-1.5" onClick={handleGoToNotes}>
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Open Chart</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handleExportFHIR}
              disabled={exporting}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{exporting ? 'Exporting...' : 'Export FHIR'}</span>
            </Button>
          </div>
        </div>

        {/* Quick Voice Note */}
        <Card id="quick-voice-note" className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Mic className="w-4 h-4 text-primary" />
              Quick Voice Note
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              {isListening && !isPaused && (
                <span className="flex items-center gap-1.5 text-xs text-destructive">
                  <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                  Recording
                </span>
              )}
              {isPaused && (
                <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <Pause className="w-3 h-3" /> Paused
                </span>
              )}
              {!isListening && !isPaused && (
                <Button size="sm" className="gap-1.5" onClick={startListening} disabled={!isSupported}>
                  <Mic className="w-3.5 h-3.5" /> Record
                </Button>
              )}
              {isListening && !isPaused && (
                <Button size="sm" variant="secondary" className="gap-1.5" onClick={pauseListening}>
                  <Pause className="w-3.5 h-3.5" /> Pause
                </Button>
              )}
              {isPaused && (
                <Button size="sm" className="gap-1.5" onClick={resumeListening}>
                  <Play className="w-3.5 h-3.5" /> Resume
                </Button>
              )}
              {(isListening || isPaused) && (
                <Button size="sm" variant="destructive" className="gap-1.5" onClick={stopListening}>
                  <Square className="w-3.5 h-3.5" /> Stop
                </Button>
              )}
            </div>
          </div>
          {!isSupported && (
            <p className="text-xs text-muted-foreground mb-2">
              Dictation is not supported in this browser. You can still type a note below.
            </p>
          )}

          {/* Mode toggle */}
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  if (editMode === 'freeform') setSegmentsFromText(noteDraft);
                  setEditMode('segments');
                }}
                className={`px-2.5 py-1 rounded ${editMode === 'segments' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              >
                Segments
              </button>
              <button
                type="button"
                onClick={() => setEditMode('freeform')}
                className={`px-2.5 py-1 rounded ${editMode === 'freeform' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              >
                Freeform
              </button>
            </div>
            {editMode === 'segments' && lowConfCount > 0 && (
              <span className="text-xs text-muted-foreground">
                <span className="text-destructive font-medium">{lowConfCount}</span> low-confidence segment{lowConfCount === 1 ? '' : 's'} — review highlighted rows
              </span>
            )}
          </div>

          {editMode === 'freeform' ? (
            <Textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Tap Record and start speaking, or type a quick note here…"
              className="min-h-[100px] text-sm"
            />
          ) : segments.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground text-center">
              Tap Record to start dictating. Each phrase appears below with a confidence score so you can quickly fix what was misheard.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
              {segments.map((seg) => {
                const tone = confidenceTone(seg.confidence);
                return (
                  <div
                    key={seg.id}
                    className={`flex items-start gap-2 border-l-2 rounded-r-md pl-2 pr-1 py-1.5 ${tone.cls} ${!seg.isFinal ? 'opacity-70 italic' : ''}`}
                  >
                    <span className={`shrink-0 mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${tone.badge}`}>
                      {seg.isFinal ? `${tone.label} ${Math.round(seg.confidence * 100)}%` : 'Live'}
                    </span>
                    {seg.isFinal ? (
                      <Input
                        value={seg.text}
                        onChange={(e) => updateSegment(seg.id, e.target.value)}
                        className="h-8 text-sm border-0 bg-transparent focus-visible:ring-1 px-1"
                      />
                    ) : (
                      <span className="flex-1 text-sm pl-1 py-1">{seg.text}</span>
                    )}
                    {seg.isFinal && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeSegment(seg.id)}
                        aria-label="Remove segment"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {noteDraft && (
            <>
              <div className="flex items-center justify-between mt-3 gap-2 flex-wrap">
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoSplit}
                    onChange={(e) => setAutoSplit(e.target.checked)}
                    className="rounded border-border"
                  />
                  Auto-split into SOAP sections (S/O/A/P) on save
                </label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={parsing || !noteDraft.trim()}
                    onClick={async () => {
                      setParsing(true);
                      try {
                        const lastAssessment = [...patient.notes]
                          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                          .find((n) => n.assessment)?.assessment;
                        const { data, error } = await supabase.functions.invoke('structure-soap', {
                          body: { transcript: noteDraft, lastAssessment },
                        });
                        if (error) throw error;
                        if (data?.error) throw new Error(data.error);
                        setParsedSoap(data);
                        toast.success('SOAP sections generated. Review below.');
                      } catch (err: any) {
                        toast.error('Parse failed: ' + (err.message || 'Unknown error'));
                      } finally {
                        setParsing(false);
                      }
                    }}
                  >
                    {parsing ? 'Parsing…' : 'Preview SOAP'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    onClick={() => {
                      setNoteDraft('');
                      setParsedSoap(null);
                      resetTranscript();
                    }}
                  >
                    <X className="w-3.5 h-3.5" /> Clear
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={saving || parsing}
                    onClick={async () => {
                      if (!noteDraft.trim()) return;
                      setSaving(true);
                      try {
                        let soap = parsedSoap;
                        if (autoSplit && !soap) {
                          const lastAssessment = [...patient.notes]
                            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                            .find((n) => n.assessment)?.assessment;
                          const { data, error } = await supabase.functions.invoke('structure-soap', {
                            body: { transcript: noteDraft, lastAssessment },
                          });
                          if (error) throw error;
                          if (data?.error) throw new Error(data.error);
                          soap = data;
                        }
                        await addNote(patient.id, {
                          id: crypto.randomUUID(),
                          date: new Date().toISOString(),
                          type: 'soap',
                          subjective: soap?.subjective || noteDraft.trim(),
                          objective: soap?.objective || '',
                          assessment: soap?.assessment || '',
                          plan: soap?.plan || '',
                          author: 'You',
                          dictated: transcript.length > 0,
                        });
                        toast.success('Voice note saved');
                        setNoteDraft('');
                        setParsedSoap(null);
                        resetTranscript();
                      } catch (err: any) {
                        toast.error('Failed to save note: ' + (err.message || 'Unknown error'));
                      } finally {
                        setSaving(false);
                      }
                    }}
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saving ? 'Saving…' : 'Save Note'}
                  </Button>
                </div>
              </div>
              {parsedSoap && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {([
                    ['Subjective', 'subjective'],
                    ['Objective', 'objective'],
                    ['Assessment', 'assessment'],
                    ['Plan', 'plan'],
                  ] as const).map(([label, key]) => (
                    <div key={key} className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
                      <Textarea
                        value={parsedSoap[key]}
                        onChange={(e) => setParsedSoap({ ...parsedSoap, [key]: e.target.value })}
                        className="min-h-[80px] text-xs"
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>

        {/* Demographics + Allergies row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Demographics */}
          <Card className="p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <User className="w-4 h-4 text-primary" />
              Demographics
            </h2>
            <div className="grid grid-cols-2 gap-y-3 gap-x-8 text-sm">
              <div>
                <span className="text-muted-foreground">Full Name</span>
                <p className="font-medium text-foreground">
                  {patient.firstName} {patient.lastName}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">MRN</span>
                <p className="font-medium text-foreground">{patient.mrn}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Gender</span>
                <p className="font-medium text-foreground capitalize">{patient.gender || 'Not specified'}</p>
              </div>
              <div className="flex items-start gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground mt-0.5" />
                <div>
                  <span className="text-muted-foreground">Date of Birth</span>
                  <p className="font-medium text-foreground">
                    {new Date(patient.dob).toLocaleDateString()} ({age} yrs)
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-1.5">
                <Phone className="w-3.5 h-3.5 text-muted-foreground mt-0.5" />
                <div>
                  <span className="text-muted-foreground">Phone</span>
                  <p className="font-medium text-foreground">
                    {patient.phone || 'Not on file'}
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {/* Allergies */}
          {(() => {
            const isNkda = patient.allergies.length > 0 && patient.allergies.every((a) => a.trim().toUpperCase() === 'NKDA');
            return (
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                  <AlertTriangle className={`w-4 h-4 ${isNkda ? 'text-muted-foreground' : 'text-destructive'}`} />
                  Allergies
                </h2>
                {patient.allergies.length > 0 ? (
                  <div className="space-y-2">
                    {patient.allergies.map((allergy, i) => (
                      <Badge
                        key={i}
                        variant={isNkda ? 'secondary' : 'destructive'}
                        className="mr-2 text-xs"
                      >
                        {allergy}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">NKDA</p>
                )}
              </Card>
            );
          })()}
        </div>



        {/* Medication Timeline */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Pill className="w-4 h-4 text-primary" />
              Medication Timeline
            </h2>
            <div className="flex gap-2">
              <Badge variant="secondary" className="text-xs">
                {activeMeds.length} Active
              </Badge>
              {inactiveMeds.length > 0 && (
                <Badge variant="outline" className="text-xs">
                  {inactiveMeds.length} Discontinued
                </Badge>
              )}
            </div>
          </div>

          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[18px] top-0 bottom-0 w-px bg-border" />

            <div className="space-y-4">
              {allMedsSorted.map((med) => (
                <div key={med.id} className="flex items-start gap-4 relative">
                  <div
                    className={`w-[38px] h-[38px] rounded-full flex items-center justify-center shrink-0 z-10 ${
                      med.active
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Pill className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className={`text-sm font-medium ${
                          med.active
                            ? 'text-foreground'
                            : 'text-muted-foreground line-through'
                        }`}
                      >
                        {med.name} {med.dosage}
                      </p>
                      {med.active ? (
                        <Badge
                          className="text-xs bg-success/10 text-success border-success/20"
                          variant="outline"
                        >
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">
                          Discontinued
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {med.frequency} · {med.route} · Started{' '}
                      {new Date(med.prescribedDate).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
              {allMedsSorted.length === 0 && (
                <p className="text-sm text-muted-foreground pl-14">
                  No medications on record.
                </p>
              )}
            </div>
          </div>
        </Card>

        {/* Visit History */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Visit History
            </h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={backfilling || sortedNotes.length === 0}
                onClick={async () => {
                  if (!patient) return;
                  setBackfilling(true);
                  try {
                    const r = await backfillFromAllNotes(patient.id);
                    toast.success(summarizeResult(r));
                    await fetchPatients();
                  } catch (e: any) {
                    toast.error(e?.message || 'Backfill failed');
                  } finally {
                    setBackfilling(false);
                  }
                }}
                className="gap-2"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {backfilling ? 'Extracting…' : 'Extract from all notes'}
              </Button>
              <Badge variant="secondary" className="text-xs">
                {sortedNotes.length} Visit{sortedNotes.length !== 1 ? 's' : ''}
              </Badge>
            </div>
          </div>


          {sortedNotes.length > 0 ? (
            <div className="space-y-4">
              {sortedNotes.map((note) => {
                const isEditing = editingNoteId === note.id;
                return (
                <div
                  key={note.id}
                  className="border border-border rounded-lg p-4 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        {new Date(note.date).toLocaleDateString('en-US', {
                          weekday: 'short',
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <Badge variant="outline" className="text-xs capitalize">
                        {note.type}
                      </Badge>
                      {note.dictated && (
                        <Badge variant="secondary" className="text-xs">
                          Dictated
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {note.author}
                      </span>
                      {templatePickerNoteId === note.id ? (
                        <div className="flex items-center gap-1.5">
                          <Select
                            onValueChange={(v) => handleReformatNote(note, v)}
                            disabled={reformattingNoteId === note.id}
                          >
                            <SelectTrigger className="h-7 w-48 text-xs">
                              <SelectValue placeholder="Pick template..." />
                            </SelectTrigger>
                            <SelectContent>
                              {templates.map((t) => (
                                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {reformattingNoteId === note.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                          ) : (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setTemplatePickerNoteId(null)}>
                              Cancel
                            </Button>
                          )}
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => setTemplatePickerNoteId(note.id)}
                          aria-label="Change template"
                        >
                          <Wand2 className="w-3 h-3" /> Template
                        </Button>
                      )}
                      {isEditing ? (
                        <>
                          <Button
                            variant="default"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            disabled={savingNoteEdit}
                            onClick={async () => {
                              setSavingNoteEdit(true);
                              try {
                                await updateNote(patient.id, note.id, noteEditDraft);
                                toast.success('Note updated');
                                setEditingNoteId(null);
                              } catch (e: any) {
                                toast.error('Save failed: ' + (e?.message || 'Unknown error'));
                              } finally {
                                setSavingNoteEdit(false);
                              }
                            }}
                          >
                            <Save className="w-3 h-3" /> Save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            disabled={savingNoteEdit}
                            onClick={() => setEditingNoteId(null)}
                          >
                            <X className="w-3 h-3" /> Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => {
                            setEditingNoteId(note.id);
                            setNoteEditDraft({
                              subjective: note.subjective || '',
                              objective: note.objective || '',
                              assessment: note.assessment || '',
                              plan: note.plan || '',
                            });
                          }}
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </Button>
                      )}
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {(['subjective', 'objective', 'assessment', 'plan'] as const).map((key) => (
                        <div key={key}>
                          <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                            {key}
                          </p>
                          <Textarea
                            value={noteEditDraft[key]}
                            onChange={(e) => setNoteEditDraft({ ...noteEditDraft, [key]: e.target.value })}
                            className="min-h-[100px] text-xs leading-relaxed"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {[
                          { label: 'Subjective', value: note.subjective },
                          { label: 'Objective', value: note.objective },
                          { label: 'Assessment', value: note.assessment },
                          { label: 'Plan', value: note.plan },
                        ].map(
                          (section) =>
                            section.value && (
                              <div key={section.label}>
                                <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">
                                  {section.label}
                                </p>
                                <p className={`text-xs text-muted-foreground leading-relaxed whitespace-pre-line ${expandedNoteIds.has(note.id) ? '' : 'line-clamp-4'}`}>
                                  {section.value}
                                </p>
                              </div>
                            )
                        )}
                      </div>
                      {(note.subjective || note.objective || note.assessment || note.plan) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 mt-2 text-xs text-primary hover:text-primary"
                          onClick={() => {
                            setExpandedNoteIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(note.id)) next.delete(note.id);
                              else next.add(note.id);
                              return next;
                            });
                          }}
                        >
                          {expandedNoteIds.has(note.id) ? 'Show less' : 'Show full note'}
                        </Button>
                      )}
                    </>
                  )}
                </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              No visits recorded yet.
            </p>
          )}
        </Card>
      </div>

      {editingPatient && (
        <EditPatientDialog
          open={!!editingPatient}
          onOpenChange={(open) => {
            if (!open) setEditingPatient(null);
          }}
          patient={editingPatient}
        />
      )}
    </div>
  );
}

const PatientProfilePage = () => {
  return (
    <PageLayout>
      <PatientProfileContent />
    </PageLayout>
  );
};

export default PatientProfilePage;
