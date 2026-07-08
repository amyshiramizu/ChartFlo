import { useState, useEffect } from 'react';
import { usePatientStore } from '@/store/patientStore';
import type { NoteTemplate } from '@/types/patient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, FileText, Trash2, Pencil } from 'lucide-react';
import { toast } from 'sonner';

const SOAP_FIELDS = [
  { key: 'subjectivePrompt' as const, label: 'Subjective Prompt' },
  { key: 'objectivePrompt' as const, label: 'Objective Prompt' },
  { key: 'assessmentPrompt' as const, label: 'Assessment Prompt' },
  { key: 'planPrompt' as const, label: 'Plan Prompt' },
];

const defaultIds = ['default-soap', 'follow-up', 'establish-care-primary', 'awv-cms', 'tcm-cms', 'ccm-monthly-visit'];

export function TemplateManager() {
  const { templates, addTemplate, updateTemplate, deleteTemplate, fetchTemplates } = usePatientStore();

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', subjectivePrompt: '', objectivePrompt: '', assessmentPrompt: '', planPrompt: '',
  });

  const resetForm = () => setForm({ name: '', subjectivePrompt: '', objectivePrompt: '', assessmentPrompt: '', planPrompt: '' });

  const handleAdd = () => {
    if (!form.name) { toast.error('Template name is required'); return; }
    addTemplate({ id: crypto.randomUUID(), name: form.name, type: 'soap', ...form });
    resetForm();
    setShowAdd(false);
    toast.success('Template added');
  };

  const handleEdit = (template: NoteTemplate) => {
    setForm({
      name: template.name,
      subjectivePrompt: template.subjectivePrompt,
      objectivePrompt: template.objectivePrompt,
      assessmentPrompt: template.assessmentPrompt,
      planPrompt: template.planPrompt,
    });
    setEditingId(template.id);
  };

  const handleUpdate = async () => {
    if (!editingId || !form.name) { toast.error('Template name is required'); return; }
    await updateTemplate(editingId, {
      name: form.name,
      subjectivePrompt: form.subjectivePrompt,
      objectivePrompt: form.objectivePrompt,
      assessmentPrompt: form.assessmentPrompt,
      planPrompt: form.planPrompt,
    });
    resetForm();
    setEditingId(null);
    toast.success('Template updated');
  };

  const handleDelete = async (id: string) => {
    await deleteTemplate(id);
    toast.success('Template deleted');
  };

  const isDefault = (id: string) => defaultIds.includes(id);

  const formUI = (
    <div className="space-y-3">
      <div>
        <Label>Template Name</Label>
        <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cardiology Follow-Up" />
      </div>
      {SOAP_FIELDS.map(field => (
        <div key={field.key}>
          <Label>{field.label}</Label>
          <Textarea
            value={form[field.key]}
            onChange={e => setForm({ ...form, [field.key]: e.target.value })}
            placeholder={`Guide text for ${field.label.replace(' Prompt', '').toLowerCase()} section...`}
            className="min-h-[60px]"
          />
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex-1 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Note Templates</h1>
            <p className="text-sm text-muted-foreground mt-1">Customize how your SOAP notes are structured</p>
          </div>
          <Button onClick={() => { resetForm(); setShowAdd(!showAdd); }} className="gap-2">
            <Plus className="w-4 h-4" /> New Template
          </Button>
        </div>

        {showAdd && (
          <Card className="p-5 mb-6 border-primary/20">
            <h3 className="text-sm font-semibold text-foreground mb-4">Create Template</h3>
            {formUI}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button onClick={handleAdd}>Save Template</Button>
            </div>
          </Card>
        )}

        {/* Edit Dialog */}
        <Dialog open={!!editingId} onOpenChange={open => { if (!open) { setEditingId(null); resetForm(); } }}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Edit Template</DialogTitle></DialogHeader>
            {formUI}
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="outline" onClick={() => { setEditingId(null); resetForm(); }}>Cancel</Button>
              <Button onClick={handleUpdate}>Save Changes</Button>
            </div>
          </DialogContent>
        </Dialog>

        <div className="space-y-3">
          {templates.map(template => (
            <Card key={template.id} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <FileText className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-medium text-foreground">{template.name}</h3>
                  {isDefault(template.id) && (
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Default</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(template)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  {!isDefault(template.id) && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(template.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'S', value: template.subjectivePrompt },
                  { label: 'O', value: template.objectivePrompt },
                  { label: 'A', value: template.assessmentPrompt },
                  { label: 'P', value: template.planPrompt },
                ].map(section => (
                  <div key={section.label} className="text-xs">
                    <span className="font-semibold text-primary">{section.label}: </span>
                    <span className="text-muted-foreground">{section.value || 'No prompt set'}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
