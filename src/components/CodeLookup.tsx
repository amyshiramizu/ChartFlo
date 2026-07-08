import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Search, BookOpen, Sparkles, Copy, Check, Plus, X, AlertTriangle, TrendingUp, Layers } from 'lucide-react';
import { searchCatalog, findCode, type CatalogEntry, type CodeType } from '@/lib/codeCatalog';
import { getStackingRule, evaluateStack } from '@/lib/stackingRules';
import { useToast } from '@/hooks/use-toast';

type FilterType = CodeType | 'ALL';

interface AIResult {
  code: string;
  type: CodeType;
  description: string;
  official_descriptor?: string;
  category?: string;
  rate2026_usd?: number | null;
  hcc?: string | null;
  notes?: string;
  confidence?: 'high' | 'medium' | 'low';
}

function fmtRate(n?: number | null) {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

interface CodeLookupProps {
  /** Restrict the type tabs visible (default: all). */
  defaultType?: FilterType;
  /** Optional callback when a code is picked (e.g. inserting into a billing form). */
  onPick?: (entry: CatalogEntry | AIResult) => void;
  /** Compact layout for use inside dialogs. */
  compact?: boolean;
}

export function CodeLookup({ defaultType = 'ALL', onPick, compact }: CodeLookupProps) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<FilterType>(defaultType);
  const [aiResults, setAiResults] = useState<AIResult[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [stack, setStack] = useState<string[]>([]);
  const { toast } = useToast();

  const addToStack = (code: string) => setStack((s) => (s.includes(code) ? s : [...s, code]));
  const removeFromStack = (code: string) => setStack((s) => s.filter((c) => c !== code));

  const localResults = useMemo(() => searchCatalog(query, type, 30), [query, type]);

  // Clear AI results when filters change
  useEffect(() => { setAiResults(null); }, [query, type]);

  async function runAiLookup() {
    if (!query.trim()) return;
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('code-lookup', {
        body: { query, type },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAiResults((data?.results as AIResult[]) || []);
    } catch (e) {
      toast({
        title: 'AI lookup failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setAiLoading(false);
    }
  }

  function copy(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied((c) => (c === code ? null : c)), 1200);
  }

  return (
    <div className="space-y-3">
      <StackBuilder stack={stack} onRemove={removeFromStack} onAdd={addToStack} onClear={() => setStack([])} />

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by code (99214, E11.9, G0556) or keyword (diabetes, AWV)"
            className="pl-9 font-mono"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && localResults.length === 0) runAiLookup();
            }}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={runAiLookup}
          disabled={!query.trim() || aiLoading}
          className="gap-1.5 shrink-0"
          title="Use AI to find codes not in the built-in catalog"
        >
          {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          AI lookup
        </Button>
      </div>

      <Tabs value={type} onValueChange={(v) => setType(v as FilterType)}>
        <TabsList className="h-8">
          <TabsTrigger value="ALL" className="text-xs h-6 px-2.5">All</TabsTrigger>
          <TabsTrigger value="CPT" className="text-xs h-6 px-2.5">CPT</TabsTrigger>
          <TabsTrigger value="HCPCS" className="text-xs h-6 px-2.5">HCPCS</TabsTrigger>
          <TabsTrigger value="ICD10" className="text-xs h-6 px-2.5">ICD-10</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Built-in catalog results */}
      <div>
        <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <BookOpen className="w-3 h-3" /> Built-in catalog · {localResults.length} match{localResults.length === 1 ? '' : 'es'}
        </div>
        {localResults.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-1">
            No built-in matches. Try AI lookup for less-common codes.
          </p>
        ) : (
          <div className={`space-y-1.5 ${compact ? 'max-h-72' : 'max-h-[420px]'} overflow-y-auto pr-1`}>
            {localResults.map((e) => (
              <ResultRow
                key={`local-${e.code}`}
                entry={e}
                onCopy={copy}
                copied={copied === e.code}
                onPick={onPick}
                inStack={stack.includes(e.code)}
                onToggleStack={() => stack.includes(e.code) ? removeFromStack(e.code) : addToStack(e.code)}
              />
            ))}
          </div>
        )}
      </div>

      {/* AI results */}
      {aiResults && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Sparkles className="w-3 h-3 text-primary" /> AI suggestions · {aiResults.length}
          </div>
          {aiResults.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-1">No AI matches.</p>
          ) : (
            <div className="space-y-1.5">
              {aiResults.map((r, i) => (
                <ResultRow
                  key={`ai-${r.code}-${i}`}
                  entry={{
                    code: r.code,
                    type: r.type,
                    description: r.description,
                    category: r.category,
                    rate2026: r.rate2026_usd ?? undefined,
                    hcc: r.hcc ?? undefined,
                    notes: [r.official_descriptor && `Official: ${r.official_descriptor}`, r.notes]
                      .filter(Boolean).join(' · '),
                  }}
                  badge={r.confidence ? `AI · ${r.confidence}` : 'AI'}
                  onCopy={copy}
                  copied={copied === r.code}
                  onPick={onPick}
                  inStack={stack.includes(r.code)}
                  onToggleStack={() => stack.includes(r.code) ? removeFromStack(r.code) : addToStack(r.code)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultRow({
  entry, onCopy, copied, onPick, badge, inStack, onToggleStack,
}: {
  entry: CatalogEntry;
  onCopy: (code: string) => void;
  copied: boolean;
  onPick?: (e: CatalogEntry) => void;
  badge?: string;
  inStack?: boolean;
  onToggleStack?: () => void;
}) {
  const rule = getStackingRule(entry.code);
  const isBillable = entry.type !== 'ICD10';
  return (
    <Card className={`p-2.5 flex items-start gap-3 hover:border-primary/40 transition-colors ${inStack ? 'border-primary/60 bg-primary/5' : ''}`}>
      <div className="flex flex-col items-start gap-1 w-24 shrink-0">
        <Badge variant="outline" className="font-mono text-[11px]">{entry.code}</Badge>
        <span className="text-[10px] text-muted-foreground">{entry.type}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground leading-snug">{entry.description}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-muted-foreground">
          {entry.category && <span>{entry.category}</span>}
          {entry.rate2026 != null && <span>2026 rate: <span className="font-mono text-foreground">{fmtRate(entry.rate2026)}</span></span>}
          {entry.hcc && <span>{entry.hcc}</span>}
          {badge && <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{badge}</Badge>}
        </div>
        {entry.notes && <div className="text-[11px] text-muted-foreground mt-1 italic">{entry.notes}</div>}
        {rule && (rule.stacksWith || rule.conflictsWith || rule.guidance) && (
          <div className="mt-1.5 space-y-0.5 text-[11px]">
            {rule.stacksWith && rule.stacksWith.length > 0 && (
              <div className="flex flex-wrap items-baseline gap-1">
                <span className="text-emerald-600 font-medium">Bills well with:</span>
                {rule.stacksWith.slice(0, 8).map((c) => (
                  <code key={c} className="font-mono text-[10px] px-1 rounded bg-emerald-500/10 text-emerald-700">{c}</code>
                ))}
              </div>
            )}
            {rule.conflictsWith && rule.conflictsWith.length > 0 && (
              <div className="flex flex-wrap items-baseline gap-1">
                <span className="text-destructive font-medium">Cannot stack:</span>
                {rule.conflictsWith.slice(0, 8).map((c) => (
                  <code key={c} className="font-mono text-[10px] px-1 rounded bg-destructive/10 text-destructive">{c}</code>
                ))}
              </div>
            )}
            {rule.guidance && <div className="text-muted-foreground italic">{rule.guidance}</div>}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        {isBillable && onToggleStack && (
          <Button
            variant={inStack ? 'default' : 'ghost'}
            size="sm"
            className="h-7 px-2 text-[11px] gap-1"
            onClick={onToggleStack}
            title={inStack ? 'Remove from stack' : 'Add to billing stack'}
          >
            {inStack ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
            Stack
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onCopy(entry.code)} title="Copy code">
          {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
        </Button>
        {onPick && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => onPick(entry)}>
            Pick
          </Button>
        )}
      </div>
    </Card>
  );
}

function StackBuilder({
  stack, onRemove, onAdd, onClear,
}: {
  stack: string[];
  onRemove: (code: string) => void;
  onAdd: (code: string) => void;
  onClear: () => void;
}) {
  const evalResult = useMemo(
    () => evaluateStack(stack, (code) => {
      const e = findCode(code);
      return e ? { rate2026: e.rate2026, description: e.description } : undefined;
    }),
    [stack],
  );

  if (stack.length === 0) {
    return (
      <Card className="p-3 border-dashed bg-muted/30">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Layers className="w-3.5 h-3.5" />
          <span>
            <span className="font-medium text-foreground">Stack Builder:</span>{' '}
            click <span className="font-mono">Stack</span> on any code to combine billable services and see total revenue, conflicts, and suggested add-ons.
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-3 border-primary/40 bg-primary/5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="w-4 h-4 text-primary" />
          Billing Stack
          <Badge variant="secondary" className="text-[10px]">{stack.length} code{stack.length === 1 ? '' : 's'}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm font-mono font-semibold text-primary flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            ${evalResult.totalRevenue.toFixed(2)}
          </div>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={onClear}>Clear</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {stack.map((code) => {
          const e = findCode(code);
          return (
            <Badge key={code} variant="outline" className="font-mono text-[11px] gap-1 pr-1 bg-background">
              {code}
              {e?.rate2026 != null && <span className="text-muted-foreground">${e.rate2026.toFixed(0)}</span>}
              <button onClick={() => onRemove(code)} className="hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          );
        })}
      </div>

      {evalResult.conflicts.length > 0 && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-2 space-y-1">
          {evalResult.conflicts.map((c, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-destructive">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                <span className="font-mono font-semibold">{c.a}</span> and{' '}
                <span className="font-mono font-semibold">{c.b}</span> cannot be billed together.
                {c.reason && <span className="text-destructive/80"> {c.reason}</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {evalResult.modifierHints.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-[11px] text-amber-700 space-y-0.5">
          {evalResult.modifierHints.map((m, i) => (
            <div key={i}>
              Append modifier <span className="font-mono font-semibold">-{m.modifier}</span> to{' '}
              <span className="font-mono font-semibold">{m.code}</span> when billed with{' '}
              <span className="font-mono">{m.partner}</span>.
            </div>
          ))}
        </div>
      )}

      {evalResult.suggestions.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Suggested add-ons</div>
          <div className="flex flex-wrap gap-1.5">
            {evalResult.suggestions.map((s) => {
              const e = findCode(s.code);
              return (
                <button
                  key={s.code}
                  onClick={() => onAdd(s.code)}
                  className="group flex items-center gap-1 px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/15 text-[11px] transition-colors"
                  title={`${e?.description ?? ''} — ${s.reason}`}
                >
                  <Plus className="w-3 h-3 text-emerald-600" />
                  <span className="font-mono font-semibold">{s.code}</span>
                  {e?.rate2026 != null && <span className="text-muted-foreground">+${e.rate2026.toFixed(0)}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

export function CodeLookupDialog({
  open, onOpenChange, defaultType, onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultType?: FilterType;
  onPick?: (entry: CatalogEntry | AIResult) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            Code Lookup — CPT / HCPCS / ICD-10
          </DialogTitle>
        </DialogHeader>
        <CodeLookup defaultType={defaultType} onPick={onPick} compact />
        <p className="text-[10px] text-muted-foreground italic">
          2026 rates are Medicare national non-facility estimates from the CY2026 PFS. Verify with your MAC and locality (GPCI).
        </p>
      </DialogContent>
    </Dialog>
  );
}
