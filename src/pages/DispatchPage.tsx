import { useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar, MobileHeader } from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, Copy, Check, Send, Trash2, RefreshCw, Play, Square, Timer, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { CHART_TYPES, chartTypeMeta, normalizeChartType, type ChartType } from "@/lib/chartTypes";

type Job = {
  id: string;
  position: number;
  patient_name: string | null;
  mrn: string | null;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  status: "pending" | "done" | "skipped";
  filled_at: string | null;
  chart_type: ChartType;
  actual_minutes: number;
  patient_id: string | null;
};

type Batch = {
  id: string;
  share_code: string;
  label: string | null;
  instructions: string | null;
  created_at: string;
  session_date: string;
  default_chart_type: ChartType;
  shift_started_at: string | null;
  shift_ended_at: string | null;
  shift_seconds: number;
};

function genCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function fmtClock(seconds: number) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export default function DispatchPage() {
  const { user } = useAuth();
  const [rawText, setRawText] = useState("");
  const [instructions, setInstructions] = useState("");
  const [label, setLabel] = useState("");
  const [defaultChartType, setDefaultChartType] = useState<ChartType>("ccm_visit");
  const [parsing, setParsing] = useState(false);
  const [batches, setBatches] = useState<(Batch & { jobs: Job[] })[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const tickRef = useRef<number | null>(null);

  // Live re-render once a second so active shift timers update.
  useEffect(() => {
    tickRef.current = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const loadBatches = async () => {
    if (!user) return;
    setLoading(true);
    const { data: bs } = await supabase
      .from("dispatch_batches")
      .select("id, share_code, label, instructions, created_at, session_date, default_chart_type, shift_started_at, shift_ended_at, shift_seconds")
      .order("created_at", { ascending: false })
      .limit(10);
    if (!bs) { setBatches([]); setLoading(false); return; }
    const ids = bs.map((b) => b.id);
    const { data: js } = await supabase
      .from("dispatch_jobs")
      .select("id, batch_id, position, patient_name, mrn, subjective, objective, assessment, plan, status, filled_at, chart_type, actual_minutes, patient_id")
      .in("batch_id", ids)
      .order("position", { ascending: true });
    setBatches(
      bs.map((b) => ({
        ...(b as Batch),
        jobs: ((js as Array<Job & { batch_id: string }>) ?? []).filter((j) => j.batch_id === b.id) as Job[],
      })),
    );
    setLoading(false);
  };

  useEffect(() => { loadBatches(); }, [user]);

  const todaysBatch = useMemo(
    () => batches.find((b) => b.session_date === todayISO()),
    [batches],
  );

  const handleParse = async () => {
    if (!user) return;
    if (!rawText.trim()) { toast.error("Paste at least one patient note"); return; }
    setParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke("ccm-batch-parse", {
        body: { rawText, instructions },
      });
      if (error) throw error;
      const patients: Array<{
        patientName?: string; mrn?: string;
        subjective?: string; objective?: string; assessment?: string; plan?: string;
        chartType?: string;
      }> = data?.patients ?? [];
      if (!patients.length) { toast.error("No patients parsed"); return; }

      // Day-merge: append to today's batch if one exists, otherwise create new.
      // Query the DB directly (don't trust local state — it only holds the last 10 batches).
      const today = todayISO();
      const { data: existingBatch } = await supabase
        .from("dispatch_batches")
        .select("id, share_code")
        .eq("user_id", user.id)
        .eq("session_date", today)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      let batchId: string;
      let code: string;
      if (existingBatch) {
        batchId = existingBatch.id;
        code = existingBatch.share_code;
      } else {
        code = genCode();
        const { data: batch, error: bErr } = await supabase
          .from("dispatch_batches")
          .insert({
            user_id: user.id,
            share_code: code,
            label: label || `Dispatch ${new Date().toLocaleDateString()}`,
            instructions,
            session_date: today,
            default_chart_type: defaultChartType,
          })
          .select()
          .single();
        if (bErr || !batch) throw bErr;
        batchId = batch.id;
      }


      // Find next position
      const { data: maxRow } = await supabase
        .from("dispatch_jobs")
        .select("position")
        .eq("batch_id", batchId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      const startPos = ((maxRow?.position as number | undefined) ?? -1) + 1;

      const jobs = patients.map((p, i) => ({
        batch_id: batchId,
        position: startPos + i,
        patient_name: p.patientName ?? null,
        mrn: p.mrn ?? null,
        subjective: p.subjective ?? "",
        objective: p.objective ?? "",
        assessment: p.assessment ?? "",
        plan: p.plan ?? "",
        chart_type: normalizeChartType(p.chartType ?? defaultChartType),
      }));
      const { error: jErr } = await supabase.from("dispatch_jobs").insert(jobs);
      if (jErr) throw jErr;

      toast.success(
        existingBatch
          ? `Added ${patients.length} patient(s) to today's batch (${code})`
          : `Parsed ${patients.length} patient(s). Code: ${code}`,
      );
      setRawText(""); setLabel("");
      loadBatches();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Parse failed";
      toast.error(msg);
    } finally {
      setParsing(false);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };

  const deleteBatch = async (id: string) => {
    if (!confirm("Delete this dispatch and all its patients?")) return;
    await supabase.from("dispatch_batches").delete().eq("id", id);
    loadBatches();
  };

  const updateJobChartType = async (jobId: string, chart_type: ChartType) => {
    await supabase.from("dispatch_jobs").update({ chart_type }).eq("id", jobId);
    loadBatches();
  };

  const startShift = async (batch: Batch) => {
    await supabase
      .from("dispatch_batches")
      .update({ shift_started_at: new Date().toISOString(), shift_ended_at: null })
      .eq("id", batch.id);
    loadBatches();
  };

  const endShift = async (batch: Batch) => {
    if (!batch.shift_started_at) return;
    const started = new Date(batch.shift_started_at).getTime();
    const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
    await supabase
      .from("dispatch_batches")
      .update({
        shift_ended_at: new Date().toISOString(),
        shift_seconds: (batch.shift_seconds || 0) + elapsed,
      })
      .eq("id", batch.id);
    loadBatches();
  };

  const shiftLiveSeconds = (b: Batch): number => {
    const base = b.shift_seconds || 0;
    if (b.shift_started_at && !b.shift_ended_at) {
      return base + Math.max(0, Math.floor((Date.now() - new Date(b.shift_started_at).getTime()) / 1000));
    }
    return base;
  };

  return (
    <div className="min-h-screen bg-background flex">
      <AppSidebar />
      <div className="flex-1 flex flex-col">
        <MobileHeader />
        <main className="flex-1 p-4 md:p-8 max-w-6xl mx-auto w-full space-y-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Send className="w-6 h-6 text-primary" />
              Claude Dispatch
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Paste a patient list, let Claude classify each as a CCM visit, encounter, med list update, TCM or RPM review, then push the queue to the Chrome extension. All dispatches from the same day roll into one batch.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">New dispatch</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  placeholder="Batch label (optional)"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <Select value={defaultChartType} onValueChange={(v) => setDefaultChartType(v as ChartType)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Default chart type" />
                  </SelectTrigger>
                  <SelectContent>
                    {CHART_TYPES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.emoji} {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                placeholder={`Paste your patient list here. One patient per block.\n\nClaude will auto-tag each as a CCM visit, encounter, med list update, TCM or RPM review. The default above is used if Claude can't tell.`}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                className="min-h-[180px] font-mono text-sm"
              />
              <Textarea
                placeholder="Optional instructions for Claude (e.g. 'these are CCM monthly check-ins, continue current meds unless noted')"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className="min-h-[60px]"
              />
              <Button onClick={handleParse} disabled={parsing} className="w-full">
                {parsing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                Parse &amp; dispatch
              </Button>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent dispatches</h2>
            <Button variant="ghost" size="sm" onClick={loadBatches}>
              <RefreshCw className="w-4 h-4 mr-1" /> Refresh
            </Button>
          </div>

          {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {!loading && batches.length === 0 && (
            <p className="text-sm text-muted-foreground">No dispatches yet. Create one above.</p>
          )}
          {batches.map((b) => {
            const done = b.jobs.filter((j) => j.status === "done").length;
            const totalMinutes = b.jobs.reduce((s, j) => s + (j.actual_minutes || 0), 0);
            const live = shiftLiveSeconds(b);
            const shiftActive = !!b.shift_started_at && !b.shift_ended_at;
            const counts = CHART_TYPES.map((c) => ({
              ...c,
              count: b.jobs.filter((j) => j.chart_type === c.value).length,
            })).filter((c) => c.count > 0);
            const isToday = b.session_date === todayISO();
            // suppress tick lint usage
            void tick;
            return (
              <Card key={b.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{b.label || "Untitled dispatch"}</CardTitle>
                        {isToday && <Badge variant="outline" className="text-xs"><CalendarDays className="w-3 h-3 mr-1" />Today</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {b.session_date} · {done}/{b.jobs.length} filled · {totalMinutes} min logged
                      </p>
                      {counts.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {counts.map((c) => (
                            <Badge key={c.value} variant="outline" className={`text-xs ${c.tint}`}>
                              {c.emoji} {c.count} {c.short}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1 bg-muted px-2 py-1 rounded-md font-mono text-sm">
                        <Timer className={`w-3.5 h-3.5 ${shiftActive ? "text-emerald-500 animate-pulse" : "text-muted-foreground"}`} />
                        {fmtClock(live)}
                      </div>
                      {shiftActive ? (
                        <Button size="sm" variant="outline" onClick={() => endShift(b)}>
                          <Square className="w-3.5 h-3.5 mr-1" /> End shift
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => startShift(b)}>
                          <Play className="w-3.5 h-3.5 mr-1" /> Start shift
                        </Button>
                      )}
                      <div className="flex items-center gap-1 bg-primary/10 px-3 py-1.5 rounded-md">
                        <code className="text-sm font-mono font-bold tracking-wider">{b.share_code}</code>
                        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => copyCode(b.share_code)}>
                          {copied === b.share_code ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => deleteBatch(b.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground mb-3">
                    Open the Chrome extension → <b>Dispatch</b> tab → enter <code className="font-mono">{b.share_code}</code> to pull this queue into Practice Fusion.
                  </p>
                  <div className="space-y-2 max-h-[28rem] overflow-y-auto">
                    {b.jobs.map((j) => {
                      const meta = chartTypeMeta(j.chart_type);
                      return (
                        <div key={j.id} className="border border-border rounded-md p-3 text-sm space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="font-medium flex items-center gap-2 flex-wrap">
                              <span>{j.patient_name || "Unnamed"}</span>
                              {j.mrn && <span className="text-xs text-muted-foreground">MRN {j.mrn}</span>}
                              {j.patient_id && (
                                <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600">
                                  <Check className="w-2.5 h-2.5 mr-0.5" /> Linked
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Select value={j.chart_type} onValueChange={(v) => updateJobChartType(j.id, v as ChartType)}>
                                <SelectTrigger className={`h-7 text-xs w-[160px] ${meta.tint}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {CHART_TYPES.map((c) => (
                                    <SelectItem key={c.value} value={c.value}>
                                      {c.emoji} {c.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {j.actual_minutes > 0 && (
                                <Badge variant="outline" className="text-xs">
                                  <Timer className="w-3 h-3 mr-1" />{j.actual_minutes}m
                                </Badge>
                              )}
                              <Badge variant={j.status === "done" ? "default" : "secondary"} className={j.status === "done" ? "bg-green-600" : ""}>
                                {j.status}
                              </Badge>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-0.5">
                            <div><b>S:</b> {j.subjective.slice(0, 140)}{j.subjective.length > 140 ? "…" : ""}</div>
                            <div><b>A:</b> {j.assessment.slice(0, 140)}{j.assessment.length > 140 ? "…" : ""}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </main>
      </div>
    </div>
  );
}
