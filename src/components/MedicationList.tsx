import { useState } from 'react';
import { usePatientStore } from '@/store/patientStore';
import type { Patient } from '@/types/patient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pill, Mic, MicOff, Send } from 'lucide-react';
import { useDictation } from '@/hooks/useDictation';
import { sendMedsToExtension } from '@/lib/practiceFusionBridge';
import { toast } from 'sonner';

interface MedicationListProps {
  patient: Patient;
}

export function MedicationList({ patient }: MedicationListProps) {
  const { addMedication, updateMedication } = usePatientStore();
  const { isListening, transcript, startListening, stopListening, resetTranscript, isSupported } = useDictation();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', dosage: '', frequency: 'Daily', route: 'PO' });

  const handleDictateMeds = () => {
    if (isListening) {
      stopListening();
      if (transcript) {
        // Simple parsing: try to extract med name from dictation
        setForm((prev) => ({ ...prev, name: prev.name ? `${prev.name} ${transcript}` : transcript }));
        resetTranscript();
      }
    } else {
      startListening();
    }
  };

  const handleAdd = () => {
    if (!form.name || !form.dosage) {
      toast.error('Name and dosage are required');
      return;
    }
    addMedication(patient.id, {
      id: crypto.randomUUID(),
      name: form.name,
      dosage: form.dosage,
      frequency: form.frequency,
      route: form.route,
      prescribedDate: new Date().toISOString().split('T')[0],
      active: true,
    });
    setForm({ name: '', dosage: '', frequency: 'Daily', route: 'PO' });
    setShowAdd(false);
    toast.success('Medication added');
  };

  const activeMeds = patient.medications.filter((m) => m.active);
  const inactiveMeds = patient.medications.filter((m) => !m.active);

  const handleSendMedsToPF = async () => {
    if (activeMeds.length === 0) {
      toast.error('No active medications to send');
      return;
    }
    await sendMedsToExtension(
      activeMeds.map((m) => ({
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        route: m.route,
      }))
    );
    toast.success(`${activeMeds.length} medication(s) sent to Practice Fusion extension`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Active Medications ({activeMeds.length})</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSendMedsToPF} className="gap-1.5">
            <Send className="w-3.5 h-3.5" />
            Send to PF
          </Button>
          {isSupported && (
            <Button variant="outline" size="sm" onClick={handleDictateMeds} className="gap-1.5">
              {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              {isListening ? 'Stop' : 'Dictate Med'}
            </Button>
          )}
          <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Add Med
          </Button>
        </div>
      </div>

      {isListening && (
        <Card className="p-3 border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
            <span className="text-sm text-destructive font-medium">Listening for medication...</span>
          </div>
          {transcript && <p className="text-sm text-muted-foreground mt-1 italic">{transcript}</p>}
        </Card>
      )}

      {showAdd && (
        <Card className="p-4 border-primary/20">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Medication Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Lisinopril" />
            </div>
            <div>
              <Label className="text-xs">Dosage</Label>
              <Input value={form.dosage} onChange={(e) => setForm({ ...form, dosage: e.target.value })} placeholder="e.g. 10mg" />
            </div>
            <div>
              <Label className="text-xs">Frequency</Label>
              <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['Daily', 'BID', 'TID', 'QID', 'QHS', 'PRN', 'Weekly'].map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Route</Label>
              <Select value={form.route} onValueChange={(v) => setForm({ ...form, route: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['PO', 'IV', 'IM', 'SC', 'SL', 'PR', 'Topical', 'Inhaled'].map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAdd}>Add</Button>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {activeMeds.map((med) => (
          <Card key={med.id} className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Pill className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">{med.name} {med.dosage}</p>
                <p className="text-xs text-muted-foreground">{med.frequency} · {med.route} · Since {new Date(med.prescribedDate).toLocaleDateString()}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => updateMedication(patient.id, med.id, { active: false })}>
              Discontinue
            </Button>
          </Card>
        ))}
      </div>

      {inactiveMeds.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Discontinued ({inactiveMeds.length})</h3>
          <div className="space-y-2 opacity-60">
            {inactiveMeds.map((med) => (
              <Card key={med.id} className="p-3 flex items-center gap-3">
                <Pill className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground line-through">{med.name} {med.dosage}</p>
                  <p className="text-xs text-muted-foreground">{med.frequency} · {med.route}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
