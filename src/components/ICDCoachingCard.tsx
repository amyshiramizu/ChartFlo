import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { lookupHcc, specificityScore } from '@/lib/hccCatalog';
import { AlertCircle, Target } from 'lucide-react';

interface Props {
  codes: Array<{ code: string; description: string }>;
}

export function ICDCoachingCard({ codes }: Props) {
  if (!codes.length) return null;
  const rows = codes.map(c => {
    const hcc = lookupHcc(c.code);
    const score = specificityScore(c.code);
    return { ...c, hcc, score };
  });
  const totalRaf = rows.reduce((s, r) => s + (r.hcc?.weight || 0), 0);
  const gaps = rows.filter(r => r.hcc?.coaching || r.score < 50);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Target className="w-4 h-4 text-primary" /> HCC capture & specificity
        </div>
        <Badge variant="secondary" className="font-mono">RAF: {totalRaf.toFixed(2)}</Badge>
      </div>

      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.code} className="border rounded-md p-2 text-xs">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono font-semibold">{r.code}</span>
              <span className="text-muted-foreground flex-1 truncate">{r.description}</span>
              {r.hcc && r.hcc.weight > 0 && (
                <Badge variant="outline" className="font-mono">HCC {r.hcc.hcc} · {r.hcc.weight.toFixed(2)}</Badge>
              )}
              <Badge variant={r.score >= 70 ? 'default' : r.score >= 50 ? 'secondary' : 'destructive'} className="font-mono">
                {r.score}%
              </Badge>
            </div>
            {r.hcc?.coaching && (
              <div className="flex gap-1.5 text-amber-700 dark:text-amber-400">
                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>{r.hcc.coaching}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {gaps.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {gaps.length} of {rows.length} codes have specificity gaps that may be under-credited.
        </div>
      )}
    </Card>
  );
}
