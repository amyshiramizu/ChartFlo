// Helper to send data to the Chart Flo Practice Fusion Chrome extension
// Uses chrome.runtime.sendMessage to communicate with the extension

// The extension ID must be set after installing the extension
const EXTENSION_ID_KEY = 'chartScribeExtensionId';

export function getExtensionId(): string | null {
  return localStorage.getItem(EXTENSION_ID_KEY);
}

export function setExtensionId(id: string) {
  localStorage.setItem(EXTENSION_ID_KEY, id);
}

export type MedAction = 'start' | 'change' | 'stop' | 'continue';

export interface MedData {
  name: string;
  dosage: string;
  frequency: string;
  route: string;
  action?: MedAction;
  instructions?: string;
}

export interface SOAPData {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  patientName?: string;
  mrn?: string;
  date?: string;
  medicationChanges?: MedData[];
}

export interface OrderData {
  patientName: string;
  mrn: string;
  date: string;
  facility: string;
  orders: string[];
}

const ACTION_LABEL: Record<MedAction, string> = {
  start: 'START',
  change: 'CHANGE',
  stop: 'DISCONTINUE',
  continue: 'CONTINUE',
};

export function formatMedicationChanges(meds: MedData[]): string {
  if (!meds?.length) return '';
  const lines = meds.map((m) => {
    const label = ACTION_LABEL[m.action ?? 'start'];
    const parts = [m.name, m.dosage, m.route, m.frequency].filter(Boolean).join(' ');
    const instr = m.instructions ? ` — ${m.instructions}` : '';
    return `  • [${label}] ${parts}${instr}`;
  });
  return `MEDICATION CHANGES (this visit):\n${lines.join('\n')}`;
}

function sendToExtension(type: string, data: unknown): Promise<boolean> {
  const extensionId = getExtensionId();
  const chromeGlobal = (window as unknown as Record<string, unknown>).chrome as {
    runtime?: { sendMessage?: (id: string, msg: unknown, cb: (r: { success?: boolean }) => void) => void };
  } | undefined;

  // Method 1: Direct chrome.runtime.sendMessage (if extension ID is known)
  if (extensionId && chromeGlobal?.runtime?.sendMessage) {
    return new Promise((resolve) => {
      try {
        chromeGlobal.runtime!.sendMessage!(extensionId, { type, data }, (response) => {
          resolve(response?.success ?? false);
        });
      } catch {
        resolve(false);
      }
    });
  }

  // Method 2: Use window.postMessage as fallback
  // The extension content script can listen for these on Chart Flo pages
  window.postMessage({ source: 'chart-scribe', type, data }, '*');
  return Promise.resolve(true);
}

export async function sendSOAPToExtension(soap: SOAPData): Promise<boolean> {
  const medBlock = formatMedicationChanges(soap.medicationChanges || []);
  const planWithMeds = medBlock
    ? `${medBlock}\n\n${soap.plan || ''}`.trim()
    : (soap.plan || '');

  const payload = {
    subjective: soap.subjective || '',
    objective: soap.objective || '',
    assessment: soap.assessment || '',
    plan: planWithMeds,
    patientName: soap.patientName,
    mrn: soap.mrn,
    date: soap.date,
    medicationChanges: soap.medicationChanges || [],
  };
  // Preferred: direct message to the installed extension
  const direct = await sendToExtension('CHART_SCRIBE_NOTE', payload);

  // Also push structured meds so the extension's Medications workflow / popup can use them
  if (soap.medicationChanges?.length) {
    await sendToExtension('CHART_SCRIBE_MEDS', soap.medicationChanges);
  }

  // Always also copy JSON to the clipboard so users without a configured extension ID
  // can use the popup's "Paste from clipboard (JSON)" action.
  try { await navigator.clipboard.writeText(JSON.stringify(payload, null, 2)); } catch { /* noop */ }
  return direct;
}


export async function sendMedsToExtension(meds: MedData[]): Promise<boolean> {
  return sendToExtension('CHART_SCRIBE_MEDS', meds);
}

export async function sendOrdersToExtension(orders: OrderData): Promise<boolean> {
  return sendToExtension('CHART_SCRIBE_ORDERS', orders);
}

export function isExtensionAvailable(): boolean {
  // Always allow sending — we use postMessage as fallback
  return true;
}

export async function setActivePatientInExtension(patient: { id: string; name: string }): Promise<boolean> {
  return sendToExtension('SET_ACTIVE_PATIENT', patient);
}

export async function clearActivePatientInExtension(): Promise<boolean> {
  return sendToExtension('CLEAR_ACTIVE_PATIENT', null);
}

