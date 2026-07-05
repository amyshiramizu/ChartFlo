import { useEffect, useMemo, useState } from 'react';
import type { Patient, ClinicalNote } from '@/types/patient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Wand2, Copy, MessageSquare, Mail, Phone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface FamilyCommunicationProps {
  patient: Patient;
}

type TemplateKey = 'visit-summary' | 'med-change' | 'appt-reminder' | 'lab-result' | 'custom';

const TEMPLATES: Record<TemplateKey, { label: string; instructions: string }> = {
  'visit-summary': {
    label: 'Visit Summary (3rd grade reading level)',
    instructions: '',
  },
  'med-change': {
    label: 'Medication Change',
    instructions: 'Focus the summary on any medication changes from the Plan. Clearly state what is new, what is stopped, and how to take new meds. Skip unrelated parts of the visit.',
  },
  'appt-reminder': {
    label: 'Appointment / Follow-up Reminder',
    instructions: 'Focus on next steps and follow-up appointments from the Plan. Keep medical details brief.',
  },
  'lab-result': {
    label: 'Lab / Test Result Update',
    instructions: 'Focus on results in the Objective and Assessment sections and what they mean for the patient. Be reassuring where appropriate but accurate.',
  },
  custom: {
    label: 'Custom (use my instructions)',
    instructions: '',
  },
};

function pickLatestNote(patient: Patient): ClinicalNote | null {
  if (!patient.notes || patient.notes.length === 0) return null;
  return [...patient.notes].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )[0];
}

export function FamilyCommunication({ patient }: FamilyCommunicationProps) {
  const sortedNotes = useMemo(
    () => [...(patient.notes || [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [patient.notes]
  );

  const [selectedNoteId, setSelectedNoteId] = useState<string>(sortedNotes[0]?.id ?? '');
  const [template, setTemplate] = useState<TemplateKey>('visit-summary');
  const [extraInstructions, setExtraInstructions] = useState('');
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedNoteId && sortedNotes[0]) setSelectedNoteId(sortedNotes[0].id);
  }, [sortedNotes, selectedNoteId]);

  const selectedNote = sortedNotes.find((n) => n.id === selectedNoteId) ?? pickLatestNote(patient);

  async function generate() {
    if (!selectedNote) {
      toast.error('No visit note to summarize yet.');
      return;
    }
    setLoading(true);
    setSummary('');
    try {
      const tplInstr = TEMPLATES[template].instructions;
      const combined = [tplInstr, extraInstructions].filter(Boolean).join('\n');
      const { data, error } = await supabase.functions.invoke('summarize-for-family', {
        body: {
          subjective: selectedNote.subjective || '',
          objective: selectedNote.objective || '',
          assessment: selectedNote.assessment || '',
          plan: selectedNote.plan || '',
          patientFirstName: patient.firstName,
          extraInstructions: combined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const text = (data as any)?.summary?.trim();
      if (!text) throw new Error('Empty summary returned');
      setSummary(text);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to generate summary');
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!summary) return;
    await navigator.clipboard.writeText(summary);
    toast.success('Copied to clipboard');
  }

  function openSms() {
    if (!summary) return;
    const num = (patient.phone || '').replace(/[^\d+]/g, '');
    const body = encodeURIComponent(summary);
    window.open(`sms:${num}?&body=${body}`, '_self');
  }

  function openEmail() {
    if (!summary) return;
    const subject = encodeURIComponent(`Visit update for ${patient.firstName} ${patient.lastName}`);
    const body = encodeURIComponent(summary);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 md:p-5 space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold">Family Communication</h2>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Generates a short, plain-language summary of the visit you can text or email to the patient's family. Written at about a 3rd grade reading level — clear, never condescending.
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Visit to summarize</Label>
            <Select value={selectedNoteId} onValueChange={setSelectedNoteId}>
              <SelectTrigger><SelectValue placeholder="Select a visit" /></SelectTrigger>
              <SelectContent>
                {sortedNotes.length === 0 && (
                  <SelectItem value="none" disabled>No notes yet</SelectItem>
                )}
                {sortedNotes.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {new Date(n.date).toLocaleDateString()} — {n.type.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Template</Label>
            <Select value={template} onValueChange={(v) => setTemplate(v as TemplateKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TEMPLATES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Extra instructions (optional)</Label>
          <Textarea
            value={extraInstructions}
            onChange={(e) => setExtraInstructions(e.target.value)}
            placeholder="e.g. Mention that the next home visit is Tuesday at 10am"
            className="min-h-[60px] text-sm"
          />
        </div>

        <Button onClick={generate} disabled={loading || !selectedNote} className="w-full sm:w-auto">
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
          {summary ? 'Regenerate' : 'Generate summary'}
        </Button>
      </Card>

      {summary && (
        <Card className="p-4 md:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label className="text-xs">Family message (editable)</Label>
            <div className="text-xs text-muted-foreground">{summary.length} characters</div>
          </div>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="min-h-[260px] text-sm leading-relaxed font-sans"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={copy}>
              <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
            </Button>
            <Button size="sm" variant="outline" onClick={openSms} disabled={!patient.phone}>
              <Phone className="w-3.5 h-3.5 mr-1.5" /> Send as text
            </Button>
            <Button size="sm" variant="outline" onClick={openEmail}>
              <Mail className="w-3.5 h-3.5 mr-1.5" /> Send as email
            </Button>
          </div>
          {!patient.phone && (
            <p className="text-xs text-muted-foreground">Add a phone number to the patient profile to enable text sending.</p>
          )}
        </Card>
      )}
    </div>
  );
}
