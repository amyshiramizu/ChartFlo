/**
 * CPT/HCPCS stacking rules for optimal, compliant billing.
 *
 * - `stacksWith`: codes that are commonly billed in the SAME encounter or
 *   calendar month to maximize reimbursement when documentation supports it.
 * - `conflictsWith`: codes that CANNOT be billed together (CMS bundling /
 *   mutually-exclusive rules). Surface a warning if both are chosen.
 * - `requiresModifier`: codes that need a modifier when stacked with the
 *   primary E/M (most commonly modifier 25).
 *
 * Based on CMS NCCI edits and CY2026 PFS guidance. Always verify against
 * the current MAC LCD and NCCI manual before submitting claims.
 */

export interface StackingRule {
  stacksWith?: string[];
  conflictsWith?: string[];
  requiresModifier?: Record<string, string>; // partnerCode -> modifier
  guidance?: string;
}

export const STACKING_RULES: Record<string, StackingRule> = {
  // ─── Office E/M ─────────────────────────────────────────────────────────
  '99213': {
    stacksWith: ['G2211', '99497', '96127', 'G0444', 'G0442', '99406', '90471'],
    requiresModifier: { '99497': '25', '90471': '25' },
    guidance: 'Add G2211 for longitudinal care of a serious/complex condition.',
  },
  '99214': {
    stacksWith: ['G2211', '99497', '96127', 'G0444', 'G0442', '99406', '90471', 'G0506'],
    requiresModifier: { '99497': '25', '90471': '25', '99406': '25' },
    guidance: 'G2211 commonly missed on chronic-care follow-ups. Append modifier 25 to E/M when a separately identifiable service is performed same day.',
  },
  '99215': {
    stacksWith: ['G2211', '99497', '96127', '90471', '99417'],
    requiresModifier: { '99497': '25', '90471': '25' },
    guidance: 'Use G2212 (Medicare) or 99417 (commercial) when total time exceeds 54 min.',
  },
  '99204': { stacksWith: ['G2211', '99497', '96127', '90471'], requiresModifier: { '99497': '25' } },
  '99205': { stacksWith: ['G2211', '99497', '96127', '90471', '99417'] },

  // ─── Home / Domiciliary E/M ─────────────────────────────────────────────
  '99347': { stacksWith: ['G2211', '99497', 'G0444', '99406'], requiresModifier: { '99497': '25' } },
  '99348': { stacksWith: ['G2211', '99497', 'G0444', '99406', 'G0506'], requiresModifier: { '99497': '25' } },
  '99349': {
    stacksWith: ['G2211', '99497', 'G0444', 'G0442', '99406', 'G0506', '96127'],
    requiresModifier: { '99497': '25' },
    guidance: 'High-yield mobile primary care combo: 99349 + G2211 + ACP + depression screen.',
  },
  '99350': { stacksWith: ['G2211', '99497', 'G0506', '96127'], requiresModifier: { '99497': '25' } },
  '99344': { stacksWith: ['G2211', '99497', 'G0506'] },
  '99345': { stacksWith: ['G2211', '99497', 'G0506'] },

  // ─── Annual Wellness Visit ──────────────────────────────────────────────
  'G0438': {
    stacksWith: ['G0468', '99497', '99498', '99213', '99214', '99215', 'G0444', 'G0442', 'G0443', '96127', '99406'],
    requiresModifier: { '99213': '25', '99214': '25', '99215': '25', '99497': '33' },
    guidance: 'AWV + same-day problem-focused E/M (with modifier 25) is one of the biggest revenue stacks. Add ACP (99497) with modifier 33 to waive patient cost-share.',
  },
  'G0439': {
    stacksWith: ['99497', '99498', '99213', '99214', '99215', '99349', '99350', 'G0444', '96127', '99406'],
    requiresModifier: { '99213': '25', '99214': '25', '99215': '25', '99349': '25', '99350': '25', '99497': '33' },
    guidance: 'Subsequent AWV stacks well with a problem-focused E/M and ACP. Document separately.',
  },
  'G0402': { stacksWith: ['G0444', 'G0442', '99497'], guidance: 'IPPE is once-per-lifetime within 12 months of Part B enrollment.' },

  // ─── ACP ────────────────────────────────────────────────────────────────
  '99497': {
    stacksWith: ['G0438', 'G0439', '99214', '99215', '99349', '99350', '99498'],
    guidance: '≥16 minutes documented to bill. Add 99498 for each additional 30 min. Modifier 33 with AWV waives patient cost-share.',
  },
  '99498': { stacksWith: ['99497'] },

  // ─── CCM family ─────────────────────────────────────────────────────────
  '99490': {
    stacksWith: ['99439', 'G0506', '99454', '99457', '99458', '99484'],
    conflictsWith: ['99491', '99437', '99487', '99489', '99424', '99425', '99426', '99427', 'G0556', 'G0557', 'G0558'],
    guidance: 'Cannot bill 99490 with provider CCM (99491), complex CCM (99487), PCM, or APCM in the same calendar month.',
  },
  '99439': { stacksWith: ['99490'], conflictsWith: ['99491', '99487', 'G0556', 'G0557', 'G0558'], guidance: 'Max 2 units per month.' },
  '99491': {
    stacksWith: ['99437', 'G0506', '99454', '99457', '99458'],
    conflictsWith: ['99490', '99439', '99487', '99489', '99424', '99425', '99426', '99427', 'G0556', 'G0557', 'G0558'],
  },
  '99437': { stacksWith: ['99491'], conflictsWith: ['99490', '99487', 'G0556', 'G0557', 'G0558'] },
  '99487': {
    stacksWith: ['99489', 'G0506', '99454', '99457', '99458'],
    conflictsWith: ['99490', '99439', '99491', '99437', '99424', '99425', '99426', '99427', 'G0556', 'G0557', 'G0558'],
    guidance: 'Complex CCM requires moderate–high MDM and ≥60 min clinical staff time.',
  },
  '99489': { stacksWith: ['99487'], conflictsWith: ['99490', '99491', 'G0556', 'G0557', 'G0558'] },

  // ─── PCM ────────────────────────────────────────────────────────────────
  '99424': { stacksWith: ['99425'], conflictsWith: ['99490', '99491', '99487', 'G0556', 'G0557', 'G0558'] },
  '99425': { stacksWith: ['99424'], conflictsWith: ['99490', '99491', '99487', 'G0556', 'G0557', 'G0558'] },
  '99426': { stacksWith: ['99427'], conflictsWith: ['99490', '99491', '99487', 'G0556', 'G0557', 'G0558'] },
  '99427': { stacksWith: ['99426'], conflictsWith: ['99490', '99491', '99487', 'G0556', 'G0557', 'G0558'] },

  // ─── APCM (mutually exclusive with CCM/PCM) ─────────────────────────────
  'G0556': {
    stacksWith: ['99454', '99457', '99458', '99484', '99497'],
    conflictsWith: ['G0557', 'G0558', '99490', '99439', '99491', '99437', '99487', '99489', '99424', '99425', '99426', '99427'],
    guidance: 'Only one APCM level per beneficiary per month. Cannot stack with any CCM/PCM code.',
  },
  'G0557': {
    stacksWith: ['99454', '99457', '99458', '99484', '99497'],
    conflictsWith: ['G0556', 'G0558', '99490', '99439', '99491', '99437', '99487', '99489', '99424', '99425', '99426', '99427'],
  },
  'G0558': {
    stacksWith: ['99454', '99457', '99458', '99484', '99497'],
    conflictsWith: ['G0556', 'G0557', '99490', '99439', '99491', '99437', '99487', '99489', '99424', '99425', '99426', '99427'],
  },

  // ─── RPM ────────────────────────────────────────────────────────────────
  '99453': { guidance: 'One-time setup per episode of care. Bill once per device episode.' },
  '99454': {
    stacksWith: ['99457', '99458', '99490', '99491', '99487', 'G0556', 'G0557', 'G0558'],
    guidance: 'Requires ≥16 days of readings in a 30-day period.',
  },
  '99457': {
    stacksWith: ['99458', '99454', '99490', '99491', '99487', 'G0556', 'G0557', 'G0558'],
    conflictsWith: ['98980', '98981'],
    guidance: 'Cannot be billed in same month as RTM management (98980/98981). 99091 cannot be billed with 99457 in the same 30-day period.',
  },
  '99458': { stacksWith: ['99457'], guidance: 'Max 2 units/month after 99457.' },
  '99091': { conflictsWith: ['99457', '99458'], guidance: 'Cannot stack with 99457/99458 for the same 30-day period.' },

  // ─── RTM ────────────────────────────────────────────────────────────────
  '98980': { stacksWith: ['98981', '98976', '98977', '98975'], conflictsWith: ['99457', '99458'] },
  '98981': { stacksWith: ['98980'], guidance: 'Max 2 units/month after 98980.' },

  // ─── TCM ────────────────────────────────────────────────────────────────
  '99495': {
    stacksWith: ['99497', '99490', '99491', 'G0556', 'G0557', 'G0558'],
    guidance: 'TCM can be billed concurrently with CCM/APCM in the same month (do not double-count time).',
  },
  '99496': { stacksWith: ['99497', '99490', '99491', 'G0556', 'G0557', 'G0558'] },

  // ─── Add-ons ────────────────────────────────────────────────────────────
  'G2211': {
    stacksWith: ['99213', '99214', '99215', '99204', '99205', '99347', '99348', '99349', '99350'],
    guidance: 'Do not append G2211 to an E/M billed with modifier 25 on a same-day procedure with a global period.',
  },
  'G0506': { stacksWith: ['99490', '99491', '99487'], guidance: 'Bill once at the CCM initiating visit.' },
  '99417': { stacksWith: ['99205', '99215'], guidance: 'Commercial / non-Medicare prolonged add-on. Use G2212 for Medicare.' },
  'G2212': { stacksWith: ['99205', '99215'], guidance: 'Medicare prolonged outpatient E/M add-on, each additional 15 min beyond threshold.' },

  // ─── BHI ────────────────────────────────────────────────────────────────
  '99484': { stacksWith: ['99490', '99491', '99487', 'G0556', 'G0557', 'G0558'] },
};

