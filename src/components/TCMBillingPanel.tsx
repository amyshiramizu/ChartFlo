import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Receipt, Calendar, AlertTriangle, CheckCircle2, FileText, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { CodeLookupDialog } from '@/components/CodeLookup';

export interface TCMBillingFields {
  dischargeDate: string;
  dischargeFacility: 'Inpatient hospital' | 'SNF' | 'Observation' | 'Partial hospitalization' | 'CMHC' | '';
  dischargingProvider: string;
  primaryDischargeDx: string;
  contactDate: string;
  contactMethod: 'Phone' | 'Email' | 'Face-to-face' | '';
  contactWith: 'Patient' | 'Caregiver' | 'Both' | '';
  faceToFaceDate: string;
  medReconDate: string;
  // MDM drivers
  numProblems: 'few' | 'multiple' | 'extensive' | '';
  dataReviewed: 'minimal' | 'moderate' | 'extensive' | '';
  riskLevel: 'low' | 'moderate' | 'high' | '';
  // Activities completed
  reviewedDischargeSummary: boolean;
  reviewedPendingResults: boolean;
  educatedPatient: boolean;
  arrangedReferrals: boolean;
  scheduledFollowUp: boolean;
  // Time
  nonFaceToFaceMinutes: string;
  faceToFaceMinutes: string;
  notes: string;
}

const initial: TCMBillingFields = {
  dischargeDate: '',
  dischargeFacility: '',
  dischargingProvider: '',
  primaryDischargeDx: '',
  contactDate: '',
  contactMethod: '',
  contactWith: '',
  faceToFaceDate: '',
  medReconDate: '',
  numProblems: '',
  dataReviewed: '',
  riskLevel: '',
  reviewedDischargeSummary: false,
  reviewedPendingResults: false,
  educatedPatient: false,
  arrangedReferrals: false,
  scheduledFollowUp: false,
  nonFaceToFaceMinutes: '',
  faceToFaceMinutes: '',
  notes: '',
};

interface Props {
  onInsert: (text: string, cptCode: '99495' | '99496') => void;
}

