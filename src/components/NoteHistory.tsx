import { useState } from 'react';
import type { Patient, ClinicalNote } from '@/types/patient';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Mic, FileText, Trash2, Wand2, Loader2, Pencil, Save, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { usePatientStore } from '@/store/patientStore';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface NoteHistoryProps {
  patient: Patient;
}

type EditDraft = {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
};

export function NoteHistory({ patient }: NoteHistoryProps) {
  const deleteNote = usePatientStore((s) => s.deleteNote);
  const updateNote = usePatientStore((s) => s.updateNote);
  const templates = usePatientStore((s) => s.templates);
  const [reformattingId, setReformattingId] = useState<string | null>(null);
  const [pickerOpenId, setPickerOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const sortedNotes = [...patient.notes].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const startEdit = (note: ClinicalNote) => {
    setEditingId(note.id);
    setDraft({
      subjective: note.subjective || '',
      objective: note.objective || '',
      assessment: note.assessment || '',
      plan: note.plan || '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async (note: ClinicalNote) => {
    if (!draft) return;
    setSavingId(note.id);
    try {
      await updateNote(patient.id, note.id, draft);
      toast.success('Note updated');
      cancelEdit();
    } catch (err: any) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSavingId(null);
    }
  };

  const handleReformat = async (note: ClinicalNote, templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setReformattingId(note.id);
    try {
      const transcript = [
        note.subjective && `SUBJECTIVE:\n${note.subjective}`,
        note.objective && `OBJECTIVE:\n${note.objective}`,
        note.assessment && `ASSESSMENT:\n${note.assessment}`,
        note.plan && `PLAN:\n${note.plan}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const { data, error } = await supabase.functions.invoke('structure-soap', {
        body: { transcript, template },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await updateNote(patient.id, note.id, {
        subjective: data.subjective ?? note.subjective,
        objective: data.objective ?? note.objective,
        assessment: data.assessment ?? note.assessment,
        plan: data.plan ?? note.plan,
      });
      toast.success(`Note reformatted with "${template.name}"`);
      setPickerOpenId(null);
    } catch (err: any) {
      toast.error('Reformat failed: ' + (err.message || 'Unknown error'));
    } finally {
      setReformattingId(null);
    }
  };

  if (sortedNotes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>No notes yet. Create a new note to get started.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{sortedNotes.length} note{sortedNotes.length !== 1 ? 's' : ''} · Showing cumulative history</p>
      {sortedNotes.map((note, idx) => {
        const isEditing = editingId === note.id;
        return (
        <Card key={note.id} className="p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium text-foreground">{new Date(note.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              <Badge variant="outline" className="text-xs uppercase">{note.type}</Badge>
              {note.dictated && (
                <Badge variant="secondary" className="text-xs gap-1">
                  <Mic className="w-3 h-3" /> Dictated
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">{note.author}</span>
              {isEditing ? (
                <>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => saveEdit(note)}
                    disabled={savingId === note.id}
                  >
                    {savingId === note.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={cancelEdit}
                    disabled={savingId === note.id}
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => startEdit(note)}
                    aria-label="Edit note"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </Button>
                  {pickerOpenId === note.id ? (
                    <div className="flex items-center gap-1.5">
                      <Select
                        onValueChange={(v) => handleReformat(note, v)}
                        disabled={reformattingId === note.id}
                      >
                        <SelectTrigger className="h-8 w-56 text-xs">
                          <SelectValue placeholder="Pick template to apply..." />
                        </SelectTrigger>
                        <SelectContent>
                          {templates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {reformattingId === note.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setPickerOpenId(null)}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => setPickerOpenId(note.id)}
                      aria-label="Reformat with template"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Change template
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label="Delete note"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this note?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the {new Date(note.date).toLocaleDateString()} note. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            await deleteNote(patient.id, note.id);
                            toast.success('Note deleted');
                          }}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          </div>


          {isEditing && draft ? (
            <div className="grid gap-4">
              <EditableSection
                label="Subjective"
                value={draft.subjective}
                onChange={(v) => setDraft({ ...draft, subjective: v })}
              />
              <EditableSection
                label="Objective"
                value={draft.objective}
                onChange={(v) => setDraft({ ...draft, objective: v })}
              />
              <EditableSection
                label="Assessment"
                value={draft.assessment}
                onChange={(v) => setDraft({ ...draft, assessment: v })}
              />
              <EditableSection
                label="Plan"
                value={draft.plan}
                onChange={(v) => setDraft({ ...draft, plan: v })}
              />
            </div>
          ) : (() => {
            const { cc, subjective } = extractChiefComplaint(note.subjective);
            return (
              <div className="grid gap-4">
                {cc && <Section label="Chief Complaint" content={cc} />}
                <Section label="Subjective" content={subjective} />
                <Section label="Objective" content={note.objective} />
                <Section label="Assessment" content={note.assessment} />
                <Section label="Plan" content={note.plan} />
              </div>
            );
          })()}


          {idx < sortedNotes.length - 1 && (
            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground italic">↑ Building on previous encounter below</p>
            </div>
          )}
        </Card>
        );
      })}
    </div>
  );
}

function extractChiefComplaint(subjective: string): { cc: string; subjective: string } {
  if (!subjective) return { cc: '', subjective: '' };
  const m = subjective.match(/^\s*Chief Complaint:\s*([^\n]*)\n*([\s\S]*)$/i);
  if (!m) return { cc: '', subjective };
  return { cc: m[1].trim(), subjective: m[2].trim() };
}

function Section({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">{label}</h4>
      <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{content}</p>
    </div>
  );
}

function EditableSection({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">{label}</h4>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[100px] text-sm leading-relaxed"
      />
    </div>
  );
}
