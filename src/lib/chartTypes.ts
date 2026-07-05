export type ChartType = "ccm_visit" | "encounter" | "med_list" | "tcm" | "rpm_review";

export const CHART_TYPES: { value: ChartType; label: string; short: string; emoji: string; tint: string }[] = [
  { value: "ccm_visit",  label: "CCM visit",          short: "CCM",  emoji: "🩺", tint: "bg-primary/10 text-primary border-primary/30" },
  { value: "encounter",  label: "Office encounter",   short: "ENC",  emoji: "🏥", tint: "bg-sky-500/10 text-sky-700 border-sky-500/30 dark:text-sky-300" },
  { value: "med_list",   label: "Med list update",    short: "MEDS", emoji: "💊", tint: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300" },
  { value: "tcm",        label: "TCM (post-discharge)", short: "TCM", emoji: "🚑", tint: "bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300" },
  { value: "rpm_review", label: "RPM data review",    short: "RPM",  emoji: "📈", tint: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300" },
];

export function chartTypeMeta(t: string | null | undefined) {
  return CHART_TYPES.find((c) => c.value === t) ?? CHART_TYPES[0];
}

export function normalizeChartType(t: unknown): ChartType {
  const v = String(t || "").toLowerCase().replace(/[\s-]/g, "_");
  const found = CHART_TYPES.find((c) => c.value === v);
  return found ? found.value : "ccm_visit";
}
