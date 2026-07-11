import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Check } from 'lucide-react';
import { toast } from 'sonner';

interface Alert {
  id: string;
  patient_id: string;
  patient_name: string;
  message: string;
  created_at: string;
}

/**
 * App-wide red banner for unacknowledged critical reading alerts.
 * Bypasses the normal task flow: shows at the top of every page,
 * on every device, until each alert is acknowledged.
 */
export default function CriticalAlertsBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const fetchAlerts = useCallback(async () => {
    const { data, error } = await supabase
      .from('alerts' as any)
      .select('id, patient_id, patient_name, message, created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(20);
    if (!error) setAlerts((data || []) as unknown as Alert[]);
  }, []);

  useEffect(() => {
    fetchAlerts();
    const i = setInterval(fetchAlerts, 60_000);
    return () => clearInterval(i);
  }, [fetchAlerts]);

  async function acknowledge(a: Alert) {
    const { error } = await supabase
      .from('alerts' as any)
      .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() })
      .eq('id', a.id);
    if (error) { toast.error(`Failed to acknowledge: ${error.message}`); return; }
    setAlerts(prev => prev.filter(x => x.id !== a.id));
  }

  if (alerts.length === 0) return null;

  return (
    <div className="bg-red-600 text-white">
      <div className="px-4 py-2 flex items-center gap-2 text-sm font-bold">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        {alerts.length} critical reading alert{alerts.length > 1 ? 's' : ''} — review required
      </div>
      <div className="divide-y divide-red-500/60 border-t border-red-500/60">
        {alerts.map(a => (
          <div key={a.id} className="px-4 py-2 flex flex-col sm:flex-row sm:items-center gap-2 bg-red-50 dark:bg-red-950/40 text-red-950 dark:text-red-100 text-sm">
            <div className="flex-1 min-w-0">
              <Link to={`/ccm/patient/${a.patient_id}`} className="font-semibold underline underline-offset-2">
                {a.patient_name || 'Patient'}
              </Link>
              <span className="mx-1.5">·</span>
              {a.message}
              <span className="ml-2 text-xs opacity-70">{new Date(a.created_at).toLocaleString()}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-red-300 text-red-800 hover:bg-red-100 dark:text-red-100 shrink-0 w-fit"
              onClick={() => acknowledge(a)}
            >
              <Check className="w-3.5 h-3.5" /> Acknowledge
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
