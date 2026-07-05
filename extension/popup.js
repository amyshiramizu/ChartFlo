const FIELDS = ['subjective', 'objective', 'assessment', 'plan'];
const $ = (id) => document.getElementById(id);
const setStatus = (msg, cls = '') => { const s = $('status'); s.textContent = msg; s.className = 'status ' + cls; };

// Chart type → routing + visual metadata. Must match src/lib/chartTypes.ts.
const CHART_TYPE_META = {
  ccm_visit:  { label: 'CCM visit',        short: 'CCM',  emoji: '🩺', action: 'openAndInsertCCM',       prefix: '',                     bg: '#dbeafe', fg: '#1e40af' },
  encounter:  { label: 'Office encounter', short: 'ENC',  emoji: '🏥', action: 'openAndInsertEncounter', prefix: '[Office Encounter]\n', bg: '#e0f2fe', fg: '#0369a1' },
  med_list:   { label: 'Med list update',  short: 'MEDS', emoji: '💊', action: 'openAndInsertMedList',   prefix: '[Med List Update]\n',  bg: '#fef3c7', fg: '#92400e' },
  tcm:        { label: 'TCM',              short: 'TCM',  emoji: '🚑', action: 'openAndInsertTCM',       prefix: '[TCM Visit]\n',        bg: '#ffe4e6', fg: '#9f1239' },
  rpm_review: { label: 'RPM review',       short: 'RPM',  emoji: '📈', action: 'openAndInsertRPM',       prefix: '[RPM Review]\n',       bg: '#d1fae5', fg: '#065f46' },
};
function chartTypeMeta(t) { return CHART_TYPE_META[t] || CHART_TYPE_META.ccm_visit; }


async function loadDraft() {
  const { draft } = await chrome.storage.local.get('draft');
  if (draft) FIELDS.forEach((f) => { if (draft[f]) $(f).value = draft[f]; });
}
async function saveDraft() {
  const draft = {};
  FIELDS.forEach((f) => (draft[f] = $(f).value));
  await chrome.storage.local.set({ draft });
}
FIELDS.forEach((f) => $(f).addEventListener('input', saveDraft));

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Ping the content script; if it doesn't respond, programmatically inject it.
// Covers PF tabs opened before the extension was installed/updated, or SPA
// navigations that outran content_scripts injection.
async function ensureContentScript(tabId) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ping = async () => {
    // Try top frame first, then any frame — PF sometimes hosts the chart UI in a sub-frame.
    try {
      const r = await chrome.tabs.sendMessage(tabId, { action: 'ping' }, { frameId: 0 });
      if (r) return true;
    } catch {}
    try {
      const r = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      if (r) return true;
    } catch {}
    return false;
  };

  if (await ping()) return true;

  // Inject top frame first (most reliable), then all frames as a fallback.
  for (const target of [{ tabId }, { tabId, allFrames: true }]) {
    try {
      await chrome.scripting.executeScript({ target, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target, files: ['content.css'] }).catch(() => {});
    } catch (e) {
      console.warn('[ChartFlo] inject attempt failed', target, e);
    }
    // Poll up to ~2s — PF's content script registers its ping listener inside
    // an IIFE that runs after document_idle, which can take a moment on slow chart pages.
    for (let i = 0; i < 10; i++) {
      await sleep(200);
      if (await ping()) return true;
    }
  }
  return false;
}

async function sendToContent(action, payload) {
  const tab = await activeTab();
  if (!tab?.url?.includes('practicefusion.com')) {
    setStatus('Open a Practice Fusion tab first.', 'err');
    return null;
  }
  const ready = await ensureContentScript(tab.id);
  if (!ready) {
    setStatus('Content script not ready — reload the PF tab and retry.', 'err');
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { action, payload }, { frameId: 0 });
  } catch (e) {
    setStatus('Content script not ready — reload the PF tab and retry.', 'err');
    return null;
  }
}

$('push').addEventListener('click', async () => {
  const payload = {};
  FIELDS.forEach((f) => (payload[f] = $(f).value.trim()));
  if (!FIELDS.some((f) => payload[f])) { setStatus('Nothing to push — fill a section first.', 'err'); return; }
  setStatus('Pushing…');
  const res = await sendToContent('push', payload);
  if (!res) return;
  if (res.filled?.length) setStatus(`Filled: ${res.filled.join(', ')}${res.missed?.length ? ' · Missed: ' + res.missed.join(', ') : ''}`, 'ok');
  else setStatus('No matching fields found on this page.', 'err');
});

$('detect').addEventListener('click', async () => {
  setStatus('Scanning…');
  const res = await sendToContent('detect');
  if (!res) return;
  setStatus(res.found?.length ? `Found: ${res.found.join(', ')}` : 'No SOAP fields recognized on this page.', res.found?.length ? 'ok' : 'err');
});

$('paste').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    const obj = JSON.parse(text);
    FIELDS.forEach((f) => { if (typeof obj[f] === 'string') $(f).value = obj[f]; });
    await saveDraft();
    setStatus('Loaded from clipboard.', 'ok');
  } catch { setStatus('Clipboard did not contain valid JSON.', 'err'); }
});

$('clear').addEventListener('click', async () => {
  FIELDS.forEach((f) => ($(f).value = ''));
  await saveDraft();
  setStatus('Cleared.');
});

loadDraft();

