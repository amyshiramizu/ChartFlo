import { useEffect, useState } from 'react';
import { usePatientStore } from '@/store/patientStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Send, Copy, Printer, FileText, CheckCircle } from 'lucide-react';
import { sendOrdersToExtension } from '@/lib/practiceFusionBridge';
import { useClinicBranding } from '@/hooks/useClinicBranding';
import { toast } from 'sonner';

export function OrderSummary() {
  const { patients, fetchPatients } = usePatientStore();
  useEffect(() => {
    if (patients.length === 0) fetchPatients();
  }, [patients.length, fetchPatients]);
  const branding = useClinicBranding();
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [responsibleType, setResponsibleType] = useState<'facility' | 'family'>('facility');
  const [responsibleName, setResponsibleName] = useState('');
  const [additionalOrders, setAdditionalOrders] = useState('');
  const facility = responsibleName;



  const patient = patients.find((p) => p.id === selectedPatientId);
  const sortedNotes = patient
    ? [...patient.notes].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    : [];
  const latestNote = sortedNotes[0] || null;
  const previousNote = sortedNotes[1] || null;

  // Extract only discrete new/changed order lines from a plan block.
  // Drops diagnosis headers, ICD tags, boilerplate, and unchanged maintenance text.
  const extractOrders = (plan?: string): string[] => {
    if (!plan) return [];
    const changeOrOrderPattern = /\b(start|started|new|add|added|begin|initiate|increase|decrease|change|changed|switch|stop|stopped|hold|held|discontinue|discontinued|dc|d\/c|reduce|raise|titrate|adjust|order|ordered|obtain|schedule|refer|referral|consult|send|prescribe|prescribed|lab|labs|cbc|cmp|a1c|hba1c|tsh|ua|urinalysis|culture|x-?ray|ct|mri|ultrasound|echo|ekg|ecg|follow\s*up|recheck|repeat)\b/i;
    return plan
      .split('\n')
      .map((line) =>
        line
          .replace(/^\s*[-*•]\s+/, '')
          .replace(/^\s*\d+[.)]\s+/, '')
          .replace(/^\s*\[[^\]]+\]\s*/, '') // strip [ICD] tags
          .trim()
      )
      .filter(
        (l) =>
          l.length > 0 &&
          changeOrOrderPattern.test(l) &&
          !/^(assessment|plan|diagnosis|dx|problem|continue plan|recommended icd-10|general|---)\s*[:.-]?\s*$/i.test(l) &&
          !/^(continue|cont\.|maintain|monitor|reviewed|discussed)\b/i.test(l) &&
          !/(dictated using|ai-assisted|transcription|billing codes|total time spent|homebound|face to face)/i.test(l) &&
          !/^#{1,6}\s+/.test(l) // strip markdown headings
      );
  };

  const latestOrders = extractOrders(latestNote?.plan);
  const previousOrders = new Set(extractOrders(previousNote?.plan).map((o) => o.toLowerCase()));

  // Show only what changed in this visit vs the prior note.
  const changedOrders = latestOrders.filter((o) => !previousOrders.has(o.toLowerCase()));

  const allOrders = [
    ...changedOrders,
    ...additionalOrders.split('\n').filter(Boolean),
  ];

  const handleCopy = () => {
    const text = generateOrderText();
    navigator.clipboard.writeText(text);
    toast.success('Orders copied to clipboard');
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html><head><title>Orders - ${patient?.lastName}, ${patient?.firstName}</title>
        <style>
          body{font-family:Arial,sans-serif;padding:40px;max-width:640px;font-size:14px;line-height:1.6;color:#0f172a}
          .brand{display:flex;align-items:center;gap:14px;border-bottom:2px solid #0f3a5f;padding-bottom:12px;margin-bottom:20px}
          .brand img{height:64px;width:auto;display:block}
          .brand p{margin:0;font-size:12px;color:#475569}
          pre{font-family:inherit;white-space:pre-wrap;margin:0}
        </style>
        </head><body>
        <div class="brand">
          <img src="${branding.logoUrl.startsWith('http') ? branding.logoUrl : window.location.origin + branding.logoUrl}" alt="${branding.brandName}" />
          <p>${branding.brandName} &middot; Order Summary</p>
        </div>
        <pre>${generateOrderText()}</pre>
        </body></html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  const generateOrderText = () => {
    if (!patient) return '';
    const responsibleLabel = responsibleType === 'facility' ? 'Facility' : 'Family / Caregiver';
    const responsibleLine = responsibleName.trim()
      ? `\n\nResponsible for follow-through (${responsibleLabel}):\n- ${responsibleName.trim()}`
      : '';
    return `${branding.brandName}\nOrders:\n${allOrders
      .map((o) => `- ${o}`)
      .join('\n')}${responsibleLine}`;
  };


  return (
    <div className="flex-1 p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold text-foreground mb-1">Order Summary</h1>
        <p className="text-sm text-muted-foreground mb-8">Generate fax-ready order summaries from patient plans</p>

        <div className="grid gap-4 mb-6">
          <div>
            <Label>Patient</Label>
            <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a patient" />
              </SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.lastName}, {p.firstName} — {p.mrn}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Responsible party</Label>
            <div className="flex gap-2">
              <Select value={responsibleType} onValueChange={(v) => setResponsibleType(v as 'facility' | 'family')}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="facility">Facility</SelectItem>
                  <SelectItem value="family">Family</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={responsibleName}
                onChange={(e) => setResponsibleName(e.target.value)}
                placeholder={responsibleType === 'facility' ? 'e.g. Quest Diagnostics, City Pharmacy' : 'e.g. Daughter — Jane Doe (555-1234)'}
              />
            </div>
          </div>
        </div>

        {patient && latestNote && (
          <>
            <Card className="p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {previousNote ? 'New / Changed Orders' : 'Orders from Latest Plan'}
                </h3>
                <Badge variant="secondary" className="text-xs">
                  {new Date(latestNote.date).toLocaleDateString()}
                </Badge>
              </div>
              {changedOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No changes since the previous note.
                </p>
              ) : (
                <ul className="space-y-2">
                  {changedOrders.map((order, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                      <CheckCircle className="w-4 h-4 text-success mt-0.5 shrink-0" />
                      {order}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <div className="mb-6">
              <Label>Additional Orders</Label>
              <Textarea
                value={additionalOrders}
                onChange={(e) => setAdditionalOrders(e.target.value)}
                placeholder="Add additional orders, one per line..."
                className="min-h-[80px]"
              />
            </div>



            {/* Preview */}
            <Card className="p-5 bg-clinical mb-6">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold text-clinical-foreground">Fax Preview</h3>
              </div>
              <pre className="text-xs font-mono text-clinical-foreground whitespace-pre-wrap leading-relaxed">
                {generateOrderText()}
              </pre>
            </Card>

            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={handleCopy} className="gap-2">
                <Copy className="w-4 h-4" />
                Copy
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  if (!patient) return;
                  await sendOrdersToExtension({
                    patientName: `${patient.lastName}, ${patient.firstName}`,
                    mrn: patient.mrn,
                    date: new Date().toLocaleDateString(),
                    facility,
                    orders: allOrders,
                  });
                  toast.success('Orders sent to Practice Fusion extension');
                }}
                className="gap-2"
              >
                <Send className="w-4 h-4" />
                Send to PF
              </Button>
              <Button onClick={handlePrint} className="gap-2">
                <Printer className="w-4 h-4" />
                Print / Fax
              </Button>
            </div>
          </>
        )}

        {patient && !latestNote && (
          <div className="text-center py-12 text-muted-foreground">
            <p>No notes found for this patient. Create a note first.</p>
          </div>
        )}
      </div>
    </div>
  );
}
