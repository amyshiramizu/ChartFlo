import { useState } from 'react';
import { Building2, ChevronDown, Plus, Settings, Star } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import type { Clinic } from '@/hooks/useClinic';

interface ClinicSwitcherProps {
  clinics: Clinic[];
  activeClinic: Clinic | null;
  defaultClinicId?: string | null;
  onSwitch: (clinicId: string) => void;
  onSetDefault?: (clinicId: string) => Promise<{ error: string | null }>;
  onCreate: (name: string) => Promise<unknown>;
  onManage?: () => void;
}

export function ClinicSwitcher({ clinics, activeClinic, defaultClinicId, onSwitch, onSetDefault, onCreate, onManage }: ClinicSwitcherProps) {

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const result = await onCreate(newName.trim());
    if (result) {
      toast.success(`Clinic "${newName.trim()}" created`);
      setNewName('');
      setCreateOpen(false);
    } else {
      toast.error('Failed to create clinic');
    }
    setCreating(false);
  };

  if (clinics.length === 0 && !activeClinic) {
    return (
      <>
        <button
          onClick={() => setCreateOpen(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create a Clinic
        </button>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Create New Clinic</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label htmlFor="clinicName">Clinic Name</Label>
                <Input
                  id="clinicName"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Main Street Family Medicine"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
              </div>
              <Button onClick={handleCreate} disabled={creating} className="w-full">
                {creating ? 'Creating...' : 'Create Clinic'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors">
            <Building2 className="w-4 h-4 shrink-0 text-sidebar-foreground/60" />
            <span className="truncate flex-1 text-left">
              {activeClinic?.name || 'Select Clinic'}
            </span>
            {activeClinic?.role === 'admin' && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0 border-sidebar-foreground/20 text-sidebar-foreground/50">
                Admin
              </Badge>
            )}
            <ChevronDown className="w-3 h-3 shrink-0 text-sidebar-foreground/40" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {clinics.map((clinic) => {
            const isDefault = clinic.id === defaultClinicId;
            const isActive = clinic.id === activeClinic?.id;
            return (
              <DropdownMenuItem
                key={clinic.id}
                onClick={() => onSwitch(clinic.id)}
                className={isActive ? 'bg-accent' : ''}
              >
                <Building2 className="w-4 h-4 mr-2" />
                <span className="truncate flex-1">{clinic.name}</span>
                {isDefault && (
                  <Star className="w-3.5 h-3.5 ml-1 fill-yellow-500 text-yellow-500" />
                )}
                {clinic.role === 'admin' && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1">
                    Admin
                  </Badge>
                )}
              </DropdownMenuItem>
            );
          })}
          {onSetDefault && activeClinic && activeClinic.id !== defaultClinicId && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={async () => {
                  const res = await onSetDefault(activeClinic.id);
                  if (res?.error) toast.error(res.error);
                  else toast.success(`"${activeClinic.name}" is now your main clinic`);
                }}
              >
                <Star className="w-4 h-4 mr-2" />
                Set "{activeClinic.name}" as main clinic
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Clinic
          </DropdownMenuItem>
          {onManage && activeClinic?.role === 'admin' && (
            <DropdownMenuItem onClick={onManage}>
              <Settings className="w-4 h-4 mr-2" />
              Manage Clinic
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>

      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create New Clinic</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="clinicName">Clinic Name</Label>
              <Input
                id="clinicName"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Main Street Family Medicine"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <Button onClick={handleCreate} disabled={creating} className="w-full">
              {creating ? 'Creating...' : 'Create Clinic'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