// --- Queue auth (end-of-day CCM auto-doc) ---
const SUPABASE_URL = 'https://qefadntuaqhrlfoqhpan.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlZmFkbnR1YXFocmxmb3FocGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1Nzg0MDEsImV4cCI6MjA5MDE1NDQwMX0.9CQEJ26jL38VaAcQmkX4_rU6QefcYrhTmuJAu2LLqWA';

async function loadQueueToken() {
  const { csQueueAuth } = await chrome.storage.local.get('csQueueAuth');
  if (csQueueAuth?.token) {
    $('queueToken').value = csQueueAuth.clinic_id
      ? JSON.stringify({ token: csQueueAuth.token, clinic_id: csQueueAuth.clinic_id })
      : csQueueAuth.token;
  }
}
async function saveQueueToken() {
  const raw = $('queueToken').value.trim();
  if (!raw) {
    $('tokenStatus').textContent = 'Paste a token first.';
    $('tokenStatus').className = 'status err';
    return;
  }
  let token = raw;
  let clinic_id = null;
  let clinic_name = null;
  // Accept either a raw JWT or a JSON blob { token, clinic_id, clinic_name }
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      token = obj.token;
      clinic_id = obj.clinic_id || null;
      clinic_name = obj.clinic_name || null;
    } catch {
      $('tokenStatus').textContent = 'Invalid JSON payload.';
      $('tokenStatus').className = 'status err';
      return;
    }
  }
  if (!token) {
    $('tokenStatus').textContent = 'Token missing in payload.';
    $('tokenStatus').className = 'status err';
    return;
  }
  if (!clinic_id) {
    $('tokenStatus').textContent =
      'No clinic in payload. Re-copy from Chart Scribe with an active clinic selected to scope the queue.';
    $('tokenStatus').className = 'status err';
    return;
  }

  // Verify the token against Supabase before persisting.
  $('tokenStatus').textContent = 'Verifying token…';
  $('tokenStatus').className = 'status';
  const saveBtn = $('saveToken');
  if (saveBtn) saveBtn.disabled = true;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 401 || res.status === 403) {
      $('tokenStatus').textContent = 'Token rejected (expired or invalid). Re-copy a fresh token from Chart Flo.';
      $('tokenStatus').className = 'status err';
      return;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      $('tokenStatus').textContent = `Verification failed (${res.status}). ${body.slice(0, 120)}`;
      $('tokenStatus').className = 'status err';
      return;
    }
    const user = await res.json().catch(() => null);
    if (!user?.id) {
      $('tokenStatus').textContent = 'Verification returned no user. Token is not valid.';
      $('tokenStatus').className = 'status err';
      return;
    }

    await chrome.storage.local.set({
      csQueueAuth: { url: SUPABASE_URL, anonKey: SUPABASE_ANON, token, clinic_id, clinic_name },
    });
    $('tokenStatus').textContent = `Verified & saved as ${user.email || user.id} · clinic ${clinic_name || clinic_id}.`;
    $('tokenStatus').className = 'status ok';
  } catch (e) {
    $('tokenStatus').textContent = `Network error during verification: ${e?.message || e}`;
    $('tokenStatus').className = 'status err';
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}
async function clearQueueToken() {
  await chrome.storage.local.remove('csQueueAuth');
  $('queueToken').value = '';
  $('tokenStatus').textContent = 'Token cleared.';
  $('tokenStatus').className = 'status';
}
$('saveToken')?.addEventListener('click', saveQueueToken);
$('clearToken')?.addEventListener('click', clearQueueToken);
loadQueueToken();

// --- Tab switching ---
document.querySelectorAll('.tabbtn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.getAttribute('data-tab');
    document.querySelectorAll('.tabbtn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tabpane').forEach((p) => {
      p.classList.toggle('active', p.id === `tab-${tab}`);
    });
  });
});

// --- Dispatch tab ---
const DISPATCH_URL = `${SUPABASE_URL}/functions/v1/dispatch-sync`;
let dispatchState = { code: '', batch: null, jobs: [] };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderDispatch() {
  const meta = $('dispatchMeta');
  const list = $('dispatchJobs');
  if (!dispatchState.batch) {
    meta.textContent = '';
    list.innerHTML = '';
    return;
  }
  const { batch, jobs } = dispatchState;
  const done = jobs.filter((j) => j.status === 'done').length;
  meta.innerHTML = `<b>${escapeHtml(batch.label || 'Untitled')}</b> · ${done}/${jobs.length} filled`;
  list.innerHTML = jobs
    .map((j) => {
      const ct = chartTypeMeta(j.chart_type);
      const mins = j.actual_minutes ? `<span class="badge">⏱ ${j.actual_minutes}m</span>` : '';
      return `
    <div class="job" data-id="${j.id}">
      <h4>${escapeHtml(j.patient_name || `Patient ${j.position + 1}`)}
        <span class="badge ${j.status}">${j.status}</span>
        <span class="badge" style="background:${ct.bg};color:${ct.fg};border-color:${ct.fg}">${ct.emoji} ${ct.short}</span>
        ${mins}
      </h4>
      <div class="meta">${escapeHtml(j.mrn ? `MRN ${j.mrn} · ` : '')}${escapeHtml(ct.label)}</div>
      <div class="actions">
        <button class="autoChartJob" data-id="${j.id}" style="background:#15803d; border-color:#15803d;">⚡ Auto-chart</button>
        <button class="fillJob secondary" data-id="${j.id}">Fill open encounter</button>
        <button class="secondary doneJob" data-id="${j.id}">Done</button>
        <button class="secondary skipJob" data-id="${j.id}">Skip</button>
      </div>
    </div>`;
    })
    .join('');

  list.querySelectorAll('.fillJob').forEach((b) =>
    b.addEventListener('click', () => fillJob(b.getAttribute('data-id'))),
  );
  list.querySelectorAll('.autoChartJob').forEach((b) =>
    b.addEventListener('click', () => autoChartJob(b.getAttribute('data-id'))),
  );
  list.querySelectorAll('.doneJob').forEach((b) =>
    b.addEventListener('click', () => updateJobStatus(b.getAttribute('data-id'), 'done')),
  );
  list.querySelectorAll('.skipJob').forEach((b) =>
    b.addEventListener('click', () => updateJobStatus(b.getAttribute('data-id'), 'skipped')),
  );
}

