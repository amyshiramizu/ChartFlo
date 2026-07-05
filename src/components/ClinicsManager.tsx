import { useState } from 'react';
import { useClinic, type Clinic } from '@/hooks/useClinic';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Building2, Plus, Settings as SettingsIcon, Shield } from 'lucide-react';
import { ClinicManageDialog } from '@/components/ClinicManageDialog';
import { toast } from 'sonner';

export function ClinicsManager() {
  const {
    clinics, members, createClinic, fetchMembers,
    removeMember, updateMemberRole, deleteClinic,
  } = useClinic();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<Clinic | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return toast.error('Clinic name required');
    setCreating(true);
    const c = await createClinic(newName.trim());
    setCreating(false);
    if (c) {
      toast.success('Clinic created');
      setNewName('');
    } else {
      toast.error('Failed to create clinic');
    }
  };

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Building2 className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Clinics &amp; Team Members</h2>
      </div>

      <div className="flex gap-2 p-4 rounded-lg border border-border bg-muted/30">
        <div className="flex-1">
          <Label className="text-xs">New Clinic Name</Label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g., Sunrise Family Medicine" />
        </div>
        <Button onClick={handleCreate} disabled={creating} className="self-end gap-2">
          <Plus className="w-4 h-4" /> Create
        </Button>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Your Clinics ({clinics.length})</h3>
        {clinics.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">You aren't part of any clinic yet. Create one above.</p>
        ) : (
          <div className="space-y-2">
            {clinics.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{c.name}</span>
                    <Badge variant={c.role === 'admin' ? 'default' : 'secondary'} className="gap-1">
                      {c.role === 'admin' && <Shield className="w-3 h-3" />}
                      {c.role}
                    </Badge>
                  </div>
                </div>
                {c.role === 'admin' && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setManaging(c)}>
                    <SettingsIcon className="w-3.5 h-3.5" /> Manage
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ClinicManageDialog
        open={!!managing}
        onOpenChange={(o) => !o && setManaging(null)}
        clinic={managing}
        members={members}
        onFetchMembers={fetchMembers}
        onRemoveMember={removeMember}
        onUpdateRole={updateMemberRole}
        onDeleteClinic={deleteClinic}
      />
    </Card>
  );
}
