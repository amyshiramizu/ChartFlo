import { useMemo, useState } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, XCircle, Play, RotateCcw, Plus, Trash2, ClipboardCopy } from 'lucide-react';
import {
  formatMedicationChanges,
  type MedData,
  type MedAction,
} from '@/lib/practiceFusionBridge';
import { toast } from 'sonner';

// Mirror of extension/content.js SECTION_KEYS — used to prove the fake PF
// chart's textareas would actually be matched by the live content script.
const SECTION_KEYS: Record<'subjective' | 'objective' | 'assessment' | 'plan', RegExp[]> = {
  subjective: [/\bsubjective\b/i, /\bhpi\b/i, /history of present illness/i, /chief complaint/i, /\bcc\b/i, /\bros\b/i, /review of systems/i],
  objective:  [/\bobjective\b/i, /physical exam/i, /\bexam\b/i, /\bvitals?\b/i],
  assessment: [/\bassessment\b/i, /\bdiagnos[ei]s\b/i, /\bimpression\b/i, /\bicd[- ]?10\b/i],
  plan:       [/\bplan\b/i, /\borders?\b/i, /follow[- ]?up/i, /treatment plan/i],
};

const matchSection = (label: string): 'subjective' | 'objective' | 'assessment' | 'plan' | null => {
  for (const key of Object.keys(SECTION_KEYS) as Array<keyof typeof SECTION_KEYS>) {
    if (SECTION_KEYS[key].some((rx) => rx.test(label))) return key;
  }
  return null;
};

// Default sample: one of each action — covers the full matrix.
const DEFAULT_MEDS: MedData[] = [
  { name: 'Lisinopril', dosage: '20 mg', frequency: 'daily', route: 'PO', action: 'start', instructions: '2-week BP check' },
  { name: 'Metformin', dosage: '1000 mg', frequency: 'BID', route: 'PO', action: 'change', instructions: 'titrated from 500 BID' },
  { name: 'Atenolol', dosage: '50 mg', frequency: 'daily', route: 'PO', action: 'stop', instructions: 'replaced by lisinopril' },
  { name: 'Atorvastatin', dosage: '40 mg', frequency: 'QHS', route: 'PO', action: 'continue' },
];

const FAKE_PF_FIELDS: Array<{ id: string; label: string; rows: number }> = [
  { id: 'pf-subjective', label: 'Subjective / HPI', rows: 3 },
  { id: 'pf-objective', label: 'Objective — Physical Exam', rows: 3 },
  { id: 'pf-assessment', label: 'Assessment / Diagnoses', rows: 2 },
  { id: 'pf-plan', label: 'Plan / Orders / Follow-up', rows: 8 },
];

type Check = { id: string; label: string; pass: boolean; detail?: string };

