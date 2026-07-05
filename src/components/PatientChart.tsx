import { useState, useEffect, useRef, useCallback } from 'react';
import { setActivePatientInExtension, clearActivePatientInExtension } from '@/lib/practiceFusionBridge';
import { usePatientStore } from '@/store/patientStore';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NoteEditor } from '@/components/NoteEditor';
import { NoteHistory } from '@/components/NoteHistory';
import { PatientTimeline } from '@/components/PatientTimeline';
import { MedicationList } from '@/components/MedicationList';
import { CareComplianceCard } from '@/components/CareComplianceCard';
import { CCMCarePlanCard } from '@/components/CCMCarePlanCard';
import { FamilyCommunication } from '@/components/FamilyCommunication';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EditPatientDialog } from '@/components/EditPatientDialog';
import { ArrowLeft, AlertTriangle, Phone, Calendar, Hash, Timer, Pause, Play, Send, Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const TASK_OPTIONS = [
  'Chart Review',
  'Care Plan Update',
  'Phone Call with Patient',
  'Phone Call with Caregiver',
  'Medication Reconciliation',
  'Referral Coordination',
  'Lab/Results Review',
  'Patient Education',
  'Symptom Monitoring',
  'Other',
];

export function PatientChart() {
  const { getSelectedPatient, selectedPatientId, fetchPatients, patients } = usePatientStore();
  const patient = getSelectedPatient();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('history');
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [timerProgram, setTimerProgram] = useState<'CCM' | 'RPM'>('CCM');
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [pendingMinutes, setPendingMinutes] = useState(0);
  const [taskDetails, setTaskDetails] = useState('');
  const [sendToDispatch, setSendToDispatch] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  // Auto-start timer and notify extension when patient is loaded
  useEffect(() => {
    if (patient) {
      setTimerSeconds(0);
      setTimerActive(true);
      startTimeRef.current = Date.now();
      setActivePatientInExtension({ id: patient.id, name: `${patient.firstName} ${patient.lastName}` });
    }
    return () => {
      clearActivePatientInExtension();
    };
    // No auto-save on unmount — we use the dialog instead
  }, [patient?.id]);

  // Timer tick
  useEffect(() => {
    if (timerActive) {
      timerRef.current = setInterval(() => setTimerSeconds(s => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerActive]);

  async function saveCCMTime(patientId: string, minutes: number, program: string = 'CCM', description: string = 'Auto-tracked from chart view') {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || minutes < 1) return;
    const { error } = await supabase.from('ccm_time_entries').insert({
      patient_id: patientId,
      user_id: user.id,
      date: new Date().toISOString().split('T')[0],
      minutes,
      program,
      description,
    });
    if (error) {
      const { toast } = await import('sonner');
      toast.error(error.message.includes('not enrolled')
        ? `Time not saved — patient is not enrolled in ${program}.`
        : 'Failed to save time entry');
    }
  }

  function handleBackClick() {
    setTimerActive(false);
    const minutes = Math.ceil(timerSeconds / 60);
    if (patient && minutes >= 1) {
      setPendingMinutes(minutes);
      setShowTaskDialog(true);
    } else {
      startTimeRef.current = 0;
      navigate('/');
    }
  }

  function genShareCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  async function getOrCreateTodayBatch(userId: string) {
    const today = new Date().toISOString().split('T')[0];
    const label = `CCM auto-dispatch ${today}`;
    const { data: existing } = await supabase
      .from('dispatch_batches')
      .select('id, share_code')
      .eq('user_id', userId)
      .eq('label', label)
      .maybeSingle();
    if (existing) return existing;
    const { data: created, error } = await supabase
      .from('dispatch_batches')
      .insert({
        user_id: userId,
        share_code: genShareCode(),
        label,
        instructions: 'Auto-queued CCM time entries from Chart Flo. Each row is a CMS-compliant non-face-to-face care management activity ready to chart in Practice Fusion.',
      })
      .select('id, share_code')
      .single();
    if (error) throw error;
    return created!;
  }

  async function pushToDispatch(task: string, minutes: number) {
    if (!patient) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setDispatching(true);
    try {
      // 1. AI-draft a short CMS-compliant CCM activity note
      const { data: draft } = await supabase.functions.invoke('ccm-log-assist', {
        body: {
          site: 'Chart Flo',
          minutes,
          patientName: `${patient.firstName} ${patient.lastName}`,
          userNote: task,
        },
      });
      const aiNote: string = draft?.note || `${task}. ${minutes} min of non-face-to-face CCM care management for ${patient.firstName} ${patient.lastName}.`;
      const activities: string[] = Array.isArray(draft?.activities) ? draft.activities : [task];

      const today = new Date().toISOString().split('T')[0];
      const subjective = `CCM monthly care management — ${activities.join(', ')}. ${minutes} minutes of non-face-to-face time logged on ${today}.`;
      const assessment = `Chronic care management activity per CMS 99490/99439 guidelines.`;
      const plan = aiNote;

      // 2. Save as a clinical note on this patient's chart
      await supabase.from('clinical_notes').insert({
        patient_id: patient.id,
        date: today,
        type: 'ccm',
        author: user.email ?? 'provider',
        subjective,
        objective: 'Non-face-to-face care management; no exam performed.',
        assessment,
        plan,
      });

      // 3. Append to today's dispatch batch
      const batch = await getOrCreateTodayBatch(user.id);
      const { count } = await supabase
        .from('dispatch_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batch.id);
      await supabase.from('dispatch_jobs').insert({
        batch_id: batch.id,
        position: count ?? 0,
        patient_name: `${patient.firstName} ${patient.lastName}`,
        mrn: patient.mrn,
        subjective,
        objective: 'Non-face-to-face care management; no exam performed.',
        assessment,
        plan,
      });

      toast.success(`Queued to Practice Fusion dispatch (code ${batch.share_code})`, {
        description: `${minutes} min · ${task}`,
      });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to queue dispatch');
    } finally {
      setDispatching(false);
    }
  }

  function handleTaskSelect(task: string) {
    const details = taskDetails.trim();
    // Combine the chosen task with the MA's free-text details so "Other" entries
    // and any task with extra context are captured verbatim in the log.
    const description = details ? `${task}: ${details}` : task;
    if (patient && pendingMinutes >= 1) {
      saveCCMTime(patient.id, pendingMinutes, timerProgram, description);
      toast.success(`${pendingMinutes} min ${timerProgram} logged — ${task}`);
      if (sendToDispatch && timerProgram === 'CCM') {
        // Fire and forget — don't block navigation
        pushToDispatch(description, pendingMinutes);
      }
    }
    setShowTaskDialog(false);
    setPendingMinutes(0);
    setTaskDetails('');
    startTimeRef.current = 0;
    navigate('/');
  }

  const formatTimer = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  useEffect(() => {
    if (patients.length === 0) fetchPatients();
  }, [patients.length, fetchPatients]);

  if (!patient) {
    return (
      <div className="flex-1 p-8 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-lg font-medium">No patient selected</p>
          <p className="text-sm mt-1">Select a patient from the dashboard</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/')}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const age = Math.floor((Date.now() - new Date(patient.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000));

  return (
    <div className="flex-1 p-4 md:p-6 overflow-auto">
      <div className="max-w-6xl mx-auto">
        {/* Patient Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={handleBackClick}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg md:text-xl font-semibold text-foreground">
                  {patient.lastName}, {patient.firstName}
                </h1>
                {patient.allergies.length > 0 && (
                  patient.allergies.every((a) => a.trim().toUpperCase() === 'NKDA') ? (
                    <Badge variant="secondary" className="gap-1 text-xs">NKDA</Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1 text-xs">
                      <AlertTriangle className="w-3 h-3" />
                      <span className="hidden sm:inline">Allergies: {patient.allergies.join(', ')}</span>
                      <span className="sm:hidden">{patient.allergies.length} Allerg{patient.allergies.length > 1 ? 'ies' : 'y'}</span>
                    </Badge>
                  )
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap text-xs md:text-sm text-muted-foreground mt-1">
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {age}yo · DOB {new Date(patient.dob).toLocaleDateString()}</span>
                <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> {patient.mrn}</span>
                {patient.phone && <span className="flex items-center gap-1 hidden sm:flex"><Phone className="w-3 h-3" /> {patient.phone}</span>}
              </div>
            </div>
          </div>
          {/* CCM/RPM Timer + Edit */}
          <div className="flex items-center gap-2 sm:ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setEditOpen(true)}
              title="Edit patient info / move practice"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Edit Info</span>
            </Button>
            <button
              onClick={() => setTimerProgram(timerProgram === 'CCM' ? 'RPM' : 'CCM')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                timerProgram === 'CCM'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {timerProgram}
            </button>
            <Badge variant="outline" className="gap-1.5 px-3 py-1.5 font-mono text-sm">
              <Timer className="w-3.5 h-3.5 text-primary" />
              <span className={timerActive ? 'text-primary' : 'text-muted-foreground'}>{formatTimer(timerSeconds)}</span>
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setTimerActive(!timerActive)}
            >
              {timerActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 flex-wrap h-auto">
            <TabsTrigger value="history">Note History</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="new-note">New Note</TabsTrigger>
            <TabsTrigger value="medications">Medications</TabsTrigger>
            <TabsTrigger value="care-plan">CCM Care Plan</TabsTrigger>
            <TabsTrigger value="compliance">CMS Compliance</TabsTrigger>
            <TabsTrigger value="family">Family Update</TabsTrigger>
          </TabsList>


          <TabsContent value="history">
            <NoteHistory patient={patient} />
          </TabsContent>

          <TabsContent value="timeline">
            <PatientTimeline patientId={patient.id} />
          </TabsContent>

          <TabsContent value="new-note">
            <NoteEditor patient={patient} onSaved={() => setActiveTab('history')} />
          </TabsContent>

          <TabsContent value="medications">
            <MedicationList patient={patient} />
          </TabsContent>

          <TabsContent value="care-plan">
            <CCMCarePlanCard patient={patient} />
          </TabsContent>

          <TabsContent value="compliance">
            <CareComplianceCard patient={patient} />
          </TabsContent>

          <TabsContent value="family">
            <FamilyCommunication patient={patient} />
          </TabsContent>


        </Tabs>
      </div>

      {/* Task Selection Dialog */}
      <Dialog open={showTaskDialog} onOpenChange={(open) => {
        if (!open) {
          // If dismissed without selecting, save with generic description
          handleTaskSelect('Chart Review');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>What task was completed?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 mt-1">
            <Label htmlFor="task-details" className="text-xs font-medium text-muted-foreground">
              Details (required for "Other", optional for the rest)
            </Label>
            <Textarea
              id="task-details"
              value={taskDetails}
              onChange={(e) => setTaskDetails(e.target.value)}
              placeholder="e.g. Called pharmacy to verify metformin refill; left voicemail for daughter re: BP cuff."
              rows={3}
              className="text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              These details are appended to the log entry so the MA can describe exactly what was done.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 mt-2">
            {TASK_OPTIONS.map(task => (
              <Button
                key={task}
                variant="outline"
                className="justify-start text-left h-auto py-3 px-4 hover:bg-primary hover:text-primary-foreground transition-colors"
                onClick={() => {
                  if (task === 'Other' && !taskDetails.trim()) {
                    toast.error('Please enter details before selecting "Other".');
                    return;
                  }
                  handleTaskSelect(task);
                }}
              >
                {task}
              </Button>
            ))}
          </div>
          {timerProgram === 'CCM' && (
            <label className="flex items-start gap-3 mt-3 p-3 rounded-md border border-border bg-muted/40 cursor-pointer">
              <Checkbox
                checked={sendToDispatch}
                onCheckedChange={(v) => setSendToDispatch(v === true)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Send className="w-3.5 h-3.5 text-primary" />
                  Also push to Practice Fusion dispatch
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  AI-draft a CMS-compliant CCM note and queue it on today's dispatch batch for the Chrome extension to chart automatically.
                </p>
              </div>
            </label>
          )}
        </DialogContent>
      </Dialog>
      {dispatching && (
        <div className="fixed bottom-4 right-4 bg-card border border-border shadow-lg rounded-md px-4 py-2 text-sm text-muted-foreground">
          Queuing to dispatch…
        </div>
      )}
      <EditPatientDialog open={editOpen} onOpenChange={setEditOpen} patient={patient} />
    </div>
  );
}
