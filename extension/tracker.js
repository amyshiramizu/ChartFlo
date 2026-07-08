// Time tracker for Practice Fusion, Updox, Microsoft Teams, and CoverMyMeds.
// Reports active time back to Chart Scribe extension storage,
// shows a live minute counter, lets the user tag an identified patient,
// and exposes an "Ask Claude" button that asks Lovable AI to draft a
// Medicare CCM-compliant note for the captured minutes.

(function () {
  'use strict';

  const SITE_MAP = [
    { match: 'teams.microsoft.com', name: 'Microsoft Teams' },
    { match: 'updox.com', name: 'Updox' },
    { match: 'covermymeds.com', name: 'CoverMyMeds' },
    { match: 'covermymeds.health', name: 'CoverMyMeds' },
    { match: 'impact-rpm.io', name: 'Impact RPM' },
    { match: 'practicefusion.com', name: 'Practice Fusion' },
  ];

  // Lovable AI assist endpoint (no auth required)
  const AI_ASSIST_URL =
    'https://qefadntuaqhrlfoqhpan.supabase.co/functions/v1/ccm-log-assist';
  // Authenticated endpoint that resolves a detected patient name into a
  // ChartFlo patient_id and links it to the active dispatch job.
  const RESOLVE_URL =
    'https://qefadntuaqhrlfoqhpan.supabase.co/functions/v1/resolve-active-patient';

  function detectSite() {
    const host = location.hostname;
    for (const { match, name } of SITE_MAP) {
      if (host.includes(match)) return name;
    }
    return null;
  }

  const siteName = detectSite();
  if (!siteName) return;

  // Avoid double-injecting in iframes that share the parent's badge
  if (window.top !== window.self) return;

  let isActive = true;
  let lastActiveTime = Date.now();
  let sessionSeconds = 0; // live counter shown on the badge
  let activeSeconds = 0;  // buffered seconds not yet flushed to storage
  let currentPatient = null; // { id, name }
  const IDLE_THRESHOLD = 60000; // 1 minute idle = pause tracking

  function onActivity() {
    isActive = true;
    lastActiveTime = Date.now();
  }
  document.addEventListener('mousemove', onActivity, { passive: true });
  document.addEventListener('keydown', onActivity, { passive: true });
  document.addEventListener('click', onActivity, { passive: true });
  document.addEventListener('scroll', onActivity, { passive: true });

  // Idle check
  setInterval(() => {
    if (Date.now() - lastActiveTime > IDLE_THRESHOLD) isActive = false;
  }, 10000);

  // Tick every second so the badge counter feels live
  setInterval(() => {
    if (isActive && !document.hidden) {
      sessionSeconds += 1;
      activeSeconds += 1;
      updateBadgeTime();
    }
  }, 1000);

  // Publish live session minutes to storage every 5s so other content
  // scripts (e.g. the in-page importer) can append them to the encounter.
  setInterval(() => {
    chrome.storage.local.set({
      csSessionMinutes: {
        site: siteName,
        minutes: Math.floor(sessionSeconds / 60),
        seconds: sessionSeconds,
        patientName: currentPatient?.name || null,
        updatedAt: new Date().toISOString(),
      },
    });
  }, 5000);

  // Flush buffered minutes to extension storage every 60s
  setInterval(flushMinutes, 60000);
  window.addEventListener('beforeunload', flushMinutes);

  function flushMinutes() {
    if (activeSeconds < 60) return;
    const minutes = Math.floor(activeSeconds / 60);
    chrome.storage.local.get(['activePatient', 'externalTimeLog'], (data) => {
      const log = data.externalTimeLog || [];
      const patient = currentPatient || data.activePatient || null;
      log.push({
        site: siteName,
        minutes,
        patientId: patient?.id || null,
        patientName: patient?.name || null,
        timestamp: new Date().toISOString(),
      });
      chrome.storage.local.set({ externalTimeLog: log });
      activeSeconds = activeSeconds % 60;
    });
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function updateBadgeTime() {
    const t = document.getElementById('cs-tracking-time');
    if (t) t.textContent = formatTime(sessionSeconds);
  }

  // ---------- Patient detection ----------
  // Best-effort scrape per site. Returns string or null.
  function cleanName(s) {
    if (!s) return null;
    let v = String(s).replace(/\s+/g, ' ').trim();
    // strip trailing DOB / MRN / age / sex annotations
    v = v.replace(/\s*[\|\u2022\-\u2013\u2014].*$/, '').trim();
    v = v.replace(/\s*\(.*?\)\s*$/, '').trim();
    v = v.replace(/\s*(DOB|MRN|Age|Male|Female)\b.*$/i, '').trim();
    if (v.length < 2 || v.length > 80) return null;
    // must look like a name (has a letter)
    if (!/[A-Za-z]/.test(v)) return null;
    return v;
  }

  function tryFromTitle() {
    const t = document.title || '';
    // Common patterns: "First Last - Practice Fusion", "First Last | Updox", etc.
    const m = t.match(/^(.+?)\s*[\-\|\u2013\u2014]\s*(?:Chart|Summary|Patient|Practice Fusion|Updox|CoverMyMeds|Impact)/i);
    if (m) {
      const v = cleanName(m[1]);
      if (v) return v;
    }
    return null;
  }

  function trySelectors(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        // Take first non-empty line and strip noise (DOB/MRN/PRN/Age/Sex)
        const raw = el.textContent.trim().split('\n')[0].trim();
        const stripped = raw.replace(/\s+(PRN|prn|FMH|MRN|DOB|Age|Male|Female).*$/i, '').trim();
        const v = cleanName(stripped);
        if (v) return v;
      } catch (_) { /* ignore */ }
    }
    return null;
  }

  function detectPatientFromPage() {
    try {
      if (siteName === 'Practice Fusion') {
        const v = trySelectors([
          '[class*="patient-demographics"] [class*="name"]',
          '[class*="patient-header"] [class*="name"]',
          '.patient-info-header',
          '[class*="patient-demographics"]',
          '[class*="patient-header"]',
          '[data-element="patient-name"]',
          '[data-test-id*="patient-name"]',
          '[data-testid*="patient-name"]',
          '.patient-name',
          '.pf-patient-name',
          '[class*="PatientName"]',
          '[class*="patientName"]',
          '.patient-banner',
          '#patient-header-name',
          '.patient-context-tab.active',
          '[class*="patient-tab"][class*="active"]',
        ]);
        if (v) return v;
        return tryFromTitle();
      }
      if (siteName === 'Updox') {
        const v = trySelectors([
          '[class*="patient-name"]',
          '[class*="PatientName"]',
          '[data-test*="patient-name"]',
          '[data-testid*="patient-name"]',
          '.patient-banner',
          '.patient-header',
          'h1.patient',
          'header [class*="patient"]',
        ]);
        if (v) return v;
        return tryFromTitle();
      }
      if (siteName === 'CoverMyMeds') {
        const v = trySelectors([
          '[data-cy*="patient-name"]',
          '[data-cy*="PatientName"]',
          '[data-testid*="patient-name"]',
          '[class*="patient-name"]',
          '[class*="PatientName"]',
          '[class*="patient-header"] [class*="name"]',
          '[class*="request-header"] [class*="patient"]',
          'h1[class*="patient"]',
        ]);
        if (v) return v;
        return tryFromTitle();
      }
      if (siteName === 'Impact RPM') {
        const v = trySelectors([
          '[data-testid*="patient-name"]',
          '[data-test*="patient-name"]',
          '[class*="patient-name"]',
          '[class*="PatientName"]',
          '[class*="patient-header"] [class*="name"]',
          '[class*="patient-profile"] h1',
          '[class*="patient-profile"] h2',
          '[class*="patient-info"] h1',
          '[class*="patient-info"] h2',
          '.patient-banner',
          'h1.patient, h2.patient',
          'header h1',
        ]);
        if (v) return v;
        return tryFromTitle();
      }
      if (siteName === 'Microsoft Teams') {
        const v = trySelectors([
          '[data-tid="chat-pane-header-title"]',
          '[data-tid="chat-header-title"]',
          '.ts-title-text',
        ]);
        if (v) return v;
      }
    } catch (_) { /* noop */ }
    return null;
  }

  function setPatient(name, persist = true) {
    if (!name) {
      currentPatient = null;
    } else {
      currentPatient = { id: null, name };
    }
    const input = document.getElementById('cs-patient-input');
    if (input && input.value !== (name || '')) input.value = name || '';
    if (persist) {
      chrome.storage.local.set({ activePatient: currentPatient });
    }
    syncActivePatient();
  }

  // Resolve the detected name into a ChartFlo patient_id and link it to the
  // active dispatch job (if a share code is loaded in the popup). Updates
  // chrome.storage.local.activePatient so downstream uploads attach to the
  // correct record. Throttled so SPA scrapes don't spam the endpoint.
  let lastSyncedName = null;
  let syncInFlight = false;
  async function syncActivePatient() {
    if (syncInFlight) return;
    const name = currentPatient?.name || null;
    if (!name) return;
    if (name === lastSyncedName) return;
    syncInFlight = true;
    try {
      const { csQueueAuth, csLastDispatchCode } = await new Promise((res) =>
        chrome.storage.local.get(['csQueueAuth', 'csLastDispatchCode'], res),
      );
      const token = csQueueAuth?.token;
      if (!token) return; // user hasn't paired the extension yet
      const resp = await fetch(RESOLVE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name,
          shareCode: csLastDispatchCode || '',
          site: siteName,
        }),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const linked = {
        id: data.patientId || null,
        name: data.patientName || name,
        mrn: data.mrn || null,
        dob: data.dob || null,
        jobId: data.jobId || null,
        batchId: data.batchId || null,
        site: siteName,
        manual: currentPatient?.manual || false,
      };
      currentPatient = linked;
      lastSyncedName = name;
      chrome.storage.local.set({ activePatient: linked });
      // Reflect the resolved status in the badge if present
      const dot = document.querySelector('#cs-tracking-badge .cs-tracking-dot');
      if (dot) {
        dot.style.background = data.patientId
          ? '#10b981'
          : data.jobId
            ? '#f59e0b'
            : '#ef4444';
        dot.title = data.patientId
          ? `Linked to ChartFlo patient${data.jobId ? ' + dispatch job' : ''}`
          : data.jobId
            ? 'Linked to dispatch job (no ChartFlo patient match)'
            : 'No ChartFlo patient match';
      }
    } catch (_) {
      /* network/offline — ignore */
    } finally {
      syncInFlight = false;
    }
  }

  // Periodically try to auto-detect (SPA pages change content without nav)
  setInterval(() => {
    if (currentPatient && currentPatient.manual) return;
    const detected = detectPatientFromPage();
    if (detected && detected !== currentPatient?.name) {
      currentPatient = { id: null, name: detected, manual: false };
      const input = document.getElementById('cs-patient-input');
      if (input && document.activeElement !== input) input.value = detected;
      chrome.storage.local.set({ activePatient: currentPatient });
      syncActivePatient();
    }
  }, 1500);

  // Re-detect on URL changes (PF is an SPA)
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (currentPatient && !currentPatient.manual) {
        currentPatient = null;
        lastSyncedName = null;
      }
      setTimeout(() => {
        if (currentPatient?.manual) return;
        const detected = detectPatientFromPage();
        if (detected) {
          currentPatient = { id: null, name: detected, manual: false };
          const input = document.getElementById('cs-patient-input');
          if (input && document.activeElement !== input) input.value = detected;
          chrome.storage.local.set({ activePatient: currentPatient });
          syncActivePatient();
        }
      }, 800);
    }
  }, 800);

  // ---------- Badge UI ----------
  function createTrackingBadge() {
    if (document.getElementById('cs-tracking-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'cs-tracking-badge';
    badge.className = 'cs-tracking-badge';
    badge.innerHTML = `
      <div class="cs-tracking-row">
        <div class="cs-tracking-dot"></div>
        <span class="cs-tracking-label">Chart Scribe · ${siteName}</span>
        <span id="cs-tracking-time" class="cs-tracking-time">0:00</span>
        <button id="cs-tracking-collapse" class="cs-tracking-toggle" title="Collapse">–</button>
      </div>
      <div class="cs-patient-row">
        <label for="cs-patient-input">Patient</label>
        <input id="cs-patient-input" class="cs-patient-input" type="text" placeholder="Type or auto-detected name" />
      </div>
      <div class="cs-tracking-actions">
        <button id="cs-ai-assist-btn" class="cs-tracking-btn">✨ Ask Claude to log</button>
      </div>
      <div id="cs-ai-panel" class="cs-ai-panel" style="display:none">
        <textarea id="cs-ai-input" placeholder="Optional: what did you do? (e.g. reviewed labs, called pharmacy)"></textarea>
        <div class="cs-ai-row">
          <button id="cs-ai-go" class="cs-tracking-btn cs-primary">Generate note</button>
          <button id="cs-ai-close" class="cs-tracking-btn">Cancel</button>
        </div>
        <div id="cs-ai-output" class="cs-ai-output" style="display:none"></div>
      </div>
    `;
    document.body.appendChild(badge);

    // Restore stored patient
    chrome.storage.local.get(['activePatient'], (d) => {
      if (d.activePatient?.name) {
        currentPatient = d.activePatient;
        const input = document.getElementById('cs-patient-input');
        if (input) input.value = d.activePatient.name;
      } else {
        const detected = detectPatientFromPage();
        if (detected) setPatient(detected);
      }
    });

    document.getElementById('cs-patient-input').addEventListener('change', (e) => {
      const v = e.target.value.trim();
      currentPatient = v ? { id: null, name: v, manual: true } : null;
      lastSyncedName = null;
      chrome.storage.local.set({ activePatient: currentPatient });
      syncActivePatient();
    });

    document.getElementById('cs-tracking-collapse').addEventListener('click', (e) => {
      const b = document.getElementById('cs-tracking-badge');
      const collapsed = b.classList.toggle('cs-collapsed');
      e.currentTarget.textContent = collapsed ? '+' : '–';
    });

    document.getElementById('cs-ai-assist-btn')
      .addEventListener('click', () => togglePanel(true));
    document.getElementById('cs-ai-close')
      .addEventListener('click', () => togglePanel(false));
    document.getElementById('cs-ai-go')
      .addEventListener('click', runAssist);
  }

  function togglePanel(show) {
    const p = document.getElementById('cs-ai-panel');
    if (p) p.style.display = show ? 'block' : 'none';
  }

  async function runAssist() {
    const out = document.getElementById('cs-ai-output');
    const goBtn = document.getElementById('cs-ai-go');
    const userNote = document.getElementById('cs-ai-input').value.trim();
    const minutes = Math.max(1, Math.round(sessionSeconds / 60));

    out.style.display = 'block';
    out.innerHTML = '<em>Asking Claude…</em>';
    goBtn.disabled = true;

    chrome.storage.local.get(['activePatient', 'externalTimeLog'], async (data) => {
      const patient = currentPatient || data.activePatient || null;
      try {
        const resp = await fetch(AI_ASSIST_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            site: siteName,
            minutes,
            patientName: patient?.name || null,
            recentLog: (data.externalTimeLog || []).slice(-5),
            userNote,
          }),
        });
        const json = await resp.json();
        if (!resp.ok) throw new Error(json?.error || 'AI error');

        const activities = (json.activities || []).map(a => `• ${a}`).join('<br>');
        const note = json.note || '';
        out.innerHTML = `
          <div class="cs-ai-section"><strong>Patient</strong><br>${escapeHtml(patient?.name || 'Unassigned')}</div>
          <div class="cs-ai-section"><strong>Activities</strong><br>${activities || '<em>None suggested</em>'}</div>
          <div class="cs-ai-section"><strong>Note</strong><br>${escapeHtml(note)}</div>
          <div class="cs-ai-row">
            <button id="cs-ai-save" class="cs-tracking-btn cs-primary">Save ${minutes} min to log</button>
            <button id="cs-ai-copy" class="cs-tracking-btn">Copy note</button>
          </div>
        `;
        document.getElementById('cs-ai-copy').addEventListener('click', () => {
          navigator.clipboard.writeText(`${activities.replace(/<br>/g,'\n')}\n\n${note}`);
        });
        document.getElementById('cs-ai-save').addEventListener('click', () => {
          chrome.storage.local.get(['externalTimeLog'], (d) => {
            const log = d.externalTimeLog || [];
            log.push({
              site: siteName,
              minutes,
              patientId: patient?.id || null,
              patientName: patient?.name || null,
              activities: json.activities || [],
              note,
              timestamp: new Date().toISOString(),
              source: 'ai-assist',
            });
            chrome.storage.local.set({ externalTimeLog: log }, () => {
              sessionSeconds = 0;
              activeSeconds = 0;
              updateBadgeTime();
              out.innerHTML = '<strong>Saved ✓</strong>';
              setTimeout(() => togglePanel(false), 1200);
            });
          });
        });
      } catch (err) {
        out.innerHTML = `<span style="color:#ef4444">Error: ${escapeHtml(String(err.message || err))}</span>`;
      } finally {
        goBtn.disabled = false;
      }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  createTrackingBadge();

  // Keep badge alive across SPA navigations
  const observer = new MutationObserver(() => {
    if (!document.getElementById('cs-tracking-badge')) createTrackingBadge();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