async function loadDispatch() {
  const code = ($('dispatchCode').value || '').trim().toUpperCase();
  if (code.length < 4) {
    $('dispatchStatus').textContent = 'Enter the share code from Chart Flo.';
    $('dispatchStatus').className = 'status err';
    return;
  }
  $('dispatchStatus').textContent = 'Loading…';
  $('dispatchStatus').className = 'status';
  try {
    const token = await getAuthToken();
    if (!token) {
      $('dispatchStatus').textContent = 'Save your Chart Flo auth token in the Settings tab first.';
      $('dispatchStatus').className = 'status err';
      return;
    }
    const r = await fetch(`${DISPATCH_URL}?code=${encodeURIComponent(code)}`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    });
    if (r.status === 401 || r.status === 403) {
      $('dispatchStatus').textContent = 'Auth token expired or rejected. Re-copy a fresh token from Chart Flo → Settings.';
      $('dispatchStatus').className = 'status err';
      return;
    }
    if (r.status === 404) {
      $('dispatchStatus').textContent = 'Batch not found for that code.';
      $('dispatchStatus').className = 'status err';
      dispatchState = { code: '', batch: null, jobs: [] };
      renderDispatch();
      return;
    }
    if (!r.ok) {
      $('dispatchStatus').textContent = `Failed (${r.status})`;
      $('dispatchStatus').className = 'status err';
      return;
    }
    const data = await r.json();
    dispatchState = { code, batch: data.batch, jobs: data.jobs || [] };
    await chrome.storage.local.set({ csLastDispatchCode: code });
    $('dispatchStatus').textContent = `Loaded ${data.jobs?.length || 0} patient(s).`;
    $('dispatchStatus').className = 'status ok';
    renderDispatch();
  } catch (e) {
    $('dispatchStatus').textContent = `Network error: ${e?.message || e}`;
    $('dispatchStatus').className = 'status err';
  }
}

