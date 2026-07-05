import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClipboardList, Plus, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';

interface CarePlanTemplate {
  id: string;
  user_id: string;
  program: string;
  name: string;
  content: string;
}

const DEFAULT_CCM_CONTENT = `PROBLEM: [Diagnosis + ICD-10]
GOALS: [Measurable, time-bound]
INTERVENTIONS:
  - Medication management:
  - Patient education:
  - Self-monitoring:
  - Referrals:
BARRIERS:
EXPECTED OUTCOMES:
NEXT REVIEW: [Date]
PATIENT AGREEMENT: Verbal consent obtained on [date]`;

export function CarePlanTemplatesManager() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<CarePlanTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', program: 'CCM', content: DEFAULT_CCM_CONTENT });

  const fetchTemplates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('care_plan_templates')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) toast.error('Failed to load templates');
    setTemplates(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchTemplates(); }, []);

  const handleSave = async () => {
    if (!user) return;
    if (!draft.name.trim()) return toast.error('Name is required');
    if (editingId) {
      const { error } = await supabase
        .from('care_plan_templates')
        .update({ name: draft.name, program: draft.program, content: draft.content })
        .eq('id', editingId);
      if (error) return toast.error(error.message);
      toast.success('Template updated');
    } else {
      const { error } = await supabase
        .from('care_plan_templates')
        .insert({ user_id: user.id, name: draft.name, program: draft.program, content: draft.content });
      if (error) return toast.error(error.message);
      toast.success('Template created');
    }
    setEditingId(null);
    setDraft({ name: '', program: 'CCM', content: DEFAULT_CCM_CONTENT });
    fetchTemplates();
  };

  const handleEdit = (t: CarePlanTemplate) => {
    setEditingId(t.id);
    setDraft({ name: t.name, program: t.program, content: t.content });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this care plan template?')) return;
    const { error } = await supabase.from('care_plan_templates').delete().eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Deleted');
    fetchTemplates();
  };

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-center gap-2">
        <ClipboardList className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">CCM / RPM Care Plan Templates</h2>
      </div>

      <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/30">
        <h3 className="text-sm font-medium">{editingId ? 'Edit Template' : 'New Template'}</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g., Diabetes Care Plan" />
          </div>
          <div>
            <Label className="text-xs">Program</Label>
            <Select value={draft.program} onValueChange={(v) => setDraft({ ...draft, program: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CCM">CCM</SelectItem>
                <SelectItem value="RPM">RPM</SelectItem>
                <SelectItem value="BHI">BHI</SelectItem>
                <SelectItem value="CCO">CCO</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label className="text-xs">Care Plan Content</Label>
          <Textarea
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            className="font-mono text-xs min-h-[200px]"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} className="gap-2">
            <Save className="w-4 h-4" /> {editingId ? 'Update' : 'Create'}
          </Button>
          {editingId && (
            <Button variant="outline" onClick={() => { setEditingId(null); setDraft({ name: '', program: 'CCM', content: DEFAULT_CCM_CONTENT }); }}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Saved Templates ({templates.length})</h3>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No care plan templates yet.</p>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{t.name}</span>
                    <Badge variant="secondary">{t.program}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{t.content.split('\n')[0]}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleEdit(t)}>Edit</Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(t.id)}>
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
