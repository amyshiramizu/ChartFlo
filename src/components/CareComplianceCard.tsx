import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Activity,
  HeartPulse,
  Brain,
  CalendarCheck,
  ClipboardList,
  FlaskConical,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { ANNUAL_REQUIRED_DOCS, matchGuidance } from '@/lib/cmsDiagnosisGuidance';
import { recommendPrograms } from '@/lib/careProgramRecommendation';
import { Lightbulb } from 'lucide-react';
import type { Patient } from '@/types/patient';

type Program = 'CCM' | 'RPM' | 'BHI';
const PROGRAMS: { id: Program; label: string; icon: any; desc: string }[] = [
  { id: 'CCM', label: 'CCM', icon: ClipboardList, desc: 'Chronic Care Mgmt · ≥2 chronic · 99490/99439/99491/99437 · APCM G0556–G0558 (2026)' },
  { id: 'RPM', label: 'RPM', icon: HeartPulse, desc: 'Remote Patient Monitoring · 99453/99454/99457/99458/99091' },
  { id: 'BHI', label: 'BHI', icon: Brain, desc: 'Behavioral Health Integration · 99484 / CoCM 99492/99493/99494' },
];

interface Props {
  patient: Patient;
}

export function CareComplianceCard({ patient }: Props) {
  const [enrollments, setEnrollments] = useState<{ program: Program }[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [problems, setProblems] = useState<{ icd_code: string; description: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Program | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [en, asm, pr] = await Promise.all([
        supabase.from('patient_enrollments').select('program').eq('patient_id', patient.id),
        supabase.from('patient_assessments').select('*').eq('patient_id', patient.id),
        supabase.from('patient_problems').select('icd_code, description').eq('patient_id', patient.id),
      ]);
      if (!alive) return;
      setEnrollments((en.data as any) || []);
      setAssessments(asm.data || []);
      setProblems(pr.data || []);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [patient.id]);

  const isEnrolled = (p: Program) => enrollments.some((e) => e.program === p);

  async function toggle(p: Program) {
    setBusy(p);
    try {
      if (isEnrolled(p)) {
        await supabase.from('patient_enrollments').delete().eq('patient_id', patient.id).eq('program', p);
        setEnrollments((cur) => cur.filter((e) => e.program !== p));
        toast.success(`${p} disenrolled`);
      } else {
        const { error } = await supabase.from('patient_enrollments').insert({ patient_id: patient.id, program: p });
        if (error) throw error;
        setEnrollments((cur) => [...cur, { program: p }]);
        toast.success(`${p} enrolled`);
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed');
    } finally {
      setBusy(null);
    }
  }

  // Map assessment_type → completed in last year
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  function recentlyCompleted(label: string) {
    // Loose match on assessment_type substring
    const a = assessments.find((x) =>
      x.assessment_type?.toLowerCase().includes(label.toLowerCase().split(' ')[0]),
    );
    if (!a?.completed_at) return false;
    return new Date(a.completed_at) >= oneYearAgo;
  }

  const guidance = matchGuidance(problems.map((p) => p.icd_code));
  const annualCompleted = ANNUAL_REQUIRED_DOCS.filter((d) => recentlyCompleted(d.label)).length;

  if (loading) {
    return (
      <Card className="p-6 flex items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading CMS compliance…
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* SOAP / diagnosis-driven recommendations */}
      <RecommendationsBanner
        problems={problems}
        isEnrolled={isEnrolled}
        onEnroll={(p) => !isEnrolled(p) && toggle(p)}
        busy={busy}
      />

      {/* Enrollment programs */}
      <Card className="p-4 md:p-5">

        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Care Management Enrollment</h3>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          {PROGRAMS.map((p) => {
            const enrolled = isEnrolled(p.id);
            const Icon = p.icon;
            return (
              <div
                key={p.id}
                className={`rounded-md border p-3 ${
                  enrolled ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${enrolled ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="font-semibold text-sm">{p.label}</span>
                    {enrolled && (
                      <Badge variant="secondary" className="text-[10px]">
                        Enrolled
                      </Badge>
                    )}
                  </div>
                  <Switch
                    checked={enrolled}
                    disabled={busy === p.id}
                    onCheckedChange={() => toggle(p.id)}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">{p.desc}</p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Annual required docs */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Yearly Required Documentation</h3>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {annualCompleted}/{ANNUAL_REQUIRED_DOCS.length} current
          </Badge>
        </div>
        <ul className="grid sm:grid-cols-2 gap-1.5">
          {ANNUAL_REQUIRED_DOCS.map((d) => {
            const done = recentlyCompleted(d.label);
            return (
              <li
                key={d.key}
                className="flex items-start gap-2 text-xs p-2 rounded border border-border bg-background"
              >
                {done ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground truncate">{d.label}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {d.cadence} · {d.cms}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-[10px] text-muted-foreground mt-2 italic">
          Completion auto-derived from this patient's assessments. Mark items complete in the CCM chart to update status.
        </p>
      </Card>

      {/* Per-diagnosis CMS guidance */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <FlaskConical className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">CMS Documentation & Testing by Diagnosis</h3>
          <Badge variant="outline" className="text-[10px]">
            {guidance.length} matched
          </Badge>
        </div>

        {problems.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No diagnoses on the problem list yet. Add diagnoses in the CCM chart or via note assessment to see CMS-recommended documentation and testing here.
          </p>
        ) : guidance.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No CMS-tracked chronic conditions matched on the problem list. Add ICD-10 codes for diabetes, HTN, CHF, COPD, CKD, etc. for tailored guidance.
          </p>
        ) : (
          <Accordion type="multiple" className="w-full">
            {guidance.map((g) => (
              <AccordionItem key={g.prefix} value={g.prefix} className="border-border">
                <AccordionTrigger className="text-sm hover:no-underline py-3">
                  <div className="flex items-center gap-2 text-left">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {g.prefix}
                    </Badge>
                    <span className="font-medium">{g.label}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-1">
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Documentation
                      </div>
                      <ul className="space-y-1">
                        {g.documentation.map((d, i) => (
                          <li key={i} className="text-xs flex gap-1.5">
                            <span className="text-primary mt-0.5">•</span>
                            <span>{d}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                        Recommended Testing
                      </div>
                      <ul className="space-y-1">
                        {g.testing.map((t, i) => (
                          <li key={i} className="text-xs flex justify-between gap-2 border-b border-border/40 pb-1">
                            <span className="font-medium">{t.name}</span>
                            <span className="text-muted-foreground text-[10px] whitespace-nowrap">
                              {t.cadence}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </Card>
    </div>
  );
}

function RecommendationsBanner({
  problems,
  isEnrolled,
  onEnroll,
  busy,
}: {
  problems: { icd_code: string }[];
  isEnrolled: (p: Program) => boolean;
  onEnroll: (p: Program) => void;
  busy: Program | null;
}) {
  const recs = recommendPrograms(problems.map((p) => p.icd_code));
  const recommended = recs.filter((r) => r.recommended);
  if (recommended.length === 0 && problems.length === 0) return null;

  return (
    <Card className="p-4 md:p-5 border-primary/30 bg-primary/5">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">SOAP-driven program recommendations</h3>
        <Badge variant="outline" className="text-[10px]">
          {recommended.length} recommended
        </Badge>
      </div>

      {recommended.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Current problem list does not yet qualify this patient for CCM, RPM, or BHI. Add chronic / monitorable / behavioral health diagnoses on the SOAP assessment to drive recommendations.
        </p>
      ) : (
        <div className="space-y-2">
          {recs.map((r) => {
            const program = r.program as Program;
            const enrolled = isEnrolled(program);
            return (
              <div
                key={r.program}
                className={`rounded-md border p-3 ${
                  r.recommended
                    ? enrolled
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-primary/40 bg-background'
                    : 'border-border bg-background opacity-70'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{r.program}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {r.cpt}
                      </Badge>
                      {r.recommended ? (
                        enrolled ? (
                          <Badge variant="secondary" className="text-[10px] bg-emerald-500/15 text-emerald-700 border-emerald-500/40">
                            Recommended · Enrolled
                          </Badge>
                        ) : (
                          <Badge className="text-[10px]">Recommended</Badge>
                        )
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Not indicated</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">{r.blurb}</p>
                    <ul className="mt-1.5 space-y-0.5">
                      {r.reasons.map((reason, i) => (
                        <li key={i} className="text-[11px] flex gap-1.5">
                          <span className="text-primary mt-0.5">•</span>
                          <span className="text-foreground/80">{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {r.recommended && !enrolled && (
                    <Button
                      size="sm"
                      className="shrink-0"
                      disabled={busy === program}
                      onClick={() => onEnroll(program)}
                    >
                      Enroll
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

