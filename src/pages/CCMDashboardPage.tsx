import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { usePatientStore } from '@/store/patientStore';
import { AppSidebar, MobileHeader } from '@/components/AppSidebar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Plus, Timer, Play, Pause, Square, Flame, DollarSign,
  Download, Upload, ArrowUpDown, Lightbulb, X, UserPlus, Stethoscope
} from 'lucide-react';
import CCMBatchUpload from '@/components/CCMBatchUpload';
import PeriodMetricsBar from '@/components/PeriodMetricsBar';
import { Checkbox } from '@/components/ui/checkbox';

// Medicare CCM billable activities per CMS guidelines
const CCM_ACTIVITIES = [
  { id: 'chart_review', label: 'Chart Review / Medical Record Review' },
  { id: 'care_plan', label: 'Care Plan Creation / Update' },
  { id: 'phone_call', label: 'Phone Call with Patient / Caregiver' },
  { id: 'medication_mgmt', label: 'Medication Management / Reconciliation' },
  { id: 'care_coordination', label: 'Care Coordination with Specialists' },
  { id: 'referral', label: 'Referral Management' },
  { id: 'lab_review', label: 'Lab / Test Results Review' },
  { id: 'patient_education', label: 'Patient Education' },
  { id: 'symptom_assessment', label: 'Symptom / Condition Assessment' },
  { id: 'transition_care', label: 'Transition of Care Management' },
  { id: 'community_resources', label: 'Community Resource Coordination' },
  { id: 'goals_review', label: 'Goals / Outcomes Review' },
  { id: 'preventive_care', label: 'Preventive Care Planning' },
  { id: 'other', label: 'Other Clinical Activity' },
];

// Medicare RPM billable activities per CMS guidelines
const RPM_ACTIVITIES = [
  { id: 'device_setup', label: 'Device Setup / Patient Education on Device Use' },
  { id: 'reading_review', label: 'Review of Physiologic Device Readings (BP, glucose, weight, SpO2)' },
  { id: 'trend_analysis', label: 'Trend Analysis / Data Interpretation' },
  { id: 'phone_call', label: 'Phone Call with Patient / Caregiver re: Readings' },
  { id: 'medication_titration', label: 'Medication Titration Based on Readings' },
  { id: 'care_plan_update', label: 'RPM Care Plan Update' },
  { id: 'provider_communication', label: 'Communication with Provider re: Readings' },
  { id: 'alert_response', label: 'Response to Out-of-Range Alert' },
  { id: 'device_troubleshoot', label: 'Device Troubleshooting' },
  { id: 'patient_coaching', label: 'Patient Self-Management Coaching' },
  { id: 'documentation', label: 'Documentation of Physiologic Data' },
  { id: 'other', label: 'Other RPM Clinical Activity' },
];

// ─── Types ───────────────────────────────────────────────
interface TimeEntry {
  id: string;
  patient_id: string;
  date: string;
  minutes: number;
  staff: string | null;
  description: string | null;
  program: string;
}

interface PatientCCMSummary {
  patientId: string;
  name: string;
  dob: string;
  totalMinutes: number;
  program: string;
  entryCount: number;
  provider: string;
  location: string;
}

// ─── Constants ───────────────────────────────────────────
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function getMonthRange(year: number, month: number) {
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const end = new Date(year, month + 1, 0);
  const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  return { start, end: endStr };
}

function getStatusInfo(minutes: number) {
  if (minutes >= 40) return { color: 'bg-amber-500', label: 'Gold (40+ min)', key: '40+' };
  if (minutes >= 35) return { color: 'bg-primary', label: 'Blue (35-39 min)', key: '35-39' };
  if (minutes >= 20) return { color: 'bg-[hsl(var(--success))]', label: 'Green (20+ min)', key: '20+' };
  if (minutes >= 15) return { color: 'bg-[hsl(25,90%,50%)]', label: 'Orange (15-19 min)', key: '15-19' };
  if (minutes >= 10) return { color: 'bg-[hsl(var(--warning))]', label: 'Yellow (10-14 min)', key: '10-14' };
  return { color: 'bg-destructive', label: 'Red (0-9 min)', key: '0-9' };
}

function getNextThreshold(minutes: number) {
  if (minutes < 20) return 20;
  if (minutes < 40) return 40;
  if (minutes < 60) return 60;
  return null;
}

