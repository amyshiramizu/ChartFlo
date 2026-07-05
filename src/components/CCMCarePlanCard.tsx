import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { ClipboardList, ExternalLink, Target, Stethoscope, Calendar, Share2, Loader2, AlertCircle, BookOpen } from 'lucide-react';
import { CodeLookupDialog } from '@/components/CodeLookup';
import type { Patient } from '@/types/patient';

interface Props { patient: Patient }

const PLAN_FIELD_LABELS: Record<string, string> = {
  expected_outcomes: 'Expected outcomes & prognosis',
  symptom_plan: 'Symptom management plan',
  med_mgmt: 'Medication management',
  preventive: 'Preventive care',
  caregivers: 'Caregivers & support',
  advance_dir: 'Advance directives',
  psychosocial: 'Psychosocial / BH needs',
  education: 'Patient / caregiver education',
};

export function CCMCarePlanCard({ patient }: Props) {
  const navigate = useNavigate();
  const [lookupOpen, setLookupOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [problems, setProblems] = useState<{ id: string; icd_code: string; description: string }[]>([]);
  const [plan, setPlan] = useState<any>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [pr, cp] = await Promise.all([
        supabase.from('patient_problems').select('id, icd_code, description').eq('patient_id', patient.id).order('created_at'),
        supabase.from('patient_care_plans').select('*').eq('patient_id', patient.id).maybeSingle(),
      ]);
      if (!alive) return;
      setProblems(pr.data || []);
      setPlan(cp.data || null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [patient.id]);

  if (loading) {
    return (
      <Card className="p-6 flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading CCM care plan…
      </Card>
    );
  }

  const problemPlans: Record<string, { goal: string; intervention: string }> = plan?.problem_plans || {};
  const data: Record<string, string> = plan?.data || {};
  const draftedCount = problems.filter((p) => problemPlans[p.id]?.goal && problemPlans[p.id]?.intervention).length;
  const populatedFields = Object.entries(PLAN_FIELD_LABELS).filter(([k]) => (data[k] || '').trim().length > 0);

  return (
    <div className="space-y-4">
      <Card className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Comprehensive CCM Care Plan</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setLookupOpen(true)}>
              <BookOpen className="w-3.5 h-3.5" /> Codes
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/ccm/patient/${patient.id}`)}>
              <ExternalLink className="w-3.5 h-3.5" /> Open full editor
            </Button>
          </div>
        </div>
        <CodeLookupDialog open={lookupOpen} onOpenChange={setLookupOpen} />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <Stat label="Problems" value={String(problems.length)} icon={<Stethoscope className="w-3 h-3" />} />
          <Stat label="Plans drafted" value={`${draftedCount}/${problems.length}`} icon={<Target className="w-3 h-3" />} />
          <Stat
            label="Next review"
            value={plan?.next_review_date ? new Date(plan.next_review_date).toLocaleDateString() : '—'}
            icon={<Calendar className="w-3 h-3" />}
          />
          <Stat
            label="Shared w/ pt"
            value={plan?.shared_with_patient ? (plan?.shared_date ? new Date(plan.shared_date).toLocaleDateString() : 'Yes') : 'No'}
            icon={<Share2 className="w-3 h-3" />}
          />
        </div>

        {!plan && (
          <div className="flex items-start gap-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-xs">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-foreground">No comprehensive care plan saved yet</div>
              <div className="text-muted-foreground mt-0.5">
                Required for CCM (99490) billing. Open the full editor to generate one from this patient's problems.
              </div>
            </div>
          </div>
        )}

        {problems.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Per-problem goals & interventions</div>
            <div className="space-y-2">
              {problems.map((p) => {
                const pp = problemPlans[p.id] || { goal: '', intervention: '' };
                const drafted = !!(pp.goal && pp.intervention);
                return (
                  <div key={p.id} className={`rounded border p-2.5 ${drafted ? 'border-primary/30 bg-primary/5' : 'border-dashed border-border bg-background'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="font-mono text-[10px]">{p.icd_code}</Badge>
                      <span className="text-xs font-medium">{p.description}</span>
                      {drafted ? (
                        <Badge variant="secondary" className="text-[10px] ml-auto">Drafted</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] ml-auto text-amber-600 border-amber-500/40">Needs plan</Badge>
                      )}
                    </div>
                    {drafted ? (
                      <div className="grid sm:grid-cols-2 gap-2 text-xs">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Goal</div>
                          <p className="text-foreground/90 line-clamp-3">{pp.goal}</p>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Intervention</div>
                          <p className="text-foreground/90 line-clamp-3">{pp.intervention}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground italic">No goal/intervention documented for this problem.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {populatedFields.length > 0 && (
          <>
            <Separator className="my-4" />
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Plan sections completed</div>
            <ul className="grid sm:grid-cols-2 gap-1.5">
              {populatedFields.map(([k, label]) => (
                <li key={k} className="text-xs flex items-start gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <div>
                    <span className="font-medium">{label}: </span>
                    <span className="text-muted-foreground line-clamp-2">{data[k]}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">{icon}{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}
