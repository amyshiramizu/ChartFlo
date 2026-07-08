import { useState, useEffect } from 'react';
import { usePatientStore } from '@/store/patientStore';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, ChevronRight, AlertTriangle, Pencil, Filter, Download, Mic, FileText, HeartPulse, Activity, Upload } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AddPatientDialog } from '@/components/AddPatientDialog';
import { EditPatientDialog } from '@/components/EditPatientDialog';
import { PFImportDialog } from '@/components/PFImportDialog';
import { PatientListUploadDialog } from '@/components/PatientListUploadDialog';
import { supabase } from '@/integrations/supabase/client';
import type { Patient } from '@/types/patient';

export function PatientDashboard() {
  const { patients, selectPatient, fetchPatients, loading } = usePatientStore();
  const [search, setSearch] = useState('');
  
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [stats, setStats] = useState({ notes: 0, ccmMinutes: 0, rpmMinutes: 0 });
  const navigate = useNavigate();

  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  useEffect(() => {
    (async () => {
      const activeClinicId = localStorage.getItem('chart_scribe_active_clinic');
      let patientIds: string[] = patients.map((p) => p.id);
      if (patientIds.length === 0) {
        let q = supabase.from('patients').select('id');
        if (activeClinicId) q = q.eq('clinic_id', activeClinicId);
        const { data } = await q;
        patientIds = (data || []).map((p: any) => p.id);
      }
      if (patientIds.length === 0) {
        setStats({ notes: 0, ccmMinutes: 0, rpmMinutes: 0 });
        return;
      }
      const [notesRes, timeRes] = await Promise.all([
        supabase.from('clinical_notes').select('id', { count: 'exact', head: true }).in('patient_id', patientIds),
        supabase.from('ccm_time_entries').select('minutes, program').in('patient_id', patientIds),
      ]);
      const ccmMinutes = (timeRes.data || []).filter((e: any) => e.program === 'CCM').reduce((s: number, e: any) => s + (e.minutes || 0), 0);
      const rpmMinutes = (timeRes.data || []).filter((e: any) => e.program === 'RPM').reduce((s: number, e: any) => s + (e.minutes || 0), 0);
      setStats({ notes: notesRes.count || 0, ccmMinutes, rpmMinutes });
    })();
  }, [patients]);

  const filtered = patients.filter((p) => {
    return `${p.firstName} ${p.lastName} ${p.mrn}`.toLowerCase().includes(search.toLowerCase());
  });

  const handleSelect = (id: string) => {
    navigate(`/chart/${id}`);
  };

  return (
    <div className="flex-1 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 md:mb-8">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold text-foreground">Patients</h1>
            <p className="text-sm text-muted-foreground mt-1">{patients.length} patients in your panel</p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" onClick={() => setShowUploadDialog(true)} className="gap-2 flex-1 sm:flex-initial">
              <Upload className="w-4 h-4" />
              Upload List
            </Button>
            <Button variant="outline" onClick={() => setShowImportDialog(true)} className="gap-2 flex-1 sm:flex-initial">
              <Download className="w-4 h-4" />
              Import from PF
            </Button>
            <Button onClick={() => setShowAddDialog(true)} className="gap-2 flex-1 sm:flex-initial">
              <Plus className="w-4 h-4" />
              New Patient
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 md:mb-6">
          <Card
            className="p-4 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate('/notes')}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Notes</p>
                <p className="text-2xl font-semibold font-mono text-foreground">{stats.notes}</p>
              </div>
            </div>
          </Card>
          <Card
            className="p-4 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate('/ccm')}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <HeartPulse className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">CCM Minutes</p>
                <p className="text-2xl font-semibold font-mono text-foreground">{stats.ccmMinutes}</p>
              </div>
            </div>
          </Card>
          <Card
            className="p-4 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate('/rpm')}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Activity className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">RPM Minutes</p>
                <p className="text-2xl font-semibold font-mono text-foreground">{stats.rpmMinutes}</p>
              </div>
            </div>
          </Card>
        </div>


        <div className="flex flex-col sm:flex-row gap-3 mb-4 md:mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or MRN..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <div className="space-y-3">
          {filtered.map((patient) => (
            <Card
              key={patient.id}
              className="p-4 hover:shadow-md transition-shadow cursor-pointer group"
              onClick={() => handleSelect(patient.id)}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm shrink-0">
                    {patient.firstName[0]}{patient.lastName[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {patient.lastName}, {patient.firstName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      DOB: {new Date(patient.dob).toLocaleDateString()} · {patient.mrn}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap ml-13 sm:ml-0">
                  {patient.allergies.length > 0 && (
                    patient.allergies.every((a) => a.trim().toUpperCase() === 'NKDA') ? (
                      <Badge variant="secondary" className="gap-1 text-xs">NKDA</Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1 text-xs">
                        <AlertTriangle className="w-3 h-3" />
                        {patient.allergies.length} Allerg{patient.allergies.length > 1 ? 'ies' : 'y'}
                      </Badge>
                    )
                  )}
                  <Badge variant="secondary" className="text-xs">
                    {patient.notes.length} Note{patient.notes.length !== 1 ? 's' : ''}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {patient.medications.filter((m) => m.active).length} Meds
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Quick record note"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/chart/${patient.id}?record=1`);
                    }}
                  >
                    <Mic className="w-4 h-4 text-primary" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingPatient(patient);
                    }}
                  >
                    <Pencil className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                  </Button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors hidden sm:block" />
                </div>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p>No patients found.</p>
            </div>
          )}
        </div>
      </div>

      <AddPatientDialog open={showAddDialog} onOpenChange={setShowAddDialog} />
      {editingPatient && (
        <EditPatientDialog
          open={!!editingPatient}
          onOpenChange={(open) => { if (!open) setEditingPatient(null); }}
          patient={editingPatient}
        />
      )}
      <PFImportDialog open={showImportDialog} onOpenChange={setShowImportDialog} />
      <PatientListUploadDialog open={showUploadDialog} onOpenChange={setShowUploadDialog} />
    </div>
  );
}