export async function getExternalTimeLog(): Promise<{ site: string; minutes: number; patientId: string | null; patientName: string | null; timestamp: string }[]> {
  const extensionId = getExtensionId();
  const chromeGlobal = (window as unknown as Record<string, unknown>).chrome as {
    runtime?: { sendMessage?: (id: string, msg: unknown, cb: (r: { log?: unknown[] }) => void) => void };
  } | undefined;

  if (extensionId && chromeGlobal?.runtime?.sendMessage) {
    return new Promise((resolve) => {
      try {
        chromeGlobal.runtime!.sendMessage!(extensionId, { type: 'GET_EXTERNAL_TIME' }, (response) => {
          resolve((response?.log as never[]) ?? []);
        });
      } catch {
        resolve([]);
      }
    });
  }
  return [];
}

export async function clearExternalTimeLog(): Promise<boolean> {
  return sendToExtension('CLEAR_EXTERNAL_TIME', null);
}

// -----------------------------------------------------------------------------
// Monthly CCM time-log formatter — turns ccm_time_entries rows into a clean
// text block ready to drop into a Practice Fusion visit note (or push via the
// extension as a SOAP note). Each row shows date, minutes, source, MA, and the
// activity description so the chart documents exactly what was done this month.
// -----------------------------------------------------------------------------
export interface TimeLogEntry {
  date: string;
  minutes: number;
  staff?: string | null;
  description?: string | null;
  program?: string | null;
}

export interface MonthlyTimeLogOptions {
  patientName: string;
  mrn?: string;
  month: number; // 1-12
  year: number;
  program?: 'CCM' | 'RPM' | 'BHI' | 'CCO';
}

export function formatMonthlyTimeLog(entries: TimeLogEntry[], opts: MonthlyTimeLogOptions): string {
  const program = opts.program || 'CCM';
  const monthName = new Date(opts.year, opts.month - 1, 1).toLocaleString('default', { month: 'long' });
  const filtered = entries
    .filter(e => {
      const d = new Date(e.date + 'T00:00:00');
      return d.getMonth() + 1 === opts.month && d.getFullYear() === opts.year && (e.minutes || 0) > 0;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalMin = filtered.reduce((s, e) => s + (e.minutes || 0), 0);

  const header = [
    `${program} MONTHLY TIME LOG — ${monthName} ${opts.year}`,
    `Patient: ${opts.patientName}${opts.mrn ? `  (MRN ${opts.mrn})` : ''}`,
    `Total documented time: ${totalMin} minutes across ${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}`,
    `Service: Non-face-to-face chronic care management per CMS guidelines (CPT 99490/99439/99491/99437).`,
  ].join('\n');

  if (!filtered.length) {
    return `${header}\n\nNo time entries logged for this month.`;
  }

  const rows = filtered.map(e => {
    const desc = (e.description || '').replace(/^\[[^\]]+\]\s*/, '').trim() || 'Care management activity';
    const sourceMatch = (e.description || '').match(/^\[([^\]]+)\]/);
    const source = sourceMatch ? sourceMatch[1] : 'Chart Flo';
    const staff = e.staff ? ` — ${e.staff}` : '';
    return `  • ${e.date} · ${e.minutes} min · [${source}]${staff} — ${desc}`;
  });

  return `${header}\n\n${rows.join('\n')}`;
}

// -----------------------------------------------------------------------------
// Daily CCM time-log formatter — same shape as the monthly version but scoped to
// one calendar date so the MA can push a single day's activity to PF as soon as
// the work is done (e.g. end-of-shift charting).
// -----------------------------------------------------------------------------
export interface DailyTimeLogOptions {
  patientName: string;
  mrn?: string;
  date: string; // YYYY-MM-DD
  program?: 'CCM' | 'RPM' | 'BHI' | 'CCO';
}

export function formatDailyTimeLog(entries: TimeLogEntry[], opts: DailyTimeLogOptions): string {
  const program = opts.program || 'CCM';
  const dayLabel = new Date(opts.date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const filtered = entries
    .filter(e => e.date === opts.date && (e.minutes || 0) > 0)
    .sort((a, b) => (a.description || '').localeCompare(b.description || ''));

  const totalMin = filtered.reduce((s, e) => s + (e.minutes || 0), 0);

  const header = [
    `${program} DAILY TIME LOG — ${dayLabel}`,
    `Patient: ${opts.patientName}${opts.mrn ? `  (MRN ${opts.mrn})` : ''}`,
    `Total documented time today: ${totalMin} minutes across ${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}`,
    `Service: Non-face-to-face chronic care management per CMS guidelines (CPT 99490/99439/99491/99437).`,
  ].join('\n');

  if (!filtered.length) {
    return `${header}\n\nNo time entries logged on this date.`;
  }

  const rows = filtered.map(e => {
    const desc = (e.description || '').replace(/^\[[^\]]+\]\s*/, '').trim() || 'Care management activity';
    const sourceMatch = (e.description || '').match(/^\[([^\]]+)\]/);
    const source = sourceMatch ? sourceMatch[1] : 'Chart Flo';
    const staff = e.staff ? ` — ${e.staff}` : '';
    return `  • ${e.minutes} min · [${source}]${staff} — ${desc}`;
  });

  return `${header}\n\n${rows.join('\n')}`;
}