// ═════════════════════════════════════════════════════════
export default function CCMDashboardPage({ program = 'CCM' }: { program?: 'CCM' | 'RPM' } = {}) {
  const ACTIVITIES = program === 'RPM' ? RPM_ACTIVITIES : CCM_ACTIVITIES;
  const programLabel = program; // 'CCM' or 'RPM'
  const { patients, fetchPatients, selectPatient } = usePatientStore();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear] = useState(now.getFullYear());

  // Timer state
  const [timerActive, setTimerActive] = useState(false);
  const [timerPaused, setTimerPaused] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerPatientId, setTimerPatientId] = useState('');

  // Provider filter
  const [selectedProvider, setSelectedProvider] = useState('all');

  // Add entry dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newEntry, setNewEntry] = useState<{ patient_id: string; minutes: string; staff: string; description: string; program: string; date: string }>({
    patient_id: '', minutes: '', staff: '', description: '', program: programLabel,
    date: new Date().toISOString().split('T')[0],
  });

  // Patients tab filters
  const [patientProgramFilter, setPatientProgramFilter] = useState('all');
  const [patientStatusFilter, setPatientStatusFilter] = useState('all');
  const [patientProviderFilter, setPatientProviderFilter] = useState('all');
  const [patientLocationFilter, setPatientLocationFilter] = useState('all');
  const [patientSort, setPatientSort] = useState<{ key: string; asc: boolean }>({ key: 'name', asc: true });

  // Settings state
  const [providers, setProviders] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [newProvider, setNewProvider] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [practiceName, setPracticeName] = useState('');

  // CSV import
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [batchUploadOpen, setBatchUploadOpen] = useState(false);

  // Stop & Save activity checklist
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [stopNote, setStopNote] = useState('');

  // ─── Effects ───────────────────────────────────────────
  useEffect(() => {
    if (patients.length === 0) fetchPatients();
  }, [patients.length, fetchPatients]);

  useEffect(() => { fetchEntries(); }, [selectedMonth, selectedYear, program]);

  useEffect(() => {
    // Derive providers/locations from patients
    const provs = new Set<string>();
    const locs = new Set<string>();
    patients.forEach(p => {
      if (p.provider) provs.add(p.provider);
      if (p.location) locs.add(p.location);
    });
    setProviders(Array.from(provs).sort());
    setLocations(Array.from(locs).sort());
  }, [patients]);

  // Load settings
  useEffect(() => {
    const saved = localStorage.getItem(`${programLabel.toLowerCase()}_practice_name`);
    if (saved) setPracticeName(saved);
  }, []);

  // Timer tick
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (timerActive && !timerPaused) {
      interval = setInterval(() => setTimerSeconds(s => s + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [timerActive, timerPaused]);

  // ─── Data Fetching ────────────────────────────────────
  async function fetchEntries() {
    setLoading(true);
    const { start, end } = getMonthRange(selectedYear, selectedMonth);
    const { data, error } = await supabase
      .from('ccm_time_entries')
      .select('*')
      .eq('program', programLabel)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: false });

    if (error) console.error('Failed to fetch CCM entries:', error);
    else setEntries((data || []) as TimeEntry[]);
    setLoading(false);
  }

  // ─── Timer handlers ───────────────────────────────────
  function handleTimerStart() {
    if (!timerPatientId) { toast.error('Select a patient first'); return; }
    setTimerActive(true);
    setTimerPaused(false);
  }

  function handleTimerPause() { setTimerPaused(true); }
  function handleTimerResume() { setTimerPaused(false); }

  function handleTimerStop() {
    if (timerSeconds === 0 || !timerPatientId) {
      setTimerActive(false);
      setTimerPaused(false);
      setTimerSeconds(0);
      return;
    }
    // Pause timer and open activity checklist
    setTimerPaused(true);
    setSelectedActivities([]);
    setStopNote('');
    setStopDialogOpen(true);
  }

  function toggleActivity(id: string) {
    setSelectedActivities(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  }

  async function handleConfirmStop() {
    setTimerActive(false);
    setTimerPaused(false);
    setStopDialogOpen(false);
    const minutes = Math.ceil(timerSeconds / 60);
    if (minutes < 1 || !timerPatientId) { setTimerSeconds(0); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const activityLabels = selectedActivities.map(id =>
      ACTIVITIES.find(a => a.id === id)?.label || id
    );
    const description = [
      activityLabels.length ? `Activities: ${activityLabels.join('; ')}` : '',
      stopNote ? `Note: ${stopNote}` : '',
    ].filter(Boolean).join(' | ') || 'Timer tracked';

    const { error: insertErr } = await supabase.from('ccm_time_entries').insert({
      patient_id: timerPatientId,
      user_id: user.id,
      date: new Date().toISOString().split('T')[0],
      minutes,
      program: programLabel,
      description,
    });
    if (insertErr) {
      toast.error(insertErr.message.includes('not enrolled')
        ? `Patient is not enrolled in ${programLabel}. Enroll them before logging minutes.`
        : 'Failed to log time');
      setTimerSeconds(0);
      return;
    }
    toast.success(`${minutes} min logged with ${activityLabels.length} activities`);
    setTimerSeconds(0);
    setTimerPatientId('');
    fetchEntries();
  }

  function handleCancelStop() {
    setStopDialogOpen(false);
    // Resume timer if it was running
    setTimerPaused(false);
  }

  // ─── Add entry ────────────────────────────────────────
  async function handleAddEntry(e: React.FormEvent) {
    e.preventDefault();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('ccm_time_entries').insert({
      patient_id: newEntry.patient_id,
      user_id: user.id,
      date: newEntry.date,
      minutes: parseInt(newEntry.minutes) || 0,
      staff: newEntry.staff || null,
      description: newEntry.description || null,
      program: newEntry.program,
    });
    if (error) {
      toast.error(error.message.includes('not enrolled')
        ? `Patient is not enrolled in ${newEntry.program}. Enroll the patient first.`
        : 'Failed to add entry');
      return;
    }
    toast.success('Time entry added');
    setAddOpen(false);
    setNewEntry({ patient_id: '', minutes: '', staff: '', description: '', program: 'CCM', date: new Date().toISOString().split('T')[0] });
    fetchEntries();
  }

  // ─── Summaries ────────────────────────────────────────
  const patientSummaries: PatientCCMSummary[] = useMemo(() => {
    // Only include time entries for patients in the active clinic (loaded into store)
    const allowedIds = new Set(patients.map(p => p.id));
    const map = new Map<string, { minutes: number; programs: Set<string>; count: number }>();
    entries.forEach(e => {
      if (!allowedIds.has(e.patient_id)) return;
      const existing = map.get(e.patient_id) || { minutes: 0, programs: new Set<string>(), count: 0 };
      existing.minutes += e.minutes;
      existing.programs.add(e.program);
      existing.count += 1;
      map.set(e.patient_id, existing);
    });

    return Array.from(map.entries()).map(([patientId, data]) => {
      const patient = patients.find(p => p.id === patientId);
      const programs = Array.from(data.programs);
      return {
        patientId,
        name: patient ? `${patient.lastName}, ${patient.firstName}` : 'Unknown',
        dob: patient?.dob || '',
        totalMinutes: data.minutes,
        program: programs.length > 1 ? 'Both' : programs[0] || 'CCM',
        entryCount: data.count,
        provider: patient?.provider || '',
        location: patient?.location || '',
      };
    }).sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [entries, patients]);

  // Filter by provider for dashboard
  const filteredSummaries = useMemo(() => {
    if (selectedProvider === 'all') return patientSummaries;
    return patientSummaries.filter(p => p.provider === selectedProvider);
  }, [patientSummaries, selectedProvider]);

  const totalPatients = filteredSummaries.length;
  const billablePatients = filteredSummaries.filter(p => p.totalMinutes >= 20).length;
  const zeroMinutes = filteredSummaries.filter(p => p.totalMinutes === 0).length;

  const almostThere = filteredSummaries.filter(p => {
    if (p.totalMinutes >= 15 && p.totalMinutes < 20) return true;
    if (p.totalMinutes >= 35 && p.totalMinutes < 40) return true;
    return false;
  }).sort((a, b) => {
    const aNeeded = a.totalMinutes < 20 ? 20 - a.totalMinutes : 40 - a.totalMinutes;
    const bNeeded = b.totalMinutes < 20 ? 20 - b.totalMinutes : 40 - b.totalMinutes;
    return aNeeded - bNeeded;
  });

  const totalMinutesLogged = entries.reduce((s, e) => s + e.minutes, 0);
  const avgMinPerPatient = totalPatients > 0 ? (totalMinutesLogged / totalPatients).toFixed(1) : '0';

  // Revenue
  const revenueItems = useMemo(() => {
    const items: { code: string; label: string; pts: number; revenue: number }[] = [];
    // Medicare 2026 national non-facility allowed amounts (CY2026 PFS final rule)
    const ccm20 = filteredSummaries.filter(p => p.totalMinutes >= 20 && (p.program === 'CCM' || p.program === 'Both'));
    if (ccm20.length) items.push({ code: '99490', label: 'CCM Staff First 20 min', pts: ccm20.length, revenue: ccm20.length * 60.49 });

    const ccm30 = filteredSummaries.filter(p => p.totalMinutes >= 30 && (p.program === 'CCM' || p.program === 'Both'));
    if (ccm30.length) items.push({ code: '99491', label: 'CCM Provider 30 min*', pts: ccm30.length, revenue: ccm30.length * 76.94 });

    const rpm20 = filteredSummaries.filter(p => p.totalMinutes >= 20 && (p.program === 'RPM' || p.program === 'Both'));
    if (rpm20.length) items.push({ code: '99457', label: 'RPM First 20 min', pts: rpm20.length, revenue: rpm20.length * 48.14 });

    const rpm40 = filteredSummaries.filter(p => p.totalMinutes >= 40 && (p.program === 'RPM' || p.program === 'Both'));
    if (rpm40.length) items.push({ code: '99458', label: 'RPM Addl 20 min', pts: rpm40.length, revenue: rpm40.length * 38.49 });

    return items;
  }, [filteredSummaries]);

  const estimatedTotal = revenueItems.reduce((s, i) => s + i.revenue, 0);

  // CCM Service Time Status — 6 buckets matching Medicare time tiers
  const serviceTimeBuckets = useMemo(() => {
    const buckets = [
      { label: 'Not started',     range: '0 min',         min: 0,  max: 0,   count: 0, text: 'text-rose-500',    bg: 'bg-rose-50 dark:bg-rose-950/30',       border: 'border-rose-200/60' },
      { label: '00:01-10:00',     range: '(Min:Sec)',     min: 1,  max: 10,  count: 0, text: 'text-orange-500',  bg: 'bg-orange-50 dark:bg-orange-950/30',   border: 'border-orange-200/60' },
      { label: '10:01-19:59',     range: '(Min:Sec)',     min: 11, max: 19,  count: 0, text: 'text-amber-500',   bg: 'bg-amber-50 dark:bg-amber-950/30',     border: 'border-amber-200/60' },
      { label: '20:00-39:59',     range: '(Min:Sec)',     min: 20, max: 39,  count: 0, text: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200/60' },
      { label: '40:00-59:59',     range: '(Min:Sec)',     min: 40, max: 59,  count: 0, text: 'text-sky-500',     bg: 'bg-sky-50 dark:bg-sky-950/30',         border: 'border-sky-200/60' },
      { label: '60:00 & above',   range: '(Min:Sec)',     min: 60, max: 9999,count: 0, text: 'text-violet-500',  bg: 'bg-violet-50 dark:bg-violet-950/30',   border: 'border-violet-200/60' },
    ];
    filteredSummaries.forEach(p => {
      const bucket = buckets.find(b => p.totalMinutes >= b.min && p.totalMinutes <= b.max);
      if (bucket) bucket.count++;
    });
    return buckets;
  }, [filteredSummaries]);

  const totalForBar = Math.max(serviceTimeBuckets.reduce((s, b) => s + b.count, 0), 1);

  // Provider performance
  const providerPerformance = useMemo(() => {
    const provMap = new Map<string, { patients: Set<string>; minutes: number; billable: number; entries: number }>();
    patientSummaries.forEach(ps => {
      const prov = ps.provider || 'Unassigned';
      const existing = provMap.get(prov) || { patients: new Set<string>(), minutes: 0, billable: 0, entries: 0 };
      existing.patients.add(ps.patientId);
      existing.minutes += ps.totalMinutes;
      existing.entries += ps.entryCount;
      if (ps.totalMinutes >= 20) existing.billable++;
      provMap.set(prov, existing);
    });
    return Array.from(provMap.entries()).map(([name, data]) => ({
      name,
      patients: data.patients.size,
      totalMinutes: data.minutes,
      billable: data.billable,
      entries: data.entries,
      avgMin: data.patients.size > 0 ? Math.round(data.minutes / data.patients.size) : 0,
    })).sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [patientSummaries]);

  // Patients tab filtered & sorted list
  const filteredPatientList = useMemo(() => {
    let list = [...patientSummaries];
    if (patientProgramFilter !== 'all') list = list.filter(p => p.program === patientProgramFilter);
    if (patientStatusFilter !== 'all') {
      list = list.filter(p => {
        const s = getStatusInfo(p.totalMinutes);
        return s.key === patientStatusFilter;
      });
    }
    if (patientProviderFilter !== 'all') list = list.filter(p => p.provider === patientProviderFilter);
    if (patientLocationFilter !== 'all') list = list.filter(p => p.location === patientLocationFilter);

    list.sort((a, b) => {
      let cmp = 0;
      switch (patientSort.key) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'minutes': cmp = a.totalMinutes - b.totalMinutes; break;
        case 'provider': cmp = (a.provider || '').localeCompare(b.provider || ''); break;
        case 'location': cmp = (a.location || '').localeCompare(b.location || ''); break;
        default: cmp = a.name.localeCompare(b.name);
      }
      return patientSort.asc ? cmp : -cmp;
    });
    return list;
  }, [patientSummaries, patientProgramFilter, patientStatusFilter, patientProviderFilter, patientLocationFilter, patientSort]);

  function toggleSort(key: string) {
    setPatientSort(prev => prev.key === key ? { key, asc: !prev.asc } : { key, asc: true });
  }

  // Settings handlers
  function addProvider() {
    if (!newProvider.trim()) return;
    setProviders(prev => [...prev, newProvider.trim()].sort());
    setNewProvider('');
  }
  function removeProvider(name: string) { setProviders(prev => prev.filter(p => p !== name)); }
  function addLocation() {
    if (!newLocation.trim()) return;
    setLocations(prev => [...prev, newLocation.trim()].sort());
    setNewLocation('');
  }
  function removeLocation(name: string) { setLocations(prev => prev.filter(l => l !== name)); }
  function savePracticeName() {
    localStorage.setItem(`${programLabel.toLowerCase()}_practice_name`, practiceName);
    toast.success('Practice name saved');
  }

  // Export
  function handleExport() {
    const data = { patients: patientSummaries, entries, exportDate: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ccm-export-${MONTHS[selectedMonth]}-${selectedYear}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Data exported');
  }

  // CSV Import
  async function handleCSVImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) { toast.error('CSV must have a header row + data'); return; }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const nameIdx = headers.indexOf('name');
    const dobIdx = headers.indexOf('dob');
    const providerIdx = headers.indexOf('provider');
    const locationIdx = headers.indexOf('location');
    const programIdx = headers.indexOf('program');

    if (nameIdx === -1) { toast.error('CSV must have a "name" column'); return; }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let imported = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const name = cols[nameIdx] || '';
      if (!name) continue;
      const parts = name.split(/\s+/);
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ') || 'Unknown';

      const { error } = await supabase.from('patients').insert({
        user_id: user.id,
        first_name: firstName,
        last_name: lastName,
        dob: dobIdx >= 0 ? cols[dobIdx] || '2000-01-01' : '2000-01-01',
        mrn: `IMP-${Date.now()}-${i}`,
        gender: 'male',
        provider: providerIdx >= 0 ? cols[providerIdx] || null : null,
        location: locationIdx >= 0 ? cols[locationIdx] || null : null,
      } as any);

      if (!error) imported++;
    }
    toast.success(`${imported} patients imported`);
    fetchPatients();
    if (csvInputRef.current) csvInputRef.current.value = '';
  }

  const formatTimer = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  // ═════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════
  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <div className="flex-1 flex flex-col">
        <MobileHeader />
        <div className="flex-1 p-4 md:p-6 overflow-auto">
          <div className="max-w-7xl mx-auto space-y-5">
            {/* ─── Period Metrics ───────────────────── */}
            <PeriodMetricsBar program={programLabel} />

            {/* ─── Top Bar ──────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-1 border-b border-border/60">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">{programLabel} · Care Management</p>
                <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
                  {practiceName || `${programLabel} Tracker`}
                </h1>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(parseInt(v))}>
                  <SelectTrigger className="w-[140px] h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i} value={String(i)}>{m} {selectedYear}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                  <SelectTrigger className="w-[140px] h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Providers</SelectItem>
                    {providers.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Dialog open={addOpen} onOpenChange={setAddOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="h-9 gap-1 text-sm">
                      <Plus className="w-4 h-4" /> Patient
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Log {programLabel} Time</DialogTitle></DialogHeader>
                    <form onSubmit={handleAddEntry} className="space-y-4">
                      <div>
                        <Label>Patient</Label>
                        <Select value={newEntry.patient_id} onValueChange={v => setNewEntry(p => ({ ...p, patient_id: v }))}>
                          <SelectTrigger><SelectValue placeholder="Select patient" /></SelectTrigger>
                          <SelectContent>
                            {patients.map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.lastName}, {p.firstName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Minutes</Label>
                          <Input type="number" min="1" value={newEntry.minutes} onChange={e => setNewEntry(p => ({ ...p, minutes: e.target.value }))} required />
                        </div>
                        <div>
                          <Label>Program</Label>
                          <Select value={newEntry.program} onValueChange={v => setNewEntry(p => ({ ...p, program: v }))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CCM">CCM</SelectItem>
                              <SelectItem value="RPM">RPM</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <Label>Date</Label>
                        <Input type="date" value={newEntry.date} onChange={e => setNewEntry(p => ({ ...p, date: e.target.value }))} />
                      </div>
                      <div>
                        <Label>Staff</Label>
                        <Input value={newEntry.staff} onChange={e => setNewEntry(p => ({ ...p, staff: e.target.value }))} placeholder="e.g. Megan H, MA" />
                      </div>
                      <div>
                        <Label>Description</Label>
                        <Textarea value={newEntry.description} onChange={e => setNewEntry(p => ({ ...p, description: e.target.value }))} placeholder="Brief note..." rows={2} />
                      </div>
                      <Button type="submit" className="w-full">Save Entry</Button>
                    </form>
                  </DialogContent>
                </Dialog>
                <Button size="sm" variant="outline" className="h-9 gap-1 text-sm" onClick={() => setBatchUploadOpen(true)}>
                  <Stethoscope className="w-3.5 h-3.5" /> Batch Chart
                </Button>
                <Button size="sm" variant="outline" className="h-9 gap-1 text-sm" onClick={handleExport}>
                  <Download className="w-3.5 h-3.5" /> Export
                </Button>
              </div>
            </div>

            {/* ─── Timer ────────────────────────────── */}
            <Card className="p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-4 border-l-4 border-l-primary shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Timer className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Active session</p>
                  <div className="font-mono text-2xl md:text-3xl font-bold text-foreground tabular-nums tracking-tight leading-none mt-0.5">{formatTimer(timerSeconds)}</div>
                </div>
              </div>
              <div className="hidden sm:block h-10 w-px bg-border" />
              <Select value={timerPatientId} onValueChange={setTimerPatientId}>
                <SelectTrigger className="w-full sm:w-[220px] h-9 text-sm">
                  <SelectValue placeholder="Select patient" />
                </SelectTrigger>
                <SelectContent>
                  {patients.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.lastName}, {p.firstName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2 sm:ml-auto">
                {!timerActive ? (
                  <Button size="sm" variant="outline" onClick={handleTimerStart} className="gap-1">
                    <Play className="w-3 h-3" /> Start
                  </Button>
                ) : timerPaused ? (
                  <Button size="sm" variant="outline" onClick={handleTimerResume} className="gap-1">
                    <Play className="w-3 h-3" /> Resume
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={handleTimerPause} className="gap-1">
                    <Pause className="w-3 h-3" /> Pause
                  </Button>
                )}
                <Button size="sm" variant="default" onClick={handleTimerStop} disabled={timerSeconds === 0} className="gap-1">
                  <Square className="w-3 h-3" /> Stop & Save
                </Button>
              </div>
            </Card>


            {/* ─── Stop & Save Activity Checklist Dialog ─── */}
            <Dialog open={stopDialogOpen} onOpenChange={(open) => { if (!open) handleCancelStop(); }}>
              <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Timer className="w-5 h-5 text-primary" />
                    Log Activities — {formatTimer(timerSeconds)} ({Math.ceil(timerSeconds / 60)} min)
                  </DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">Select all {programLabel} activities performed during this session (per Medicare guidelines):</p>
                <div className="space-y-2 mt-2">
                  {ACTIVITIES.map(activity => (
                    <label
                      key={activity.id}
                      className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <Checkbox
                        checked={selectedActivities.includes(activity.id)}
                        onCheckedChange={() => toggleActivity(activity.id)}
                      />
                      <span className="text-sm">{activity.label}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-3">
                  <Label className="text-sm">Additional Notes (optional)</Label>
                  <Textarea
                    value={stopNote}
                    onChange={e => setStopNote(e.target.value)}
                    placeholder="Brief description of what was done..."
                    rows={2}
                    className="mt-1"
                  />
                </div>
                <div className="flex gap-2 mt-4">
                  <Button variant="outline" className="flex-1" onClick={handleCancelStop}>
                    Cancel & Resume
                  </Button>
                  <Button className="flex-1" onClick={handleConfirmStop}>
                    Save Entry
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* ─── Main Tabs ────────────────────────── */}
            <Tabs defaultValue="dashboard" className="space-y-4">
              <TabsList>
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                <TabsTrigger value="patients">Patients</TabsTrigger>
                <TabsTrigger value="providers">Providers</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>

              {/* ═══ DASHBOARD TAB ═══ */}
              <TabsContent value="dashboard" className="space-y-6">

                {/* Executive summary banner */}
                <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-primary via-primary to-[hsl(195,75%,28%)] text-primary-foreground shadow-sm">
                  <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />
                  <div className="relative p-5 md:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] font-semibold opacity-70">
                        {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                      </p>
                      <h2 className="text-xl md:text-2xl font-semibold mt-1 tracking-tight">
                        {programLabel} Performance — {MONTHS[selectedMonth]} {selectedYear}
                      </h2>
                      <p className="text-sm opacity-80 mt-1">
                        {billablePatients} of {totalPatients} patients billable · {totalMinutesLogged.toLocaleString()} minutes logged
                      </p>
                    </div>
                    <div className="flex items-center gap-6 md:border-l md:border-white/20 md:pl-6">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider opacity-70">Projected</p>
                        <p className="font-mono text-2xl md:text-3xl font-bold tabular-nums tracking-tight">${estimatedTotal.toFixed(0)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider opacity-70">Avg / pt</p>
                        <p className="font-mono text-2xl md:text-3xl font-bold tabular-nums tracking-tight">{avgMinPerPatient}<span className="text-sm font-normal opacity-70 ml-1">min</span></p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Top stat cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { icon: UserPlus, label: 'Total Active Patients', value: totalPatients, badge: `${totalPatients}`, badgeTone: 'bg-muted text-muted-foreground', accent: 'border-l-primary', iconBg: 'bg-primary/10 text-primary' },
                    { icon: DollarSign, label: 'Billable (20+ min)', value: billablePatients, badge: `${totalPatients > 0 ? Math.round((billablePatients / totalPatients) * 100) : 0}%`, badgeTone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', accent: 'border-l-emerald-500', iconBg: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300' },
                    { icon: X, label: 'Zero Minutes', value: zeroMinutes, badge: 'Attention', badgeTone: 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', accent: 'border-l-rose-500', iconBg: 'bg-rose-50 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300' },
                    { icon: Flame, label: 'Almost There (≤5 min)', value: almostThere.length, badge: 'Push', badgeTone: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', accent: 'border-l-amber-500', iconBg: 'bg-amber-50 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300' },
                  ].map((s, i) => {
                    const Icon = s.icon;
                    return (
                      <Card key={i} className={`p-4 border-l-4 ${s.accent} shadow-sm hover:shadow-md transition-shadow`}>
                        <div className="flex items-start justify-between">
                          <div className={`w-9 h-9 rounded-lg ${s.iconBg} flex items-center justify-center`}>
                            <Icon className="w-4.5 h-4.5" strokeWidth={2.25} />
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.badgeTone}`}>{s.badge}</span>
                        </div>
                        <p className="text-3xl font-bold text-foreground mt-3 font-mono tabular-nums tracking-tight">{s.value}</p>
                        <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                      </Card>
                    );
                  })}
                </div>

                {/* CCM Service Time Status — 6-bucket grid */}
                <Card className="p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-border/60">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Timer className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{programLabel} Service Time Distribution</h3>
                        <p className="text-[11px] text-muted-foreground">Medicare time tier breakdown</p>
                      </div>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-muted-foreground">{totalForBar} patients</span>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {serviceTimeBuckets.map(b => {
                      const pct = totalForBar > 0 ? ((b.count / totalForBar) * 100).toFixed(2) : '0.00';
                      return (
                        <div key={b.label} className={`rounded-xl ${b.bg} border ${b.border} p-3 text-center transition-transform hover:scale-[1.02]`}>
                          <p className="text-[11px] font-semibold text-muted-foreground">{pct}%</p>
                          <p className={`text-3xl md:text-4xl font-extrabold ${b.text} font-mono tabular-nums my-1`}>
                            {String(b.count).padStart(2, '0')}
                          </p>
                          <p className="text-[11px] font-semibold text-foreground">{b.label}</p>
                          <p className="text-[10px] text-muted-foreground">{b.range}</p>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                <div className="grid lg:grid-cols-5 gap-6">
                  {/* Almost There (left) */}
                  <div className="lg:col-span-3 space-y-6">
                    {almostThere.length > 0 ? (
                      <Card className="p-5 border-0 shadow-sm">
                        <div className="flex items-center gap-2 mb-1">
                          <Flame className="w-5 h-5 text-orange-500" />
                          <h2 className="text-base font-bold text-orange-500">ALMOST THERE — Push These Patients!</h2>
                        </div>
                        <p className="text-xs text-muted-foreground mb-4">Patients needing 5 or fewer minutes to hit the next billing code</p>
                        <div className="space-y-2">
                          {almostThere.map(p => {
                            const nextTier = p.totalMinutes < 20 ? 20 : 40;
                            const needed = nextTier - p.totalMinutes;
                            return (
                              <div key={p.patientId} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted/80 transition-colors" onClick={() => { setTimerPatientId(p.patientId); setTimerActive(true); setTimerPaused(false); setTimerSeconds(0); toast.success(`Timer started for ${p.name}`); }}>
                                <div>
                                  <span className="font-semibold text-sm text-foreground">{p.name}</span>
                                  <span className="text-xs text-muted-foreground ml-2">{p.totalMinutes} min · {p.program}</span>
                                </div>
                                <span className="text-xs font-semibold text-orange-500">
                                  Need {needed} min → {nextTier} min
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    ) : (
                      <Card className="p-8 border-0 shadow-sm text-center text-sm text-muted-foreground">
                        No patients in the 15-19 or 35-39 min push zone right now 🎉
                      </Card>
                    )}
                  </div>

                  {/* Right Column */}
                  <div className="lg:col-span-2 space-y-6">

                    {/* Revenue */}
                    <Card className="p-5">
                      <h3 className="text-sm font-semibold text-foreground mb-4">Revenue Projection</h3>
                      {revenueItems.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No billable patients yet</p>
                      ) : (
                        <div className="space-y-3">
                          {revenueItems.map(item => (
                            <div key={item.code} className="flex items-center justify-between text-sm">
                              <div>
                                <span className="text-muted-foreground">{item.code} — </span>
                                <span className="text-foreground">{item.label}</span>
                                <span className="text-muted-foreground ml-2">{item.pts} pts</span>
                              </div>
                              <span className="font-semibold text-[hsl(var(--success))]">${item.revenue.toFixed(0)}</span>
                            </div>
                          ))}
                          {/* 99491 tip */}
                          {revenueItems.find(r => r.code === '99491') && (
                            <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground flex items-start gap-2">
                              <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                              <span>*99491: eligible if PROVIDER (NP/MD) personally logged 30+ non-F2F min. Bills INSTEAD of 99490 (not in addition).</span>
                            </div>
                          )}
                          <div className="border-t border-border pt-3 flex items-center justify-between">
                            <span className="font-semibold text-foreground">Estimated Total</span>
                            <span className="text-lg font-bold text-[hsl(var(--success))]">${estimatedTotal.toFixed(0)}</span>
                          </div>
                        </div>
                      )}
                    </Card>

                    {/* Quick Stats */}
                    <Card className="p-5">
                      <h3 className="text-sm font-semibold text-foreground mb-4">Quick Stats</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs text-muted-foreground">Total Minutes Logged</p>
                          <p className="text-2xl font-bold text-foreground">{totalMinutesLogged}</p>
                        </div>
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs text-muted-foreground">Avg Min/Patient</p>
                          <p className="text-2xl font-bold text-foreground">{avgMinPerPatient}</p>
                        </div>
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs text-muted-foreground">Time Entries</p>
                          <p className="text-2xl font-bold text-foreground">{entries.length}</p>
                        </div>
                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs text-muted-foreground">Orange Zone (PUSH!)</p>
                          <p className="text-2xl font-bold text-[hsl(25,90%,50%)]">{almostThere.length}</p>
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>
              </TabsContent>

              {/* ═══ PATIENTS TAB ═══ */}
              <TabsContent value="patients" className="space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap gap-2">
                  <Select value={patientProgramFilter} onValueChange={setPatientProgramFilter}>
                    <SelectTrigger className="w-[130px] h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Programs</SelectItem>
                      <SelectItem value="CCM">CCM</SelectItem>
                      <SelectItem value="RPM">RPM</SelectItem>
                      <SelectItem value="Both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={patientStatusFilter} onValueChange={setPatientStatusFilter}>
                    <SelectTrigger className="w-[160px] h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="0-9">Red (0-9 min)</SelectItem>
                      <SelectItem value="10-14">Yellow (10-14 min)</SelectItem>
                      <SelectItem value="15-19">Orange (15-19 min)</SelectItem>
                      <SelectItem value="20+">Green (20+ min)</SelectItem>
                      <SelectItem value="35-39">Blue (35-39 min)</SelectItem>
                      <SelectItem value="40+">Gold (40+ min)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={patientProviderFilter} onValueChange={setPatientProviderFilter}>
                    <SelectTrigger className="w-[140px] h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Providers</SelectItem>
                      {providers.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={patientLocationFilter} onValueChange={setPatientLocationFilter}>
                    <SelectTrigger className="w-[140px] h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Locations</SelectItem>
                      {locations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* Table */}
                <Card className="p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {[
                            { key: 'name', label: 'Name' },
                            { key: 'dob', label: 'DOB' },
                            { key: 'program', label: 'Program' },
                            { key: 'provider', label: 'Provider' },
                            { key: 'location', label: 'Location' },
                            { key: 'minutes', label: 'Minutes' },
                            { key: 'status', label: 'Status' },
                            { key: 'threshold', label: 'Next Threshold' },
                            { key: 'needed', label: 'Mins Needed' },
                            { key: 'actions', label: '' },
                          ].map(col => (
                            <th
                              key={col.key}
                              className="px-3 py-2.5 text-left font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors text-xs"
                              onClick={() => toggleSort(col.key)}
                            >
                              <span className="flex items-center gap-1">
                                {col.label}
                                <ArrowUpDown className="w-3 h-3 opacity-40" />
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPatientList.length === 0 ? (
                          <tr><td colSpan={10} className="text-center py-8 text-muted-foreground">No patients match filters</td></tr>
                        ) : filteredPatientList.map(p => {
                          const status = getStatusInfo(p.totalMinutes);
                          const nextT = getNextThreshold(p.totalMinutes);
                          const needed = nextT ? nextT - p.totalMinutes : null;
                          return (
                            <tr key={p.patientId} className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => { setTimerPatientId(p.patientId); setTimerActive(true); setTimerPaused(false); setTimerSeconds(0); toast.success(`Timer started for ${p.name}`); }}>
                              <td className="px-3 py-2.5 font-medium text-foreground" onClick={(e) => { e.stopPropagation(); navigate(`/chart/${p.patientId}`); }}>
                                <span className="hover:underline hover:text-primary cursor-pointer">{p.name}</span>
                              </td>
                              <td className="px-3 py-2.5 text-muted-foreground">{p.dob ? new Date(p.dob).toLocaleDateString() : '—'}</td>
                              <td className="px-3 py-2.5"><Badge variant="outline" className="text-xs">{p.program}</Badge></td>
                              <td className="px-3 py-2.5 text-muted-foreground">{p.provider || '—'}</td>
                              <td className="px-3 py-2.5 text-muted-foreground">{p.location || '—'}</td>
                              <td className="px-3 py-2.5 font-mono font-medium text-foreground">{p.totalMinutes}</td>
                              <td className="px-3 py-2.5"><div className={`inline-block w-3 h-3 rounded-full ${status.color}`} title={status.label} /></td>
                              <td className="px-3 py-2.5 text-muted-foreground">{nextT ? `${nextT} min` : '✓'}</td>
                              <td className="px-3 py-2.5">
                                {needed !== null ? (
                                  <span className={`text-xs font-semibold ${needed <= 5 ? 'text-[hsl(25,90%,50%)]' : 'text-muted-foreground'}`}>
                                    {needed}
                                  </span>
                                ) : <span className="text-[hsl(var(--success))] text-xs font-semibold">✓</span>}
                              </td>
                              <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate(`/ccm/patient/${p.patientId}`)}>Open chart</Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </TabsContent>

              {/* ═══ PROVIDERS TAB ═══ */}
              <TabsContent value="providers" className="space-y-4">
                <h2 className="text-lg font-bold text-foreground">Provider Performance</h2>
                <Card className="p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Provider</th>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Patients</th>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Total Minutes Logged</th>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Billable Patients</th>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Entries This Month</th>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Avg Min/Patient</th>
                        </tr>
                      </thead>
                      <tbody>
                        {providerPerformance.length === 0 ? (
                          <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No provider data yet. Assign providers to patients in Settings.</td></tr>
                        ) : providerPerformance.map(prov => (
                          <tr key={prov.name} className="border-b border-border/50 hover:bg-muted/20">
                            <td className="px-4 py-2.5 font-medium text-foreground">{prov.name}</td>
                            <td className="px-4 py-2.5 text-foreground">{prov.patients}</td>
                            <td className="px-4 py-2.5 font-mono text-foreground">{prov.totalMinutes}</td>
                            <td className="px-4 py-2.5 text-[hsl(var(--success))] font-semibold">{prov.billable}</td>
                            <td className="px-4 py-2.5 text-foreground">{prov.entries}</td>
                            <td className="px-4 py-2.5 font-mono text-foreground">{prov.avgMin}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </TabsContent>

              {/* ═══ SETTINGS TAB ═══ */}
              <TabsContent value="settings" className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Manage Providers */}
                  <Card className="p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-3">Manage Providers</h3>
                    <div className="flex gap-2 mb-3">
                      <Input
                        value={newProvider}
                        onChange={e => setNewProvider(e.target.value)}
                        placeholder="e.g. Dr. Smith"
                        className="h-9 text-sm"
                        onKeyDown={e => e.key === 'Enter' && addProvider()}
                      />
                      <Button size="sm" onClick={addProvider} className="h-9">Add</Button>
                    </div>
                    <div className="space-y-1">
                      {providers.map(p => (
                        <div key={p} className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/50 text-sm">
                          <span className="text-foreground">{p}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeProvider(p)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                      {providers.length === 0 && <p className="text-xs text-muted-foreground">No providers added. Providers are derived from patient records or added here.</p>}
                    </div>
                  </Card>

                  {/* Manage Locations */}
                  <Card className="p-5">
                    <h3 className="text-sm font-semibold text-foreground mb-3">Manage Locations</h3>
                    <div className="flex gap-2 mb-3">
                      <Input
                        value={newLocation}
                        onChange={e => setNewLocation(e.target.value)}
                        placeholder="e.g. Main Clinic"
                        className="h-9 text-sm"
                        onKeyDown={e => e.key === 'Enter' && addLocation()}
                      />
                      <Button size="sm" onClick={addLocation} className="h-9">Add</Button>
                    </div>
                    <div className="space-y-1">
                      {locations.map(l => (
                        <div key={l} className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/50 text-sm">
                          <span className="text-foreground">{l}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeLocation(l)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                      {locations.length === 0 && <p className="text-xs text-muted-foreground">No locations added.</p>}
                    </div>
                  </Card>
                </div>

                {/* Practice Name */}
                <Card className="p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-1">Practice Name</h3>
                  <p className="text-xs text-muted-foreground mb-3">Shown in the header bar</p>
                  <div className="flex gap-2">
                    <Input
                      value={practiceName}
                      onChange={e => setPracticeName(e.target.value)}
                      placeholder="My Practice"
                      className="h-9 text-sm max-w-sm"
                    />
                    <Button size="sm" onClick={savePracticeName} className="h-9">Save</Button>
                  </div>
                </Card>

                {/* CSV Import */}
                <Card className="p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-1">Import Patients from CSV</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    CSV columns: name, dob, diagnoses, insurance, provider, location, program (CCM/RPM/Both)
                  </p>
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleCSVImport}
                    className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:opacity-90 cursor-pointer"
                  />
                </Card>

                {/* Data Management */}
                <Card className="p-5">
                  <h3 className="text-sm font-semibold text-foreground mb-3">Data Management</h3>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleExport} className="gap-1">
                      <Download className="w-3.5 h-3.5" /> Export All Data (JSON)
                    </Button>
                  </div>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
      <CCMBatchUpload
        open={batchUploadOpen}
        onOpenChange={setBatchUploadOpen}
        entries={entries}
        patients={patients.map(p => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, dob: p.dob, mrn: p.mrn }))}
        month={MONTHS[selectedMonth]}
        year={selectedYear}
      />
    </div>
  );
}
