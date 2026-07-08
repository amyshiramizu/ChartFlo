import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Upload, FileSpreadsheet, Loader2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePatientStore } from '@/store/patientStore';
import { CHART_TYPES, chartTypeMeta, type ChartType } from '@/lib/chartTypes';

interface RawRow { [k: string]: string }
interface NormalizedRow {
  firstName: string;
  lastName: string;
  dob: string;
  mrn: string;
  gender: 'male' | 'female';
  phone?: string;
  allergies: string[];
  provider?: string;
  location?: string;
  _error?: string;
}

const HEADER_MAP: Record<string, keyof NormalizedRow | 'fullName'> = {
  'first': 'firstName', 'firstname': 'firstName', 'first name': 'firstName', 'given': 'firstName',
  'last': 'lastName', 'lastname': 'lastName', 'last name': 'lastName', 'surname': 'lastName', 'family': 'lastName',
  'name': 'fullName', 'patient': 'fullName', 'patient name': 'fullName', 'full name': 'fullName',
  'dob': 'dob', 'date of birth': 'dob', 'birthdate': 'dob', 'birth date': 'dob',
  'mrn': 'mrn', 'medical record number': 'mrn', 'chart #': 'mrn', 'chart number': 'mrn', 'id': 'mrn', 'patient id': 'mrn',
  'gender': 'gender', 'sex': 'gender',
  'phone': 'phone', 'phone number': 'phone', 'mobile': 'phone', 'cell': 'phone',
  'allergies': 'allergies', 'allergy': 'allergies',
  'provider': 'provider', 'pcp': 'provider', 'doctor': 'provider',
  'location': 'location', 'facility': 'location', 'site': 'location',
};

