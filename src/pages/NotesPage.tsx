import { useEffect, useState, useMemo } from 'react';
import { PageLayout } from '@/components/MobileLayout';
import { PatientChart } from '@/components/PatientChart';
import { usePatientStore } from '@/store/patientStore';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Search, User, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
import { toast } from 'sonner';

type NoteRow = {
  id: string;
  patient_id: string;
  date: string;
  type: string;
  author: string | null;
  subjective: string | null;
  assessment: string | null;
};

export default function NotesPage() {
  const { selectedPatientId, patients, fetchPatients, selectPatient, deleteNote } = usePatientStore();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (patients.length === 0) fetchPatients();
  }, [patients.length, fetchPatients]);

  const patientMap = useMemo(() => {
    const m = new Map<string, { first: string; last: string; mrn: string }>();
    patients.forEach(p => m.set(p.id, { first: p.firstName, last: p.lastName, mrn: p.mrn }));
    return m;
  }, [patients]);

  useEffect(() => {
    if (selectedPatientId) return;
    const ids = patients.map(p => p.id);
    if (ids.length === 0) {
      setNotes([]);
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('clinical_notes')
        .select('id, patient_id, date, type, author, subjective, assessment')
        .in('patient_id', ids)
        .order('date', { ascending: false })
        .limit(200);
      setNotes((data as NoteRow[]) || []);
      setLoading(false);
    })();
  }, [selectedPatientId, patients]);

  const filtered = useMemo(() => {
    // Only show notes for patients currently visible in the active clinic
    const scoped = notes.filter(n => patientMap.has(n.patient_id));
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(n => {
      const p = patientMap.get(n.patient_id)!;
      const name = `${p.first} ${p.last} ${p.mrn}`.toLowerCase();
      return (
        name.includes(q) ||
        (n.subjective || '').toLowerCase().includes(q) ||
        (n.assessment || '').toLowerCase().includes(q) ||
        (n.author || '').toLowerCase().includes(q)
      );
    });
  }, [notes, search, patientMap]);

  // If a patient is selected, defer to the chart view (preserves existing UX)
  if (selectedPatientId) {
    return (
      <PageLayout>
        <PatientChart />
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="flex-1 p-4 md:p-6 overflow-auto">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold text-foreground flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" /> All Notes
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {loading ? 'Loading…' : `${filtered.length} note${filtered.length === 1 ? '' : 's'} across your patients`}
              </p>
            </div>
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by patient, MRN, content, or author…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {!loading && filtered.length === 0 && (
            <Card className="p-8 text-center text-muted-foreground">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="font-medium">No notes yet</p>
              <p className="text-sm mt-1">Open a patient and create a note to see it here.</p>
              <Button variant="outline" className="mt-4" onClick={() => navigate('/')}>
                Go to Dashboard
              </Button>
            </Card>
          )}

          <div className="space-y-2">
            {filtered.map(n => {
              const p = patientMap.get(n.patient_id)!;
              const name = `${p.last}, ${p.first}`;
              const preview = (n.assessment || n.subjective || '').replace(/\s+/g, ' ').slice(0, 160);
              return (
                <Card
                  key={n.id}
                  className="p-4 hover:bg-accent/40 cursor-pointer transition-colors"
                  onClick={() => {
                    selectPatient(n.patient_id);
                    navigate(`/chart/${n.patient_id}`);
                  }}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <User className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="font-medium text-foreground">{name}</span>
                        {p?.mrn && (
                          <span className="text-xs font-mono text-muted-foreground">MRN {p.mrn}</span>
                        )}
                        <Badge variant="outline" className="text-xs uppercase">{n.type}</Badge>
                      </div>
                      {preview && (
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{preview}</p>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground text-right shrink-0 flex items-start gap-2">
                      <div>
                        <div>{n.date}</div>
                        {n.author && <div className="mt-0.5">{n.author}</div>}
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Delete note"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently remove the note for {name}. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={async () => {
                                await deleteNote(n.patient_id, n.id);
                                setNotes((prev) => prev.filter((x) => x.id !== n.id));
                                toast.success('Note deleted');
                              }}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