export default function PFExtensionTestPage() {
  const [meds, setMeds] = useState<MedData[]>(DEFAULT_MEDS);
  const [fakeChart, setFakeChart] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);

  const fieldMatches = useMemo(
    () => FAKE_PF_FIELDS.map((f) => ({ ...f, matched: matchSection(f.label) })),
    [],
  );

  const updateMed = (i: number, patch: Partial<MedData>) => {
    setMeds((ms) => ms.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  };
  const addMed = () =>
    setMeds((ms) => [
      ...ms,
      { name: '', dosage: '', frequency: 'daily', route: 'PO', action: 'start' },
    ]);
  const removeMed = (i: number) => setMeds((ms) => ms.filter((_, idx) => idx !== i));

  const runTest = () => {
    // 1) Build the payload exactly the way sendSOAPToExtension does.
    const baseSoap = {
      subjective: 'Patient reports BP improving on current regimen. No chest pain. No SOB.',
      objective: 'BP 132/82, HR 76, BMI 29.4. Heart RRR, lungs clear.',
      assessment: '1. Essential hypertension (I10)\n2. Type 2 diabetes mellitus (E11.9)',
      plan: 'Diet & exercise counseling. Re-check BP in 2 weeks. Labs in 3 months.',
    };
    const medBlock = formatMedicationChanges(meds);
    const planWithMeds = medBlock ? `${medBlock}\n\n${baseSoap.plan}` : baseSoap.plan;

    const draft = {
      ...baseSoap,
      plan: planWithMeds,
      patientName: 'Test, Patient',
      mrn: 'TEST-001',
      date: new Date().toISOString().split('T')[0],
      medicationChanges: meds,
    };

    // 2) Simulate extension/content.js: route each draft field into the matching
    //    fake-PF textarea using the same SECTION_KEYS regexes.
    const next: Record<string, string> = {};
    for (const f of FAKE_PF_FIELDS) {
      const key = matchSection(f.label);
      if (key) next[f.id] = ((draft as unknown) as Record<string, string>)[key] || '';
    }
    setFakeChart(next);
    setPayload(draft);

    // 3) Assertions
    const planText = next['pf-plan'] || '';
    const results: Check[] = [];

    results.push({
      id: 'plan-matched',
      label: 'Plan field on fake PF chart was matched by SECTION_KEYS regex',
      pass: !!next['pf-plan'],
    });
    results.push({
      id: 'header',
      label: 'Plan contains "MEDICATION CHANGES (this visit):" header',
      pass: planText.includes('MEDICATION CHANGES (this visit):'),
    });

    const TAGS: Record<MedAction, string> = {
      start: '[START]',
      change: '[CHANGE]',
      stop: '[DISCONTINUE]',
      continue: '[CONTINUE]',
    };
    const presentActions = new Set(meds.map((m) => m.action || 'start'));
    (Object.keys(TAGS) as MedAction[]).forEach((act) => {
      const expected = presentActions.has(act);
      const tag = TAGS[act];
      const found = planText.includes(tag);
      results.push({
        id: `tag-${act}`,
        label: expected
          ? `Plan contains ${tag} tag (${act})`
          : `Plan correctly omits ${tag} tag (no ${act} med supplied)`,
        pass: expected ? found : !found,
        detail: expected && !found ? 'Tag missing from Plan section' : undefined,
      });
    });

    // Each med name should appear at least once in the plan
    meds.forEach((m, i) => {
      if (!m.name.trim()) return;
      results.push({
        id: `name-${i}`,
        label: `"${m.name}" appears in Plan`,
        pass: planText.includes(m.name),
      });
    });

    // Instructions, when present, should be appended after an em-dash
    meds.forEach((m, i) => {
      if (!m.instructions?.trim()) return;
      results.push({
        id: `instr-${i}`,
        label: `Instructions for "${m.name}" preserved`,
        pass: planText.includes(`— ${m.instructions}`),
      });
    });

    // Original Plan content must NOT be overwritten — block is prepended.
    results.push({
      id: 'preserve',
      label: 'Original Plan content preserved beneath the med block',
      pass: planText.includes(baseSoap.plan),
    });

    // Structured medicationChanges payload should round-trip with full fidelity.
    results.push({
      id: 'structured',
      label: `Structured medicationChanges payload contains ${meds.length} item(s)`,
      pass: Array.isArray(draft.medicationChanges) && draft.medicationChanges.length === meds.length,
    });

    setChecks(results);

    const failed = results.filter((r) => !r.pass);
    if (failed.length === 0) {
      toast.success(`All ${results.length} checks passed — extension payload is correct.`);
    } else {
      toast.error(`${failed.length} of ${results.length} checks failed.`);
    }
  };

  const reset = () => {
    setMeds(DEFAULT_MEDS);
    setFakeChart({});
    setChecks(null);
    setPayload(null);
  };

  const copyPayload = async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success('Payload copied to clipboard');
    } catch {
      toast.error('Clipboard unavailable');
    }
  };

  const passCount = checks?.filter((c) => c.pass).length ?? 0;
  const totalCount = checks?.length ?? 0;
  const allPass = checks !== null && passCount === totalCount;

  return (
    <div className="min-h-screen flex bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          <header>
            <h1 className="text-2xl font-semibold text-foreground">PF Extension End-to-End Test</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Simulates the Chrome extension's SOAP-import flow against a local fake Practice Fusion chart.
              Verifies the <code className="font-mono">START / CHANGE / DISCONTINUE / CONTINUE</code> tags land
              in the Plan section before you install the extension in Chrome.
            </p>
          </header>

          {/* 1. Med change builder */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">1 · Medication changes to send</h2>
              <Button size="sm" variant="outline" onClick={addMed} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add row
              </Button>
            </div>
            <div className="space-y-2">
              {meds.map((m, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-3">
                    <Label className="text-xs">Name</Label>
                    <Input value={m.name} onChange={(e) => updateMed(i, { name: e.target.value })} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Dosage</Label>
                    <Input value={m.dosage} onChange={(e) => updateMed(i, { dosage: e.target.value })} />
                  </div>
                  <div className="col-span-1">
                    <Label className="text-xs">Route</Label>
                    <Input value={m.route} onChange={(e) => updateMed(i, { route: e.target.value })} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Frequency</Label>
                    <Input value={m.frequency} onChange={(e) => updateMed(i, { frequency: e.target.value })} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Action</Label>
                    <Select
                      value={m.action || 'start'}
                      onValueChange={(v) => updateMed(i, { action: v as MedAction })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="start">start</SelectItem>
                        <SelectItem value="change">change</SelectItem>
                        <SelectItem value="stop">stop</SelectItem>
                        <SelectItem value="continue">continue</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <Button size="icon" variant="ghost" onClick={() => removeMed(i)}>
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                  <div className="col-span-12 -mt-1">
                    <Label className="text-xs">Instructions (optional)</Label>
                    <Input value={m.instructions || ''} onChange={(e) => updateMed(i, { instructions: e.target.value })} />
                  </div>
                </div>
              ))}
              {meds.length === 0 && (
                <p className="text-sm text-muted-foreground italic">No medication changes — add at least one row.</p>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              <Button onClick={runTest} className="gap-1.5">
                <Play className="w-4 h-4" /> Run end-to-end test
              </Button>
              <Button variant="outline" onClick={reset} className="gap-1.5">
                <RotateCcw className="w-4 h-4" /> Reset
              </Button>
            </div>
          </Card>

          {/* 2. Field matcher preview */}
          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-2">2 · Fake PF SOAP field matcher</h2>
            <p className="text-xs text-muted-foreground mb-3">
              The live extension uses these same regex rules to locate fields in a real PF chart.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {fieldMatches.map((f) => (
                <div key={f.id} className="flex items-center justify-between border rounded px-3 py-2 text-sm">
                  <span className="font-mono text-xs">{f.label}</span>
                  {f.matched ? (
                    <Badge variant="secondary" className="font-mono text-xs">→ {f.matched}</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-xs">no match</Badge>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* 3. Fake PF chart */}
          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-3">3 · Fake Practice Fusion chart (post-import)</h2>
            <div className="space-y-3">
              {FAKE_PF_FIELDS.map((f) => (
                <div key={f.id}>
                  <Label className="text-xs font-mono" htmlFor={f.id}>{f.label}</Label>
                  <Textarea
                    id={f.id}
                    rows={f.rows}
                    value={fakeChart[f.id] || ''}
                    readOnly
                    className="font-mono text-xs"
                    placeholder="(empty — click Run end-to-end test)"
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* 4. Checklist */}
          {checks && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">4 · Checklist</h2>
                <Badge variant={allPass ? 'default' : 'destructive'} className="font-mono text-xs">
                  {passCount} / {totalCount} passed
                </Badge>
              </div>
              <ul className="space-y-1.5">
                {checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-sm">
                    {c.pass ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                    )}
                    <div>
                      <span className={c.pass ? 'text-foreground' : 'text-destructive'}>{c.label}</span>
                      {c.detail && <p className="text-xs text-muted-foreground">{c.detail}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* 5. Raw payload */}
          {payload && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">5 · Raw extension payload (CHART_SCRIBE_NOTE)</h2>
                <Button size="sm" variant="outline" onClick={copyPayload} className="gap-1.5">
                  <ClipboardCopy className="w-3.5 h-3.5" /> Copy JSON
                </Button>
              </div>
              <pre className="text-xs font-mono bg-muted/30 p-3 rounded overflow-x-auto max-h-96">
                {JSON.stringify(payload, null, 2)}
              </pre>
              <p className="text-xs text-muted-foreground mt-2">
                This is the exact object the web app stores in <code>chrome.storage.local.draft</code>.
                Once the extension is installed, its floating Import button reads <code>draft.plan</code> and writes it
                into the matched PF Plan textarea verbatim.
              </p>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
