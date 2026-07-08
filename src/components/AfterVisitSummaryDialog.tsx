import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FileHeart, Loader2, Printer, Copy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  patientId: string;
  patientName?: string;
  note: { subjective?: string; objective?: string; assessment?: string; plan?: string };
  noteId?: string | null;
  clinicId?: string | null;
}

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'zh', label: 'Mandarin' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'ru', label: 'Russian' },
];

export function AfterVisitSummaryDialog({ patientId, patientName, note, noteId, clinicId }: Props) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState('en');
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState('');

  const generate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-avs', {
        body: { patientId, noteId, clinicId, language: lang, note },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSummary(data?.summary || '');
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate summary');
    } finally {
      setLoading(false);
    }
  };

  const print = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>After-Visit Summary - ${patientName || ''}</title>
      <style>body{font-family:Georgia,serif;max-width:680px;margin:40px auto;padding:0 24px;line-height:1.55;color:#222}</style>
      </head><body><h1>After-Visit Summary</h1>
      <p><strong>${patientName || ''}</strong></p>
      <pre style="white-space:pre-wrap;font-family:inherit;font-size:15px">${summary}</pre>
      </body></html>`);
    w.document.close();
    w.print();
  };

  const copy = async () => {
    await navigator.clipboard.writeText(summary);
    toast.success('Summary copied');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileHeart className="w-4 h-4" /> After-visit summary
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Patient After-Visit Summary</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2">
          <Select value={lang} onValueChange={setLang}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LANGS.map(l => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={generate} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Generate'}
          </Button>
          {summary && <>
            <Button variant="outline" size="icon" onClick={copy}><Copy className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" onClick={print}><Printer className="w-4 h-4" /></Button>
          </>}
        </div>
        <Textarea value={summary} onChange={e => setSummary(e.target.value)} rows={18} placeholder="Click Generate to create a plain-language summary the patient can take home." />
        <p className="text-xs text-muted-foreground">Written at ~6th grade reading level. Review before printing.</p>
      </DialogContent>
    </Dialog>
  );
}
