import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle, AlertTriangle, ChevronDown, ChevronUp, ShieldCheck } from 'lucide-react';
import { validateCMSChecklist, SECTION_LABELS, type ValidatorInput, type Section } from '@/lib/cmsChecklist';

interface Props {
  input: ValidatorInput;
  onValidityChange?: (canSave: boolean) => void;
}

export function CMSChecklistCard({ input, onValidityChange }: Props) {
  const result = useMemo(() => validateCMSChecklist(input), [input]);
  const [expanded, setExpanded] = useState(true);

  // Notify parent of validity (effectful, but render-time fine because memoized)
  if (onValidityChange) {
    // call in a microtask to avoid setState-in-render warnings from parent
    queueMicrotask(() => onValidityChange(result.canSave));
  }

  const sections: Section[] = ['visit', 'subjective', 'objective', 'assessment', 'plan'];

  return (
    <Card className={`p-4 ${result.canSave ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-destructive/40 bg-destructive/5'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className={`w-4 h-4 ${result.canSave ? 'text-emerald-600' : 'text-destructive'}`} />
          <h3 className="text-sm font-semibold text-foreground">CMS Documentation Checklist</h3>
          <Badge variant="outline" className="text-[10px]">
            {result.passedCount}/{result.items.length} passed
          </Badge>
          {result.criticalCount > 0 && (
            <Badge variant="destructive" className="text-[10px]">{result.criticalCount} critical</Badge>
          )}
          {result.warningCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">{result.warningCount} warnings</Badge>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setExpanded((e) => !e)} className="gap-1">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {expanded ? 'Hide' : 'Show'}
        </Button>
      </div>

      {!result.canSave && (
        <p className="text-xs text-destructive mt-2">
          Save is blocked: please resolve the critical items below to meet CMS requirements for home-based E/M (99341–99350).
        </p>
      )}

      {expanded && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {sections.map((sec) => {
            const items = result.bySection[sec];
            if (!items.length) return null;
            const sectionFailed = items.some((i) => !i.passed && i.severity === 'critical');
            return (
              <div
                key={sec}
                className={`rounded-md border p-2.5 ${sectionFailed ? 'border-destructive/30 bg-background' : 'border-border bg-background'}`}
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  {SECTION_LABELS[sec]}
                </div>
                <ul className="space-y-1">
                  {items.map((it) => (
                    <li key={it.id} className="flex items-start gap-2 text-xs">
                      {it.passed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                      ) : it.severity === 'critical' ? (
                        <AlertCircle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                      )}
                      <div className="flex-1">
                        <div className={it.passed ? 'text-muted-foreground line-through' : 'text-foreground'}>
                          {it.label}
                        </div>
                        {!it.passed && it.fix && (
                          <div className="text-[11px] text-muted-foreground italic">→ {it.fix}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
