import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageLayout } from '@/components/MobileLayout';
import { supabase } from '@/integrations/supabase/client';
import { usePatientStore } from '@/store/patientStore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AddPatientDialog } from '@/components/AddPatientDialog';
import { EditPatientDialog } from '@/components/EditPatientDialog';
import { toast } from 'sonner';
import {
  Database, Download, Pencil, Plus, Search, Trash2, Users as UsersIcon,
  Stethoscope, MonitorSmartphone, UserRound, Import,
} from 'lucide-react';
import type { Patient } from '@/types/patient';

// ─── shared helpers ──────────────────────────────────────

function exportCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function TabToolbar({ search, setSearch, onExport, children }: {
  search: string; setSearch: (s: string) => void; onExport: () => void; children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 mb-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>
      <Button variant="outline" onClick={onExport} className="gap-2">
        <Download className="w-4 h-4" /> Export CSV
      </Button>
      {children}
    </div>
  );
}

const MIGRATION_HINT = 'This table may not exist yet — run the latest database migration in Supabase (SQL Editor).';

// ─── Patients tab ────────────────────────────────────────

function PatientsTab() {
  const { patients, fetchPatients } = usePatientStore();
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);

  useEffect(() => { if (patients.length === 0) fetchPatients(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = patients.filter(p =>
    `${p.firstName} ${p.lastName} ${p.mrn} ${p.provider || ''} ${p.location || ''}`
      .toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Card className="p-4">
      <TabToolbar
        search={search}
        setSearch={setSearch}
        onExport={() => exportCsv('patients.csv',
          ['Last Name', 'First Name', 'DOB', 'MRN', 'Gender', 'Phone', 'Provider', 'Location', 'Status'],
          filtered.map(p => [p.lastName, p.firstName, p.dob, p.mrn, p.gender, p.phone || '', p.provider || '', p.location || '', p.status || 'active']))}
      >
        <Button onClick={() => setShowAdd(true)} className="gap-2"><Plus className="w-4 h-4" /> Add Patient</Button>
      </TabToolbar>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead><TableHead>DOB</TableHead><TableHead>MRN</TableHead>
              <TableHead>Provider</TableHead><TableHead>Location</TableHead><TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.lastName}, {p.firstName}</TableCell>
                <TableCell>{p.dob}</TableCell>
                <TableCell>{p.mrn}</TableCell>
                <TableCell>{p.provider || '—'}</TableCell>
                <TableCell>{p.location || '—'}</TableCell>
                <TableCell>
                  {p.status === 'inactive'
                    ? <Badge variant="outline" className="border-dashed text-muted-foreground">Inactive</Badge>
                    : <Badge variant="secondary" className="text-emerald-700">Active</Badge>}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(p)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No patients found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <AddPatientDialog open={showAdd} onOpenChange={setShowAdd} />
      {editing && (
        <EditPatientDialog open={!!editing} onOpenChange={o => { if (!o) setEditing(null); }} patient={editing} />
      )}
    </Card>
  );
}

// ─── Providers tab ───────────────────────────────────────

interface Provider {
  id: string; name: string; specialty: string | null; npi: string | null;
  phone: string | null; email: string | null; active: boolean;
}

const EMPTY_PROVIDER = { name: '', specialty: '', npi: '', phone: '', email: '' };

function ProvidersTab() {
  const { patients } = usePatientStore();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_PROVIDER);

  const fetchProviders = useCallback(async () => {
    const { data, error } = await supabase.from('providers' as any).select('*').order('name');
    if (error) { console.error(error); return; }
    setProviders((data || []) as unknown as Provider[]);
  }, []);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  async function save() {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const clinicId = localStorage.getItem('chart_scribe_active_clinic');
    const row = {
      name: form.name.trim(), specialty: form.specialty || null, npi: form.npi || null,
      phone: form.phone || null, email: form.email || null,
    };
    const { error } = editingId
      ? await supabase.from('providers' as any).update(row).eq('id', editingId)
      : await supabase.from('providers' as any).insert({ ...row, user_id: user.id, ...(clinicId ? { clinic_id: clinicId } : {}) });
    if (error) { toast.error(`Save failed: ${error.message}. ${MIGRATION_HINT}`); return; }
    toast.success(editingId ? 'Provider updated' : 'Provider added');
    setDialogOpen(false);
    setForm(EMPTY_PROVIDER);
    setEditingId(null);
    fetchProviders();
  }

  async function toggleActive(p: Provider) {
    const { error } = await supabase.from('providers' as any).update({ active: !p.active }).eq('id', p.id);
    if (error) { toast.error(`Update failed: ${error.message}`); return; }
    fetchProviders();
  }

  async function remove(p: Provider) {
    if (!confirm(`Delete provider "${p.name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('providers' as any).delete().eq('id', p.id);
    if (error) { toast.error(`Delete failed: ${error.message}`); return; }
    toast.success('Provider deleted');
    fetchProviders();
  }

  async function importFromPatients() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const clinicId = localStorage.getItem('chart_scribe_active_clinic');
    const existing = new Set(providers.map(p => p.name.toLowerCase()));
    const names = Array.from(new Set(
      patients.map(p => (p.provider || '').trim()).filter(n => n && !existing.has(n.toLowerCase())),
    ));
    if (names.length === 0) { toast.info('No new provider names found on patients'); return; }
    const { error } = await supabase.from('providers' as any).insert(
      names.map(name => ({ name, user_id: user.id, ...(clinicId ? { clinic_id: clinicId } : {}) })),
    );
    if (error) { toast.error(`Import failed: ${error.message}. ${MIGRATION_HINT}`); return; }
    toast.success(`Imported ${names.length} provider${names.length > 1 ? 's' : ''} from your patient panel`);
    fetchProviders();
  }

  const filtered = providers.filter(p =>
    `${p.name} ${p.specialty || ''} ${p.npi || ''}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Card className="p-4">
      <TabToolbar
        search={search}
        setSearch={setSearch}
        onExport={() => exportCsv('providers.csv',
          ['Name', 'Specialty', 'NPI', 'Phone', 'Email', 'Active'],
          filtered.map(p => [p.name, p.specialty || '', p.npi || '', p.phone || '', p.email || '', p.active ? 'Yes' : 'No']))}
      >
        <Button variant="outline" onClick={importFromPatients} className="gap-2" title="Create provider records from names already on your patients">
          <Import className="w-4 h-4" /> Import from Patients
        </Button>
        <Button onClick={() => { setForm(EMPTY_PROVIDER); setEditingId(null); setDialogOpen(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> Add Provider
        </Button>
      </TabToolbar>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead><TableHead>Specialty</TableHead><TableHead>NPI</TableHead>
              <TableHead>Phone</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.specialty || '—'}</TableCell>
                <TableCell>{p.npi || '—'}</TableCell>
                <TableCell>{p.phone || '—'}</TableCell>
                <TableCell>{p.email || '—'}</TableCell>
                <TableCell>
                  <button onClick={() => toggleActive(p)} title="Click to toggle">
                    {p.active
                      ? <Badge variant="secondary" className="text-emerald-700 cursor-pointer">Active</Badge>
                      : <Badge variant="outline" className="border-dashed text-muted-foreground cursor-pointer">Inactive</Badge>}
                  </button>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                      setForm({ name: p.name, specialty: p.specialty || '', npi: p.npi || '', phone: p.phone || '', email: p.email || '' });
                      setEditingId(p.id); setDialogOpen(true);
                    }}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(p)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No providers yet. Add one, or use “Import from Patients” to pull in the provider names already on your panel.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingId ? 'Edit Provider' : 'Add Provider'}</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Dr. Jane Smith" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Specialty</Label><Input value={form.specialty} onChange={e => setForm({ ...form, specialty: e.target.value })} placeholder="Internal Medicine" /></div>
              <div><Label>NPI</Label><Input value={form.npi} onChange={e => setForm({ ...form, npi: e.target.value })} placeholder="1234567890" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <Button onClick={save} className="w-full">{editingId ? 'Save Changes' : 'Add Provider'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Devices tab ─────────────────────────────────────────

interface RpmDevice {
  id: string; patient_id: string; device_type: string; model: string | null;
  serial_number: string | null; status: string; assigned_date: string;
}

const DEVICE_TYPES = [
  'Blood Pressure Cuff', 'Glucometer', 'Pulse Oximeter', 'Weight Scale',
  'Continuous Glucose Monitor', 'Spirometer', 'Thermometer', 'ECG Monitor', 'Other',
];

function DevicesTab() {
  const { patients } = usePatientStore();
  const [devices, setDevices] = useState<RpmDevice[]>([]);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ patient_id: '', device_type: DEVICE_TYPES[0], model: '', serial: '' });

  const patientName = useCallback((id: string) => {
    const p = patients.find(x => x.id === id);
    return p ? `${p.lastName}, ${p.firstName}` : 'Unknown';
  }, [patients]);

  const fetchDevices = useCallback(async () => {
    const { data, error } = await supabase.from('rpm_devices').select('*').order('assigned_date', { ascending: false });
    if (error) { console.error(error); return; }
    setDevices((data || []) as RpmDevice[]);
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  async function addDevice() {
    if (!form.patient_id) { toast.error('Select a patient'); return; }
    const { error } = await supabase.from('rpm_devices').insert({
      patient_id: form.patient_id, device_type: form.device_type,
      model: form.model || null, serial_number: form.serial || null,
    });
    if (error) { toast.error(`Add failed: ${error.message}`); return; }
    toast.success('Device assigned');
    setDialogOpen(false);
    setForm({ patient_id: '', device_type: DEVICE_TYPES[0], model: '', serial: '' });
    fetchDevices();
  }

  async function toggleStatus(d: RpmDevice) {
    const next = d.status === 'active' ? 'returned' : 'active';
    const { error } = await supabase.from('rpm_devices').update({ status: next }).eq('id', d.id);
    if (error) { toast.error(`Update failed: ${error.message}`); return; }
    fetchDevices();
  }

  async function remove(d: RpmDevice) {
    if (!confirm(`Delete this ${d.device_type}? This cannot be undone.`)) return;
    const { error } = await supabase.from('rpm_devices').delete().eq('id', d.id);
    if (error) { toast.error(`Delete failed: ${error.message}`); return; }
    fetchDevices();
  }

  const filtered = devices.filter(d =>
    `${d.device_type} ${d.model || ''} ${d.serial_number || ''} ${patientName(d.patient_id)}`
      .toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Card className="p-4">
      <TabToolbar
        search={search}
        setSearch={setSearch}
        onExport={() => exportCsv('devices.csv',
          ['Device', 'Model', 'Serial', 'Patient', 'Status', 'Assigned'],
          filtered.map(d => [d.device_type, d.model || '', d.serial_number || '', patientName(d.patient_id), d.status, d.assigned_date]))}
      >
        <Button onClick={() => setDialogOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> Assign Device</Button>
      </TabToolbar>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead><TableHead>Model</TableHead><TableHead>Serial #</TableHead>
              <TableHead>Patient</TableHead><TableHead>Assigned</TableHead><TableHead>Status</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(d => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.device_type}</TableCell>
                <TableCell>{d.model || '—'}</TableCell>
                <TableCell>{d.serial_number || '—'}</TableCell>
                <TableCell>{patientName(d.patient_id)}</TableCell>
                <TableCell>{d.assigned_date}</TableCell>
                <TableCell>
                  <button onClick={() => toggleStatus(d)} title="Click to toggle active/returned">
                    {d.status === 'active'
                      ? <Badge variant="secondary" className="text-emerald-700 cursor-pointer">Active</Badge>
                      : <Badge variant="outline" className="cursor-pointer">{d.status}</Badge>}
                  </button>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(d)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No devices assigned yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Assign Device</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <Label>Patient</Label>
              <Select value={form.patient_id} onValueChange={v => setForm({ ...form, patient_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select patient" /></SelectTrigger>
                <SelectContent>
                  {patients.filter(p => p.status !== 'inactive').map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.lastName}, {p.firstName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Device Type</Label>
              <Select value={form.device_type} onValueChange={v => setForm({ ...form, device_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEVICE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Model</Label><Input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Omron BP786N" /></div>
              <div><Label>Serial #</Label><Input value={form.serial} onChange={e => setForm({ ...form, serial: e.target.value })} /></div>
            </div>
            <Button onClick={addDevice} className="w-full">Assign Device</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Users tab ───────────────────────────────────────────

interface ClinicUser {
  id: string; full_name: string; email: string; title: string; role: string; invited_at: string;
}

function UsersTab() {
  const [users, setUsers] = useState<ClinicUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const clinicId = localStorage.getItem('chart_scribe_active_clinic');
      let members: { user_id: string; role: string; invited_at: string }[] = [];
      if (clinicId) {
        const { data } = await supabase.from('clinic_members').select('user_id, role, invited_at').eq('clinic_id', clinicId);
        members = data || [];
      }
      if (members.length === 0) {
        // Solo practice: show the signed-in user's own profile
        const { data: { user } } = await supabase.auth.getUser();
        if (user) members = [{ user_id: user.id, role: 'owner', invited_at: '' }];
      }
      const ids = members.map(m => m.user_id);
      const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email, title').in('user_id', ids);
      const byId = new Map((profiles || []).map(p => [p.user_id, p]));
      setUsers(members.map(m => ({
        id: m.user_id,
        full_name: byId.get(m.user_id)?.full_name || '—',
        email: byId.get(m.user_id)?.email || '—',
        title: byId.get(m.user_id)?.title || '',
        role: m.role,
        invited_at: m.invited_at ? m.invited_at.slice(0, 10) : '',
      })));
      setLoading(false);
    })();
  }, []);

  const filtered = users.filter(u =>
    `${u.full_name} ${u.email} ${u.title} ${u.role}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <Card className="p-4">
      <TabToolbar
        search={search}
        setSearch={setSearch}
        onExport={() => exportCsv('users.csv',
          ['Name', 'Email', 'Title', 'Role', 'Invited'],
          filtered.map(u => [u.full_name, u.email, u.title, u.role, u.invited_at]))}
      />
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Title</TableHead>
              <TableHead>Role</TableHead><TableHead>Invited</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(u => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>{u.title || '—'}</TableCell>
                <TableCell><Badge variant={u.role === 'admin' || u.role === 'owner' ? 'default' : 'secondary'}>{u.role}</Badge></TableCell>
                <TableCell>{u.invited_at || '—'}</TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && !loading && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No users found.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        To invite or remove team members, use Settings → Clinics &amp; Users.
      </p>
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────

export default function DatabasePage() {
  const { patients, fetchPatients } = usePatientStore();

  useEffect(() => { if (patients.length === 0) fetchPatients(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageLayout>
      <div className="flex-1 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6">
            <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2">
              <Database className="w-6 h-6 text-primary" /> Database
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Browse and manage your practice's core records: patients, providers, devices, and users.
            </p>
          </div>
          <Tabs defaultValue="patients">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="patients" className="gap-1.5"><UserRound className="w-4 h-4" /> Patients</TabsTrigger>
              <TabsTrigger value="providers" className="gap-1.5"><Stethoscope className="w-4 h-4" /> Providers</TabsTrigger>
              <TabsTrigger value="devices" className="gap-1.5"><MonitorSmartphone className="w-4 h-4" /> Devices</TabsTrigger>
              <TabsTrigger value="users" className="gap-1.5"><UsersIcon className="w-4 h-4" /> Users</TabsTrigger>
            </TabsList>
            <TabsContent value="patients" className="mt-4"><PatientsTab /></TabsContent>
            <TabsContent value="providers" className="mt-4"><ProvidersTab /></TabsContent>
            <TabsContent value="devices" className="mt-4"><DevicesTab /></TabsContent>
            <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>
          </Tabs>
        </div>
      </div>
    </PageLayout>
  );
}