async function updateJobStatus(jobId, status, minutes) {
  if (!dispatchState.code) return;
  try {
    const token = await getAuthToken();
    if (!token) {
      $('dispatchStatus').textContent = 'Save your Chart Flo auth token in the Settings tab first.';
      $('dispatchStatus').className = 'status err';
      return;
    }
    const body = { jobId, status };
    if (typeof minutes === 'number' && minutes >= 0) body.minutes = minutes;
    const r = await fetch(`${DISPATCH_URL}?code=${encodeURIComponent(dispatchState.code)}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      $('dispatchStatus').textContent = `Update failed (${r.status})`;
      $('dispatchStatus').className = 'status err';
      return;
    }
    const job = dispatchState.jobs.find((j) => j.id === jobId);
    if (job) {
      job.status = status;
      if (typeof minutes === 'number') job.actual_minutes = (job.actual_minutes || 0) + minutes;
    }
    renderDispatch();
  } catch (e) {
    $('dispatchStatus').textContent = `Network error: ${e?.message || e}`;
    $('dispatchStatus').className = 'status err';
  }
}

async function fillJob(jobId) {
  const job = dispatchState.jobs.find((j) => j.id === jobId);
  if (!job) return;
  const tab = await activeTab();
  if (!tab?.url?.includes('practicefusion.com')) {
    $('dispatchStatus').textContent = 'Open a Practice Fusion encounter tab first.';
    $('dispatchStatus').className = 'status err';
    return;
  }
  try {
    const ready = await ensureContentScript(tab.id);
    if (!ready) {
      $('dispatchStatus').textContent = 'Content script not ready — reload the PF tab and retry.';
      $('dispatchStatus').className = 'status err';
      return;
    }
    const res = await chrome.tabs.sendMessage(tab.id, {
      action: 'push',
      payload: {
        subjective: job.subjective || '',
        objective: job.objective || '',
        assessment: job.assessment || '',
        plan: job.plan || '',
      },
    }, { frameId: 0 });
    if (res?.filled?.length) {
      $('dispatchStatus').textContent = `Filled ${job.patient_name || ''}: ${res.filled.join(', ')}`;
      $('dispatchStatus').className = 'status ok';
      await updateJobStatus(jobId, 'done');
    } else {
      $('dispatchStatus').textContent = 'No SOAP fields recognized on this page.';
      $('dispatchStatus').className = 'status err';
    }
  } catch (e) {
    $('dispatchStatus').textContent = 'Content script not ready — reload the PF tab and retry.';
    $('dispatchStatus').className = 'status err';
  }
}

function buildSoapText(job) {
  const sections = [];
  if (job.subjective) sections.push(`SUBJECTIVE:\n${job.subjective}`);
  if (job.objective)  sections.push(`OBJECTIVE:\n${job.objective}`);
  if (job.assessment) sections.push(`ASSESSMENT:\n${job.assessment}`);
  if (job.plan)       sections.push(`PLAN:\n${job.plan}`);
  return sections.join('\n\n');
}

async function autoChartJob(jobId, opts = {}) {
  const job = dispatchState.jobs.find((j) => j.id === jobId);
  if (!job) return { ok: false, error: 'Job not found' };
  if (!job.patient_name) {
    $('dispatchStatus').textContent = `${job.mrn || 'Job'} has no patient name — cannot auto-chart.`;
    $('dispatchStatus').className = 'status err';
    return { ok: false, error: 'No patient name' };
  }
  const tab = await activeTab();
  if (!tab?.url?.includes('practicefusion.com')) {
    $('dispatchStatus').textContent = 'Open Practice Fusion in the active tab first.';
    $('dispatchStatus').className = 'status err';
    return { ok: false, error: 'Not on PF' };
  }
  const meta = chartTypeMeta(job.chart_type);
  const text = meta.prefix + buildSoapText(job);
  if (!text.trim()) {
    $('dispatchStatus').textContent = `${job.patient_name}: SOAP empty.`;
    $('dispatchStatus').className = 'status err';
    return { ok: false, error: 'Empty SOAP' };
  }
  const t0 = Date.now();
  try {
    const ready = await ensureContentScript(tab.id);
    if (!ready) {
      const msg = `Content script not ready for ${job.patient_name} — reload the PF tab.`;
      $('dispatchStatus').textContent = msg;
      $('dispatchStatus').className = 'status err';
      return { ok: false, error: msg };
    }
    $('dispatchStatus').textContent = `${meta.emoji} ${meta.label} — ${job.patient_name} — searching…`;
    $('dispatchStatus').className = 'status';
    const search = await chrome.tabs.sendMessage(tab.id, { action: 'searchPatient', patientName: job.patient_name }, { frameId: 0 });
    if (!search?.success) {
      const msg = `Search failed for ${job.patient_name}: ${search?.error || 'unknown'}`;
      $('dispatchStatus').textContent = msg;
      $('dispatchStatus').className = 'status err';
      return { ok: false, error: msg };
    }
    $('dispatchStatus').textContent = `${meta.emoji} Opening ${meta.label} for ${job.patient_name}…`;
    // Try the chart-type-specific action first, fall back to the CCM flow if the
    // content script doesn't recognise it (older installs / unimplemented types).
    let ins = await chrome.tabs.sendMessage(
      tab.id,
      { action: meta.action, patientName: job.patient_name, text, chartType: job.chart_type },
      { frameId: 0 },
    ).catch(() => null);
    if (!ins || ins.unknownAction) {
      ins = await chrome.tabs.sendMessage(
        tab.id,
        { action: 'openAndInsertCCM', patientName: job.patient_name, text, chartType: job.chart_type },
        { frameId: 0 },
      );
    }
    if (!ins?.success) {
      const msg = `Insert failed for ${job.patient_name}: ${ins?.error || 'unknown'}`;
      $('dispatchStatus').textContent = msg;
      $('dispatchStatus').className = 'status err';
      return { ok: false, error: msg };
    }

    // Autonomous finish: save the note and return to charts so the next job can run
    // without user intervention. Failures here are non-fatal (insert already succeeded)
    // so we still mark the job as done.
    let saveNote = true, goBack = true;
    try {
      const s = await chrome.storage.local.get(['csAutoSave', 'csAutoReturn']);
      saveNote = s.csAutoSave !== false;
      goBack = s.csAutoReturn !== false;
    } catch { /* defaults */ }

    if (saveNote) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'saveCCMNote' }, { frameId: 0 });
      } catch (e) { console.warn('[ChartFlo] autonomous save failed:', e?.message || e); }
    }
    if (goBack) {
      try {
        await new Promise((r) => setTimeout(r, 600));
        await chrome.tabs.sendMessage(tab.id, { action: 'goBackToCharts' }, { frameId: 0 });
      } catch (e) { console.warn('[ChartFlo] autonomous return failed:', e?.message || e); }
    }

    const minutes = Math.max(1, Math.round((Date.now() - t0) / 60000));
    await updateJobStatus(jobId, 'done', minutes);
    if (!opts.silent) {
      $('dispatchStatus').textContent = `✓ ${meta.emoji} Charted ${job.patient_name} (${minutes}m).`;
      $('dispatchStatus').className = 'status ok';
    }
    return { ok: true };
  } catch (e) {
    const msg = `Content script not ready for ${job.patient_name} — reload the PF tab. (${e?.message || e})`;
    $('dispatchStatus').textContent = msg;
    $('dispatchStatus').className = 'status err';
    return { ok: false, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────
// Autonomous mode — polls the dispatch batch every 30s and auto-charts any
// pending jobs whenever a Practice Fusion tab is open. Runs entirely in the
// background so the MA doesn't have to click "Auto-chart all" each time a new
// batch arrives from Chart Flo.
// ─────────────────────────────────────────────────────────────
let autoModeTimer = null;
let autoModeRunning = false;

async function autoModeTick() {
  if (autoModeRunning) return;
  const { csAutoMode, csLastDispatchCode } = await chrome.storage.local.get(['csAutoMode', 'csLastDispatchCode']);
  if (!csAutoMode || !csLastDispatchCode) return;
  const tab = await activeTab();
  if (!tab?.url?.includes('practicefusion.com')) return;
  autoModeRunning = true;
  try {
    // Refresh the batch silently, then chart any pending jobs.
    if (typeof loadDispatch === 'function') {
      try { await loadDispatch({ silent: true }); } catch { /* ignore */ }
    }
    const pending = (dispatchState?.jobs || []).filter((j) => j.status === 'pending');
    if (!pending.length) return;
    $('dispatchStatus').textContent = `🤖 Autonomous mode — ${pending.length} pending…`;
    $('dispatchStatus').className = 'status';
    for (const j of pending) {
      const r = await autoChartJob(j.id, { silent: true });
      if (!r.ok) console.warn('[ChartFlo] autonomous chart failed:', j.patient_name, r.error);
      await new Promise((res) => setTimeout(res, 1200));
    }
  } finally {
    autoModeRunning = false;
  }
}

function setAutoMode(on) {
  chrome.storage.local.set({ csAutoMode: !!on });
  if (autoModeTimer) { clearInterval(autoModeTimer); autoModeTimer = null; }
  if (on) {
    autoModeTimer = setInterval(autoModeTick, 30000);
    autoModeTick(); // fire immediately
    $('dispatchStatus').textContent = '🤖 Autonomous mode ON — will chart new batches every 30s.';
    $('dispatchStatus').className = 'status ok';
  } else {
    $('dispatchStatus').textContent = 'Autonomous mode off.';
    $('dispatchStatus').className = 'status';
  }
}

// Restore autonomous-mode toggle state and wire the checkbox.
chrome.storage.local.get(['csAutoMode', 'csAutoSave', 'csAutoReturn'], (d) => {
  const modeEl = $('autoMode'); if (modeEl) modeEl.checked = !!d.csAutoMode;
  const saveEl = $('autoSave'); if (saveEl) saveEl.checked = d.csAutoSave !== false;
  const retEl = $('autoReturn'); if (retEl) retEl.checked = d.csAutoReturn !== false;
  if (d.csAutoMode) setAutoMode(true);
});
$('autoMode')?.addEventListener('change', (e) => setAutoMode(e.target.checked));
$('autoSave')?.addEventListener('change', (e) => chrome.storage.local.set({ csAutoSave: e.target.checked }));
$('autoReturn')?.addEventListener('change', (e) => chrome.storage.local.set({ csAutoReturn: e.target.checked }));

function acpReset(total) {
  $('autoChartPanel').style.display = '';
  $('acpProgress').textContent = `0/${total}`;
  $('acpOk').textContent = '0';
  $('acpFail').textContent = '0';
  $('acpRows').innerHTML = '';
}
function acpAddRow(name) {
  const row = document.createElement('div');
  row.style.cssText = 'padding:4px 6px; border-bottom:1px solid #eef0f3; display:flex; gap:6px; align-items:flex-start;';
  row.innerHTML = `<span class="acp-icon" style="width:14px; flex-shrink:0;">⏳</span><span style="flex:1;"><b style="font-family:system-ui;">${name}</b><div class="acp-detail" style="color:#6b7280; margin-top:2px;">working…</div></span>`;
  $('acpRows').appendChild(row);
  return row;
}
function acpFinishRow(row, ok, detail) {
  row.querySelector('.acp-icon').textContent = ok ? '✓' : '✗';
  row.querySelector('.acp-icon').style.color = ok ? '#15803d' : '#b91c1c';
  const d = row.querySelector('.acp-detail');
  d.textContent = detail || (ok ? 'charted' : 'failed');
  d.style.color = ok ? '#15803d' : '#b91c1c';
}
function acpUpdateCounts(i, total, ok, fail) {
  $('acpProgress').textContent = `${i}/${total}`;
  $('acpOk').textContent = String(ok);
  $('acpFail').textContent = String(fail);
}

async function autoChartAll() {
  const pending = dispatchState.jobs.filter((j) => j.status === 'pending');
  if (!pending.length) {
    $('dispatchStatus').textContent = 'No pending jobs to chart.';
    $('dispatchStatus').className = 'status';
    return;
  }
  const btn = $('autoChartAll');
  if (btn) btn.disabled = true;
  acpReset(pending.length);
  let ok = 0, fail = 0;
  for (let i = 0; i < pending.length; i++) {
    const j = pending[i];
    const name = j.patient_name || j.mrn || 'patient';
    $('dispatchStatus').textContent = `[${i + 1}/${pending.length}] ${name}…`;
    $('dispatchStatus').className = 'status';
    const row = acpAddRow(name);
    const r = await autoChartJob(j.id, { silent: true });
    if (r.ok) { ok++; acpFinishRow(row, true, 'charted'); }
    else { fail++; acpFinishRow(row, false, r.error || 'failed'); }
    acpUpdateCounts(i + 1, pending.length, ok, fail);
    await new Promise((res) => setTimeout(res, 800));
  }
  if (btn) btn.disabled = false;
  $('dispatchStatus').textContent = `Auto-chart complete — ${ok} charted, ${fail} failed.`;
  $('dispatchStatus').className = fail ? 'status err' : 'status ok';
}

$('acpClear')?.addEventListener('click', () => {
  $('autoChartPanel').style.display = 'none';
  $('acpRows').innerHTML = '';
});



$('loadDispatch')?.addEventListener('click', loadDispatch);
$('refreshDispatch')?.addEventListener('click', loadDispatch);
$('autoChartAll')?.addEventListener('click', autoChartAll);
$('dispatchCode')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadDispatch();
});

chrome.storage.local.get(['csLastDispatchCode'], (d) => {
  if (d.csLastDispatchCode) $('dispatchCode').value = d.csLastDispatchCode;
});

// --- Microphone recording → transcribe → structure SOAP → insert ---
const TRANSCRIBE_URL = `${SUPABASE_URL}/functions/v1/transcribe-audio`;
const STRUCTURE_URL = `${SUPABASE_URL}/functions/v1/structure-soap`;
let recState = { recorder: null, chunks: [], stream: null, mime: '', recording: false, audioCtx: null, analyser: null, rafId: null, source: null, startTime: 0, timerInterval: null };

function drawWaveform() {
  const canvas = $('recWave');
  if (!canvas || !recState.analyser) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const buf = new Uint8Array(recState.analyser.fftSize);
  const render = () => {
    if (!recState.recording) return;
    recState.analyser.getByteTimeDomainData(buf);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#10b981';
    ctx.beginPath();
    const slice = w / buf.length;
    let x = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      x += slice;
    }
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    recState.rafId = requestAnimationFrame(render);
  };
  render();
}

function clearWaveform() {
  const canvas = $('recWave');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();
}

function setRecStatus(msg, cls = '') {
  const el = $('recStatus');
  el.textContent = msg;
  el.className = 'status ' + cls;
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateTimer() {
  if (!recState.recording) return;
  const elapsed = Date.now() - recState.startTime;
  $('recTimer').textContent = formatTime(elapsed);
}

function resetTimer() {
  if (recState.timerInterval) clearInterval(recState.timerInterval);
  recState.timerInterval = null;
  $('recTimer').textContent = '00:00';
}

function pickMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function getAuthToken() {
  return new Promise((res) => {
    chrome.storage.local.get(['csQueueAuth'], (d) => res(d.csQueueAuth?.token || null));
  });
}

const MIC_KEY = 'cs.micDeviceId';

async function loadSavedMicId() {
  return new Promise((res) => chrome.storage.local.get([MIC_KEY], (d) => res(d?.[MIC_KEY] || '')));
}
async function saveMicId(id) {
  return new Promise((res) => chrome.storage.local.set({ [MIC_KEY]: id || '' }, res));
}

async function populateMicList() {
  const sel = $('micSelect');
  if (!sel) return;
  try {
    // Need at least one prior permission grant for labels to be populated.
    let devices = await navigator.mediaDevices.enumerateDevices();
    const hasLabels = devices.some((d) => d.kind === 'audioinput' && d.label);
    if (!hasLabels) {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch { /* user can still pick "Default" */ }
    }
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    const saved = await loadSavedMicId();
    sel.innerHTML = '<option value="">Default microphone</option>' +
      inputs.map((d) => {
        const label = d.label || `Microphone (${(d.deviceId || '').slice(0, 6)})`;
        const bt = /bluetooth|airpods|wireless|bt|headset|buds/i.test(label) ? ' 🔵' : '';
        return `<option value="${d.deviceId}"${d.deviceId === saved ? ' selected' : ''}>${label}${bt}</option>`;
      }).join('');
  } catch (e) {
    setRecStatus(`Could not list microphones: ${e?.message || e}`, 'err');
  }
}

$('micSelect')?.addEventListener('change', (e) => saveMicId(e.target.value));
$('micRefresh')?.addEventListener('click', populateMicList);
populateMicList();
navigator.mediaDevices?.addEventListener?.('devicechange', populateMicList);

async function startRecording() {
  try {
    const deviceId = await loadSavedMicId();
    const audioConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (deviceId) audioConstraints.deviceId = { exact: deviceId };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    } catch (err) {
      if (deviceId && (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError')) {
        // Saved device disappeared (e.g., Bluetooth disconnected) — fall back to default.
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        setRecStatus('Saved mic unavailable — using system default.', 'err');
      } else {
        throw err;
      }
    }
    const mime = pickMime();
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    let audioCtx = null, analyser = null, source = null;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
    } catch {}
    recState = { recorder, chunks: [], stream, mime: recorder.mimeType || mime || 'audio/webm', recording: true, audioCtx, analyser, source, rafId: null, startTime: Date.now(), timerInterval: null };
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recState.chunks.push(e.data); };
    recorder.onstop = handleRecordingStop;
    recorder.start();
    recState.timerInterval = setInterval(updateTimer, 1000);
    $('recBtn').textContent = '■ Stop encounter';
    $('recBtn').style.background = '#b91c1c';
    $('recBtn').style.borderColor = '#b91c1c';
    setRecStatus('Recording encounter… click Stop when done.');
    drawWaveform();
    // Refresh device labels now that permission was granted.
    populateMicList();
  } catch (e) {
    const name = e?.name || '';
    let msg = e?.message || String(e);
    if (name === 'NotAllowedError') {
      msg = 'Microphone blocked. Click the 🔒 in the address bar → Site settings → Microphone → Allow, then retry.';
    } else if (name === 'NotFoundError') {
      msg = 'No microphone detected. Pair your Bluetooth mic in your OS, then press ↻ to refresh.';
    } else if (name === 'NotReadableError') {
      msg = 'Microphone is in use by another app. Close Zoom/Teams/Meet, then retry.';
    }
    setRecStatus(`Microphone error: ${msg}`, 'err');
  }
}

function stopRecording() {
  if (!recState.recorder) return;
  try { recState.recorder.stop(); } catch {}
  recState.stream?.getTracks().forEach((t) => t.stop());
  if (recState.rafId) cancelAnimationFrame(recState.rafId);
  try { recState.source?.disconnect(); } catch {}
  try { recState.audioCtx?.close(); } catch {}
  recState.recording = false;
  resetTimer();
  $('recBtn').textContent = '● Record encounter';
  $('recBtn').style.background = '';
  $('recBtn').style.borderColor = '';
  clearWaveform();
}

async function handleRecordingStop() {
  setRecStatus('Transcribing…');
  $('recBtn').disabled = true;
  try {
    const blob = new Blob(recState.chunks, { type: recState.mime || 'audio/webm' });
    if (!blob.size) { setRecStatus('No audio captured.', 'err'); return; }
    const token = await getAuthToken();
    if (!token) {
      setRecStatus('Save your Chart Flo auth token in Settings tab first.', 'err');
      return;
    }
    const audioBase64 = await blobToBase64(blob);
    const r = await fetch(TRANSCRIBE_URL, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audioBase64, mimeType: recState.mime || 'audio/webm' }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      setRecStatus(`Transcription failed (${r.status}): ${txt.slice(0, 140)}`, 'err');
      return;
    }
    const data = await r.json();
    const transcript = (data?.transcript || '').trim();
    if (!transcript) { setRecStatus('Empty transcript.', 'err'); return; }
    setRecStatus('Structuring SOAP note…');
    const sr = await fetch(STRUCTURE_URL, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transcript }),
    });
    if (!sr.ok) {
      const txt = await sr.text().catch(() => '');
      setRecStatus(`SOAP structuring failed (${sr.status}): ${txt.slice(0, 140)}`, 'err');
      return;
    }
    const soap = await sr.json();
    let filled = [];
    for (const f of FIELDS) {
      if (typeof soap?.[f] === 'string' && soap[f].trim()) {
        $(f).value = soap[f].trim();
        filled.push(f);
      }
    }
    await saveDraft();
    setRecStatus(filled.length ? `Filled: ${filled.join(', ')}` : 'Structured but no fields returned.', filled.length ? 'ok' : 'err');
  } catch (e) {
    setRecStatus(`Error: ${e?.message || e}`, 'err');
  } finally {
    $('recBtn').disabled = false;
  }
}

$('recBtn')?.addEventListener('click', () => {
  if (recState.recording) stopRecording();
  else startRecording();
});

// --- Orders tab: structured rows → formatted Plan text + stage for fax ---
const ORD_META_FIELDS = ['ordPatient', 'ordMrn', 'ordDate', 'ordFacility'];
const ORD_ROW_COLS = [
  { key: 'name',      placeholder: 'Order / medication',  flex: '2 1 140px' },
  { key: 'dose',      placeholder: 'Dose (e.g. 500 mg)',  flex: '1 1 90px' },
  { key: 'route',     placeholder: 'Route (PO, IM…)',     flex: '1 1 80px' },
  { key: 'frequency', placeholder: 'Frequency (BID…)',    flex: '1 1 90px' },
  { key: 'duration',  placeholder: 'Duration (10 days)',  flex: '1 1 100px' },
];

function setOrdStatus(msg, cls = '') {
  const el = $('ordStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status ' + cls;
}

function blankRow() { return { name: '', dose: '', route: '', frequency: '', duration: '' }; }

function renderOrderRows(rows) {
  const host = $('ordRows');
  if (!host) return;
  host.innerHTML = '';
  rows.forEach((r, idx) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; align-items:center; padding:6px; border:1px solid #e2e8f0; border-radius:6px; background:#f8fafc;';
    wrap.dataset.idx = String(idx);
    ORD_ROW_COLS.forEach((col) => {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = col.placeholder;
      inp.value = r[col.key] || '';
      inp.dataset.key = col.key;
      inp.style.cssText = `flex:${col.flex}; min-width:0; font:12px/1.4 ui-monospace,Menlo,monospace; padding:5px 6px; border:1px solid #cbd5e1; border-radius:4px;`;
      inp.addEventListener('input', () => {
        r[col.key] = inp.value;
        rebuildOrderPreview();
        saveOrdersDraft();
      });
      wrap.appendChild(inp);
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Remove order';
    del.className = 'secondary';
    del.style.cssText = 'flex:0 0 28px; padding:4px 0; font-size:14px; line-height:1;';
    del.addEventListener('click', () => {
      ordState.rows.splice(idx, 1);
      if (!ordState.rows.length) ordState.rows.push(blankRow());
      renderOrderRows(ordState.rows);
      rebuildOrderPreview();
      saveOrdersDraft();
    });
    wrap.appendChild(del);
    host.appendChild(wrap);
  });
}