function normalizeDate(v: string): string {
  if (!v) return '';
  const s = v.trim();
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // MM/DD/YYYY or M/D/YY
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = (parseInt(y) > 30 ? '19' : '20') + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Excel serial date
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n > 1000 && n < 80000) {
      const d = XLSX.SSF.parse_date_code(n);
      if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

function normalizeRow(raw: RawRow): NormalizedRow {
  const out: NormalizedRow = {
    firstName: '', lastName: '', dob: '', mrn: '',
    gender: 'female', allergies: [],
  };
  let fullName = '';
  for (const [k, v] of Object.entries(raw)) {
    if (!k) continue;
    const key = HEADER_MAP[k.toLowerCase().trim()];
    if (!key) continue;
    const val = String(v ?? '').trim();
    if (key === 'fullName') fullName = val;
    else if (key === 'gender') {
      const g = val.toLowerCase();
      out.gender = g.startsWith('m') ? 'male' : 'female';
    } else if (key === 'allergies') {
      out.allergies = val
        ? val.split(/[,;|]/).map(a => a.trim()).filter(Boolean)
        : [];
    } else if (key === 'dob') {
      out.dob = normalizeDate(val);
    } else {
      (out as any)[key] = val;
    }
  }
  if (!out.firstName && !out.lastName && fullName) {
    // Try "Last, First" then "First Last"
    if (fullName.includes(',')) {
      const [last, first] = fullName.split(',').map(s => s.trim());
      out.lastName = last; out.firstName = first;
    } else {
      const parts = fullName.trim().split(/\s+/);
      out.firstName = parts[0] || '';
      out.lastName = parts.slice(1).join(' ') || '';
    }
  }
  if (!out.firstName || !out.lastName) out._error = 'Missing name';
  else if (!out.dob) out._error = 'Missing/invalid DOB';
  return out;
}

export function PatientListUploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<NormalizedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [createBatch, setCreateBatch] = useState(true);
  const [chartType, setChartType] = useState<ChartType>('ccm_visit');
  const [importing, setImporting] = useState(false);
  const { fetchPatients } = usePatientStore();

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const ext = file.name.split('.').pop()?.toLowerCase();
    try {
      let raw: RawRow[] = [];
      if (ext === 'csv') {
        const text = await file.text();
        const res = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: true });
        raw = res.data;
      } else if (ext === 'xlsx' || ext === 'xls') {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        raw = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: '', raw: false });
      } else {
        toast.error('Use CSV or XLSX format');
        return;
      }
      const normalized = raw.map(normalizeRow);
      setRows(normalized);
      const valid = normalized.filter(r => !r._error).length;
      toast.success(`Parsed ${valid} valid row${valid !== 1 ? 's' : ''}${normalized.length - valid ? ` (${normalized.length - valid} with errors)` : ''}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to parse file');
    }
  };

  const downloadTemplate = () => {
    const csv = 'First Name,Last Name,DOB,MRN,Gender,Phone,Allergies,Provider,Location\nJohn,Doe,1945-03-12,MRN001,male,555-1234,"Penicillin, Sulfa",Dr. Smith,Main Clinic\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'chartflo-patient-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    const valid = rows.filter(r => !r._error);
    if (!valid.length) { toast.error('No valid rows to import'); return; }
    setImporting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const activeClinicId = localStorage.getItem('chart_scribe_active_clinic');

      // Paginate to break Supabase 1000-row default cap.
      const existing: any[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        let q = supabase.from('patients').select('id, mrn, first_name, last_name, dob').range(from, from + PAGE - 1);
        if (activeClinicId) q = q.eq('clinic_id', activeClinicId);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;
        existing.push(...data);
        if (data.length < PAGE) break;
      }
      const byMrn = new Map<string, any>();
      const byNameDob = new Map<string, any>();
      (existing ?? []).forEach((p: any) => {
        if (p.mrn) byMrn.set(p.mrn.toLowerCase(), p);
        byNameDob.set(`${(p.first_name || '').toLowerCase()}|${(p.last_name || '').toLowerCase()}|${p.dob}`, p);
      });

      let created = 0, updated = 0;
      const upsertedIds: { id: string; name: string; mrn: string }[] = [];

      for (const r of valid) {
        const match =
          (r.mrn && byMrn.get(r.mrn.toLowerCase())) ||
          byNameDob.get(`${r.firstName.toLowerCase()}|${r.lastName.toLowerCase()}|${r.dob}`);
        const payload: any = {
          first_name: r.firstName, last_name: r.lastName, dob: r.dob,
          mrn: r.mrn || `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          gender: r.gender, phone: r.phone || null,
          allergies: r.allergies, provider: r.provider || null, location: r.location || null,
        };
        if (match) {
          const { error } = await supabase.from('patients').update(payload).eq('id', match.id);
          if (!error) { updated++; upsertedIds.push({ id: match.id, name: `${r.lastName}, ${r.firstName}`, mrn: payload.mrn }); }
        } else {
          const insertPayload = { ...payload, user_id: user.id, ...(activeClinicId ? { clinic_id: activeClinicId } : {}) };
          const { data, error } = await supabase.from('patients').insert(insertPayload).select('id').single();
          if (!error && data) { created++; upsertedIds.push({ id: data.id, name: `${r.lastName}, ${r.firstName}`, mrn: payload.mrn }); }
        }
      }

      // Optionally add to today's dispatch batch
      if (createBatch && upsertedIds.length) {
        const today = new Date();
        const todayISO = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        const { data: existingBatch } = await supabase
          .from('dispatch_batches')
          .select('id, share_code')
          .eq('user_id', user.id)
          .eq('session_date', todayISO)
          .maybeSingle();

        let batchId = existingBatch?.id;
        if (!batchId) {
          const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
          const code = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
          const { data: newBatch, error: bErr } = await supabase.from('dispatch_batches').insert({
            user_id: user.id, share_code: code,
            label: `Patient List ${today.toLocaleDateString()}`,
            session_date: todayISO, default_chart_type: chartType,
          }).select('id').single();
          if (bErr || !newBatch) throw bErr;
          batchId = newBatch.id;
        }

        const { data: maxRow } = await supabase.from('dispatch_jobs')
          .select('position').eq('batch_id', batchId)
          .order('position', { ascending: false }).limit(1).maybeSingle();
        const startPos = ((maxRow?.position as number | undefined) ?? -1) + 1;
        const jobs = upsertedIds.map((p, i) => ({
          batch_id: batchId, position: startPos + i,
          patient_name: p.name, mrn: p.mrn,
          subjective: '', objective: '', assessment: '', plan: '',
          chart_type: chartType,
        }));
        await supabase.from('dispatch_jobs').insert(jobs);
      }

      toast.success(`Imported: ${created} new, ${updated} updated${createBatch ? ` · Added to today's dispatch` : ''}`);
      await fetchPatients();
      setRows([]); setFileName('');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const validCount = rows.filter(r => !r._error).length;
  const errorCount = rows.length - validCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Patient List</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file. Existing patients (matched by MRN or Name + DOB) will be updated.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2 flex-1">
              <Upload className="w-4 h-4" />
              {fileName || 'Choose CSV / XLSX file'}
            </Button>
            <Button variant="ghost" size="sm" onClick={downloadTemplate} className="gap-2">
              <Download className="w-4 h-4" />
              Template
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Recognized columns: First Name, Last Name (or "Name"), DOB, MRN, Gender, Phone, Allergies, Provider, Location.
          </p>

          {rows.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{validCount} valid</Badge>
                {errorCount > 0 && <Badge variant="destructive">{errorCount} errors</Badge>}
              </div>

              <Card className="max-h-64 overflow-y-auto p-2 text-xs">
                <table className="w-full">
                  <thead className="text-muted-foreground">
                    <tr><th className="text-left p-1">Name</th><th className="text-left p-1">DOB</th><th className="text-left p-1">MRN</th><th className="text-left p-1">Status</th></tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 100).map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="p-1">{r.lastName}, {r.firstName}</td>
                        <td className="p-1 font-mono">{r.dob || '—'}</td>
                        <td className="p-1 font-mono">{r.mrn || '—'}</td>
                        <td className="p-1">{r._error ? <span className="text-destructive">{r._error}</span> : <span className="text-green-600">OK</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 100 && <p className="text-center text-muted-foreground p-2">…and {rows.length - 100} more</p>}
              </Card>

              <Card className="p-3 space-y-3">
                <div className="flex items-start gap-2">
                  <Checkbox id="batch" checked={createBatch} onCheckedChange={(v) => setCreateBatch(!!v)} />
                  <div className="flex-1">
                    <Label htmlFor="batch" className="cursor-pointer">
                      Add to today's dispatch batch
                    </Label>
                    <p className="text-xs text-muted-foreground">Patients will be queued for charting in today's dispatch session.</p>
                  </div>
                </div>
                {createBatch && (
                  <div className="flex items-center gap-2 pl-6">
                    <Label className="text-xs">Chart type:</Label>
                    <Select value={chartType} onValueChange={(v) => setChartType(v as ChartType)}>
                      <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CHART_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.emoji} {t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </Card>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={importing}>Cancel</Button>
          <Button onClick={handleImport} disabled={!validCount || importing} className="gap-2">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Import {validCount > 0 ? `${validCount} patient${validCount !== 1 ? 's' : ''}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