export function getStackingRule(code: string): StackingRule | undefined {
  return STACKING_RULES[code.trim().toUpperCase()];
}

export interface StackEvaluation {
  totalRevenue: number;
  conflicts: Array<{ a: string; b: string; reason?: string }>;
  modifierHints: Array<{ code: string; partner: string; modifier: string }>;
  suggestions: Array<{ code: string; reason: string }>;
}

export function evaluateStack(
  selectedCodes: string[],
  catalogLookup: (code: string) => { rate2026?: number; description?: string } | undefined,
): StackEvaluation {
  const set = new Set(selectedCodes.map((c) => c.toUpperCase()));
  let totalRevenue = 0;
  const conflicts: StackEvaluation['conflicts'] = [];
  const modifierHints: StackEvaluation['modifierHints'] = [];
  const suggestionCounts = new Map<string, { count: number; reason: string }>();

  for (const code of set) {
    const entry = catalogLookup(code);
    if (entry?.rate2026) totalRevenue += entry.rate2026;

    const rule = getStackingRule(code);
    if (!rule) continue;

    // Conflicts
    for (const conflict of rule.conflictsWith ?? []) {
      if (set.has(conflict.toUpperCase()) && code < conflict) {
        conflicts.push({ a: code, b: conflict, reason: rule.guidance });
      }
    }

    // Modifier hints
    for (const [partner, mod] of Object.entries(rule.requiresModifier ?? {})) {
      if (set.has(partner.toUpperCase())) {
        modifierHints.push({ code: partner, partner: code, modifier: mod });
      }
    }

    // Suggestions: codes in stacksWith that aren't already selected
    for (const sug of rule.stacksWith ?? []) {
      const sugU = sug.toUpperCase();
      if (set.has(sugU)) continue;
      // Skip if the suggestion conflicts with anything already selected
      const sugRule = getStackingRule(sugU);
      const blocked = (sugRule?.conflictsWith ?? []).some((c) => set.has(c.toUpperCase()));
      if (blocked) continue;
      const prev = suggestionCounts.get(sugU);
      suggestionCounts.set(sugU, {
        count: (prev?.count ?? 0) + 1,
        reason: prev?.reason ?? `Commonly billed with ${code}`,
      });
    }
  }

  const suggestions = Array.from(suggestionCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([code, { reason }]) => ({ code, reason }));

  return { totalRevenue, conflicts, modifierHints, suggestions };
}
