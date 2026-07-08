import { useState } from 'react';
import { usePatientStore } from '@/store/patientStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface AddPatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddPatientDialog({ open, onOpenChange }: AddPatientDialogProps) {
  const { addPatient } = usePatientStore();
  const [form, setForm] = useState({
    firstName: '', lastName: '', dob: '', phone: '', allergies: '', gender: 'male' as 'male' | 'female', nkda: false,
  });

  const handleSubmit = () => {
    if (!form.firstName || !form.lastName || !form.dob) return;
    addPatient({
      id: crypto.randomUUID(),
      firstName: form.firstName,
      lastName: form.lastName,
      dob: form.dob,
      mrn: `MRN-${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`,
      gender: form.gender,
      phone: form.phone || undefined,
      allergies: form.nkda
        ? ['NKDA']
        : form.allergies
        ? form.allergies.split(',').map((a) => a.trim()).filter(Boolean)
        : [],
      createdAt: new Date().toISOString().split('T')[0],
    });
    setForm({ firstName: '', lastName: '', dob: '', phone: '', allergies: '', gender: 'male', nkda: false });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Patient</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="firstName">First Name</Label>
              <Input id="firstName" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="lastName">Last Name</Label>
              <Input id="lastName" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="dob">Date of Birth</Label>
              <Input id="dob" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="gender">Gender</Label>
              <select id="gender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as 'male' | 'female' })} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label htmlFor="allergies">Allergies (comma-separated)</Label>
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                <Checkbox
                  id="nkda"
                  checked={form.nkda}
                  onCheckedChange={(v) => setForm({ ...form, nkda: !!v, allergies: v ? '' : form.allergies })}
                />
                <span>NKDA (No Known Drug Allergies)</span>
              </label>
            </div>
            <Input
              id="allergies"
              placeholder={form.nkda ? 'NKDA selected' : 'e.g. Penicillin, Sulfa'}
              value={form.nkda ? 'NKDA' : form.allergies}
              onChange={(e) => setForm({ ...form, allergies: e.target.value })}
              disabled={form.nkda}
            />
          </div>
          <Button onClick={handleSubmit} className="w-full">Add Patient</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
