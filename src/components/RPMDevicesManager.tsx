import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePatientStore } from '@/store/patientStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Activity, Plus, Trash2 } from 'lucide-react';
import { PatientNameLink } from '@/components/PatientNameLink';
import { toast } from 'sonner';

interface RpmDevice {
  id: string;
  patient_id: string;
  device_type: string;
  model: string | null;
  serial_number: string | null;
  imei?: string | null;
  status: string;
  notes: string | null;
  assigned_date: string;
}

const DEVICE_TYPES = [
  'Blood Pressure Cuff',
  'Glucometer',
  'Pulse Oximeter',
  'Weight Scale',
  'Continuous Glucose Monitor',
  'Spirometer',
  'Thermometer',
  'ECG Monitor',
  'Other',
];

const MODELS_BY_TYPE: Record<string, string[]> = {
  'Blood Pressure Cuff': ['Omron BP786N', 'Omron BP7450', 'A&D UA-651BLE', 'Withings BPM Connect', 'iHealth Track', 'Qardio Arm'],
  'Glucometer': ['Accu-Chek Guide', 'OneTouch Verio Reflect', 'Contour Next One', 'iHealth Gluco+', 'TRUE METRIX AIR'],
  'Pulse Oximeter': ['Masimo MightySat', 'Nonin 3230', 'iHealth Air PO3M', 'Wellue O2Ring'],
  'Weight Scale': ['Withings Body+', 'A&D UC-352BLE', 'iHealth Lina', 'Greater Goods 0397'],
  'Continuous Glucose Monitor': ['Dexcom G6', 'Dexcom G7', 'FreeStyle Libre 2', 'FreeStyle Libre 3', 'Medtronic Guardian 4'],
  'Spirometer': ['MIR Spirobank Smart', 'NuvoAir Air Next', 'Aluna'],
  'Thermometer': ['iHealth PT3', 'Withings Thermo', 'Kinsa Smart Ear'],
  'ECG Monitor': ['KardiaMobile 6L', 'Withings Move ECG', 'Apple Watch ECG', 'Wellue DuoEK'],
  'Other': [],
};


export function RPMDevicesManager() {
  const { patients } = usePatientStore();
  const [devices, setDevices] = useState<RpmDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [patientId, setPatientId] = useState<string>('');
  const [deviceType, setDeviceType] = useState(DEVICE_TYPES[0]);
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [imei, setImei] = useState('');

  const fetchDevices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('rpm_devices')
      .select('*')
      .order('assigned_date', { ascending: false });
    if (error) toast.error('Failed to load devices');
    setDevices(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  const handleAdd = async () => {
    if (!patientId) return toast.error('Select a patient');
    const cleanImei = imei.replace(/\D/g, '');
    if (imei && (cleanImei.length < 14 || cleanImei.length > 16)) {
      return toast.error('IMEI should be 14–16 digits');
    }
    const { error } = await supabase.from('rpm_devices').insert({
      patient_id: patientId,
      device_type: deviceType,
      model: model || null,
      serial_number: serial || null,
      ...(cleanImei ? { imei: cleanImei } : {}),
    } as any);
    if (error) {
      return toast.error(error.message.includes('duplicate') || error.message.includes('unique')
        ? `IMEI ${cleanImei} is already registered to another device`
        : error.message);
    }
    toast.success('Device assigned');
    setModel('');
    setSerial('');
    setImei('');
    fetchDevices();
  };

  const handleRemove = async (id: string) => {
    const { error } = await supabase.from('rpm_devices').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Device removed');
    fetchDevices();
  };

  const toggleStatus = async (d: RpmDevice) => {
    const next = d.status === 'active' ? 'inactive' : 'active';
    const { error } = await supabase.from('rpm_devices').update({ status: next }).eq('id', d.id);
    if (error) return toast.error(error.message);
    fetchDevices();
  };

  const patientName = (id: string) => {
    const p = patients.find((p) => p.id === id);
    return p ? `${p.lastName}, ${p.firstName}` : id.slice(0, 8);
  };

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">RPM Devices</h2>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 p-4 rounded-lg border border-border bg-muted/30">
        <div>
          <Label className="text-xs">Patient</Label>
          <Select value={patientId} onValueChange={setPatientId}>
            <SelectTrigger><SelectValue placeholder="Select patient" /></SelectTrigger>
            <SelectContent>
              {patients.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.lastName}, {p.firstName} ({p.mrn})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Device Type</Label>
          <Select value={deviceType} onValueChange={(v) => { setDeviceType(v); setModel(''); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DEVICE_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Model</Label>
          {(MODELS_BY_TYPE[deviceType]?.length ?? 0) > 0 ? (
            <Select value={model} onValueChange={(v) => setModel(v === '__custom__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
              <SelectContent>
                {MODELS_BY_TYPE[deviceType].map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
                <SelectItem value="__custom__">Other / custom…</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model name" />
          )}
          {(MODELS_BY_TYPE[deviceType]?.length ?? 0) > 0 && !MODELS_BY_TYPE[deviceType].includes(model) && (
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Enter custom model"
              className="mt-2"
            />
          )}
        </div>
        <div>
          <Label className="text-xs">Serial Number</Label>
          <Input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Device serial" className="font-mono" />
        </div>
        <div>
          <Label className="text-xs">IMEI (links cellular readings to the patient)</Label>
          <Input value={imei} onChange={(e) => setImei(e.target.value)} placeholder="356938035643809" className="font-mono" inputMode="numeric" />
        </div>
        <div className="sm:col-span-2">
          <Button onClick={handleAdd} className="gap-2 w-full sm:w-auto">
            <Plus className="w-4 h-4" /> Assign Device
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Assigned Devices ({devices.length})</h3>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No devices assigned yet.</p>
        ) : (
          <div className="space-y-2">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{d.device_type}</span>
                    {d.model && <span className="text-xs text-muted-foreground">{d.model}</span>}
                    <Badge variant={d.status === 'active' ? 'default' : 'secondary'}>{d.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <PatientNameLink patientId={d.patient_id} className="text-xs">
                      {patientName(d.patient_id)}
                    </PatientNameLink>
                    {d.serial_number ? ` · SN: ${d.serial_number}` : ''}{d.imei ? ` · IMEI: ${d.imei}` : ''} · Assigned {d.assigned_date}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => toggleStatus(d)}>
                  {d.status === 'active' ? 'Deactivate' : 'Activate'}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleRemove(d.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