function formatRow(r) {
  const parts = [r.name, r.dose, r.route, r.frequency, r.duration]
    .map((s) => (s || '').trim())
    .filter(Boolean);
  return parts.join(' · ');
}

function buildOrdersPlanTextFromRows(meta, rows) {
  const lines = ['Orders:'];
  rows.map(formatRow).filter(Boolean).forEach((l) => lines.push(`  • ${l}`));
  if (meta.facility) { lines.push(''); lines.push(`Send to: ${meta.facility}`); }
  return lines.join('\n');
}

let ordState = { rows: [blankRow()] };
let ordPreviewDirty = false;

function readMeta() {
  return {
    patientName: $('ordPatient').value.trim(),
    mrn: $('ordMrn').value.trim(),
    date: $('ordDate').value.trim(),
    facility: $('ordFacility').value.trim(),
  };
}

function rebuildOrderPreview() {
  if (ordPreviewDirty) return;
  $('ordList').value = buildOrdersPlanTextFromRows(readMeta(), ordState.rows);
}

function readOrdersForm() {
  const meta = readMeta();
  const rows = ordState.rows.filter((r) => Object.values(r).some((v) => (v || '').trim()));
  const orders = rows.map(formatRow).filter(Boolean);
  return {
    ...meta,
    orders,
    rows,
    planText: $('ordList').value,
    savedAt: new Date().toISOString(),
  };
}