// Count business days between two ISO dates (exclusive of start, inclusive of end).
function businessDaysBetween(startISO: string, endISO: string): number | null {
  if (!startISO || !endISO) return null;
  const start = new Date(startISO + 'T00:00:00');
  const end = new Date(endISO + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  if (end < start) return -1;
  let days = 0;
  const cur = new Date(start);
  cur.setDate(cur.getDate() + 1);
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) days++;
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function calendarDaysBetween(startISO: string, endISO: string): number | null {
  if (!startISO || !endISO) return null;
  const start = new Date(startISO + 'T00:00:00');
  const end = new Date(endISO + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function TCMBillingPanel({ onInsert }: Props) {
  const [f, setF] = useState<TCMBillingFields>(initial);
  const [lookupOpen, setLookupOpen] = useState(false);
  const set = <K extends keyof TCMBillingFields>(k: K, v: TCMBillingFields[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const contactBizDays = useMemo(
    () => businessDaysBetween(f.dischargeDate, f.contactDate),
    [f.dischargeDate, f.contactDate],
  );
  const visitCalDays = useMemo(
    () => calendarDaysBetween(f.dischargeDate, f.faceToFaceDate),
    [f.dischargeDate, f.faceToFaceDate],
  );
  const medReconOnVisit = !!(f.medReconDate && f.faceToFaceDate && f.medReconDate <= f.faceToFaceDate);

  // Determine recommended complexity
  const recommendedCpt: '99495' | '99496' | null = useMemo(() => {
    if (!f.numProblems || !f.dataReviewed || !f.riskLevel || visitCalDays === null) return null;
    const highMdm =
      f.riskLevel === 'high' ||
      (f.numProblems === 'extensive' && f.dataReviewed === 'extensive');
    if (highMdm && visitCalDays >= 0 && visitCalDays <= 7) return '99496';
    if (visitCalDays >= 0 && visitCalDays <= 14) return '99495';
    return null;
  }, [f.numProblems, f.dataReviewed, f.riskLevel, visitCalDays]);

  // Validation gates required by CMS for TCM billing
  const issues = useMemo(() => {
    const arr: string[] = [];
    if (!f.dischargeDate) arr.push('Discharge date required.');
    if (!f.contactDate) arr.push('Interactive contact date required.');
    if (contactBizDays !== null && contactBizDays > 2)
      arr.push(`Interactive contact must be ≤2 business days post-discharge (currently ${contactBizDays}).`);
    if (contactBizDays !== null && contactBizDays < 0)
      arr.push('Interactive contact date is before discharge date.');
    if (!f.contactMethod) arr.push('Interactive contact method required.');
    if (!f.faceToFaceDate) arr.push('Face-to-face visit date required.');
    if (visitCalDays !== null && visitCalDays > 14)
      arr.push(`Face-to-face visit must be within 14 days of discharge (currently ${visitCalDays}).`);
    if (!f.medReconDate) arr.push('Medication reconciliation date required.');
    if (f.medReconDate && f.faceToFaceDate && !medReconOnVisit)
      arr.push('Medication reconciliation must occur no later than the face-to-face visit date.');
    if (!f.reviewedDischargeSummary) arr.push('Discharge summary review not attested.');
    if (!f.educatedPatient) arr.push('Patient/caregiver education not attested.');
    if (!f.scheduledFollowUp) arr.push('Follow-up arrangement not attested.');
    return arr;
  }, [f, contactBizDays, visitCalDays, medReconOnVisit]);

  const buildText = (cpt: '99495' | '99496'): string => {
    const totalMin =
      (Number(f.nonFaceToFaceMinutes) || 0) + (Number(f.faceToFaceMinutes) || 0);
    const complexityLabel = cpt === '99496' ? 'High' : 'Moderate';
    const fmt = (d: string) => (d ? new Date(d + 'T00:00:00').toLocaleDateString() : '[____]');

    const activities = [
      f.reviewedDischargeSummary && '• Reviewed hospital discharge summary.',
      f.reviewedPendingResults && '• Reviewed pending diagnostic results from hospitalization.',
      f.educatedPatient && '• Provided education to patient/caregiver on diagnoses, self-management, and red-flag symptoms.',
      f.arrangedReferrals && '• Established/re-established community referrals and resources.',
      f.scheduledFollowUp && '• Arranged follow-up with PCP and specialists.',
    ].filter(Boolean).join('\n');

    return [
      '═══ TRANSITIONAL CARE MANAGEMENT — BILLING & REQUIRED DOCUMENTATION ═══',
      '',
      `Billed code: CPT ${cpt} — TCM, ${complexityLabel.toLowerCase()}-complexity MDM, face-to-face within ${cpt === '99496' ? '7' : '14'} days of discharge.`,
      `Service period: 30 days beginning ${fmt(f.dischargeDate)}. Bill on day 30 (${
        f.dischargeDate
          ? new Date(new Date(f.dischargeDate + 'T00:00:00').getTime() + 29 * 86_400_000).toLocaleDateString()
          : '[____]'
      }).`,
      '',
      'Required CMS elements (attested below):',
      `1. Discharge from ${f.dischargeFacility || '[facility]'} on ${fmt(f.dischargeDate)}; discharging provider: ${f.dischargingProvider || '[____]'}. Primary discharge diagnosis: ${f.primaryDischargeDx || '[____]'}.`,
      `2. Interactive contact on ${fmt(f.contactDate)} (${
        contactBizDays !== null ? `${contactBizDays} business day(s) post-discharge` : '[___ business days post-discharge]'
      }) via ${f.contactMethod || '[method]'} with ${f.contactWith || '[patient/caregiver]'}.`,
      `3. Face-to-face visit on ${fmt(f.faceToFaceDate)} (${
        visitCalDays !== null ? `${visitCalDays} calendar day(s) post-discharge` : '[___ days post-discharge]'
      }) — within the ${cpt === '99496' ? '7-day' : '14-day'} window required for ${cpt}.`,
      `4. Medication reconciliation completed on ${fmt(f.medReconDate)} (no later than the face-to-face visit date — REQUIRED for TCM billing).`,
      '5. Non-face-to-face care management activities documented:',
      activities || '• [activities completed during 30-day service period]',
      '',
      `Medical decision-making complexity: ${complexityLabel} (${cpt}).`,
      `  • Number/complexity of problems addressed: ${f.numProblems || '[____]'}.`,
      `  • Amount/complexity of data reviewed: ${f.dataReviewed || '[____]'}.`,
      `  • Risk of complications / morbidity / mortality: ${f.riskLevel || '[____]'}.`,
      `  • Rationale: ${complexityLabel}-complexity MDM is supported by the number of acute and chronic problems managed post-discharge, the data reviewed (discharge summary, hospital labs/imaging, medication reconciliation), and the elevated risk of readmission and adverse events inherent to the transition of care.`,
      '',
      `Total TCM time during 30-day service period: ${totalMin || '[____]'} minutes (non-face-to-face ${f.nonFaceToFaceMinutes || '[__]'} min + face-to-face ${f.faceToFaceMinutes || '[__]'} min).`,
      '',
      'Billing rationale:',
      `  • CPT ${cpt} reported once per beneficiary per 30-day post-discharge period.`,
      `  • Same-day E/M not separately billable on the date of the face-to-face TCM visit.`,
      `  • TCM may not be reported by another practitioner for the same beneficiary during the same 30-day period.`,
      `  • Concurrent CCM (99490/99439), PCM (99426/99427), or RPM (99457/99458) services may NOT overlap the TCM 30-day period for the same time.`,
      `  • G2211 visit-complexity add-on may be reported with the TCM face-to-face when applicable.`,
      `  • +99497 / +99498 (Advance Care Planning) separately billable if ≥16 minutes documented.`,
      f.notes ? `\nAdditional notes: ${f.notes}` : '',
      '',
      '═══ END TCM BILLING BLOCK ═══',
    ].filter(Boolean).join('\n');
  };

  const handleInsert = () => {
    if (!recommendedCpt) {
      toast.error('Complete complexity drivers and dates before inserting.');
      return;
    }
    if (issues.length) {
      toast.warning(`Inserting with ${issues.length} unresolved CMS requirement(s).`);
    }
    onInsert(buildText(recommendedCpt), recommendedCpt);
    toast.success(`TCM ${recommendedCpt} billing block inserted into Plan.`);
  };

  const handleInsertAs = (cpt: '99495' | '99496') => {
    onInsert(buildText(cpt), cpt);
    toast.success(`TCM ${cpt} billing block inserted into Plan.`);
  };

  return (
    <Card className="p-4 border-primary/20 bg-primary/5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Receipt className="w-4 h-4 text-primary" />
          TCM Billing — 99495 / 99496 (CMS-compliant)
        </h3>
        <div className="flex items-center gap-2">
          {recommendedCpt ? (
            <Badge className="text-[10px] uppercase">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Recommended: CPT {recommendedCpt}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] uppercase">
              Complete fields to determine code
            </Badge>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs" onClick={() => setLookupOpen(true)}>
            <BookOpen className="w-3.5 h-3.5" /> Code Lookup
          </Button>
        </div>
      </div>
      <CodeLookupDialog open={lookupOpen} onOpenChange={setLookupOpen} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Discharge date</Label>
          <Input type="date" value={f.dischargeDate} onChange={(e) => set('dischargeDate', e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Discharging facility</Label>
          <Select value={f.dischargeFacility} onValueChange={(v) => set('dischargeFacility', v as TCMBillingFields['dischargeFacility'])}>
            <SelectTrigger><SelectValue placeholder="Select facility type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Inpatient hospital">Inpatient hospital</SelectItem>
              <SelectItem value="SNF">Skilled nursing facility</SelectItem>
              <SelectItem value="Observation">Observation</SelectItem>
              <SelectItem value="Partial hospitalization">Partial hospitalization</SelectItem>
              <SelectItem value="CMHC">CMHC</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Discharging provider</Label>
          <Input value={f.dischargingProvider} onChange={(e) => set('dischargingProvider', e.target.value)} placeholder="Dr. ___" />
        </div>
        <div>
          <Label className="text-xs">Primary discharge diagnosis</Label>
          <Input value={f.primaryDischargeDx} onChange={(e) => set('primaryDischargeDx', e.target.value)} placeholder="ICD-10 + description" />
        </div>

        <div>
          <Label className="text-xs flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Interactive contact date
            {contactBizDays !== null && (
              <span className={`ml-auto text-[10px] ${contactBizDays > 2 || contactBizDays < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                {contactBizDays < 0 ? 'before discharge' : `${contactBizDays} biz day(s)`}
              </span>
            )}
          </Label>
          <Input type="date" value={f.contactDate} onChange={(e) => set('contactDate', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Contact method</Label>
            <Select value={f.contactMethod} onValueChange={(v) => set('contactMethod', v as TCMBillingFields['contactMethod'])}>
              <SelectTrigger><SelectValue placeholder="Method" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Phone">Phone</SelectItem>
                <SelectItem value="Email">Email / portal</SelectItem>
                <SelectItem value="Face-to-face">Face-to-face</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">With</Label>
            <Select value={f.contactWith} onValueChange={(v) => set('contactWith', v as TCMBillingFields['contactWith'])}>
              <SelectTrigger><SelectValue placeholder="With" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Patient">Patient</SelectItem>
                <SelectItem value="Caregiver">Caregiver</SelectItem>
                <SelectItem value="Both">Both</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label className="text-xs flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Face-to-face visit date
            {visitCalDays !== null && (
              <span className={`ml-auto text-[10px] ${visitCalDays > 14 || visitCalDays < 0 ? 'text-destructive' : visitCalDays <= 7 ? 'text-emerald-600' : 'text-amber-600'}`}>
                {visitCalDays < 0 ? 'before discharge' : `day ${visitCalDays}`}
              </span>
            )}
          </Label>
          <Input type="date" value={f.faceToFaceDate} onChange={(e) => set('faceToFaceDate', e.target.value)} />
        </div>
        <div>
          <Label className="text-xs flex items-center gap-1">
            Medication reconciliation date
            {medReconOnVisit && (
              <span className="ml-auto text-[10px] text-emerald-600">✓ on/before visit</span>
            )}
          </Label>
          <Input type="date" value={f.medReconDate} onChange={(e) => set('medReconDate', e.target.value)} />
        </div>

        <div>
          <Label className="text-xs">Number/complexity of problems</Label>
          <Select value={f.numProblems} onValueChange={(v) => set('numProblems', v as TCMBillingFields['numProblems'])}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="few">Few / minor</SelectItem>
              <SelectItem value="multiple">Multiple / moderate</SelectItem>
              <SelectItem value="extensive">Extensive / severe</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Data reviewed</Label>
          <Select value={f.dataReviewed} onValueChange={(v) => set('dataReviewed', v as TCMBillingFields['dataReviewed'])}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="minimal">Minimal</SelectItem>
              <SelectItem value="moderate">Moderate</SelectItem>
              <SelectItem value="extensive">Extensive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Risk of complications</Label>
          <Select value={f.riskLevel} onValueChange={(v) => set('riskLevel', v as TCMBillingFields['riskLevel'])}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="moderate">Moderate</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Non-face-to-face min</Label>
            <Input type="number" min={0} value={f.nonFaceToFaceMinutes} onChange={(e) => set('nonFaceToFaceMinutes', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Face-to-face min</Label>
            <Input type="number" min={0} value={f.faceToFaceMinutes} onChange={(e) => set('faceToFaceMinutes', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Care management activities completed</Label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {[
            { k: 'reviewedDischargeSummary', label: 'Reviewed discharge summary' },
            { k: 'reviewedPendingResults', label: 'Reviewed pending diagnostic results' },
            { k: 'educatedPatient', label: 'Educated patient/caregiver on diagnoses & red flags' },
            { k: 'arrangedReferrals', label: 'Arranged community referrals / resources' },
            { k: 'scheduledFollowUp', label: 'Scheduled PCP / specialist follow-up' },
          ].map((row) => (
            <label key={row.k} className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={f[row.k as keyof TCMBillingFields] as boolean}
                onCheckedChange={(v) => set(row.k as keyof TCMBillingFields, !!v as never)}
              />
              {row.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-xs">Additional notes (optional)</Label>
        <Textarea
          value={f.notes}
          onChange={(e) => set('notes', e.target.value)}
          className="min-h-[50px]"
          placeholder="Med changes, pending results, readmission-risk drivers..."
        />
      </div>

      {issues.length > 0 && (
        <div className="p-3 rounded-md border border-amber-500/40 bg-amber-500/5">
          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            {issues.length} CMS requirement{issues.length === 1 ? '' : 's'} unresolved
          </p>
          <ul className="list-disc ml-5 space-y-0.5">
            {issues.map((m, i) => (
              <li key={i} className="text-xs text-muted-foreground">{m}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={handleInsert} className="gap-1.5" disabled={!recommendedCpt}>
          <FileText className="w-3.5 h-3.5" />
          Insert billing block into Plan {recommendedCpt ? `(${recommendedCpt})` : ''}
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleInsertAs('99495')}>Force 99495</Button>
        <Button variant="outline" size="sm" onClick={() => handleInsertAs('99496')}>Force 99496</Button>
        <Button variant="ghost" size="sm" onClick={() => setF(initial)}>Reset</Button>
      </div>
    </Card>
  );
}
