import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { generateMonthlyCcmPdf } from '@/lib/ccmMonthlyPdf';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

interface Props {
  patientId: string;
  patient: { firstName: string; lastName: string; dob?: string; mrn?: string; provider?: string };
  clinicName?: string;
  practitionerName?: string;
}

export function MonthlyCcmPdfButton({ patientId, patient, clinicName, practitionerName }: Props) {
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(false);

  const years = [now.getFullYear(), now.getFullYear() - 1];

  async function handleGenerate() {
    setLoading(true);
    try {
      const blob = await generateMonthlyCcmPdf({ patientId, patient, year, month, clinicName, practitionerName });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = `${patient.lastName}_${patient.firstName}`.replace(/[^a-z0-9_-]/gi, '');
      a.href = url;
      a.download = `CCM_${safeName}_${MONTHS[month]}-${year}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Monthly CCM PDF generated');
      setOpen(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Failed to generate PDF');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileDown className="w-4 h-4" /> Monthly CCM PDF
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Monthly CCM Summary</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Compiles total minutes, full care plan, problem list, medications, assessments, clinical notes, and a CMS attestation into a single PDF — ready to upload into Practice Fusion.
        </p>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div>
            <Label className="text-xs">Month</Label>
            <Select value={String(month)} onValueChange={v => setMonth(parseInt(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Year</Label>
            <Select value={String(year)} onValueChange={v => setYear(parseInt(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
          <Button onClick={handleGenerate} disabled={loading} className="gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Building…</> : <><FileDown className="w-4 h-4" /> Download PDF</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