function writeOrdersForm(o) {
  if (!o) return;
  $('ordPatient').value = o.patientName || '';
  $('ordMrn').value = o.mrn || '';
  $('ordDate').value = o.date || '';
  $('ordFacility').value = o.facility || '';
  if (Array.isArray(o.rows) && o.rows.length) {
    ordState.rows = o.rows.map((r) => ({ ...blankRow(), ...r }));
  } else if (Array.isArray(o.orders) && o.orders.length) {
    ordState.rows = o.orders.map((line) => ({ ...blankRow(), name: String(line) }));
  } else {
    ordState.rows = [blankRow()];
  }
  renderOrderRows(ordState.rows);
  ordPreviewDirty = false;
  if (o.planText && o.planText.trim()) {
    $('ordList').value = o.planText;
    ordPreviewDirty = true;
  } else {
    rebuildOrderPreview();
  }
}

async function loadOrdersDraft() {
  const { pendingOrders, ordDraft } = await chrome.storage.local.get(['pendingOrders', 'ordDraft']);
  writeOrdersForm(ordDraft || pendingOrders || { rows: [blankRow()] });
}

async function saveOrdersDraft() {
  await chrome.storage.local.set({ ordDraft: readOrdersForm() });
}

ORD_META_FIELDS.forEach((id) => $(id)?.addEventListener('input', () => {
  rebuildOrderPreview();
  saveOrdersDraft();
}));

