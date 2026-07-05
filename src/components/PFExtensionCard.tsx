import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Chrome, CheckCircle2, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useClinic } from '@/hooks/useClinic';

export function PFExtensionCard() {
  const { activeClinic } = useClinic();
  const download = () => {
    fetch('/chart-scribe-pf-extension.zip')
      .then((r) => {
        if (!r.ok) throw new Error(`Download failed (${r.status})`);
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'chart-scribe-pf-extension.zip';
        a.click();
        URL.revokeObjectURL(a.href);
        toast.success('Extension downloaded');
      })
      .catch((e) => toast.error(e.message));
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2.5">
          <Chrome className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-foreground">Practice Fusion push extension</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Chrome extension that recognizes SOAP sections inside Practice Fusion encounters and
            fills Subjective, Objective, Assessment and Plan with one click.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 text-primary shrink-0" />
          <span>Auto-detects fields by label, ARIA and section headings</span>
        </div>
        <div className="flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 text-primary shrink-0" />
          <span>Appends to existing content — never overwrites silently</span>
        </div>
        <div className="flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 text-primary shrink-0" />
          <span>Paste a note as JSON or use "Copy for PF" from a note</span>
        </div>
        <div className="flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 text-primary shrink-0" />
          <span>Highlights matched fields with "Detect fields"</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={download} className="gap-2">
          <Download className="w-4 h-4" />
          Download extension (.zip)
        </Button>
        <Button
          variant="outline"
          className="gap-2"
          disabled={!activeClinic}
          onClick={async () => {
            if (!activeClinic) return toast.error('Select a clinic first');
            const { data } = await supabase.auth.getSession();
            const token = data.session?.access_token;
            if (!token) return toast.error('Not signed in');
            const blob = JSON.stringify({
              token,
              clinic_id: activeClinic.id,
              clinic_name: activeClinic.name,
            });
            let copied = false;
            try {
              if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(blob);
                copied = true;
              }
            } catch (e) {
              copied = false;
            }
            if (!copied) {
              try {
                const ta = document.createElement('textarea');
                ta.value = blob;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                copied = document.execCommand('copy');
                document.body.removeChild(ta);
              } catch (e) {
                copied = false;
              }
            }
            if (copied) {
              toast.success(`Auth + clinic copied for ${activeClinic.name}`);
            } else {
              // Last resort: show the token in a prompt so the user can copy manually
              window.prompt('Copy this auth blob manually:', blob);
            }
          }}
        >
          <KeyRound className="w-4 h-4" />
          Copy auth token for extension
        </Button>
      </div>



      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-primary">Install instructions</summary>
        <ol className="mt-2 ml-5 list-decimal space-y-1 text-muted-foreground">
          <li>Unzip the downloaded file.</li>
          <li>
            Open <code className="px-1 py-0.5 rounded bg-muted">chrome://extensions</code> in Chrome,
            Edge, Brave or Arc.
          </li>
          <li>Toggle <b>Developer mode</b> on (top-right).</li>
          <li>Click <b>Load unpacked</b> and select the unzipped folder.</li>
          <li>Open a Practice Fusion encounter, click the extension icon, then <b>Push</b>.</li>
        </ol>
      </details>
    </Card>
  );
}
