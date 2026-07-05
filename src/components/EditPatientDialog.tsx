import { useState, useEffect } from 'react';
import { usePatientStore } from '@/store/patientStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useClinic } from '@/hooks/useClinic';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Building2, Loader2 } from 'lucide-react';
import type { Patient } from '@/types/patient';


interface EditPatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient;
}

export function EditPatientDialog({ open, onOpenChange, patient }: EditPatientDialogProps) {
  const { updatePatient, fetchPatients } = usePatientStore();
  const { clinics } = useClinic();
  const [form, setForm] = useState({
    firstName: '', lastName: '', dob: '', phone: '', allergies: '', mrn: '', gender: 'male' as 'male' | 'female', nkda: false,
  });
  const [currentClinicId, setCurrentClinicId] = useState<string | null>(null);
  const [targetClinicId, setTargetClinicId] = useState<string>('');
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (patient) {
      const isNkda = patient.allergies.length === 1 && /^NKDA$/i.test(patient.allergies[0]);
      setForm({
        firstName: patient.firstName,
        lastName: patient.lastName,
        dob: patient.dob,
        phone: patient.phone || '',
        allergies: isNkda ? '' : patient.allergies.join(', '),
        mrn: patient.mrn,
        gender: patient.gender || 'male',
        nkda: isNkda,
      });
    }
  }, [patient]);

  // Load patient's current clinic_id directly from DB (not on Patient type)
  useEffect(() => {
    if (!open || !patient?.id) return;
    let alive = true;
    supabase
      .from('patients')
      .select('clinic_id')
      .eq('id', patient.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        setCurrentClinicId((data as any)?.clinic_id ?? null);
        setTargetClinicId('');
      });
    return () => { alive = false; };
  }, [open, patient?.id]);

  const adminClinics = clinics.filter((c) => c.role === 'admin');
  const isAdminOfCurrent = currentClinicId
    ? adminClinics.some((c) => c.id === currentClinicId)
    : adminClinics.length > 0;
  const moveDestinations = adminClinics.filter((c) => c.id !== currentClinicId);
  const canMove = isAdminOfCurrent && moveDestinations.length > 0;

  const handleMove = async () => {
    if (!targetClinicId || targetClinicId === currentClinicId) return;
    setMoving(true);
    const { error } = await supabase
      .from('patients')
      .update({ clinic_id: targetClinicId })
      .eq('id', patient.id);
    setMoving(false);
    if (error) {
      toast.error(`Move failed: ${error.message}`);
      return;
    }
    const dest = adminClinics.find((c) => c.id === targetClinicId);
    toast.success(`Patient moved to ${dest?.name || 'selected practice'}`);
    setCurrentClinicId(targetClinicId);
    await fetchPatients();
    onOpenChange(false);
  };

  const handleSubmit = () => {
    if (!form.firstName || !form.lastName || !form.dob) return;
    updatePatient(patient.id, {
      firstName: form.firstName,
      lastName: form.lastName,
      dob: form.dob,
      mrn: form.mrn,
      gender: form.gender,
      phone: form.phone || undefined,
      allergies: form.nkda
        ? ['NKDA']
        : form.allergies
        ? form.allergies.split(',').map((a) => a.trim()).filter(Boolean)
        : [],
    });
    onOpenChange(false);
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Patient</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="editFirstName">First Name</Label>
              <Input id="editFirstName" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="editLastName">Last Name</Label>
              <Input id="editLastName" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="editDob">Date of Birth</Label>
              <Input id="editDob" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="editGender">Gender</Label>
              <select id="editGender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as 'male' | 'female' })} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="editMrn">MRN</Label>
            <Input id="editMrn" value={form.mrn} onChange={(e) => setForm({ ...form, mrn: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="editPhone">Phone</Label>
            <Input id="editPhone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label htmlFor="editAllergies">Allergies (comma-separated)</Label>
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                <Checkbox
                  id="editNkda"
                  checked={form.nkda}
                  onCheckedChange={(v) => setForm({ ...form, nkda: !!v, allergies: v ? '' : form.allergies })}
                />
                <span>NKDA (No Known Drug Allergies)</span>
              </label>
            </div>
            <Input
              id="editAllergies"
              placeholder={form.nkda ? 'NKDA selected' : 'e.g. Penicillin, Sulfa'}
              value={form.nkda ? 'NKDA' : form.allergies}
              onChange={(e) => setForm({ ...form, allergies: e.target.value })}
              disabled={form.nkda}
            />
          </div>
          <Button onClick={handleSubmit} className="w-full">Save Changes</Button>

          {adminClinics.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  <Label className="text-sm font-semibold">Move patient to another practice</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Current practice:{' '}
                  <span className="font-medium text-foreground">
                    {clinics.find((c) => c.id === currentClinicId)?.name || 'Unassigned'}
                  </span>
                </p>
                {!canMove ? (
                  <p className="text-xs text-muted-foreground">
                    {!isAdminOfCurrent
                      ? 'You must be an admin of this patient’s current practice to move them.'
                      : 'You need admin access to a second practice to move this patient.'}
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <Select value={targetClinicId} onValueChange={setTargetClinicId}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select destination practice…" />
                      </SelectTrigger>
                      <SelectContent>
                        {moveDestinations.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      onClick={handleMove}
                      disabled={!targetClinicId || moving}
                      className="gap-2"
                    >
                      {moving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                      Move
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
