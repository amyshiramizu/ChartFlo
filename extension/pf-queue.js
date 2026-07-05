// Practice Fusion CCM auto-documentation queue.
// Polls Supabase pf_push_queue for the signed-in user and shows pending
// items as a side panel inside Practice Fusion. Each item, when actioned,
// fills the SOAP fields (Subjective / Objective / Assessment / Plan)
// independently from the queued chart note. When the currently open PF
// chart matches a queued item by last name + DOB, the matching item is
// auto-filled exactly once (strict-match required).

(function () {
  'use strict';
  if (!location.hostname.includes('practicefusion.com')) return;
  if (window.top !== window.self) return;

  const POLL_MS = 30000;
  const CHART_MS = 2500;
  let cfg = null;
  let pending = [];
  const autoFilled = new Set(); // queue ids already auto-pasted this session

  async function loadCfg() {
    return new Promise((res) => {
      chrome.storage.local.get(['csQueueAuth'], (d) => res(d.csQueueAuth || null));
    });
  }

  async function fetchQueue() {
    if (!cfg?.url || !cfg?.token || !cfg?.clinic_id) return [];
    const today = new Date().toISOString().slice(0, 10);
    try {
      const r = await fetch(
        `${cfg.url}/rest/v1/pf_push_queue?status=eq.pending&encounter_date=eq.${today}` +
          `&clinic_id=eq.${cfg.clinic_id}&order=created_at.asc`,
        {
          headers: {
            apikey: cfg.anonKey,
            Authorization: `Bearer ${cfg.token}`,
          },
        },
      );
      if (!r.ok) return [];
      const rows = await r.json();
      return rows.filter((row) => row.clinic_id === cfg.clinic_id);
    } catch {
      return [];
    }
  }

  async function markStatus(id, status, error = null) {
    if (!cfg?.url || !cfg?.token || !cfg?.clinic_id) return;
    await fetch(
      `${cfg.url}/rest/v1/pf_push_queue?id=eq.${id}&clinic_id=eq.${cfg.clinic_id}`,
      {
        method: 'PATCH',
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          status,
          error,
          processed_at: status === 'done' ? new Date().toISOString() : null,
        }),
      },
    );
  }

  // ---------- DOM helpers ----------
  function setVal(el, value) {
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function findFieldByLabel(labels) {
    const nodes = document.querySelectorAll('label, span, div, h3, h4, legend');
    for (const node of nodes) {
      const t = (node.textContent || '').trim().toLowerCase();
      if (!t) continue;
      if (!labels.some((l) => t === l || t.startsWith(l + ':') || t.startsWith(l + ' '))) continue;
      const container = node.closest('div,section,fieldset') || node.parentElement;
      const ta = container?.querySelector('textarea, [contenteditable="true"]');
      if (ta) return ta;
    }
    return null;
  }

  function writeTo(el, value) {
    if (!el || !value) return false;
    const existing =
      el.tagName === 'TEXTAREA' ? el.value : el.isContentEditable ? el.innerText : '';
    const merged = existing && existing.trim() ? `${existing.trim()}\n\n${value}` : value;
    if (el.isContentEditable) {
      el.innerText = merged;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      setVal(el, merged);
    }
    return true;
  }

  function fillSoapForItem(item) {
    const subjEl = findFieldByLabel(['subjective', 'hpi', 'history of present illness']);
    const objEl = findFieldByLabel(['objective', 'exam', 'physical exam']);
    const assEl = findFieldByLabel(['assessment', 'impression']);
    const planEl = findFieldByLabel(['plan', 'orders', 'treatment plan']);

    const hasStructured =
      item.subjective || item.objective || item.assessment || item.plan;

    let filled = 0;
    const missing = [];

    if (hasStructured) {
      if (item.subjective && subjEl) { writeTo(subjEl, item.subjective); filled++; }
      else if (item.subjective) missing.push('Subjective');
      if (item.objective && objEl) { writeTo(objEl, item.objective); filled++; }
      else if (item.objective) missing.push('Objective');
      if (item.assessment && assEl) { writeTo(assEl, item.assessment); filled++; }
      else if (item.assessment) missing.push('Assessment');
      if (item.plan && planEl) { writeTo(planEl, item.plan); filled++; }
      else if (item.plan) missing.push('Plan');

      if (filled === 0) {
        // No structured field landed — fall back to combined into the first
        // available SOAP field.
        const fallback = assEl || planEl || subjEl || objEl;
        if (!fallback) return { ok: false, reason: 'No SOAP field found on page' };
        writeTo(fallback, item.note || '');
        return { ok: true, filled: 1, missing };
      }
      return { ok: true, filled, missing };
    }

    // Legacy row: only `note` is populated.
    const target = assEl || planEl || subjEl || objEl;
    if (!target) return { ok: false, reason: 'No SOAP field found on page' };
    const block =
      `--- CCM Encounter (${item.minutes} min) ---\n` +
      (item.note || '') +
      `\n--- end CCM ---`;
    writeTo(target, block);
    return { ok: true, filled: 1, missing: [] };
  }

  // ---------- Patient matching ----------
  function normalizeDob(s) {
    if (!s) return '';
    const t = String(s).trim();
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)))
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if ((m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.exec(t))) {
      let y = m[3];
      if (y.length === 2) y = (Number(y) > 30 ? '19' : '20') + y;
      return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
    const d = new Date(t);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return '';
  }

  // Heuristic: read the patient name + DOB from the visible PF chart header.
  // PF renders the patient banner with "Last, First" and a DOB label.
  function readOpenChart() {
    const text = document.body.innerText || '';
    // DOB patterns: "DOB: 1/4/1958", "DOB 1958-01-04"
    const dobMatch =
      /\bDOB[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})/i.exec(text);
    const dob = dobMatch ? normalizeDob(dobMatch[1]) : '';

    // Try a few selectors PF uses for the patient banner / chart header.
    const nameSelectors = [
      '[data-element="patient-name"]',
      '.patient-name',
      '.chart-patient-name',
      'header h1',
      'h1',
    ];
    let nameText = '';
    for (const sel of nameSelectors) {
      const el = document.querySelector(sel);
      const t = el && (el.textContent || '').trim();
      if (t && t.length < 80) { nameText = t; break; }
    }
    return { name: nameText, dob };
  }

  function lastNameOf(full) {
    if (!full) return '';
    const cleaned = String(full).replace(/\s*\(.*?\)\s*/g, '').trim();
    if (cleaned.includes(',')) return cleaned.split(',')[0].trim().toLowerCase();
    const parts = cleaned.split(/\s+/);
    return (parts[parts.length - 1] || '').toLowerCase();
  }

  function matchItem(open, item) {
    if (!open.dob || !item.patient_dob) return false;
    if (normalizeDob(item.patient_dob) !== open.dob) return false;
    const openLast = lastNameOf(open.name);
    const itemLast = lastNameOf(item.patient_name);
    if (!openLast || !itemLast) return false;
    return openLast === itemLast;
  }

  async function tryAutoFill() {
    if (!pending.length) return;
    const open = readOpenChart();
    if (!open.dob || !open.name) return;

    for (const item of pending) {
      if (autoFilled.has(item.id)) continue;
      if (!matchItem(open, item)) continue;

      // Strict match found — paste once.
      const r = fillSoapForItem(item);
      autoFilled.add(item.id);
      if (r.ok) {
        const note = r.missing && r.missing.length
          ? `Auto-filled ${item.patient_name} (missing: ${r.missing.join(', ')})`
          : `Auto-filled ${item.patient_name}`;
        showFlash(note);
      } else {
        showFlash(r.reason || 'Could not auto-fill', true);
      }
      return; // only one auto-fill per tick
    }
  }

  // ---------- UI ----------
  function ensurePanel() {
    if (document.getElementById('cs-queue-panel')) return;
    const el = document.createElement('div');
    el.id = 'cs-queue-panel';
    el.className = 'cs-queue-panel';
    el.innerHTML = `
      <div class="cs-queue-header">
        <span>CCM Queue</span>
        <span class="cs-queue-count" id="cs-queue-count">0</span>
        <button id="cs-queue-toggle" title="Collapse">–</button>
      </div>
      <div class="cs-queue-body" id="cs-queue-body"></div>
    `;
    document.body.appendChild(el);
    document.getElementById('cs-queue-toggle').addEventListener('click', (e) => {
      const collapsed = el.classList.toggle('cs-q-collapsed');
      e.currentTarget.textContent = collapsed ? '+' : '–';
    });
  }

  function render() {
    ensurePanel();
    const body = document.getElementById('cs-queue-body');
    const count = document.getElementById('cs-queue-count');
    if (!body || !count) return;
    count.textContent = String(pending.length);

    if (!cfg?.token) {
      body.innerHTML = `
        <p class="cs-q-hint">
          Open the Chart Flo extension popup and paste your Chart Flo
          auth token to enable end-of-day CCM auto-documentation.
        </p>`;
      return;
    }
    if (!cfg?.clinic_id) {
      body.innerHTML = `
        <p class="cs-q-hint">
          Saved token has no clinic scope. Re-copy the auth token from
          Chart Flo with an active clinic selected to enable the queue.
        </p>`;
      return;
    }
    const open = readOpenChart();
    const banner = open.name
      ? `<div class="cs-q-open">Open chart: <b>${escapeHtml(open.name)}</b>${
          open.dob ? ` · DOB ${escapeHtml(open.dob)}` : ''
        }</div>`
      : '';

    if (pending.length === 0) {
      body.innerHTML = banner + `<p class="cs-q-hint">No pending CCM encounters for ${
        escapeHtml(cfg.clinic_name || 'this clinic')
      } today.</p>`;
      return;
    }
    body.innerHTML = banner + pending
      .map((it) => {
        const matched = matchItem(open, it);
        const auto = autoFilled.has(it.id);
        const hasSoap = !!(it.subjective || it.objective || it.assessment || it.plan);
        return `
        <div class="cs-q-item ${matched ? 'cs-q-match' : ''}" data-id="${it.id}">
          <div class="cs-q-row">
            <strong>${escapeHtml(it.patient_name)}</strong>
            <span class="cs-q-min">${it.minutes}m</span>
          </div>
          <div class="cs-q-mrn">
            MRN ${escapeHtml(it.mrn || '—')}${it.patient_dob ? ` · DOB ${escapeHtml(it.patient_dob)}` : ''}
            ${hasSoap ? ' · <span class="cs-q-tag">SOAP</span>' : ''}
            ${matched ? ' · <span class="cs-q-tag cs-q-tag-ok">matches open chart</span>' : ''}
            ${auto ? ' · <span class="cs-q-tag cs-q-tag-ok">auto-filled</span>' : ''}
          </div>
          <div class="cs-q-actions">
            <button class="cs-q-fill" data-id="${it.id}">Fill SOAP</button>
            <button class="cs-q-done" data-id="${it.id}">Mark done</button>
            <button class="cs-q-skip" data-id="${it.id}">Skip</button>
          </div>
        </div>`;
      })
      .join('');

    body.querySelectorAll('.cs-q-fill').forEach((b) =>
      b.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const item = pending.find((p) => p.id === id);
        if (!item) return;
        const open = readOpenChart();
        if (!matchItem(open, item)) {
          const ok = window.confirm(
            `Open chart (${open.name || 'unknown'}, DOB ${open.dob || '—'}) does not match queued patient (${item.patient_name}, DOB ${item.patient_dob || '—'}).\n\nFill anyway?`,
          );
          if (!ok) return;
        }
        const r = fillSoapForItem(item);
        if (r.ok) {
          autoFilled.add(item.id);
          const msg = r.missing && r.missing.length
            ? `Filled ${item.patient_name} (missing: ${r.missing.join(', ')})`
            : `Filled ${item.patient_name}`;
          showFlash(msg);
        } else {
          showFlash(r.reason || 'Could not find a SOAP field', true);
        }
      }),
    );
    body.querySelectorAll('.cs-q-done').forEach((b) =>
      b.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        await markStatus(id, 'done');
        pending = pending.filter((p) => p.id !== id);
        render();
      }),
    );
    body.querySelectorAll('.cs-q-skip').forEach((b) =>
      b.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        await markStatus(id, 'failed', 'Skipped by user');
        pending = pending.filter((p) => p.id !== id);
        render();
      }),
    );
  }

  function showFlash(msg, err = false) {
    const f = document.createElement('div');
    f.className = 'cs-q-flash' + (err ? ' err' : '');
    f.textContent = msg;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 3000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function tick() {
    cfg = await loadCfg();
    pending = await fetchQueue();
    render();
  }

  ensurePanel();
  render();
  tick();
  setInterval(tick, POLL_MS);

  // Watch the chart for navigation/SPA changes and try auto-fill on match.
  setInterval(() => {
    tryAutoFill();
    // Re-render so the "matches open chart" badge updates as the user
    // moves between patients without waiting on the queue poll.
    if (pending.length) render();
  }, CHART_MS);

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.csQueueAuth) tick();
  });
})();