$('ordList')?.addEventListener('input', () => {
  ordPreviewDirty = true;
  saveOrdersDraft();
});

$('ordAddRow')?.addEventListener('click', () => {
  ordState.rows.push(blankRow());
  renderOrderRows(ordState.rows);
});

$('ordPush')?.addEventListener('click', async () => {
  const o = readOrdersForm();
  const planText = (o.planText && o.planText.trim()) || buildOrdersPlanTextFromRows(o, ordState.rows);
  if (!o.orders.length && !planText.replace(/Orders:\s*/, '').trim()) {
    setOrdStatus('Add at least one order row.', 'err'); return;
  }
  const tab = await activeTab();
  if (!tab?.url?.includes('practicefusion.com')) {
    setOrdStatus('Open a Practice Fusion encounter tab first.', 'err');
    return;
  }
  setOrdStatus('Pushing orders into Plan…');
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { action: 'push', payload: { plan: planText } }, { frameId: 0 });
    if (res?.filled?.length) {
      setOrdStatus(`Filled: ${res.filled.join(', ')}`, 'ok');
      await saveOrdersDraft();
    } else {
      setOrdStatus('No Plan/Orders field found on this page. Open the chart-note view.', 'err');
    }
  } catch {
    setOrdStatus('Content script not ready — reload the PF tab and retry.', 'err');
  }
});

$('ordStageFax')?.addEventListener('click', async () => {
  const o = readOrdersForm();
  if (!o.orders.length) { setOrdStatus('Add at least one order row.', 'err'); return; }
  await chrome.storage.local.set({ pendingOrders: o, ordDraft: o });
  setOrdStatus('Staged. Open a PF fax compose page — the Chart Flo banner will offer "Fill fax".', 'ok');
});

$('ordPaste')?.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    const obj = JSON.parse(text);
    const rows = Array.isArray(obj.rows)
      ? obj.rows
      : Array.isArray(obj.orders)
        ? obj.orders.map((line) => ({ ...blankRow(), name: String(line) }))
        : [];
    writeOrdersForm({
      patientName: obj.patientName || obj.patient || '',
      mrn: obj.mrn || '',
      date: obj.date || '',
      facility: obj.facility || obj.recipient || '',
      rows,
    });
    await saveOrdersDraft();
    setOrdStatus('Loaded from clipboard.', 'ok');
  } catch { setOrdStatus('Clipboard did not contain valid orders JSON.', 'err'); }
});

$('ordClear')?.addEventListener('click', async () => {
  ORD_META_FIELDS.forEach((id) => ($(id).value = ''));
  ordState.rows = [blankRow()];
  renderOrderRows(ordState.rows);
  ordPreviewDirty = false;
  $('ordList').value = '';
  await chrome.storage.local.remove(['ordDraft']);
  setOrdStatus('Cleared.');
});

loadOrdersDraft();

