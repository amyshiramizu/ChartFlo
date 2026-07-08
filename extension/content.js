// Chart Scribe → Practice Fusion content script.
// Recognizes SOAP section inputs by label/aria/placeholder/id heuristics and fills them.

const SECTION_KEYS = {
  subjective: [/\bsubjective\b/i, /\bhpi\b/i, /history of present illness/i, /chief complaint/i, /\bcc\b/i, /\bros\b/i, /review of systems/i],
  objective:  [/\bobjective\b/i, /physical exam/i, /\bexam\b/i, /\bvitals?\b/i],
  assessment: [/\bassessment\b/i, /\bdiagnos[ei]s\b/i, /\bimpression\b/i, /\bicd[- ]?10\b/i],
  plan:       [/\bplan\b/i, /\borders?\b/i, /follow[- ]?up/i, /treatment plan/i],
};

function isEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return !el.disabled && !el.readOnly;
  if (tag === 'INPUT') {
    const t = (el.type || 'text').toLowerCase();
    return ['text','search',''].includes(t) && !el.disabled && !el.readOnly;
  }
  if (el.isContentEditable) return true;
  return false;
}

function labelTextFor(el) {
  const bits = [];
  if (el.id) {
    const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lab) bits.push(lab.innerText);
  }
  const wrap = el.closest('label');
  if (wrap) bits.push(wrap.innerText);
  const aria = el.getAttribute('aria-label'); if (aria) bits.push(aria);
  const ph = el.getAttribute('placeholder'); if (ph) bits.push(ph);
  const name = el.getAttribute('name'); if (name) bits.push(name);
  const ttl = el.getAttribute('title'); if (ttl) bits.push(ttl);
  if (el.id) bits.push(el.id);
  // climb up to 4 ancestors for a section heading
  let p = el.parentElement, hops = 0;
  while (p && hops < 4) {
    const heading = p.querySelector('h1,h2,h3,h4,h5,legend,[role="heading"],.section-title,.field-label');
    if (heading && heading.innerText && heading.innerText.length < 80) bits.push(heading.innerText);
    p = p.parentElement; hops++;
  }
  return bits.join(' | ');
}

function classifyEl(el) {
  const text = labelTextFor(el);
  if (!text) return null;
  for (const [key, patterns] of Object.entries(SECTION_KEYS)) {
    if (patterns.some((re) => re.test(text))) return key;
  }
  return null;
}

function collectCandidates() {
  const all = Array.from(document.querySelectorAll('textarea, input, [contenteditable="true"], [contenteditable=""]'));
  const map = {};
  for (const el of all) {
    if (!isEditable(el)) continue;
    const key = classifyEl(el);
    if (!key) continue;
    // prefer textareas / contenteditable over single-line inputs
    const score = el.tagName === 'TEXTAREA' ? 3 : el.isContentEditable ? 2 : 1;
    const prev = map[key];
    if (!prev || score > prev.score) map[key] = { el, score };
  }
  return map;
}

function setValue(el, value) {
  if (el.isContentEditable) {
    el.focus();
    // append a newline if existing content present
    const existing = el.innerText.trim();
    const next = existing ? existing + '\n\n' + value : value;
    el.innerText = next;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  const existing = el.value ? el.value.trim() : '';
  const next = existing ? existing + '\n\n' + value : value;
  setter.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function flash(el) {
  el.classList.add('cs-pf-flash');
  setTimeout(() => el.classList.remove('cs-pf-flash'), 1200);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'detect') {
    const map = collectCandidates();
    const found = [];
    for (const [key, { el }] of Object.entries(map)) {
      el.classList.add('cs-pf-detected');
      setTimeout(() => el.classList.remove('cs-pf-detected'), 2500);
      found.push(key);
    }
    sendResponse({ found });
    return true;
  }
  if (msg.action === 'push') {
    const res = pushPayload(msg.payload || {});
    sendResponse(res);
    return true;
  }
});

function pushPayload(payload) {
  const map = collectCandidates();
  const filled = [], missed = [];
  for (const [key, value] of Object.entries(payload)) {
    if (!value) continue;
    const target = map[key];
    if (!target) { missed.push(key); continue; }
    try { setValue(target.el, value); flash(target.el); filled.push(key); }
    catch { missed.push(key); }
  }
  return { filled, missed };
}

// ---------- In-page Chart-Notes-style importer ----------
// A floating button that pulls the latest Chart Scribe draft from
// chrome.storage.local (kept current by the web app via background.js)
// and one-click fills the open Practice Fusion SOAP form. Also lets the
// provider insert the live tracked minutes into the Plan section.

(function initImporter() {
  if (window.top !== window.self) return;
  if (!location.hostname.includes('practicefusion.com')) return;
  if (document.getElementById('cs-importer-fab')) return;

  const fab = document.createElement('div');
  fab.id = 'cs-importer-fab';
  fab.className = 'cs-importer-fab';
  fab.innerHTML = `
    <button id="cs-imp-main" class="cs-imp-main" title="Import Chart Scribe note into this encounter">
      <span class="cs-imp-icon">📋</span>
      <span class="cs-imp-label">Import Chart Scribe note</span>
    </button>
    <div id="cs-imp-meta" class="cs-imp-meta">No draft yet</div>
    <div class="cs-imp-actions">
      <button id="cs-imp-minutes" class="cs-imp-mini" title="Append tracked minutes to Plan">+ Minutes</button>
      <button id="cs-imp-refresh" class="cs-imp-mini" title="Refresh draft">↻</button>
      <button id="cs-imp-hide" class="cs-imp-mini" title="Hide">×</button>
    </div>
  `;
  document.body.appendChild(fab);

  const $ = (id) => document.getElementById(id);

  function renderMeta(meta, draft) {
    const el = $('cs-imp-meta');
    if (!el) return;
    if (!draft || !Object.values(draft).some(Boolean)) {
      el.textContent = 'No Chart Scribe draft yet — send a note from the app.';
      return;
    }
    const parts = [];
    if (meta?.patientName) parts.push(meta.patientName);
    if (meta?.mrn) parts.push(`MRN ${meta.mrn}`);
    if (meta?.updatedAt) {
      const t = new Date(meta.updatedAt);
      parts.push(t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }
    el.textContent = parts.length ? `Ready: ${parts.join(' · ')}` : 'Draft ready';
  }

  function loadAndRender() {
    chrome.storage.local.get(['draft', 'draftMeta'], (d) => {
      renderMeta(d.draftMeta, d.draft);
    });
  }
  loadAndRender();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.draft || changes.draftMeta) loadAndRender();
  });

  $('cs-imp-main').addEventListener('click', () => {
    chrome.storage.local.get(['draft'], (d) => {
      const draft = d.draft || {};
      const payload = {
        subjective: draft.subjective || '',
        objective: draft.objective || '',
        assessment: draft.assessment || '',
        plan: draft.plan || '',
      };
      if (!Object.values(payload).some(Boolean)) {
        toast('No Chart Scribe note to import yet.', true);
        return;
      }
      const res = pushPayload(payload);
      if (res.filled?.length) {
        toast(`Imported: ${res.filled.join(', ')}${res.missed?.length ? ' · missed ' + res.missed.join(', ') : ''}`);
      } else {
        toast('No matching SOAP fields found on this page.', true);
      }
    });
  });

  $('cs-imp-minutes').addEventListener('click', () => {
    chrome.storage.local.get(['csSessionMinutes', 'activePatient'], (d) => {
      const minutes = Number(d.csSessionMinutes?.minutes) || 0;
      if (minutes <= 0) {
        toast('No tracked minutes yet for this session.', true);
        return;
      }
      const map = collectCandidates();
      const target = map.plan || map.assessment;
      if (!target) {
        toast('No Plan/Assessment field to append minutes to.', true);
        return;
      }
      const stamp = new Date().toLocaleDateString();
      const who = d.activePatient?.name ? ` for ${d.activePatient.name}` : '';
      const line = `\n\nTime spent${who}: ${minutes} minute${minutes === 1 ? '' : 's'} of non-face-to-face care coordination on ${stamp} (tracked by Chart Scribe).`;
      try { setValue(target.el, line.trimStart()); flash(target.el); toast(`Added ${minutes} min to Plan.`); }
      catch { toast('Could not append minutes.', true); }
    });
  });

  $('cs-imp-refresh').addEventListener('click', loadAndRender);
  $('cs-imp-hide').addEventListener('click', () => fab.remove());

  function toast(msg, err = false) {
    const t = document.createElement('div');
    t.className = 'cs-imp-toast' + (err ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // Keep alive across PF SPA navigations
  const obs = new MutationObserver(() => {
    if (!document.getElementById('cs-importer-fab')) {
      // re-inject by re-running this IIFE
      initImporter();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();
// CCM Documentation Generator - Content Script for Practice Fusion
// Complete workflow: Search -> Open Chart -> Select Encounter -> Open Note -> Insert -> Save -> Return
// VERSION 3 - Fixed patient search and navigation issues

(function() {
  console.log('CCM Pro Assistant v3.0.0: Content script loaded on', window.location.href);

  // Remove previous message handler if it exists (prevents stale listener on re-injection)
  if (window.__ccmMainHandler) {
    chrome.runtime.onMessage.removeListener(window.__ccmMainHandler);
    console.log('CCM Extension: Removed previous main handler');
  }

  // Skip re-initializing DOM/helper functions if already loaded
  // (only the message handler gets replaced on re-injection)
  const alreadyLoaded = !!window.ccmExtensionLoaded;
  window.ccmExtensionLoaded = true;

  // Define the message handler (will be stored on window for future removal)
  window.__ccmMainHandler = function(request, sender, sendResponse) {
    console.log('CCM Extension: Received message:', request.action);
    
    // Handle ping
    if (request.action === 'ping') {
      sendResponse({ success: true, message: 'Content script is loaded' });
      return true;
    }
    
    // Handle insertText
    if (request.action === 'insertText') {
      console.log('CCM Extension: Handling insertText');
      const result = insertTextIntoActiveElement(request.text);
      sendResponse(result);
      return true;
    }
    
    // Step 1: Search for patient and open their chart
    if (request.action === 'searchPatient') {
      console.log('CCM Extension: === STARTING searchPatient for:', request.patientName);
      searchAndOpenPatient(request.patientName)
        .then(result => {
          console.log('CCM Extension: searchPatient result:', result);
          sendResponse(result);
        })
        .catch(err => {
          console.error('CCM Extension: searchPatient ERROR:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
    
    // Combined Steps 2-4: Open CCM encounter, navigate to note, insert text
    if (request.action === 'openAndInsertCCM') {
      console.log('CCM Extension: === STARTING openAndInsertCCM for:', request.patientName);
      openCcmNoteAndInsert(request.text, request.patientName, request.dateOfService)
        .then(result => {
          console.log('CCM Extension: openAndInsertCCM result:', result);
          sendResponse(result);
        })
        .catch(err => {
          console.error('CCM Extension: openAndInsertCCM ERROR:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
    
    // Step 2: Select the current month's CCM encounter (standalone)
    if (request.action === 'openCurrentMonthCCMEncounter') {
      console.log('CCM Extension: === STARTING openCurrentMonthCCMEncounter');
      openCurrentMonthCCMEncounter(request.dateOfService)
        .then(result => {
          console.log('CCM Extension: openCurrentMonthCCMEncounter result:', result);
          sendResponse(result);
        })
        .catch(err => {
          console.error('CCM Extension: openCurrentMonthCCMEncounter ERROR:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
    
    // Step 3: Navigate to the CCM note editor via "Go to..." dropdown
    if (request.action === 'navigateToCCMNote') {
      console.log('CCM Extension: === STARTING navigateToCCMNote');
      navigateToCCMNote()
        .then(result => {
          console.log('CCM Extension: navigateToCCMNote result:', result);
          sendResponse(result);
        })
        .catch(err => {
          console.error('CCM Extension: navigateToCCMNote ERROR:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
    
    // Step 4: Insert the narrative text
    if (request.action === 'insertCCMNote') {
      console.log('CCM Extension: === STARTING insertCCMNote');
      insertCCMNoteText(request.text)
        .then(result => {
          console.log('CCM Extension: insertCCMNote result:', result);
          sendResponse(result);
        })
        .catch(err => {
          console.error('CCM Extension: insertCCMNote ERROR:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
    
    // Step 5: Save the note
    if (request.action === 'saveCCMNote') {
      console.log('CCM Extension: === STARTING saveCCMNote');
      saveCCMNote()
        .then(result => {
          console.log('CCM Extension: saveCCMNote result:', result);
          sendResponse(result);
        })
        .catch(err => {
          console.error('CCM Extension: saveCCMNote ERROR:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
    
    // Step 6: Return to patient list
    if (request.action === 'goBackToCharts') {
      console.log('CCM Extension: === STARTING goBackToCharts');
      goBackToChartsPage()
        .then(result => {
          console.log('CCM Extension: goBackToCharts result:', result);
          sendResponse(result);
        })
        .catch(err => {
          console.error('CCM Extension: goBackToCharts ERROR:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }
    
    // Clear search input and filters
    if (request.action === 'clearSearch') {
      console.log('CCM Extension: === STARTING clearSearch');
      clearSearchAndFilters()
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    
    // Get current patient info for detection
    if (request.action === 'getPatientInfo') {
      const info = detectCurrentPatient();
      sendResponse(info);
      return true;
    }
    
    // ── COPY FORWARD WORKFLOW HANDLERS ──
    
    // Get "Seen By" provider from a CCM encounter row on the Timeline
    if (request.action === 'ccm_getTimelineSeenBy') {
      console.log('CCM Extension: === ccm_getTimelineSeenBy for', request.month, request.year);
      getTimelineSeenBy(request.month, request.year)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    
    // Extract note content for copy-forward (up to cutoff marker)
    if (request.action === 'ccm_extractNoteForForward') {
      console.log('CCM Extension: === ccm_extractNoteForForward');
      extractNoteForCopyForward()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    
    // Navigate to Timeline tab (from encounter page)
    if (request.action === 'ccm_goToTimeline') {
      console.log('CCM Extension: === ccm_goToTimeline');
      goToTimelineTab()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    
    // Click "New encounter" button on Timeline
    if (request.action === 'ccm_clickNewEncounter') {
      console.log('CCM Extension: === ccm_clickNewEncounter');
      clickNewEncounterButton()
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    
    // Fill new encounter form fields
    if (request.action === 'ccm_fillEncounterForm') {
      console.log('CCM Extension: === ccm_fillEncounterForm');
      fillNewEncounterForm(request)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    // Insert HTML content into note editor (preserves formatting)
    if (request.action === 'ccm_insertNoteHTML') {
      console.log('CCM Extension: === ccm_insertNoteHTML');
      insertNoteHTML(request.html)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    
    console.log('CCM Extension: Unknown action:', request.action);
    return true;
  };

  // Register the handler
  chrome.runtime.onMessage.addListener(window.__ccmMainHandler);
  console.log('CCM Extension: Main message handler registered');

  // ============================================
  // HELPER FUNCTIONS
  // ============================================

  async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getCurrentMonthYear() {
    return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }).toLowerCase();
  }

  function getCurrentMonthName() {
    return new Date().toLocaleString('en-US', { month: 'long' }).toLowerCase();
  }

  /**
   * Check if text contains a "Total Time" marker for CCM notes.
   * Handles all known variations: "Total CCM Time", "Total Monthly Time:", 
   * "Total Monthly CCM Minutes:", etc.
   */
  function hasTotalTimeMarker(text) {
    return /Total\s+(?:CCM\s+)?(?:Monthly\s+)?(?:CCM\s+)?(?:Time|Minutes?)/i.test(text);
  }
  // Expose for MC IIFE access
  window.__hasTotalTimeMarker = hasTotalTimeMarker;

  /**
   * Find the text node containing a Total Time marker within an element.
   * Returns the text node, or null.
   */
  function findTotalTimeTextNode(rootEl) {
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
      if (hasTotalTimeMarker(node.textContent)) return node;
    }
    return null;
  }

  // ============================================
  // PAGE DETECTION FUNCTIONS
  // ============================================

  /**
   * Check if we're on the patient list/charts page
   */
  function isOnPatientListPage() {
    // Check URL patterns
    const url = window.location.href.toLowerCase();
    if (url.includes('/charts/list') || 
        url.includes('/charts/all') ||
        url.includes('/charts/patients') ||  // Added this pattern
        url.includes('charts/list')) {
      return true;
    }
    
    // Check for search input (primary indicator of patient list)
    const searchInput = document.querySelector(
      'input[placeholder*="Search all patients"],' +
      'input[placeholder*="search all patients"],' +
      'input[placeholder*="Search patients"]'
    );
    
    if (searchInput && searchInput.offsetParent !== null) {
      return true;
    }
    
    // Check for "Patient lists" text in the page
    const pageText = document.body.innerText;
    if (pageText.includes('Patient lists') && searchInput) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if we're on an individual patient's chart
   */
  function isOnPatientChartPage() {
    const url = window.location.href.toLowerCase();
    
    // Check for patient chart URL patterns
    if (url.includes('/patient/') || url.includes('/encounter/')) {
      return true;
    }
    
    // Look for patient header elements that indicate we're viewing a specific patient
    const patientHeader = document.querySelector(
      '[class*="patient-demographics"],' +
      '[class*="patient-header"],' +
      '.patient-info-header'
    );
    
    // Also check for PRN number display (patient record number)
    const prnDisplay = document.querySelector('[class*="prn"], [data-element*="prn"]');
    
    if (patientHeader || prnDisplay) {
      // But make sure we're not on the list page
      if (!isOnPatientListPage()) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Check if we're on a login page
   */
  function isOnLoginPage() {
    // Check URL for login patterns
    const url = window.location.href.toLowerCase();
    if (url.includes('/login') || url.includes('/signin') || url.includes('/auth')) {
      return true;
    }
    
    // Only consider it a login page if there's a visible password field 
    // AND we're NOT on a Practice Fusion app page
    if (url.includes('practicefusion.com/apps/')) {
      // We're in the app, so it's not a login page even if there's a password field somewhere
      return false;
    }
    
    const passwordInput = document.querySelector('input[type="password"]');
    const loginForm = document.querySelector('form[action*="login"], form[action*="Login"]');
    
    // Check if password field is visible and prominent
    if (passwordInput && passwordInput.offsetParent !== null) {
      // Make sure this isn't just a password field in some settings area
      // by checking if the page title or content suggests login
      const pageText = document.body.innerText.toLowerCase();
      if (pageText.includes('sign in') || pageText.includes('log in') || pageText.includes('password')) {
        return true;
      }
    }
    
    if (loginForm) {
      return true;
    }
    
    return false;
  }

  // ============================================
  // NAME MATCHING FUNCTIONS
  // ============================================

  /**
   * Normalize a name for comparison
   */
  function normalizeName(name) {
    if (!name) return '';
    let normalized = name.trim().toUpperCase().replace(/\s+/g, ' ');
    
    // If name is in "LAST, FIRST" format, convert to "FIRST LAST"
    if (normalized.includes(',')) {
      const parts = normalized.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        normalized = parts[1] + ' ' + parts[0];
      }
    }
    return normalized;
  }

  /**
   * Extract name parts, handling quoted nicknames like Gerald "Brent" Forsgren
   */
  function getNameParts(name) {
    if (!name) return { full: '', parts: [], first: '', last: '', original: [], nickname: '' };
    
    // Extract nickname in quotes (e.g., "Brent" from Gerald "Brent" Forsgren)
    let nickname = '';
    const nickMatch = name.match(/["'\u201C\u201D]([^"'\u201C\u201D]+)["'\u201C\u201D]/);
    if (nickMatch) {
      nickname = nickMatch[1].trim().toUpperCase();
    }
    
    // Strip quoted nickname for normalization
    const cleanName = name.replace(/["'\u201C\u201D][^"'\u201C\u201D]*["'\u201C\u201D]/g, ' ').trim();
    
    const normalized = normalizeName(cleanName);
    const parts = normalized.split(' ').filter(p => p.length > 0);
    return {
      full: normalized,
      parts: parts,
      first: parts[0] || '',
      last: parts[parts.length - 1] || '',
      original: name.trim().toUpperCase().split(/[\s,]+/).filter(p => p.length > 0),
      nickname: nickname  // "BRENT" — can be used for middle initial matching
    };
  }

  /**
   * Calculate match score between search name and found name
   * IMPROVED: Requires BOTH first AND last name to match for high scores
   */
  function nameMatchScore(searchName, foundName) {
    const search = getNameParts(searchName);
    const found = getNameParts(foundName);
    
    // Skip if found name is too short (like just "L" or initials)
    if (found.full.length < 3) {
      return 0;
    }
    
    let score = 0;
    
    // Exact full match (after normalization)
    if (search.full === found.full) {
      return 100;
    }
    
    // Count how many search parts are found
    let firstNameMatch = false;
    let lastNameMatch = false;
    
    // Check first name
    if (search.first && search.first.length >= 2) {
      for (const foundPart of found.parts) {
        if (foundPart === search.first) {
          firstNameMatch = true;
          score += 40;
          break;
        } else if (foundPart.startsWith(search.first) || search.first.startsWith(foundPart)) {
          // Partial match (e.g., "NORINE" matches "NORIN")
          if (foundPart.length >= 3) {
            firstNameMatch = true;
            score += 30;
            break;
          }
        }
      }
    }
    
    // Check last name
    if (search.last && search.last.length >= 2) {
      for (const foundPart of found.parts) {
        if (foundPart === search.last) {
          lastNameMatch = true;
          score += 40;
          break;
        } else if (foundPart.startsWith(search.last) || search.last.startsWith(foundPart)) {
          if (foundPart.length >= 3) {
            lastNameMatch = true;
            score += 30;
            break;
          }
        }
      }
    }
    
    // Check nickname match: if search has "Brent" and found has "B" (middle initial)
    if (search.nickname && !firstNameMatch) {
      for (const foundPart of found.parts) {
        if (foundPart === search.nickname) {
          score += 15; // Full nickname match in chart name
          break;
        } else if (foundPart.length === 1 && search.nickname.startsWith(foundPart)) {
          score += 10; // Middle initial matches nickname first letter
          break;
        }
      }
    }
    
    // CRITICAL: For a good match, we need BOTH first and last name
    if (search.parts.length >= 2 && (!firstNameMatch || !lastNameMatch)) {
      score = Math.min(score, 25);
    }
    
    // Bonus for exact word boundary matches
    if (firstNameMatch && lastNameMatch) {
      score += 20;
    }
    
    return score;
  }

  // ============================================
  // STEP 1: SEARCH FOR PATIENT AND OPEN CHART
  // ============================================

  // Ember/React track inputs via a native value setter; a direct `el.value = x`
  // is ignored. Use the prototype setter + a real InputEvent so PF registers it.
  function setNativeValue(input, value) {
    try {
      const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (desc && desc.set) desc.set.call(input, value);
      else input.value = value;
    } catch (e) { input.value = value; }
  }

  async function hardClearSearchInput(input) {
    if (!input) return;
    input.focus();
    try { input.setSelectionRange(0, (input.value || '').length); } catch (e) {}
    // Ctrl/Cmd+A then delete — Ember reliably registers keyboard-driven clears
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', ctrlKey: true, metaKey: true }));
    setNativeValue(input, '');
    try {
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    } catch (e) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Backspace', keyCode: 8 }));
    await sleep(150);
  }

  async function typeNativeSearch(input, term) {
    if (!input) return;
    input.focus();
    setNativeValue(input, '');
    try { input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })); } catch (e) {}
    await sleep(80);
    // Type character by character so the framework's search model updates
    let acc = '';
    for (const ch of term) {
      acc += ch;
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch }));
      setNativeValue(input, acc);
      try { input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch })); }
      catch (e) { input.dispatchEvent(new Event('input', { bubbles: true })); }
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
      await sleep(25);
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function searchAndOpenPatient(patientName) {
    try {
      // Skip if we're in an iframe - only operate on main frame
      if (window !== window.top) {
        console.log('CCM Extension: Skipping - running in iframe, not main frame');
        // Return success to prevent error, but don't do anything
        return { success: false, error: 'Running in iframe - waiting for main frame', isIframe: true };
      }

      console.log('=== STEP 1: Searching for patient ===');
      console.log('Patient name:', patientName);
      console.log('Current URL:', window.location.href);

      // First, check what page we're on
      if (isOnLoginPage()) {
        console.log('ERROR: On login page');
        return { success: false, error: 'On login page - please log in first' };
      }

      // Check if we need to navigate to patient list first
      if (!isOnPatientListPage()) {
        console.log('Not on patient list page, checking if on patient chart...');
        
        if (isOnPatientChartPage()) {
          // Check if this is the CORRECT patient
          const pageText = document.body.innerText.toUpperCase();
          const searchParts = getNameParts(patientName);
          
          const hasFirst = searchParts.first && pageText.includes(searchParts.first);
          const hasLast = searchParts.last && pageText.includes(searchParts.last);
          
          if (hasFirst && hasLast) {
            console.log('Already on correct patient chart');
            return { success: true, message: 'Already on correct patient chart' };
          } else {
            console.log('On wrong patient chart, need to go back to list');
            return { success: false, error: 'On wrong patient chart. Please navigate to Patient Lists first.' };
          }
        }
        
        return { success: false, error: 'Not on Charts page. Please navigate to Patient Lists first.' };
      }

      // Find the search input - with retry/wait
      console.log('Looking for search input...');
      let searchInput = null;
      let searchAttempts = 0;
      const maxSearchAttempts = 10;
      
      while (!searchInput && searchAttempts < maxSearchAttempts) {
        searchAttempts++;
        
        searchInput =
          document.querySelector('input[placeholder*="Search all patients"]') ||
          document.querySelector('input[placeholder*="search all patients"]') ||
          document.querySelector('input[placeholder*="Search patients"]') ||
          document.querySelector('[data-element="patient-search"] input') ||
          document.querySelector('.patient-search-select input');
        
        if (!searchInput) {
          console.log(`Search input not found, waiting... (attempt ${searchAttempts}/${maxSearchAttempts})`);
          await sleep(1000);
        }
      }

      if (!searchInput) {
        console.log('ERROR: Search input not found after waiting');
        return { success: false, error: 'Search input not found - page may not have loaded. Please try again.' };
      }
      
      console.log('Found search input');

      // Clear and focus the input - MUST CLEAR FILTER CHIPS FIRST
      console.log('Clearing search filters...');
      
      // IMPORTANT: Practice Fusion uses filter chips/tags that must be removed
      // The chips look like "Name: Deanna hales ×" with a small × to click
      let clearedCount = 0;
      const maxClearAttempts = 10; // Prevent infinite loops
      let clearAttempt = 0;
      
      // Keep clearing until no more chips are found
      while (clearAttempt < maxClearAttempts) {
        clearAttempt++;
        let foundChipThisRound = false;
        
        try {
          // Method 1: Find chips by looking for "Name:" or "PRN:" text with × buttons
          const allElements = document.querySelectorAll('span, div, button');
          
          for (const el of allElements) {
            const text = (el.textContent || '').trim();
            
            // Look for filter chips that contain "Name:" or "PRN:"
            if ((text.includes('Name:') || text.includes('PRN:')) && text.includes('×')) {
              // Find the × button within this chip
              const closeBtn = el.querySelector('button, [role="button"], span');
              if (closeBtn) {
                const closeBtnText = (closeBtn.textContent || '').trim();
                if (closeBtnText === '×' || closeBtnText === 'x' || closeBtnText === '✕') {
                  console.log('Clicking × in chip:', text.substring(0, 30));
                  closeBtn.click();
                  clearedCount++;
                  foundChipThisRound = true;
                  await sleep(400);
                  break; // Restart the search after clicking
                }
              }
              
              // If no button found, look for the × in the parent
              const parent = el.parentElement;
              if (parent) {
                const btns = parent.querySelectorAll('button, span, svg');
                for (const btn of btns) {
                  const btnText = (btn.textContent || '').trim();
                  if (btnText === '×' || btnText === 'x' || btnText === '✕') {
                    console.log('Clicking × near chip');
                    btn.click();
                    clearedCount++;
                    foundChipThisRound = true;
                    await sleep(400);
                    break;
                  }
                }
                if (foundChipThisRound) break;
              }
            }
          }
          
          // Method 2: Look for standalone × buttons anywhere
          if (!foundChipThisRound) {
            const allButtons = document.querySelectorAll('button, span, div');
            for (const btn of allButtons) {
              const text = (btn.textContent || '').trim();
              if ((text === '×' || text === '✕' || text === 'x') && btn.offsetParent !== null) {
                // Make sure it's near the search area (within reasonable distance)
                const rect = btn.getBoundingClientRect();
                if (rect.top < 400) { // Near top of page where search is
                  const parent = btn.parentElement;
                  const parentText = (parent?.textContent || '').toLowerCase();
                  if (parentText.includes('name') || parentText.includes('prn')) {
                    console.log('Clicking standalone × button');
                    btn.click();
                    clearedCount++;
                    foundChipThisRound = true;
                    await sleep(400);
                    break;
                  }
                }
              }
            }
          }
          
          // Method 3: Look for the ⊗ clear all button (visible in screenshot)
          if (!foundChipThisRound) {
            const clearAllCandidates = document.querySelectorAll('button, span, div, svg');
            for (const el of clearAllCandidates) {
              const text = (el.textContent || '').trim();
              const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
              
              if (text === '⊗' || text.includes('⊗') || 
                  ariaLabel.includes('clear') || ariaLabel.includes('reset')) {
                const rect = el.getBoundingClientRect();
                if (rect.top < 400) { // Near top of page
                  console.log('Clicking ⊗ clear all button');
                  el.click();
                  clearedCount++;
                  foundChipThisRound = true;
                  await sleep(400);
                  break;
                }
              }
            }
          }
          
          // Method 4: Click parent of × if direct click didn't work
          if (!foundChipThisRound) {
            const xButtons = document.querySelectorAll('*');
            for (const el of xButtons) {
              if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
                const text = el.childNodes[0].textContent.trim();
                if (text === '×' || text === '✕') {
                  const rect = el.getBoundingClientRect();
                  if (rect.top < 400 && rect.top > 0) {
                    console.log('Clicking element containing ×');
                    el.click();
                    clearedCount++;
                    foundChipThisRound = true;
                    await sleep(400);
                    break;
                  }
                }
              }
            }
          }
          
        } catch (e) {
          console.log('Error clearing filters:', e.message);
        }
        
        // If we didn't find any chips this round, we're done
        if (!foundChipThisRound) {
          console.log('No more filter chips found');
          break;
        }
      }
      
      console.log('Cleared', clearedCount, 'filter chips in', clearAttempt, 'attempts');
      await sleep(500);
      
      // Now focus and clear the actual input (native simulation for Ember)
      await hardClearSearchInput(searchInput);

      // Press Escape to close any dropdowns
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', code: 'Escape', keyCode: 27 }));
      
      await sleep(500); // Wait for clear to take effect

      // Get name parts - search with clean name (no quoted nicknames) for best results
      const nameParts = getNameParts(patientName);
      // Strip quoted nicknames from search term (PF doesn't understand them)
      const searchTerm = patientName.replace(/["'\u201C\u201D][^"'\u201C\u201D]*["'\u201C\u201D]/g, ' ').replace(/\s+/g, ' ').trim();
      
      console.log('Typing search term:', searchTerm);
      console.log('Looking for first name:', nameParts.first, 'last name:', nameParts.last);
      if (nameParts.nickname) console.log('Nickname:', nameParts.nickname);
      
      // Type the search term using native keyboard simulation so Ember's
      // search model updates (direct .value assignment is ignored by PF).
      await typeNativeSearch(searchInput, searchTerm);
      
      await sleep(500);
      
      // Now press Enter to submit the search
      console.log('Pressing Enter to search...');
      const enterKeyDown = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13
      });
      const enterKeyPress = new KeyboardEvent('keypress', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13
      });
      const enterKeyUp = new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13
      });
      
      searchInput.dispatchEvent(enterKeyDown);
      searchInput.dispatchEvent(enterKeyPress);
      searchInput.dispatchEvent(enterKeyUp);
      
      // Also try clicking a search button if one exists
      const searchButton = document.querySelector(
        'button[type="submit"], ' +
        'button[aria-label*="search"], ' +
        'button[aria-label*="Search"], ' +
        '.search-button, ' +
        '[data-element*="search"] button'
      );
      if (searchButton) {
        console.log('Found search button, clicking...');
        searchButton.click();
      }

      // Wait for results to filter
      console.log('Waiting for search results...');
      await sleep(3000);

      // Find the best matching patient
      console.log('Looking for patient matches...');
      
      const candidates = [];
      // nameParts already declared above
      
      // Method 1: Check table rows FIRST - look at the full row text
      // This handles cases where first and last name are in separate elements
      const rows = document.querySelectorAll('tbody tr, .charts-list-results tr, tr.ember-view');
      console.log('Table rows found:', rows.length);
      
      for (const row of rows) {
        // Get the FULL row text to check for both first and last name
        const rowText = row.textContent.toUpperCase();
        
        // Check if this row contains BOTH the first name AND last name
        const hasFirst = nameParts.first && rowText.includes(nameParts.first);
        const hasLast = nameParts.last && rowText.includes(nameParts.last);
        
        // Also check nickname match: if search has "Brent" and row has "B" as middle initial
        let hasNickname = false;
        if (nameParts.nickname) {
          // Check if row contains the full nickname OR its first initial as a standalone letter
          hasNickname = rowText.includes(nameParts.nickname) || 
            rowText.includes(' ' + nameParts.nickname[0] + ' ');
        }
        
        if (hasFirst && hasLast) {
          console.log('Found row with both names:', rowText.substring(0, 80));
          
          // Find a clickable element in this row (the name link)
          const clickable = row.querySelector(
            'div.text-color-link, ' +
            'a.text-color-link, ' +
            '.text-color-link, ' +
            '[data-element="patient-first-name"]'
          );
          
          if (clickable && clickable.offsetParent !== null) {
            // Give high score, bonus for nickname/middle initial match
            const score = 100 + (hasNickname ? 10 : 0);
            candidates.push({ 
              element: clickable, 
              text: clickable.textContent.trim(), 
              score: score,
              type: 'rowMatch'
            });
          }
        }
      }
      
      // Method 2: Look for individual patient name divs (fallback)
      if (candidates.length === 0) {
        const patientNameDivs = document.querySelectorAll(
          'div.text-color-link, ' +
          '[data-element="patient-first-name"], ' +
          '[data-element*="patient-name"], ' +
          '.chart-list-results__col_patient-name div, ' +
          '.patient-name, ' +
          'td div.text-color-link'
        );
        
        console.log('Patient name elements found:', patientNameDivs.length);
        
        for (const div of patientNameDivs) {
          const text = div.textContent.trim();
          if (text.length < 3 || text.length > 100) continue;
          if (/^\d+\/\d+\/\d+$/.test(text)) continue;
          if (/^\d+$/.test(text)) continue;
          
          const score = nameMatchScore(patientName, text);
          if (score > 0) {
            candidates.push({ element: div, text: text, score: score, type: 'nameDiv' });
          }
        }
      }
      
      // Remove duplicates and sort by score
      const uniqueCandidates = [];
      const seenElements = new Set();
      for (const c of candidates) {
        if (!seenElements.has(c.element)) {
          seenElements.add(c.element);
          uniqueCandidates.push(c);
        }
      }
      uniqueCandidates.sort((a, b) => b.score - a.score);
      
      console.log('Unique candidates found:', uniqueCandidates.length);
      uniqueCandidates.slice(0, 5).forEach((c, i) => {
        console.log(`  ${i + 1}. Score: ${c.score}, Text: "${c.text}", Type: ${c.type}`);
      });
      
      // Click if we have a match (score >= 60 for individual elements, or any rowMatch)
      if (uniqueCandidates.length > 0 && uniqueCandidates[0].score >= 60) {
        const best = uniqueCandidates[0];
        console.log('=== CLICKING BEST MATCH ===');
        console.log('Text:', best.text, 'Score:', best.score);
        
        best.element.click();
        await sleep(3000);
        
        console.log('SUCCESS: Clicked patient name, chart should be opening');
        return { success: true };
      }
      
      // If no high-confidence match, try searching by last name only
      if (uniqueCandidates.length === 0 || uniqueCandidates[0].score < 60) {
        console.log('No confident match found, trying last name search...');
        
        // Clear the search properly
        searchInput.focus();
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Press Enter to clear
        searchInput.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13
        }));
        await sleep(1000);
        
        // Search by last name
        const lastName = nameParts.last;
        console.log('Searching by last name:', lastName);
        searchInput.value = lastName;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Press Enter to search
        searchInput.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13
        }));
        searchInput.dispatchEvent(new KeyboardEvent('keyup', {
          bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13
        }));
        
        await sleep(3000);
        
        // Look again using row-based matching
        console.log('Checking rows after last name search...');
        const retryRows = document.querySelectorAll('tbody tr, .charts-list-results tr, tr.ember-view');
        
        for (const row of retryRows) {
          const rowText = row.textContent.toUpperCase();
          const hasFirst = nameParts.first && rowText.includes(nameParts.first);
          const hasLast = nameParts.last && rowText.includes(nameParts.last);
          
          if (hasFirst && hasLast) {
            console.log('Found row match on retry:', rowText.substring(0, 60));
            
            const clickable = row.querySelector(
              'div.text-color-link, a.text-color-link, .text-color-link, [data-element="patient-first-name"]'
            );
            
            if (clickable && clickable.offsetParent !== null) {
              console.log('Clicking:', clickable.textContent.trim());
              clickable.click();
              await sleep(3000);
              return { success: true };
            }
          }
        }
        
        // Final fallback - check individual divs
        const retryDivs = document.querySelectorAll('div.text-color-link, .text-color-link');
        
        for (const div of retryDivs) {
          const text = div.textContent.trim();
          const score = nameMatchScore(patientName, text);
          
          console.log(`  Retry div check: "${text}" score: ${score}`);
          
          if (score >= 60) {
            console.log('Found match on retry:', text);
            div.click();
            await sleep(3000);
            return { success: true };
          }
        }
      }

      console.log('ERROR: Patient not found:', patientName);
      console.log('Please verify:');
      console.log('  1. The patient name spelling matches exactly');
      console.log('  2. The patient exists in Practice Fusion');
      console.log('  3. You are on the correct patient list view');
      
      return { 
        success: false, 
        error: `Patient not found: "${patientName}". Please verify the name matches the chart exactly.`
      };
      
    } catch (e) {
      console.error('Search error:', e);
      return { success: false, error: e.message };
    }
  }

  // ============================================
  // COMBINED STEP 2-4: Open CCM, Navigate to Note, Insert Text
  // ============================================

  async function openCcmNoteAndInsert(narrative, expectedPatientName, dateOfService) {
    console.log('=== STEPS 2-4: Opening CCM visit, navigating to note, inserting text ===');
    console.log('Expected patient:', expectedPatientName);
    console.log('Date of Service param:', dateOfService);
    console.log('Narrative starts with:', (narrative || '').substring(0, 30));

    // Derive target month - PRIORITY ORDER:
    // 1. Parse from narrative text (most reliable - contains the actual DOS)
    // 2. Use dateOfService parameter from popup
    // 3. Fall back to current date
    let targetDate;
    
    // PRIORITY 1: Parse date from narrative text (format: "MM-DD-YYYY: XX mins - ...")
    const narrativeDateMatch = (narrative || '').match(/^(\d{2})-(\d{2})-(\d{4})\s*:/);
    if (narrativeDateMatch) {
      const nMonth = parseInt(narrativeDateMatch[1]) - 1; // 0-indexed
      const nDay = parseInt(narrativeDateMatch[2]);
      const nYear = parseInt(narrativeDateMatch[3]);
      targetDate = new Date(nYear, nMonth, nDay);
      console.log('>>> PRIORITY 1: Parsed target date from NARRATIVE TEXT:', targetDate.toDateString());
    }
    // PRIORITY 2: Use dateOfService param (YYYY-MM-DD from date input)
    else if (dateOfService && dateOfService.includes('-') && dateOfService.length >= 10) {
      const parts = dateOfService.split('-');
      targetDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      console.log('>>> PRIORITY 2: Parsed target date from dateOfService param:', targetDate.toDateString());
    }
    // PRIORITY 3: Last resort - current date
    else {
      targetDate = new Date();
      console.log('>>> PRIORITY 3 (FALLBACK): Using current date:', targetDate.toDateString());
    }
    
    const monthName = targetDate.toLocaleString('en-US', { month: 'long' }).toLowerCase();
    const shortMonth = targetDate.toLocaleString('en-US', { month: 'short' }).toLowerCase();
    const monthNum = String(targetDate.getMonth() + 1).padStart(2, '0');
    const targetYear = targetDate.getFullYear().toString();
    console.log('TARGET MONTH:', monthName, '| SHORT:', shortMonth, '| NUM:', monthNum, '| YEAR:', targetYear);

    // Helper: check if a row's text matches the target month
    // IMPORTANT: Simple substring checks like "01/2026" can falsely match "02/01/2026" 
    // (where 01 is the DAY, not the month). Use regex to ensure MM/ is at the start of a date.
    function rowMatchesTargetMonth(rowText) {
      // Full month name (most reliable) - "january" won't match "february"
      if (rowText.includes(monthName)) return true;
      
      // Short month + year - "jan 2026" or "jan2026"  
      if (rowText.includes(shortMonth + ' ' + targetYear)) return true;
      if (rowText.includes(shortMonth + targetYear)) return true;
      
      // Also check "CCCM: January" pattern (details column)
      if (rowText.includes('cccm: ' + monthName)) return true;
      
      // Numeric date MM/DD/YYYY - use regex so "01/" only matches at START of date
      // (?:^|[^0-9/]) ensures the month number isn't preceded by a digit or slash
      // This prevents "02/01/2026" from matching when looking for month "01"
      const numericDateRegex = new RegExp('(?:^|[^0-9\\/])' + monthNum + '\\/\\d{1,2}\\/' + targetYear);
      if (numericDateRegex.test(rowText)) return true;
      
      return false;
    }
    
    // Helper: check if a row does NOT match a different month (prevents false positives)
    function rowMatchesDifferentMonth(rowText) {
      // Check if the row has a DIFFERENT month name in the CCM details
      const allMonths = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      for (const m of allMonths) {
        if (m !== monthName && rowText.includes('cccm: ' + m)) return true;
        if (m !== monthName && rowText.includes('ccm') && rowText.includes(': ' + m + ' ' + targetYear)) return true;
      }
      return false;
    }

    // STEP 2: Wait for the patient chart to load
    console.log('Step 2: Waiting for patient chart to load...');
    
    let correctPatient = false;
    let attempts = 0;
    const maxAttempts = 15;
    
    while (attempts < maxAttempts && !correctPatient) {
      attempts++;
      await sleep(1000);
      
      const pageText = document.body.innerText.toUpperCase();
      const expectedParts = getNameParts(expectedPatientName);
      
      const hasFirstName = expectedParts.first && pageText.includes(expectedParts.first);
      const hasLastName = expectedParts.last && pageText.includes(expectedParts.last);
      
      if (hasFirstName && hasLastName) {
        correctPatient = true;
        console.log('Patient chart verified:', expectedPatientName);
      }
    }
    
    if (!correctPatient) {
      console.log('ERROR: Could not verify patient chart loaded for', expectedPatientName);
      return { success: false, error: 'Could not verify patient chart loaded for ' + expectedPatientName };
    }
    
    // Make sure we're on the Timeline tab to see encounters
    console.log('Ensuring Timeline tab is selected...');
    const allTabs = document.querySelectorAll('a, button, [role="tab"]');
    for (const tab of allTabs) {
      const tabText = (tab.textContent || '').trim().toLowerCase();
      if (tabText === 'timeline') {
        console.log('Found Timeline tab, clicking...');
        tab.click();
        await sleep(2000);
        break;
      }
    }
    
    // Look for CCM encounters
    console.log('Looking for CCM encounters...');
    await sleep(2000);
    
    // Current month info (targetYear already defined above)
    
    let ccmRowFound = false;
    
    // Method 1: Find all clickable "Office Visit" or "Home Visit" links
    const allLinks = document.querySelectorAll('a');
    console.log('Total links found:', allLinks.length);
    console.log('Looking for CCM with month:', monthName, shortMonth, monthNum + '/' + targetYear);
    
    // Log first few links for debugging
    let linkCount = 0;
    for (const link of allLinks) {
      const linkText = link.textContent.toLowerCase().trim();
      if (linkCount < 5) {
        console.log('Sample link:', linkText.substring(0, 30));
        linkCount++;
      }
      
      // Check if this is a visit type link - be more flexible
      if (linkText.includes('visit') || linkText.includes('office') || linkText.includes('home')) {
        // Check the surrounding row/container for CCM and target month
        const row = link.closest('tr') || link.closest('[class*="row"]') || link.parentElement?.parentElement;
        
        if (row) {
          const rowText = row.textContent.toLowerCase();
          
          const hasCCM = rowText.includes('ccm');
          const hasTargetMonth = rowMatchesTargetMonth(rowText);
          
          console.log('Checking visit link:', linkText.substring(0, 20), '| hasCCM:', hasCCM, '| hasTargetMonth:', hasTargetMonth);
          
          if (hasCCM && hasTargetMonth && !rowMatchesDifferentMonth(rowText)) {
            console.log('=== FOUND TARGET MONTH CCM ROW VIA METHOD 1 ===');
            console.log('Row text:', rowText.substring(0, 150));
            console.log('Clicking link:', link.textContent.trim());
            
            link.click();
            ccmRowFound = true;
            await sleep(4000);
            break;
          }
        }
      }
    }
    
    // Calculate previous month for exclusion (relative to target date, used in multiple methods)
    const prevMonth = targetDate.getMonth() === 0 ? 11 : targetDate.getMonth() - 1;
    const prevMonthNum = String(prevMonth + 1).padStart(2, '0');
    const prevMonthName = new Date(targetDate.getFullYear(), prevMonth, 1).toLocaleString('en-US', { month: 'long' }).toLowerCase();
    const prevShortMonth = new Date(targetDate.getFullYear(), prevMonth, 1).toLocaleString('en-US', { month: 'short' }).toLowerCase();
    
    // Method 2: If no link found, try finding by row content
    if (!ccmRowFound) {
      console.log('Method 1 failed, trying Method 2...');
      
      try {
        // Look for table rows specifically
        const rows = document.querySelectorAll('tr');
        console.log('Found', rows.length, 'table rows');
        
        for (const row of rows) {
          const rowText = (row.textContent || '').toLowerCase();
          
          // Check for CCM (Complex CCM or just CCM)
          const hasCCM = rowText.includes('complex ccm') || 
                         (rowText.includes('ccm') && !rowText.includes('rpm'));
          
          // Check for target month
          const hasCurrentMonth = rowMatchesTargetMonth(rowText);
          
          // Check if this row is for a DIFFERENT month (e.g., "CCCM: February 2026" when looking for January)
          const hasDifferentMonth = rowMatchesDifferentMonth(rowText);
          
          if (hasCCM && hasCurrentMonth && !hasDifferentMonth) {
            console.log('=== Found target month CCM row ===');
            console.log('Row text:', rowText.substring(0, 200));
            
            // Find the Office Visit or Home Visit link in this row
            const anchors = row.querySelectorAll('a');
            console.log('Anchors in row:', anchors.length);
            
            let anchor = null;
            
            // List all anchors for debugging
            for (let i = 0; i < anchors.length; i++) {
              const a = anchors[i];
              const aText = (a.textContent || '').trim();
              console.log('  Anchor', i, ':', aText);
              
              if (aText.toLowerCase().includes('visit') || 
                  aText.toLowerCase().includes('office') ||
                  aText.toLowerCase().includes('home')) {
                anchor = a;
                console.log('  >>> This is the visit link!');
              }
            }
            
            // If no visit anchor found, use the first anchor
            if (!anchor && anchors.length > 0) {
              anchor = anchors[0];
              console.log('Using first anchor as fallback');
            }
            
            if (anchor) {
              console.log('>>> Clicking anchor:', anchor.textContent.trim());
              
              anchor.scrollIntoView({ behavior: 'instant', block: 'center' });
              await sleep(500);
              
              // Try multiple click methods
              anchor.focus();
              anchor.click();
              console.log('>>> Click executed');
              
              // Also dispatch click event
              anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              console.log('>>> Click event dispatched');
              
              ccmRowFound = true;
              await sleep(5000);
              console.log('>>> Wait complete');
              break;
            } else {
              console.log('WARNING: No anchor found in row!');
              
              // Try finding any clickable element
              const clickables = row.querySelectorAll('a, button, [role="button"], [class*="link"]');
              console.log('Other clickables:', clickables.length);
              
              if (clickables.length > 0) {
                const el = clickables[0];
                console.log('Clicking first clickable:', el.textContent.trim());
                el.scrollIntoView({ behavior: 'instant', block: 'center' });
                await sleep(500);
                el.click();
                ccmRowFound = true;
                await sleep(5000);
                break;
              } else {
                // Try clicking the row itself
                console.log('Clicking row itself...');
                row.click();
                ccmRowFound = true;
                await sleep(5000);
                break;
              }
            }
          }
        }
        
        // If still not found, try a more aggressive search
        if (!ccmRowFound) {
          console.log('Row search failed, trying text-based search...');
          
          // Find all Office Visit / Home Visit links
          const visitLinks = document.querySelectorAll('a');
          
          for (const link of visitLinks) {
            const linkText = (link.textContent || '').toLowerCase().trim();
            
            if (linkText === 'office visit' || linkText === 'home visit') {
              // Check the entire row by looking at sibling cells
              const row = link.closest('tr');
              if (row) {
                const rowText = row.textContent.toLowerCase();
                
                // Check if this row has CCM and target month
                // Use regex for numeric dates to prevent "02/01/2026" matching month "01"
                const numericDateRegex2 = new RegExp('(?:^|[^0-9\\/])' + monthNum + '\\/\\d{1,2}\\/' + targetYear);
                const hasTargetMonthText = rowText.includes(shortMonth) || numericDateRegex2.test(rowText);
                
                if (rowText.includes('ccm') && hasTargetMonthText) {
                  
                  // Make sure it's not a different month
                  if (!rowText.includes(prevShortMonth)) {
                    
                    console.log('=== Found via text search ===');
                    console.log('Link:', linkText);
                    console.log('Row text:', rowText.substring(0, 150));
                    
                    link.scrollIntoView({ behavior: 'instant', block: 'center' });
                    await sleep(500);
                    link.click();
                    
                    ccmRowFound = true;
                    await sleep(5000);
                    break;
                  }
                }
              }
            }
          }
        }
        
      } catch (method2Err) {
        console.error('Method 2 error:', method2Err.message);
      }
    }
    
    // Method 3: Just find any element containing "Office Visit" near target month and "CCM"
    if (!ccmRowFound) {
      console.log('Method 2 failed, trying Method 3 - direct text search...');
      
      // Find all text that mentions target month and CCM
      const bodyText = document.body.innerHTML.toLowerCase();
      
      if ((bodyText.includes(monthName) || bodyText.includes(shortMonth)) && bodyText.includes('ccm')) {
        console.log('Page contains target month CCM reference');
        
        // Find Office Visit / Home Visit links
        const visitLinks = Array.from(document.querySelectorAll('a')).filter(a => {
          const t = a.textContent.toLowerCase();
          return t.includes('office visit') || t.includes('home visit') || t.includes('visit');
        });
        
        console.log('Visit links found:', visitLinks.length);
        
        // Click the first one that's near CCM target month text
        for (const link of visitLinks) {
          const parent = link.closest('tr') || link.closest('div');
          if (parent) {
            const parentText = parent.textContent.toLowerCase();
            if (parentText.includes('ccm') && (parentText.includes(monthName) || parentText.includes(shortMonth)) && parentText.includes(targetYear) && !rowMatchesDifferentMonth(parentText)) {
              console.log('Found via Method 3, clicking:', link.textContent);
              link.click();
              ccmRowFound = true;
              await sleep(4000);
              break;
            }
          }
        }
      }
    }
    
    // Method 4: Click ANY link inside a table row that contains "CCM" and the target month
    if (!ccmRowFound) {
      console.log('Method 3 failed, trying Method 4 - any link in CCM + target month row...');
      
      const allRows = document.querySelectorAll('tr');
      for (const row of allRows) {
        const rowText = row.textContent.toLowerCase();
        
        if (rowText.includes('ccm') && rowMatchesTargetMonth(rowText) && !rowMatchesDifferentMonth(rowText)) {
          console.log('Method 4: Found CCM row with target month:', rowText.substring(0, 150));
          
          // Click the first link in this row
          const firstLink = row.querySelector('a');
          if (firstLink) {
            console.log('Method 4: Clicking link:', firstLink.textContent.trim());
            firstLink.scrollIntoView({ behavior: 'instant', block: 'center' });
            await sleep(500);
            firstLink.click();
            ccmRowFound = true;
            await sleep(4000);
            break;
          } else {
            // No link? Try clicking the row itself
            console.log('Method 4: No link found, clicking row directly');
            row.click();
            ccmRowFound = true;
            await sleep(4000);
            break;
          }
        }
      }
    }

    if (!ccmRowFound) {
      console.log('ERROR: Patient does not have a CCM note for', monthName);
      return { success: false, error: 'Patient does not have a CCM note for ' + monthName };
    }
    
    // STEP 3: Navigate to the CCM note
    console.log('Step 3: Opening CCM note editor...');
    const navResult = await navigateToCCMNote();
    if (!navResult || !navResult.success) {
      console.error('Failed to navigate to CCM note:', navResult?.error);
      return { success: false, error: 'Unable to open CCM note editor' };
    }
    console.log('SUCCESS: Opened CCM note editor');

    // STEP 4: Insert the narrative
    console.log('Step 4: Inserting narrative...');
    const insertResult = await insertCCMNoteText(narrative);
    if (!insertResult || !insertResult.success) {
      console.error('Failed to insert narrative:', insertResult?.error);
      return { success: false, error: 'Unable to insert text' };
    }
    console.log('SUCCESS: Narrative inserted into note');
    
    return { success: true };
  }

  // ============================================
  // STEP 2: Open CCM Encounter (standalone)
  // ============================================

  async function openCurrentMonthCCMEncounter(dateOfService) {
    try {
      console.log('=== STEP 2: Opening target month CCM visit note ===');
      console.log('dateOfService param:', dateOfService);
      
      // Derive target month from dateOfService if provided
      let targetDate;
      if (dateOfService && dateOfService.includes('-')) {
        const parts = dateOfService.split('-');
        targetDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        console.log('Parsed target date from param:', targetDate.toDateString());
      } else {
        targetDate = new Date();
        console.log('WARNING: No dateOfService, using current date:', targetDate.toDateString());
      }
      
      const monthName = targetDate.toLocaleString('en-US', { month: 'long' }).toLowerCase();
      const monthYear = targetDate.toLocaleString('en-US', { month: 'long', year: 'numeric' }).toLowerCase();
      const year = targetDate.getFullYear().toString();
      console.log('Looking for CCM note with:', monthName, year);

      const rows = document.querySelectorAll('tr');
      console.log('Table rows found:', rows.length);

      for (const row of rows) {
        const rowText = row.textContent.toLowerCase();
        
        if (rowText.includes('ccm') && 
            (rowText.includes(monthName) || rowText.includes(monthYear))) {
          
          console.log('=== FOUND CURRENT MONTH CCM ROW ===');
          
          const visitLink = row.querySelector('a');
          
          if (visitLink) {
            console.log('Clicking visit link:', visitLink.textContent.trim());
            visitLink.click();
            await sleep(3000);
            return { success: true };
          }
        }
      }

      // Fallback: Look for any unsigned CCM
      console.log('Looking for any unsigned CCM...');
      for (const row of rows) {
        const rowText = row.textContent.toLowerCase();
        
        if (rowText.includes('ccm') && 
            !rowText.includes('signed') &&
            rowText.includes(year)) {
          
          const visitLink = row.querySelector('a');
          
          if (visitLink) {
            console.log('Clicking visit link:', visitLink.textContent.trim());
            visitLink.click();
            await sleep(3000);
            return { success: true };
          }
        }
      }

      return { success: false, error: 'CCM visit note not found' };
      
    } catch (e) {
      console.error('Step 2 error:', e);
      return { success: false, error: e.message };
    }
  }

  // ============================================
  // STEP 3: NAVIGATE TO CCM NOTE
  // ============================================

  async function navigateToCCMNote() {
    try {
      console.log('=== STEP 3: Verifying CCM note page ===');
      
      // Wait for encounter page to fully load
      await sleep(4000);
      
      // After clicking Office Visit, the note editor should already be visible
      // We just need to verify we're on the right page - DO NOT CLICK ANYTHING
      
      // Check if "Total CCM Time" or similar marker exists on page (means we're in CCM note)
      console.log('Checking for Total Time marker...');
      const pageText = document.body.innerText;
      
      if (hasTotalTimeMarker(pageText)) {
        console.log('Found Total Time marker - we are on the CCM note page');
        return { success: true };
      }
      
      // Check for other CCM indicators
      if (pageText.includes('Chronic Care Management') || pageText.includes('CCM Conditions')) {
        console.log('Found CCM content - we are on the CCM note page');
        return { success: true };
      }
      
      // Check if there's a rich text editor visible
      console.log('Looking for rich text editor...');
      const editor = document.querySelector(
        '[contenteditable="true"], ' +
        'textarea:not([hidden]), ' +
        'iframe[class*="wysihtml"], ' +
        '.wysihtml5-editor'
      );
      
      if (editor && editor.offsetParent !== null) {
        console.log('Found visible editor element');
        return { success: true };
      }
      
      // Wait a bit more and check again
      console.log('Waiting for page to load...');
      await sleep(3000);
      
      // Check again for CCM content
      const pageTextRetry = document.body.innerText;
      if (hasTotalTimeMarker(pageTextRetry) || 
          pageTextRetry.includes('Chronic Care Management') ||
          pageTextRetry.includes('CCM Conditions')) {
        console.log('Found CCM content after waiting');
        return { success: true };
      }
      
      // At this point, assume we're on the right page
      // The insertCCMNoteText function will handle finding the editor
      console.log('Proceeding to insert text...');
      return { success: true };
      
    } catch (e) {
      console.error('Step 3 error:', e);
      return { success: false, error: e.message };
    }
  }

  // ============================================
  // STEP 4: INSERT TEXT INTO CCM NOTE
  // ============================================

  async function insertCCMNoteText(text) {
    try {
      // MC Calculator mode: skip actual insertion, just return success
      // (We only needed openCcmNoteAndInsert to find and open the encounter)
      if (text === '__MC_CALC_ONLY__') {
        console.log('MC Calc mode: Skipping text insertion, encounter is open');
        return { success: true, mcCalcOnly: true };
      }

      console.log('=== STEP 4: Inserting note text ===');
      console.log('Text length:', text.length);

      // Wait for the note editor to load
      console.log('Waiting for note editor to load...');
      await sleep(3000);
      
      // Try to find the editor with retries
      let retryCount = 0;
      const maxRetries = 5;
      
      while (retryCount < maxRetries) {
        retryCount++;
        console.log(`Looking for editor (attempt ${retryCount}/${maxRetries})...`);

        // Method 1: Look for the "Total CCM Time" / "Total Monthly Time" text and insert before it
        console.log('Looking for Total Time marker...');
        const pageText = document.body.innerText;
        
        if (hasTotalTimeMarker(pageText)) {
          console.log('Found Total Time marker on page');
          
          // Find all contenteditable areas and editable divs
          const editableAreas = document.querySelectorAll(
            '[contenteditable="true"], ' +
            '.note-editable, ' +
            '[class*="editor"], ' +
            '[class*="note-content"], ' +
            '[role="textbox"]'
          );
          
          console.log('Found', editableAreas.length, 'editable areas');
          
          for (const editable of editableAreas) {
            const editableText = editable.innerText || editable.textContent;
            
            if (hasTotalTimeMarker(editableText)) {
              console.log('Found editor with Total Time marker');
              editable.focus();
              
              // Find the exact text node containing the Total Time marker
              const node = findTotalTimeTextNode(editable);
              
              if (node) {
                  console.log('Found Total Time text node');
                  
                  // Get the parent element (likely a div or p)
                  let targetElement = node.parentElement;
                  console.log('Target element tag:', targetElement.tagName);
                  console.log('Target parent tag:', targetElement.parentNode?.tagName);
                  
                  // Create new paragraph with the text
                  const newPara = document.createElement('p');
                  newPara.innerHTML = text.replace(/\n/g, '<br>');
                  console.log('Created paragraph with text length:', newPara.innerHTML.length);
                  
                  // Add a line break before the marker
                  const spacer = document.createElement('br');
                  
                  // Insert before the Total CCM Time element
                  targetElement.parentNode.insertBefore(newPara, targetElement);
                  targetElement.parentNode.insertBefore(spacer, targetElement);
                  
                  console.log('Inserted paragraph. New editor content length:', editable.innerHTML.length);
                  
                  // Trigger multiple events to ensure the framework picks up the change
                  editable.dispatchEvent(new Event('input', { bubbles: true }));
                  editable.dispatchEvent(new Event('change', { bubbles: true }));
                  editable.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                  
                  // Also try focusing and blurring to trigger any validation
                  editable.focus();
                  await sleep(100);
                  editable.blur();
                  await sleep(100);
                  editable.focus();
                  
                  console.log('SUCCESS: Text inserted before Total Time marker');
                  console.log('Verification - editor now contains text:', editable.innerText.includes(text.substring(0, 50)) ? 'YES' : 'NO');
                  return { success: true };
              }
            }
          }
        }

        // Method 2: Find any rich text editor by looking for toolbar nearby
        console.log('Looking for rich text editor...');
        const toolbars = document.querySelectorAll('[class*="toolbar"], [class*="editor-toolbar"], [role="toolbar"]');
        
        for (const toolbar of toolbars) {
          // Look for contenteditable near the toolbar
          const parent = toolbar.parentElement;
          if (parent) {
            const editor = parent.querySelector('[contenteditable="true"], [class*="editable"]');
            if (editor && editor.offsetParent !== null) {
              console.log('Found editor near toolbar');
              editor.focus();
              
              // Try to insert at cursor or end
              const selection = window.getSelection();
              if (selection) {
                const range = selection.getRangeAt(0);
                const textNode = document.createTextNode(text + '\n\n');
                range.insertNode(textNode);
                editor.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('SUCCESS: Text inserted at cursor');
                return { success: true };
              }
              
              // Append at end
              editor.innerHTML += '<br><br>' + text.replace(/\n/g, '<br>');
              editor.dispatchEvent(new Event('input', { bubbles: true }));
              console.log('SUCCESS: Text appended to editor');
              return { success: true };
            }
          }
        }

        // Method 3: wysihtml5 iframe editor
        console.log('Looking for wysihtml5 editor...');
        const wysihtml5Iframe = document.querySelector('iframe.wysihtml5-sandbox, iframe[class*="wysihtml"]');
        
        if (wysihtml5Iframe) {
          console.log('Found wysihtml5 iframe');
          try {
            const iframeDoc = wysihtml5Iframe.contentDocument || wysihtml5Iframe.contentWindow.document;
            const editorBody = iframeDoc.body;
            
            if (editorBody && editorBody.innerHTML.length > 0) {
              editorBody.focus();
              
              const bodyText = editorBody.innerText || editorBody.textContent;
              
              if (bodyText.includes('Total CCM Time')) {
                console.log('Found "Total CCM Time" marker in iframe');
                
                const walker = document.createTreeWalker(
                  editorBody,
                  NodeFilter.SHOW_TEXT,
                  null,
                  false
                );
                
                let node;
                while (node = walker.nextNode()) {
                  if (node.textContent.includes('Total CCM Time')) {
                    let targetElement = node.parentElement;
                    
                    const newPara = iframeDoc.createElement('p');
                    newPara.innerHTML = text.replace(/\n/g, '<br>');
                    
                    const spacer = iframeDoc.createElement('p');
                    spacer.innerHTML = '<br>';
                    
                    targetElement.parentNode.insertBefore(newPara, targetElement);
                    targetElement.parentNode.insertBefore(spacer, targetElement);
                    
                    editorBody.dispatchEvent(new Event('input', { bubbles: true }));
                    
                    console.log('SUCCESS: Text inserted before Total CCM Time in iframe');
                    return { success: true };
                  }
                }
              }
              
              // Append at end
              const newPara = iframeDoc.createElement('p');
              newPara.innerHTML = text.replace(/\n/g, '<br>');
              editorBody.appendChild(iframeDoc.createElement('br'));
              editorBody.appendChild(newPara);
              editorBody.dispatchEvent(new Event('input', { bubbles: true }));
              console.log('SUCCESS: Text appended to iframe editor');
              return { success: true };
            }
          } catch (iframeError) {
            console.error('Iframe access error:', iframeError);
          }
        }

        // Method 4: Textarea
        console.log('Looking for textarea...');
        const textareas = document.querySelectorAll('textarea');
        
        for (const textarea of textareas) {
          if (textarea.offsetParent !== null && !textarea.disabled && !textarea.readOnly) {
            console.log('Found textarea:', textarea.name || textarea.id || 'unnamed');
            
            const content = textarea.value;
            const markerIndex = content.indexOf('Total CCM Time');
            
            if (markerIndex !== -1) {
              const before = content.substring(0, markerIndex);
              const after = content.substring(markerIndex);
              textarea.value = before + text + '\n\n' + after;
            } else {
              textarea.value = content + '\n\n' + text;
            }
            
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('SUCCESS: Text inserted into textarea');
            return { success: true };
          }
        }

        // Method 5: Any contenteditable
        console.log('Looking for any contenteditable...');
        const editables = document.querySelectorAll('[contenteditable="true"]');
        
        for (const editable of editables) {
          if (editable.offsetParent !== null && editable.innerText.length > 50) {
            console.log('Found large contenteditable element');
            editable.focus();
            
            // Append at end
            editable.innerHTML += '<br><br>' + text.replace(/\n/g, '<br>');
            editable.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('SUCCESS: Text appended to contenteditable');
            return { success: true };
          }
        }
        
        // If editor not found, wait and retry
        console.log('Editor not found, waiting 2 seconds before retry...');
        await sleep(2000);
      }

      console.log('ERROR: Could not find note editor after all retries');
      return { success: false, error: 'Could not find note editor' };
      
    } catch (e) {
      console.error('Step 4 error:', e);
      return { success: false, error: e.message };
    }
  }

  // ============================================
  // STEP 5: SAVE THE NOTE
  // ============================================

  async function saveCCMNote() {
    try {
      console.log('=== STEP 5: Saving note ===');
      
      const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn');
      
      for (const btn of buttons) {
        const label = (btn.textContent || btn.value || '').trim().toLowerCase();
        
        if (label === 'save' || label.startsWith('save')) {
          if (btn.offsetParent !== null && !btn.disabled) {
            console.log('Clicking Save:', label);
            btn.click();
            await sleep(2500);
            return { success: true };
          }
        }
      }
      
      const saveBtn = document.querySelector('[data-element*="save"], .save-button, .btn-save');
      if (saveBtn && saveBtn.offsetParent !== null) {
        saveBtn.click();
        await sleep(2500);
        return { success: true };
      }
      
      console.log('WARNING: Save button not found');
      return { success: false, error: 'Save button not found' };
      
    } catch (e) {
      console.error('Save error:', e);
      return { success: false, error: e.message };
    }
  }

  // ============================================
  // STEP 6: RETURN TO PATIENT LIST
  // ============================================

  async function goBackToChartsPage() {
    try {
      console.log('=== STEP 6: Returning to patient list ===');
      
      // Check if we're on login page
      if (isOnLoginPage()) {
        console.log('ERROR: On login page - session may have expired');
        return { success: false, error: 'Session expired - please log in again' };
      }
      
      // Handle any "Leave site?" or confirmation dialogs
      await handleLeaveDialog();
      
      // Try clicking "Patient lists" link first (more reliable than direct URL)
      const patientListsLink = document.querySelector('a[href*="charts/list"], [data-element*="patient-list"]');
      if (patientListsLink) {
        console.log('Clicking Patient lists link');
        patientListsLink.click();
        await sleep(2000);
        await handleLeaveDialog();
        return { success: true };
      }
      
      // Navigate to charts page via URL
      const chartsUrl = 'https://static.practicefusion.com/apps/ehr/index.html#/PF/charts/list/all/recent';
      console.log('Navigating to charts page...');
      window.location.href = chartsUrl;
      
      // Wait and handle any dialogs that appear
      await sleep(1000);
      await handleLeaveDialog();
      await sleep(2000);
      
      return { success: true };
      
    } catch (e) {
      console.error('Go back error:', e);
      return { success: false, error: e.message };
    }
  }

  /**
   * Handle "Leave site?" and other confirmation dialogs
   */
  async function handleLeaveDialog() {
    try {
      // Look for "Leave" or "OK" or "Continue" buttons in dialogs
      const dialogButtons = document.querySelectorAll(
        '[class*="modal"] button, ' +
        '[class*="dialog"] button, ' +
        '[role="dialog"] button, ' +
        '.modal button, ' +
        '.dialog button'
      );
      
      for (const btn of dialogButtons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        
        if (text === 'leave' || text === 'ok' || text === 'continue' || 
            text === 'yes' || text === 'confirm' || text === "don't save") {
          console.log('Clicking dialog button:', text);
          btn.click();
          await sleep(500);
          return;
        }
      }
      
      // Look for Leave button by iterating through buttons
      const allButtons = document.querySelectorAll('button');
      for (const btn of allButtons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (text === 'leave') {
          btn.click();
          await sleep(500);
          break;
        }
      }
      
    } catch (e) {
      console.log('No dialog to handle or error:', e.message);
    }
  }

  // ============================================
  // MANUAL TEXT INSERTION
  // ============================================

  function insertTextIntoActiveElement(text) {
    const active = document.activeElement;
    
    if (active && active.tagName === 'TEXTAREA') {
      const cursorPos = active.selectionStart;
      const content = active.value;
      
      if (cursorPos !== undefined && cursorPos >= 0) {
        const before = content.substring(0, cursorPos);
        const after = content.substring(cursorPos);
        active.value = before + text + after;
        const newPos = cursorPos + text.length;
        active.setSelectionRange(newPos, newPos);
      } else {
        active.value = content + '\n\n' + text;
      }
      
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    }
    
    if (active && (active.isContentEditable || active.contentEditable === 'true')) {
      document.execCommand('insertText', false, text);
      active.dispatchEvent(new Event('input', { bubbles: true }));
      return { success: true };
    }
    
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        if (iframeDoc.body && iframeDoc.body.isContentEditable) {
          iframeDoc.body.focus();
          iframeDoc.execCommand('insertText', false, text);
          return { success: true };
        }
      } catch (e) {}
    }
    
    return { success: false };
  }

  // ============================================
  // SEARCH CLEARING FUNCTION
  // ============================================

  async function clearSearchAndFilters() {
    console.log('CCM Extension: Clearing search and filters...');
    
    // Clear filter chips first
    let clearedCount = 0;
    const maxClearAttempts = 10;
    let clearAttempt = 0;
    
    while (clearAttempt < maxClearAttempts) {
      clearAttempt++;
      let foundChipThisRound = false;
      
      try {
        const allElements = document.querySelectorAll('span, div, button');
        
        for (const el of allElements) {
          const text = (el.textContent || '').trim();
          
          if ((text.includes('Name:') || text.includes('PRN:')) && (text.includes('×') || text.includes('✕'))) {
            const closeBtn = el.querySelector('button, [role="button"], span');
            if (closeBtn) {
              const closeBtnText = (closeBtn.textContent || '').trim();
              if (closeBtnText === '×' || closeBtnText === 'x' || closeBtnText === '✕') {
                console.log('CCM Extension: Clearing chip:', text.substring(0, 30));
                closeBtn.click();
                clearedCount++;
                foundChipThisRound = true;
                await sleep(400);
                break;
              }
            }
          }
        }
      } catch (e) {
        console.log('Error clearing filters:', e.message);
      }
      
      if (!foundChipThisRound) break;
    }
    
    // Clear the search input
    const searchInput = document.querySelector(
      'input[placeholder*="Search all patients"],' +
      'input[placeholder*="search all patients"],' +
      'input[placeholder*="Search patients"]'
    );
    
    if (searchInput) {
      await hardClearSearchInput(searchInput);
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', code: 'Escape', keyCode: 27 }));
    }
    
    console.log('CCM Extension: Cleared', clearedCount, 'filter chips');
    return { success: true };
  }

  // ============================================
  // PATIENT DETECTION FUNCTION
  // ============================================

  function ccmCleanText(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

  function ccmTitleCase(s) {
    return ccmCleanText(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }

  function ccmPlausibleName(name) {
    const t = ccmCleanText(name);
    if (t.length < 3 || t.length > 60) return false;
    if (!/[A-Za-z]/.test(t)) return false;
    // letters plus spaces, hyphens, apostrophes, periods, commas only
    if (!/^[A-Za-z][A-Za-z .,'\-]*$/.test(t)) return false;
    return true;
  }

  // Read the patient name from the blue chart banner. The PRN code that follows
  // the name ("PRN: AM646542") is the most reliable anchor in Practice Fusion.
  function extractPatientNameFromBanner() {
    const nameBeforePRN = (txt) => {
      const i = txt.search(/\bPRN:/i);
      if (i < 0) return '';
      let before = ccmCleanText(txt.slice(0, i));
      const w = before.split(' ').filter(Boolean);
      if (w.length > 4) before = w.slice(-4).join(' '); // drop any leading tab/nav text
      return before;
    };

    // Method 1: the smallest element on the page that contains a PRN code.
    try {
      let best = null, bestLen = Infinity;
      const all = document.body.getElementsByTagName('*');
      for (let i = 0; i < all.length; i++) {
        const t = all[i].textContent;
        if (t && t.length < bestLen && /\bPRN:\s*[A-Za-z0-9]/i.test(t)) {
          best = t; bestLen = t.length;
        }
      }
      if (best) {
        const name = nameBeforePRN(best);
        if (ccmPlausibleName(name)) return ccmTitleCase(name);
      }
    } catch (e) {}

    // Method 2: an open chart tab whose label is an ALL-CAPS patient name.
    try {
      const SKIP = /MEDICARE|MEDICAID|AARP|COMPLETE|ADVANTAGE|BLUE|CROSS|SHIELD|AETNA|CIGNA|UNITED|HUMANA|ANTHEM|PATIENT LISTS|SELF[- ]PAY|NO RESTRICTION/;
      const els = document.querySelectorAll('a, li, [role="tab"], button, span, div');
      for (const el of els) {
        if (el.children && el.children.length > 2) continue; // tab labels are simple
        let t = ccmCleanText(el.textContent).replace(/[×✕✖xX]\s*$/, '').trim();
        if (/^[A-Z][A-Z'.\- ]{2,40}$/.test(t) && /\s/.test(t) && !SKIP.test(t)) {
          if (ccmPlausibleName(t)) return ccmTitleCase(t);
        }
      }
    } catch (e) {}

    // Method 3: the document title.
    try {
      const dt = ccmCleanText(document.title).replace(/\s*[-|–].*$/, '').trim();
      if (ccmPlausibleName(dt)) return ccmTitleCase(dt);
    } catch (e) {}

    return null;
  }

  function detectCurrentPatient() {
    const url = window.location.href;
    const isPracticeFusion = url.includes('practicefusion.com');
    const isPatientList = isOnPatientListPage();
    const isPatientChart = isOnPatientChartPage();

    let patientName = null;
    if (isPracticeFusion) {
      patientName = extractPatientNameFromBanner();
    }

    return {
      isPracticeFusion,
      isPatientList,
      isPatientChart,
      patientName,
      url
    };
  }

  // ============================================
  // EXPOSE FUNCTIONS FOR MC MODULE
  // ============================================
  // The MC batch processor needs access to the proven
  // patient search and CCM encounter navigation logic.
  window.__ccmPro = {
    searchAndOpenPatient,
    openCcmNoteAndInsert,
    navigateToCCMNote,
    goBackToChartsPage,
    getNameParts,
    nameMatchScore,
    normalizeName,
    isOnPatientListPage,
    isOnPatientChartPage,
    isOnLoginPage,
    handleLeaveDialog,
    sleep,
  };

})();

// ============================================================
// CCM MINUTES CALCULATOR - INTEGRATED MODULE
// Separate IIFE with its own guard so it can be injected
// independently of the main CCM Pro content script
// ============================================================

(function() {
  // Remove previous MC handler if it exists (prevents stale listener on re-injection)
  if (window.__ccmMCHandler) {
    chrome.runtime.onMessage.removeListener(window.__ccmMCHandler);
    console.log('CCM MC: Removed previous MC handler');
  }

  // Import shared helpers from main IIFE
  const hasTotalTimeMarker = window.__hasTotalTimeMarker || function(text) {
    return /Total\s+(?:CCM\s+)?(?:Monthly\s+)?(?:CCM\s+)?(?:Time|Minutes?)/i.test(text);
  };

  const mcAlreadyLoaded = !!window.ccmMCLoaded;
  window.ccmMCLoaded = true;
  console.log('CCM MC: Minutes Calculator module ' + (mcAlreadyLoaded ? 're-registered' : 'loaded'));

  // ── Minutes Calculator Selectors & Timing ──
  let MC_PF = {
    searchInput: 'input[placeholder*="Search"], input[data-testid="patient-search"], #patientSearchInput, .patient-search input',
    searchResults: '.patient-search-results .patient-item, .search-results-list li, [data-testid="patient-search-result"]',
    searchResultName: '.patient-name, .result-name, [data-testid="patient-name"]',
    encountersTab: '[data-tab="encounters"], .encounters-tab, a[href*="encounters"], .chart-tab-encounters',
    encounterItems: '.encounter-list-item, .encounter-item, [data-testid="encounter-item"], tr.encounter-row',
    encounterTitle: '.encounter-title, .encounter-type, .encounter-reason, td.reason',
    encounterDate: '.encounter-date, .date-column, td.date',
    encounterLink: 'a, .encounter-link, [data-action="open"]',
    noteContent: '.note-content, .encounter-note, .clinical-note-content, [data-testid="note-content"], .note-text-container',
    noteTextArea: 'textarea.note-text, [contenteditable="true"].note-body, .note-editor',
    backButton: '.back-button, .btn-back, [data-action="back"], .breadcrumb-back',
  };

  let MC_TIMING = {
    afterSearch: 1500,
    afterClickPatient: 2000,
    afterOpenNote: 2000,
    betweenPatients: 2000,
  };

  // Load saved MC settings
  (async function loadMCSettings() {
    try {
      const data = await chrome.storage.local.get(['pfSelectors', 'pfTiming']);
      if (data.pfSelectors) MC_PF = { ...MC_PF, ...data.pfSelectors };
      if (data.pfTiming) MC_TIMING = { ...MC_TIMING, ...data.pfTiming };
    } catch (e) { /* Use defaults */ }
  })();

  // ============================================
  // COPY FORWARD WORKFLOW FUNCTIONS
  // ============================================

  /**
   * Get the "Seen By" provider from a CCM encounter row on the Timeline page.
   * Scans the encounter table for the target month's CCM row and extracts the provider name.
   */
  async function getTimelineSeenBy(month, year) {
    console.log('=== getTimelineSeenBy for month:', month, 'year:', year);
    
    // Ensure we're on the Timeline tab
    const timelineTab = Array.from(document.querySelectorAll('a, button, [role="tab"]'))
      .find(el => (el.textContent || '').trim().toLowerCase() === 'timeline');
    if (timelineTab) {
      timelineTab.click();
      await sleep(2000);
    }

    const monthNames = ['', 'january','february','march','april','may','june',
                        'july','august','september','october','november','december'];
    const targetMonthName = monthNames[parseInt(month)] || '';
    const targetYear = String(year);
    const monthNum = String(month).padStart(2, '0');

    // Scan table rows for the CCM encounter matching the target month
    const rows = document.querySelectorAll('tr');
    console.log('Scanning', rows.length, 'timeline rows for CCM', targetMonthName, targetYear);

    for (const row of rows) {
      const rowText = (row.textContent || '').toLowerCase();
      
      // Must have CCM
      if (!rowText.includes('ccm')) continue;
      
      // Must match target month
      const hasMonth = rowText.includes(targetMonthName) || 
                       rowText.includes('cccm - ' + targetMonthName) ||
                       rowText.includes('cccm- ' + targetMonthName);
      
      // Also check date column (e.g., "01/01/2026")
      const dateRegex = new RegExp('(?:^|\\s)' + monthNum + '/\\d{1,2}/' + targetYear);
      const hasDate = dateRegex.test(rowText);
      
      if (!hasMonth && !hasDate) continue;
      
      console.log('Found CCM row:', rowText.substring(0, 150));
      
      // Extract provider name from the TYPE/SOURCE column
      // The row structure is: TYPE/SOURCE cell | DETAILS cell | STATUS/DATE cell
      // TYPE/SOURCE shows "Office Visit\nKaden Lee"
      const cells = row.querySelectorAll('td');
      let seenBy = '';
      
      if (cells.length >= 1) {
        // First cell typically has "Office Visit" + provider name
        const cellText = cells[0].innerText || cells[0].textContent || '';
        const lines = cellText.split('\n').map(l => l.trim()).filter(l => l);
        
        // Provider name is usually the second line (after "Office Visit")
        if (lines.length >= 2) {
          // Skip lines that are visit type descriptors
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.toLowerCase().includes('visit') && 
                !line.toLowerCase().includes('office') &&
                line.length > 2) {
              seenBy = line;
              break;
            }
          }
        }
      }
      
      console.log('Extracted Seen By:', seenBy);
      return { success: true, seenBy: seenBy, found: true };
    }

    console.log('No CCM row found for', targetMonthName, targetYear);
    return { success: true, seenBy: '', found: false };
  }

  /**
   * Extract the current note's content for copy-forward.
   * Gets text/HTML up to "Monthly Patient Communication" marker, 
   * then appends "Total CCM Time for the Month:".
   */
  async function extractNoteForCopyForward() {
    console.log('=== extractNoteForCopyForward ===');
    await sleep(2000);

    // Try to get HTML content from the note editor (preserves formatting)
    let noteHTML = '';
    let noteText = '';
    
    // Method 1: WYSIHTML5 iframe editor
    const iframes = document.querySelectorAll(
      'iframe.wysihtml5-sandbox, iframe[class*="wysihtml"], iframe[class*="editor"]'
    );
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        if (iframeDoc && iframeDoc.body) {
          const html = iframeDoc.body.innerHTML;
          const text = iframeDoc.body.innerText || iframeDoc.body.textContent;
          if (text && text.trim().length > 50) {
            noteHTML = html;
            noteText = text;
            console.log('Extracted from WYSIHTML5 iframe, length:', html.length);
            break;
          }
        }
      } catch (e) { /* cross-origin */ }
    }

    // Method 2: Contenteditable element
    if (!noteHTML) {
      const editables = document.querySelectorAll('[contenteditable="true"]');
      for (const el of editables) {
        const text = el.innerText || el.textContent;
        if (text && text.trim().length > 100) {
          noteHTML = el.innerHTML;
          noteText = text;
          console.log('Extracted from contenteditable, length:', noteHTML.length);
          break;
        }
      }
    }

    // Method 3: Textarea
    if (!noteHTML) {
      const textareas = document.querySelectorAll('textarea');
      for (const ta of textareas) {
        if (ta.value && ta.value.trim().length > 100) {
          noteText = ta.value;
          noteHTML = ta.value.replace(/\n/g, '<br>');
          console.log('Extracted from textarea, length:', noteText.length);
          break;
        }
      }
    }

    if (!noteText) {
      return { success: false, error: 'Could not extract note content' };
    }

    // Find cutoff point: "Monthly Patient Communication" (case-insensitive)
    const cutoffPatterns = [
      /monthly\s+patient\s+communication/i,
      /patient\s+communication\s*:/i,
      /monthly\s+communication/i
    ];

    let cutoffIdx = -1;
    let cutoffPattern = null;
    
    for (const pattern of cutoffPatterns) {
      const match = noteText.match(pattern);
      if (match) {
        cutoffIdx = match.index + match[0].length;
        cutoffPattern = match[0];
        break;
      }
    }

    let forwardHTML = '';
    let forwardText = '';

    if (cutoffIdx > 0) {
      // Found the cutoff marker - take everything up to and including it
      console.log('Found cutoff at:', cutoffPattern, 'position:', cutoffIdx);
      
      // For HTML, find the same marker and cut there
      const htmlLower = noteHTML.toLowerCase();
      for (const pattern of cutoffPatterns) {
        const htmlMatch = htmlLower.match(pattern);
        if (htmlMatch) {
          // Find the end of the element containing the match
          let htmlCutIdx = htmlMatch.index + htmlMatch[0].length;
          
          // Look for closing tag after the match to include the full element
          const afterMatch = noteHTML.substring(htmlCutIdx);
          const closingTag = afterMatch.match(/^[^<]*(<\/[^>]+>)?/);
          if (closingTag) {
            htmlCutIdx += closingTag[0].length;
          }
          
          forwardHTML = noteHTML.substring(0, htmlCutIdx);
          break;
        }
      }
      
      forwardText = noteText.substring(0, cutoffIdx);
    } else {
      // No cutoff found - take everything up to "Total CCM Time"
      console.log('No "Monthly Patient Communication" found, cutting at Total CCM Time');
      const totalPattern = /total\s+ccm\s+time/i;
      const totalMatch = noteText.match(totalPattern);
      
      if (totalMatch) {
        forwardText = noteText.substring(0, totalMatch.index);
        
        const htmlTotalMatch = noteHTML.toLowerCase().match(totalPattern);
        if (htmlTotalMatch) {
          forwardHTML = noteHTML.substring(0, htmlTotalMatch.index);
        }
      } else {
        // Take everything
        forwardHTML = noteHTML;
        forwardText = noteText;
      }
    }

    // Append the Total CCM Time marker
    forwardHTML = forwardHTML.trimEnd() + '<br><br>Total CCM Time for the Month:';
    forwardText = forwardText.trimEnd() + '\n\nTotal CCM Time for the Month:';

    console.log('Forward content ready, HTML length:', forwardHTML.length, 'Text length:', forwardText.length);
    return { success: true, html: forwardHTML, text: forwardText };
  }

  /**
   * Navigate to the Timeline tab from an encounter page.
   */
  async function goToTimelineTab() {
    console.log('=== goToTimelineTab ===');
    
    // Method 1: Click the Timeline tab link in the patient chart header
    const tabs = document.querySelectorAll('a, button, [role="tab"]');
    for (const tab of tabs) {
      const text = (tab.textContent || '').trim().toLowerCase();
      if (text === 'timeline') {
        console.log('Found Timeline tab, clicking...');
        tab.click();
        await sleep(3000);
        
        // Verify we're on Timeline by checking for encounter list
        const hasEncounterList = document.querySelector('table') || 
          document.body.innerText.includes('TYPE/SOURCE') ||
          document.body.innerText.includes('New encounter');
        
        if (hasEncounterList) {
          console.log('Successfully on Timeline tab');
          return { success: true };
        }
      }
    }

    // Method 2: Use URL navigation
    const currentUrl = window.location.href;
    const patientMatch = currentUrl.match(/patients\/([^\/]+)/);
    if (patientMatch) {
      const patientId = patientMatch[1];
      const timelineUrl = `https://static.practicefusion.com/apps/ehr/index.html#/PF/charts/patients/${patientId}/timeline/encounter`;
      console.log('Navigating to Timeline via URL:', timelineUrl);
      window.location.href = timelineUrl;
      await sleep(4000);
      return { success: true };
    }

    return { success: false, error: 'Could not navigate to Timeline' };
  }

  /**
   * Click the "New encounter" button on the Timeline page.
   */
  async function clickNewEncounterButton() {
    console.log('=== clickNewEncounterButton ===');
    await sleep(1000);

    // Method 1: Find the green "New encounter" button by text
    const allButtons = document.querySelectorAll('button, a.btn, [role="button"]');
    for (const btn of allButtons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text.includes('new encounter') && btn.offsetParent !== null) {
        console.log('Found "New encounter" button, clicking...');
        btn.click();
        await sleep(4000);
        return { success: true };
      }
    }

    // Method 2: Look for button by class/attribute patterns common in PF
    const newEncBtn = document.querySelector(
      'button[data-element*="new-encounter"], ' +
      'button[class*="new-encounter"], ' +
      '.encounter-actions button.btn-success, ' +
      'button.btn-success[class*="encounter"]'
    );
    if (newEncBtn) {
      console.log('Found new encounter button via selector');
      newEncBtn.click();
      await sleep(4000);
      return { success: true };
    }

    // Method 3: Find any green button near top that creates encounters
    for (const btn of allButtons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      if ((text.includes('new') || text.includes('create') || text.includes('add')) && 
          text.includes('encounter') && btn.offsetParent !== null) {
        console.log('Found encounter create button:', text);
        btn.click();
        await sleep(4000);
        return { success: true };
      }
    }

    return { success: false, error: '"New encounter" button not found' };
  }

  /**
   * Fill the new encounter form fields.
   * @param {Object} options - { noteType, date (MM/DD/YYYY), seenBy, chiefComplaint }
   */
  async function fillNewEncounterForm(options) {
    console.log('=== fillNewEncounterForm ===', options);
    await sleep(2000);

    const results = { noteType: false, date: false, seenBy: false, chiefComplaint: false };

    // ── NOTE TYPE: Select "Complex CCM" from dropdown ──
    if (options.noteType) {
      console.log('Setting Note Type to:', options.noteType);
      
      // Find select elements - look for one labeled "NOTE TYPE" or containing CCM options
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        // Check if this select has CCM-related options
        const optTexts = Array.from(sel.options).map(o => o.text.toLowerCase());
        if (optTexts.some(t => t.includes('ccm') || t.includes('complex'))) {
          console.log('Found Note Type dropdown with', sel.options.length, 'options');
          
          // Find the matching option
          for (const opt of sel.options) {
            if (opt.text.toLowerCase().includes(options.noteType.toLowerCase())) {
              sel.value = opt.value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              sel.dispatchEvent(new Event('input', { bubbles: true }));
              results.noteType = true;
              console.log('Set Note Type to:', opt.text);
              break;
            }
          }
          break;
        }
        
        // Also check by nearby label
        const label = sel.closest('div, label, td')?.textContent || '';
        if (label.toLowerCase().includes('note type')) {
          for (const opt of sel.options) {
            if (opt.text.toLowerCase().includes('complex ccm')) {
              sel.value = opt.value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              results.noteType = true;
              console.log('Set Note Type (by label) to:', opt.text);
              break;
            }
          }
          break;
        }
      }
      await sleep(500);
    }

    // ── DATE: Set the encounter date ──
    if (options.date) {
      console.log('Setting Date to:', options.date);
      
      // Find date inputs
      const dateInputs = document.querySelectorAll('input[type="date"], input[type="text"]');
      for (const input of dateInputs) {
        // Check label or nearby text for "DATE" or "Date"
        const container = input.closest('div, label, td, fieldset');
        const containerText = (container?.textContent || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        
        if (containerText.includes('date') && !containerText.includes('last refreshed') &&
            (input.type === 'date' || placeholder.includes('mm/dd') || placeholder.includes('date') ||
             /^\d{2}\/\d{2}\/\d{4}$/.test(input.value))) {
          
          // Set the value using the native input setter to trigger Angular/React bindings
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(input, options.date);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
          results.date = true;
          console.log('Set Date to:', options.date);
          break;
        }
      }
      await sleep(500);
    }

    // ── SEEN BY: Select the provider from dropdown ──
    if (options.seenBy) {
      console.log('Setting Seen By to:', options.seenBy);
      
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const container = sel.closest('div, label, td, fieldset');
        const containerText = (container?.textContent || '').toLowerCase();
        
        if (containerText.includes('seen by') || containerText.includes('provider')) {
          console.log('Found Seen By dropdown with', sel.options.length, 'options');
          
          // Find matching option (partial match on name)
          const targetLower = options.seenBy.toLowerCase().trim();
          for (const opt of sel.options) {
            const optLower = opt.text.toLowerCase().trim();
            if (optLower === targetLower || optLower.includes(targetLower) || targetLower.includes(optLower)) {
              sel.value = opt.value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              sel.dispatchEvent(new Event('input', { bubbles: true }));
              results.seenBy = true;
              console.log('Set Seen By to:', opt.text);
              break;
            }
          }
          
          // If no exact match, try matching by last name
          if (!results.seenBy) {
            const targetParts = targetLower.split(/\s+/);
            const lastName = targetParts[targetParts.length - 1];
            for (const opt of sel.options) {
              if (opt.text.toLowerCase().includes(lastName)) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                results.seenBy = true;
                console.log('Set Seen By (by last name) to:', opt.text);
                break;
              }
            }
          }
          break;
        }
      }
      await sleep(500);
    }

    // ── CHIEF COMPLAINT: Type the text ──
    if (options.chiefComplaint) {
      console.log('Setting Chief Complaint to:', options.chiefComplaint);
      
      // Find input/textarea for chief complaint
      const inputs = document.querySelectorAll('input[type="text"], textarea');
      for (const input of inputs) {
        const container = input.closest('div, label, td, fieldset, section');
        const containerText = (container?.textContent || '').toLowerCase();
        
        if (containerText.includes('chief complaint') || 
            (input.placeholder || '').toLowerCase().includes('chief complaint')) {
          
          input.focus();
          const nativeSetter = Object.getOwnPropertyDescriptor(
            input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
          ).set;
          nativeSetter.call(input, options.chiefComplaint);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
          results.chiefComplaint = true;
          console.log('Set Chief Complaint to:', options.chiefComplaint);
          break;
        }
      }
      await sleep(500);
    }

    console.log('fillNewEncounterForm results:', results);
    return { success: true, results };
  }

  /**
   * Insert HTML content into the note editor (preserves formatting).
   * Used by copy-forward to paste the previous month's note structure.
   */
  async function insertNoteHTML(html) {
    console.log('=== insertNoteHTML, length:', html?.length);
    await sleep(3000);
    
    // Method 1: WYSIHTML5 iframe editor
    const iframes = document.querySelectorAll(
      'iframe.wysihtml5-sandbox, iframe[class*="wysihtml"], iframe[class*="editor"]'
    );
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        if (iframeDoc && iframeDoc.body) {
          console.log('Inserting HTML into WYSIHTML5 iframe');
          iframeDoc.body.innerHTML = html;
          
          // Sync to underlying textarea
          const textarea = iframe.parentElement?.querySelector('textarea') ||
            document.querySelector('textarea[data-wysihtml5-editor]');
          if (textarea) {
            textarea.value = iframeDoc.body.innerHTML;
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
          }
          
          return { success: true, method: 'wysihtml5_iframe' };
        }
      } catch (e) { /* cross-origin */ }
    }
    
    // Method 2: Contenteditable element
    const editables = document.querySelectorAll('[contenteditable="true"]');
    for (const el of editables) {
      if (el.offsetParent !== null && el.offsetHeight > 50) {
        console.log('Inserting HTML into contenteditable');
        el.innerHTML = html;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, method: 'contenteditable' };
      }
    }
    
    // Method 3: Textarea fallback (strip HTML to text)
    const textareas = document.querySelectorAll('textarea:not([hidden])');
    for (const ta of textareas) {
      if (ta.offsetParent !== null && ta.offsetHeight > 50) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const plainText = tmp.innerText || tmp.textContent;
        
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        nativeSetter.call(ta, plainText);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, method: 'textarea' };
      }
    }
    
    return { success: false, error: 'No editor element found' };
  }

  // ── MC Utility Functions ──

  function mcDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function mcWaitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const existing = mcQueryMultiple(selector);
      if (existing) { resolve(existing); return; }
      const observer = new MutationObserver(() => {
        const el = mcQueryMultiple(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout: ${selector}`)); }, timeout);
    });
  }

  function mcWaitForElements(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const existing = mcQueryAllMultiple(selector);
      if (existing.length > 0) { resolve(existing); return; }
      const observer = new MutationObserver(() => {
        const els = mcQueryAllMultiple(selector);
        if (els.length > 0) { observer.disconnect(); resolve(els); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout: ${selector}`)); }, timeout);
    });
  }

  function mcQueryMultiple(selectorString) {
    const selectors = selectorString.split(',').map(s => s.trim());
    for (const sel of selectors) {
      try { const el = document.querySelector(sel); if (el) return el; } catch (e) {}
    }
    return null;
  }

  function mcQueryAllMultiple(selectorString) {
    const selectors = selectorString.split(',').map(s => s.trim());
    for (const sel of selectors) {
      try { const els = document.querySelectorAll(sel); if (els.length > 0) return els; } catch (e) {}
    }
    return [];
  }

  // ── MC Get Current Patient Name from PF page ──
  function mcGetCurrentPatientName() {
    // Method 1: Patient demographics header (most reliable)
    const headerSelectors = [
      '[class*="patient-demographics"] [class*="name"]',
      '[class*="patient-header"] [class*="name"]',
      '.patient-info-header',
      '[class*="patient-demographics"]',
      '[class*="patient-header"]',
    ];
    for (const sel of headerSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          // Get just the name text, not PRN or other info
          const text = el.textContent.trim().split('\n')[0].trim();
          // Clean: remove PRN, age, etc. — name is usually the first bold/large text
          const cleanName = text.replace(/\s+(PRN|prn|FMH|MRN|DOB).*$/i, '').trim();
          if (cleanName && cleanName.length > 2 && cleanName.length < 60) return cleanName;
        }
      } catch (e) {}
    }

    // Method 2: Active tab in patient tabs bar
    const activeTab = document.querySelector('.patient-context-tab.active, [class*="patient-tab"][class*="active"]');
    if (activeTab) {
      const text = activeTab.textContent.trim();
      if (text && text.length > 2 && text.length < 60 && !text.includes('Patient lists')) return text;
    }

    // Method 3: Page title often contains patient name
    const title = document.title || '';
    if (title.includes('Practice Fusion') && title.includes('-')) {
      const parts = title.split('-');
      const namePart = parts[0].trim();
      if (namePart && namePart.length > 2 && namePart.length < 60) return namePart;
    }

    return null;
  }

  function mcSimulateTyping(element, text) {
    element.focus();
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('focus', { bubbles: true }));
    for (const char of text) {
      element.value += char;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function mcClearSearch(element) {
    element.focus();
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  // ── MC Note Text Extraction ──

  function mcExtractCurrentNoteText() {
    // Method 1: Standard selectors
    let noteEl = mcQueryMultiple(MC_PF.noteContent);
    if (noteEl) {
      const text = noteEl.innerText || noteEl.textContent;
      if (text && text.trim().length > 50) return text;
    }
    noteEl = mcQueryMultiple(MC_PF.noteTextArea);
    if (noteEl) {
      const text = noteEl.value || noteEl.innerText || noteEl.textContent;
      if (text && text.trim().length > 50) return text;
    }

    // Method 2: WYSIHTML5 iframe editor (used by Complex CCM and other note types)
    const wysiIframes = document.querySelectorAll(
      'iframe.wysihtml5-sandbox, iframe[class*="wysihtml"], iframe[class*="editor"]'
    );
    for (const iframe of wysiIframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        if (iframeDoc && iframeDoc.body) {
          const text = iframeDoc.body.innerText || iframeDoc.body.textContent;
          if (text && text.trim().length > 50) return text;
        }
      } catch (e) { /* cross-origin, skip */ }
    }

    // Method 3: Any contenteditable element (PF sometimes uses these for notes)
    const editables = document.querySelectorAll('[contenteditable="true"]');
    for (const el of editables) {
      const text = el.innerText || el.textContent;
      // Must be substantial text (not a small toolbar input)
      if (text && text.trim().length > 100) return text;
    }

    // Method 4: Fallback - find any large text block with time/CCM keywords
    const allElements = document.querySelectorAll('div, section, article, textarea');
    for (const el of allElements) {
      const text = el.innerText || el.value || '';
      if (text.length > 200 &&
          (text.match(/\d+\s*min(?:utes?|s)?\s+spent/i) ||
           text.match(/spent\s+\d+\s*min/i) ||
           text.includes('Chronic Care Management') ||
           text.includes('Total CCM Time') ||
           text.includes('CCM Conditions'))) {
        return text;
      }
    }

    return null;
  }

  // ── MC Calculate Current Note ──

  function mcCalculateCurrentNote() {
    const noteText = mcExtractCurrentNoteText();
    if (!noteText) {
      return { success: false, error: 'Could not find note content. Make sure a CCM note is open in Practice Fusion.' };
    }
    const result = CCMMinuteParser.parseNote(noteText);
    const totalField = CCMMinuteParser.findTotalCCMField(noteText);
    return {
      success: true,
      entries: result.entries.map(e => ({
        date: CCMMinuteParser.formatDate(e.date), minutes: e.minutes,
        source: e.source, description: e.description, staff: e.staff || 'Unknown'
      })),
      totalMinutes: result.totalMinutes,
      monthYear: result.monthYear,
      staffBreakdown: result.staffBreakdown.map(s => ({
        staff: s.staff, totalMinutes: s.totalMinutes, entryCount: s.entries.length
      })),
      totalFieldFound: totalField.found,
      totalFieldEmpty: totalField.isEmpty,
      totalFieldCurrentValue: totalField.currentValue
    };
  }

  // ── MC Insert Total Into Note ──

  function mcInsertTotalIntoNote(totalMinutes) {
    const textToInsert = `${totalMinutes} minutes`;
    console.log('MC Insert: Starting insertion of', textToInsert);

    // ── Strategy 1: Find "Total CCM Time for the Month:" field and fill it ──
    // This is the primary target — the designated field in the CCM note
    const fieldResult = mcInsertAtTotalField(totalMinutes);
    console.log('MC Insert: Strategy 1 (field match) result:', fieldResult);
    if (fieldResult.success) return fieldResult;

    // ── Strategy 2: Insert at cursor position in active element ──
    const cursorResult = mcInsertAtCursor(textToInsert);
    console.log('MC Insert: Strategy 2 (cursor) result:', cursorResult);
    if (cursorResult.success) return cursorResult;

    // ── Strategy 3: Insert at cursor in WYSIHTML5 iframe editor ──
    const iframeResult = mcInsertAtIframeCursor(textToInsert);
    if (iframeResult.success) return iframeResult;

    return { success: false, error: 'Could not find note element' };
  }

  // Insert text at the current cursor position in contenteditable or textarea
  function mcInsertAtCursor(text) {
    // Check active element first
    const active = document.activeElement;

    // Case 1: Textarea
    if (active && active.tagName === 'TEXTAREA' && active.selectionStart !== undefined) {
      const pos = active.selectionStart;
      const before = active.value.substring(0, pos);
      const after = active.value.substring(active.selectionEnd || pos);
      active.value = before + text + after;
      const newPos = pos + text.length;
      active.setSelectionRange(newPos, newPos);
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, method: 'textarea_cursor' };
    }

    // Case 2: Contenteditable element
    if (active && active.contentEditable === 'true') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        // Verify the selection is inside the active element
        if (active.contains(range.startContainer)) {
          range.deleteContents();
          const textNode = document.createTextNode(text);
          range.insertNode(textNode);
          // Move cursor to end of inserted text
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          sel.removeAllRanges();
          sel.addRange(range);
          active.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true, method: 'contenteditable_cursor' };
        }
      }
    }

    // Case 3: Check any contenteditable element with a selection
    const allEditables = document.querySelectorAll('[contenteditable="true"]');
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      for (const editable of allEditables) {
        if (editable.contains(range.startContainer) && editable.offsetParent !== null) {
          range.deleteContents();
          const textNode = document.createTextNode(text);
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          sel.removeAllRanges();
          sel.addRange(range);
          editable.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true, method: 'contenteditable_selection' };
        }
      }
    }

    return { success: false };
  }

  // Insert text at cursor position inside a WYSIHTML5 iframe editor
  function mcInsertAtIframeCursor(text) {
    const iframes = document.querySelectorAll(
      'iframe.wysihtml5-sandbox, iframe[class*="wysihtml"], iframe[class*="editor"]'
    );
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        if (!iframeDoc || !iframeDoc.body) continue;

        const iframeWin = iframe.contentWindow;
        const sel = iframeWin.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          if (iframeDoc.body.contains(range.startContainer)) {
            range.deleteContents();
            const textNode = iframeDoc.createTextNode(text);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            sel.removeAllRanges();
            sel.addRange(range);
            // Sync back to hidden textarea
            mcSyncIframeToTextarea(iframe, iframeDoc);
            return { success: true, method: 'iframe_cursor' };
          }
        }
      } catch (e) { /* cross-origin, skip */ }
    }
    return { success: false };
  }

  // Sync WYSIHTML5 iframe content back to hidden textarea
  function mcSyncIframeToTextarea(iframe, iframeDoc) {
    try {
      // After inserting into this iframe, sync to its sibling textarea
      // We KNOW this is the right iframe (we just modified it), so sync to
      // the nearest hidden textarea in the same container — no marker check needed
      const container = iframe.parentElement;
      if (!container) return;
      
      const textareas = container.querySelectorAll('textarea');
      for (const ta of textareas) {
        // Target hidden textareas (WYSIHTML5 backing store)
        if (ta.style.display === 'none' || ta.hidden || ta.offsetParent === null) {
          console.log('MC Sync: iframe→sibling textarea, old length:', ta.value.length, 'new length:', iframeDoc.body.innerHTML.length);
          ta.value = iframeDoc.body.innerHTML;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('MC Sync: iframe→textarea synced successfully');
          return;
        }
      }
      
      // If no hidden textarea in container, try any textarea in container
      for (const ta of textareas) {
        if (ta.value && ta.value.length > 20) {
          console.log('MC Sync: iframe→visible textarea fallback');
          ta.value = iframeDoc.body.innerHTML;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
      
      console.log('MC Sync: No sibling textarea found in container');
    } catch (e) {
      console.log('MC Sync: iframe→textarea error:', e.message);
    }
  }

  // Sync a contenteditable element's content to any nearby textarea
  // PF's WYSIHTML5 editor uses a contenteditable for display but saves from a hidden textarea
  function syncContenteditableToTextarea(el) {
    try {
      const html = el.innerHTML;
      
      // Method 1: Walk up the DOM looking for a container that has a textarea sibling
      let container = el.parentElement;
      for (let depth = 0; depth < 5 && container; depth++) {
        const textareas = container.querySelectorAll('textarea');
        for (const ta of textareas) {
          if (ta !== el && ta.value && ta.value.length > 20) {
            console.log('MC Sync: contenteditable→textarea (depth ' + depth + '), old len:', ta.value.length);
            ta.value = html;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('MC Sync: contenteditable→textarea synced, new len:', ta.value.length);
            return;
          }
        }
        container = container.parentElement;
      }
      
      // Method 2: Check if this contenteditable is inside an iframe
      // If so, sync to that iframe's sibling textarea
      if (el.ownerDocument !== document) {
        // We're inside an iframe
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
          try {
            if (iframe.contentDocument === el.ownerDocument) {
              mcSyncIframeToTextarea(iframe, el.ownerDocument);
              return;
            }
          } catch(e) { /* cross-origin */ }
        }
      }
      
      // Method 3: Find any textarea on page with CCM content (last resort, targeted)
      const allTA = document.querySelectorAll('textarea');
      for (const ta of allTA) {
        if (ta.value && hasTotalTimeMarker(ta.value)) {
          console.log('MC Sync: contenteditable→textarea with CCM marker (broad fallback)');
          ta.value = html;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
      
      console.log('MC Sync: No textarea found for contenteditable sync');
    } catch(e) {
      console.log('MC Sync: contenteditable sync error:', e.message);
    }
  }

  // Insert into the "Total CCM Time for the Month:" field specifically
  // Replaces any existing value (e.g. "133 minutes" → "140 minutes")
  function mcInsertAtTotalField(totalMinutes) {
    const text = `${totalMinutes} minutes`;
    console.log('MC InsertField: Looking for total field to insert:', text);
    
    // Pattern matches multiple variations of the total time field
    const fieldPatterns = [
      /(Total\s+CCM\s+Time\s+for\s+the\s+[Mm]onth\s*:\s*)(\d+\s*min(?:utes?)?)?/i,
      /(Total\s+Monthly\s+Time\s*:\s*)(\d+\s*min(?:utes?)?)?/i,
      /(Total\s+Monthly\s+CCM\s+(?:Time|Minutes?)\s*:\s*)(\d+\s*min(?:utes?)?)?/i,
      /(Total\s+CCM\s+(?:Time|Minutes?)\s*:\s*)(\d+\s*min(?:utes?)?)?/i,
      /(Total\s+(?:Time|Minutes?)\s+(?:for\s+(?:the\s+)?)?(?:Month|Monthly)\s*:\s*)(\d+\s*min(?:utes?)?)?/i,
    ];

    function tryReplace(str) {
      for (let p = 0; p < fieldPatterns.length; p++) {
        if (fieldPatterns[p].test(str)) {
          console.log(`MC InsertField: Pattern ${p} matched in string`);
          return { matched: true, result: str.replace(fieldPatterns[p], `$1${text}`) };
        }
      }
      return { matched: false };
    }
    
    // Helper: replace in text nodes within an element
    function replaceInTextNodes(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while (node = walker.nextNode()) {
        for (const pattern of fieldPatterns) {
          if (pattern.test(node.textContent)) {
            console.log('MC InsertField: Matched text node:', JSON.stringify(node.textContent.substring(0, 80)));
            node.textContent = node.textContent.replace(pattern, `$1${text}`);
            return true;
          }
        }
      }
      return false;
    }

    let visualSuccess = false;
    let textareaSuccess = false;
    let method = 'none';

    // ════════════════════════════════════════
    // PART 1: Update ALL textareas (this is what PF actually saves)
    // The textarea contains HTML (WYSIHTML5 backing store), so we parse it
    // into a temp element, do text node replacement, and write it back.
    // ════════════════════════════════════════
    const ALL_textareas = document.querySelectorAll('textarea');
    console.log('MC InsertField: Total textareas on page:', ALL_textareas.length);
    
    for (const ta of ALL_textareas) {
      const val = ta.value || '';
      if (val.length < 10) continue;
      
      const taId = ta.id || ta.name || '(no id)';
      
      // First try direct regex on the raw value (works if text isn't wrapped in tags)
      const r = tryReplace(val);
      if (r.matched) {
        ta.value = r.result;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('MC InsertField: ✓ TEXTAREA UPDATED directly (this is what PF saves)');
        textareaSuccess = true;
        method = 'textarea_direct';
        continue;
      }
      
      // If direct regex failed, the text is likely wrapped in HTML tags.
      // Parse into a temp element, check text content for marker, then replace in text nodes.
      const stripped = val.replace(/<[^>]+>/g, '');
      if (!hasTotalTimeMarker(stripped)) {
        console.log('MC InsertField: Textarea id=' + taId + ' has no marker, skipping');
        continue;
      }
      
      console.log('MC InsertField: Textarea id=' + taId + ' has marker in HTML. Parsing DOM to replace...');
      
      // Parse the HTML into a temporary element
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = val;
      
      // Walk text nodes and do the replacement
      if (replaceInTextNodes(tempDiv)) {
        ta.value = tempDiv.innerHTML;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('MC InsertField: ✓ TEXTAREA UPDATED via DOM parse (this is what PF saves)');
        textareaSuccess = true;
        method = 'textarea_dom_parse';
      } else {
        console.log('MC InsertField: WARNING - marker found but text node replacement failed in textarea');
        console.log('MC InsertField: Textarea last 120:', JSON.stringify(val.substring(val.length - 120)));
      }
    }

    // ════════════════════════════════════════
    // PART 2: Update visual elements (so user sees the change)
    // This is cosmetic — Part 1 is what actually persists
    // ════════════════════════════════════════

    // Try iframes (WYSIHTML5 visual editor)
    const ALL_iframes = document.querySelectorAll('iframe');
    for (const iframe of ALL_iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc || !iframeDoc.body) continue;
        const iframeText = iframeDoc.body.textContent || '';
        if (!hasTotalTimeMarker(iframeText)) continue;
        
        const r = tryReplace(iframeDoc.body.innerHTML);
        if (r.matched) {
          iframeDoc.body.innerHTML = r.result;
          console.log('MC InsertField: ✓ Updated iframe visual');
          visualSuccess = true;
          if (!textareaSuccess) method = 'iframe_visual_only';
        } else if (replaceInTextNodes(iframeDoc.body)) {
          console.log('MC InsertField: ✓ Updated iframe textnode visual');
          visualSuccess = true;
          if (!textareaSuccess) method = 'iframe_textnode_visual_only';
        }
      } catch(e) { /* cross-origin */ }
    }

    // Try contenteditable elements
    if (!visualSuccess) {
      const allEditables = document.querySelectorAll('[contenteditable="true"]');
      for (const el of allEditables) {
        if (el.offsetParent === null) continue;
        const elText = el.textContent || '';
        if (!hasTotalTimeMarker(elText)) continue;
        
        const r = tryReplace(el.innerHTML);
        if (r.matched) {
          el.innerHTML = r.result;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          console.log('MC InsertField: ✓ Updated contenteditable visual');
          visualSuccess = true;
          if (!textareaSuccess) method = 'editable_visual_only';
        } else if (replaceInTextNodes(el)) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          console.log('MC InsertField: ✓ Updated contenteditable textnode visual');
          visualSuccess = true;
          if (!textareaSuccess) method = 'editable_textnode_visual_only';
        }
      }
    }

    // ════════════════════════════════════════
    // RESULT
    // ════════════════════════════════════════
    const success = textareaSuccess || visualSuccess;
    console.log('MC InsertField: Result — textarea:', textareaSuccess, 'visual:', visualSuccess, 'method:', method);
    
    if (!success) {
      console.log('MC InsertField: FAILED — no matching field found anywhere');
      const pageText = document.body.textContent || '';
      console.log('MC InsertField: Page has marker:', hasTotalTimeMarker(pageText));
      console.log('MC InsertField: Page text last 200:', JSON.stringify(pageText.substring(pageText.length - 200)));
    }
    
    return { success, method, textareaUpdated: textareaSuccess, visualUpdated: visualSuccess };
  }
  
  // Directly update associated textarea for WYSIHTML5 iframe
  // PF saves from the hidden textarea, not the iframe
  function mcDirectUpdateTextarea(iframe, iframeDoc) {
    // This is called right after inserting into the iframe.
    // We need to ensure the backing textarea has the updated content.
    // mcSyncIframeToTextarea handles the sibling — this is the broader fallback.
    try {
      // Look for any hidden textarea on the page that has CCM note content
      const allTA = document.querySelectorAll('textarea');
      for (const ta of allTA) {
        if (ta.value && hasTotalTimeMarker(ta.value)) {
          // This textarea has the CCM marker — update it with the iframe's new content
          ta.value = iframeDoc.body.innerHTML;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('MC InsertField: Synced to textarea with CCM marker (backup)');
          return;
        }
      }
    } catch(e) {
      console.log('MC InsertField: mcDirectUpdateTextarea error:', e.message);
    }
  }

  // ── MC Selector Testing ──

  function mcTestSelectors() {
    const results = {};
    for (const [key, selector] of Object.entries(MC_PF)) {
      const el = mcQueryMultiple(selector);
      results[key] = !!el;
    }
    return results;
  }

  // ── MC Batch Processing ──
  // NOTE: Batch orchestration is now handled by popup.js using the same
  // sendMessageToTab / navigateToPatientList / ensureContentScriptLoaded pattern
  // as Review & Generate. Content.js only provides individual message handlers:
  //   'searchPatient'       — from main CCM Pro
  //   'openAndInsertCCM'    — with '__MC_CALC_ONLY__' to skip text insertion
  //   'mc_calculateCurrent' — reads note, parses minutes
  //   'mc_insertTotal'      — fills Total CCM Time field
  //   'saveCCMNote'         — from main CCM Pro
  //   'clearSearch'         — from main CCM Pro

  let mcBatchAborted = false;

  // Helper: Insert total into WYSIHTML5 iframe (fallback for batch mode)
  function mcInsertTotalViaIframe(totalMinutes) {
    // Just delegate to the comprehensive function
    const result = mcInsertAtTotalField(totalMinutes);
    if (result.success) {
      console.log('MC Batch: Inserted total via', result.method);
      return true;
    }
    return false;
  }

  // ── MC Floating Action Button ──

  function mcCreateFloatingButton() {
    if (document.getElementById('ccm-calc-fab')) return;

    const fab = document.createElement('div');
    fab.id = 'ccm-calc-fab';
    fab.innerHTML = `<button id="ccm-calc-btn" title="Calculate CCM Minutes">
      <span style="font-size:18px;">⏱️</span>
      <span style="font-size:11px;display:block;line-height:1;">CCM</span>
    </button>`;
    document.body.appendChild(fab);

    document.getElementById('ccm-calc-btn').addEventListener('click', () => {
      const result = mcCalculateCurrentNote();
      mcShowResultsOverlay(result);
    });
  }

  function mcShowResultsOverlay(result) {
    const existing = document.getElementById('ccm-calc-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ccm-calc-overlay';

    if (!result.success) {
      overlay.innerHTML = `<div class="ccm-overlay-content">
        <div class="ccm-overlay-header"><h3>CCM Minutes Calculator</h3>
          <button class="ccm-close-btn" id="ccm-close-overlay">✕</button></div>
        <div class="ccm-overlay-body"><p class="ccm-error">${result.error}</p></div></div>`;
    } else {
      let staffHTML = '';
      if (result.staffBreakdown && result.staffBreakdown.length > 0) {
        staffHTML = `<div class="ccm-staff-breakdown"><div class="ccm-staff-title">Minutes by Staff</div>
          <div class="ccm-staff-bars">${result.staffBreakdown.map(s => `<div class="ccm-staff-row">
            <span class="ccm-staff-name">${s.staff}</span>
            <div class="ccm-staff-bar-container">
              <div class="ccm-staff-bar" style="width:${Math.round((s.totalMinutes/result.totalMinutes)*100)}%"></div></div>
            <span class="ccm-staff-mins">${s.totalMinutes} min</span></div>`).join('')}</div></div>`;
      }

      overlay.innerHTML = `<div class="ccm-overlay-content">
        <div class="ccm-overlay-header"><h3>CCM Minutes Calculator</h3>
          <button class="ccm-close-btn" id="ccm-close-overlay">✕</button></div>
        <div class="ccm-overlay-body">
          ${result.monthYear ? `<p class="ccm-month-label">${result.monthYear}</p>` : ''}
          <div class="ccm-total-box"><span class="ccm-total-label">Total CCM Time:</span>
            <span class="ccm-total-value">${result.totalMinutes} minutes</span></div>
          ${staffHTML}
          <table class="ccm-entries-table"><thead>
            <tr><th>Date</th><th>Min</th><th>Staff</th><th>Type</th><th>Description</th></tr></thead>
            <tbody>${result.entries.map(e => `<tr>
              <td>${e.date}</td><td><strong>${e.minutes}</strong></td><td>${e.staff||'?'}</td>
              <td><span class="ccm-source-badge ccm-source-${e.source}">${e.source.replace(/_/g,' ')}</span></td>
              <td class="ccm-desc">${e.description}</td></tr>`).join('')}</tbody></table>
          <div class="ccm-actions">
            ${result.totalFieldFound && result.totalFieldEmpty
              ? `<button id="ccm-insert-total" class="ccm-btn ccm-btn-primary">Insert Total (${result.totalMinutes} min)</button>` : ''}
            <button id="ccm-copy-total" class="ccm-btn ccm-btn-secondary">Copy Total</button>
          </div></div></div>`;
    }

    document.body.appendChild(overlay);

    document.getElementById('ccm-close-overlay').addEventListener('click', () => overlay.remove());

    const insertBtn = document.getElementById('ccm-insert-total');
    if (insertBtn) insertBtn.addEventListener('click', () => {
      const r = mcInsertTotalIntoNote(result.totalMinutes);
      insertBtn.textContent = r.success ? '✓ Inserted!' : `Error: ${r.error}`;
      if (r.success) { insertBtn.disabled = true; insertBtn.classList.add('ccm-btn-success'); }
    });

    const copyBtn = document.getElementById('ccm-copy-total');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(`${result.totalMinutes} minutes`).then(() => {
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Total'; }, 2000);
      });
    });

    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
    });
  }

  // ── MC Message Handling (prefixed with mc_) ──

  window.__ccmMCHandler = (message, sender, sendResponse) => {
    switch (message.action) {
      case 'mc_ping':
        sendResponse({ success: true, message: 'MC content script is loaded' });
        return true;

      case 'mc_getPatientName':
        sendResponse({ success: true, patientName: mcGetCurrentPatientName() });
        return true;

      case 'mc_calculateCurrent':
        sendResponse(mcCalculateCurrentNote());
        return true;

      case 'mc_insertTotal':
        sendResponse(mcInsertTotalIntoNote(message.totalMinutes));
        return true;

      case 'mc_insertTotalAndSave': {
        // Strategy: Modify the WYSIHTML5 iframe using Selection/Range API
        // so the editor tracks the change and syncs to textarea on save.
        const totalMin = message.totalMinutes;
        const totalText = `${totalMin} minutes`;
        console.log('MC InsertAndSave: Starting for', totalText);
        
        const fieldPatterns = [
          /(Total\s+CCM\s+Time\s+for\s+the\s+[Mm]onth\s*:\s*)(\d+\s*min(?:utes?)?)?/i,
          /(Total\s+Monthly\s+Time\s*:\s*)(\d+\s*min(?:utes?)?)?/i,
          /(Total\s+Monthly\s+CCM\s+(?:Time|Minutes?)\s*:\s*)(\d+\s*min(?:utes?)?)?/i,
          /(Total\s+CCM\s+(?:Time|Minutes?)\s*:\s*)(\d+\s*min(?:utes?)?)?/i,
          /(Total\s+(?:Time|Minutes?)\s+(?:for\s+(?:the\s+)?)?(?:Month|Monthly)\s*:\s*)(\d+\s*min(?:utes?)?)?/i,
        ];
        
        let inserted = false;
        
        // ── APPROACH 1: Find the text node in the WYSIHTML5 iframe and use execCommand ──
        const allIframes = document.querySelectorAll('iframe');
        console.log('MC InsertAndSave: Checking', allIframes.length, 'iframes');
        
        for (const iframe of allIframes) {
          try {
            const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!iDoc || !iDoc.body) continue;
            const bodyText = iDoc.body.textContent || '';
            if (!hasTotalTimeMarker(bodyText)) continue;
            
            console.log('MC InsertAndSave: Found CCM iframe, body length:', bodyText.length);
            
            // Walk text nodes to find the one with the total marker
            const walker = iDoc.createTreeWalker(iDoc.body, NodeFilter.SHOW_TEXT, null, false);
            let targetNode = null;
            let matchedPattern = null;
            let node;
            while (node = walker.nextNode()) {
              for (const p of fieldPatterns) {
                if (p.test(node.textContent)) {
                  targetNode = node;
                  matchedPattern = p;
                  break;
                }
              }
              if (targetNode) break;
            }
            
            if (!targetNode) {
              console.log('MC InsertAndSave: Marker found in body but not in individual text node');
              // The text might be split across nodes. Try the whole line approach.
              // Find text nodes containing "Total" and "Month" or "Time"
              const walker2 = iDoc.createTreeWalker(iDoc.body, NodeFilter.SHOW_TEXT, null, false);
              while (node = walker2.nextNode()) {
                const t = node.textContent.trim();
                if (t.match(/Total\s+CCM\s+Time/i) || t.match(/Total\s+Monthly\s+Time/i) || t.match(/Total\s+CCM\s+Time\s+for/i)) {
                  // This node contains the label. The value might be in the same node after ":"
                  // or might be empty (needs appending)
                  targetNode = node;
                  // Use a generic pattern
                  matchedPattern = /(:\s*)(\d+\s*min(?:utes?)?)?$/i;
                  if (!matchedPattern.test(t)) {
                    // Doesn't end with colon — try the next text node for the value
                    matchedPattern = null;
                  }
                  break;
                }
              }
            }
            
            if (targetNode && matchedPattern) {
              console.log('MC InsertAndSave: Found target text node:', JSON.stringify(targetNode.textContent));
              
              // Method A: Use Selection/Range to select after the colon and insertText
              try {
                const iWin = iframe.contentWindow;
                const sel = iWin.getSelection();
                const range = iDoc.createRange();
                
                // Find where the colon+space ends in this text node
                const match = targetNode.textContent.match(matchedPattern);
                if (match) {
                  const colonEnd = match.index + match[1].length;
                  const existingValueEnd = match[0].length + match.index;
                  
                  // Select existing value (if any) so insertText replaces it
                  range.setStart(targetNode, colonEnd);
                  range.setEnd(targetNode, existingValueEnd);
                  sel.removeAllRanges();
                  sel.addRange(range);
                  
                  // Use execCommand insertText — WYSIHTML5 tracks this as a user edit
                  const execResult = iDoc.execCommand('insertText', false, totalText);
                  console.log('MC InsertAndSave: execCommand insertText result:', execResult);
                  
                  if (execResult) {
                    inserted = true;
                    console.log('MC InsertAndSave: ✓ Inserted via execCommand in iframe');
                  }
                }
              } catch(selErr) {
                console.log('MC InsertAndSave: Selection method failed:', selErr.message);
              }
              
              // Method B: If execCommand failed, do direct text node modification
              if (!inserted) {
                console.log('MC InsertAndSave: Falling back to direct text node modification');
                const oldText = targetNode.textContent;
                targetNode.textContent = oldText.replace(matchedPattern, `$1${totalText}`);
                
                // Trigger WYSIHTML5 change detection
                iDoc.body.dispatchEvent(new Event('input', { bubbles: true }));
                iDoc.body.dispatchEvent(new Event('change', { bubbles: true }));
                
                // Try to trigger WYSIHTML5's internal sync
                const composerEl = iDoc.body;
                if (composerEl) {
                  composerEl.dispatchEvent(new Event('focus', { bubbles: true }));
                  composerEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
                  composerEl.dispatchEvent(new Event('blur', { bubbles: true }));
                }
                
                inserted = true;
                console.log('MC InsertAndSave: ✓ Inserted via direct textContent + events');
              }
              
              // Method C: ALSO force-sync iframe HTML → sibling textarea as backup
              if (inserted) {
                try {
                  const parent = iframe.parentElement;
                  if (parent) {
                    const textareas = parent.querySelectorAll('textarea');
                    for (const ta of textareas) {
                      if (ta.style.display === 'none' || ta.hidden || ta.offsetParent === null) {
                        console.log('MC InsertAndSave: Force-syncing iframe→textarea, old len:', ta.value.length);
                        ta.value = iDoc.body.innerHTML;
                        ta.dispatchEvent(new Event('input', { bubbles: true }));
                        ta.dispatchEvent(new Event('change', { bubbles: true }));
                        console.log('MC InsertAndSave: ✓ Textarea synced, new len:', ta.value.length);
                      }
                    }
                  }
                } catch(syncErr) {
                  console.log('MC InsertAndSave: Textarea sync error:', syncErr.message);
                }
              }
            } else {
              console.log('MC InsertAndSave: Could not find target text node in iframe');
            }
            
            if (inserted) break;
          } catch(e) {
            console.log('MC InsertAndSave: Iframe error:', e.message);
          }
        }
        
        // ── APPROACH 2: If no iframe worked, try contenteditable directly ──
        if (!inserted) {
          console.log('MC InsertAndSave: No iframe success, trying contenteditables...');
          const editables = document.querySelectorAll('[contenteditable="true"]');
          for (const el of editables) {
            if (el.offsetParent === null) continue;
            const elText = el.textContent || '';
            if (!hasTotalTimeMarker(elText)) continue;
            
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
              for (const p of fieldPatterns) {
                if (p.test(node.textContent)) {
                  // Try execCommand
                  const sel = window.getSelection();
                  const range = document.createRange();
                  const match = node.textContent.match(p);
                  if (match) {
                    const start = match.index + match[1].length;
                    const end = match.index + match[0].length;
                    range.setStart(node, start);
                    range.setEnd(node, end);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    
                    if (document.execCommand('insertText', false, totalText)) {
                      console.log('MC InsertAndSave: ✓ Inserted via execCommand in contenteditable');
                      inserted = true;
                    } else {
                      node.textContent = node.textContent.replace(p, `$1${totalText}`);
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      console.log('MC InsertAndSave: ✓ Inserted via textContent in contenteditable');
                      inserted = true;
                    }
                  }
                  break;
                }
              }
              if (inserted) break;
            }
            if (inserted) break;
          }
        }
        
        // ── APPROACH 3: Direct textarea replacement as last resort ──
        if (!inserted) {
          console.log('MC InsertAndSave: No visual editor found, trying textarea directly...');
          const textareas = document.querySelectorAll('textarea');
          for (const ta of textareas) {
            const val = ta.value || '';
            if (val.length < 10) continue;
            const stripped = val.replace(/<[^>]+>/g, '');
            if (!hasTotalTimeMarker(stripped) && !hasTotalTimeMarker(val)) continue;
            
            // Parse HTML and replace in text nodes
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = val;
            const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
              for (const p of fieldPatterns) {
                if (p.test(node.textContent)) {
                  node.textContent = node.textContent.replace(p, `$1${totalText}`);
                  ta.value = tempDiv.innerHTML;
                  ta.dispatchEvent(new Event('input', { bubbles: true }));
                  ta.dispatchEvent(new Event('change', { bubbles: true }));
                  console.log('MC InsertAndSave: ✓ Updated textarea via DOM parse');
                  inserted = true;
                  break;
                }
              }
              if (inserted) break;
            }
            
            // Also try direct regex on raw value
            if (!inserted) {
              for (const p of fieldPatterns) {
                if (p.test(val)) {
                  ta.value = val.replace(p, `$1${totalText}`);
                  ta.dispatchEvent(new Event('input', { bubbles: true }));
                  ta.dispatchEvent(new Event('change', { bubbles: true }));
                  console.log('MC InsertAndSave: ✓ Updated textarea directly');
                  inserted = true;
                  break;
                }
              }
            }
            if (inserted) break;
          }
        }
        
        console.log('MC InsertAndSave: Insert result:', inserted);
        
        // ── NOW SAVE (after a delay for WYSIHTML5 to register changes) ──
        setTimeout(() => {
          // Find Save button
          let saveBtn = null;
          const allBtns = document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn');
          for (const btn of allBtns) {
            const label = (btn.textContent || btn.value || '').trim().toLowerCase();
            if ((label === 'save' || label.startsWith('save')) && btn.offsetParent !== null && !btn.disabled) {
              saveBtn = btn;
              break;
            }
          }
          if (!saveBtn) saveBtn = document.querySelector('[data-element*="save"], .save-button, .btn-save');
          
          if (saveBtn) {
            // BEFORE clicking save, verify the textarea has our value
            const allTA = document.querySelectorAll('textarea');
            for (const ta of allTA) {
              const val = ta.value || '';
              if (val.includes(totalText)) {
                console.log('MC InsertAndSave: ✓ Textarea confirmed to have total before save');
              } else if (hasTotalTimeMarker(val) || hasTotalTimeMarker(val.replace(/<[^>]+>/g, ''))) {
                console.log('MC InsertAndSave: ⚠ Textarea has marker but NOT our value! Forcing update...');
                // Force it one more time
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = val;
                const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null, false);
                let n;
                while (n = walker.nextNode()) {
                  for (const p of fieldPatterns) {
                    if (p.test(n.textContent)) {
                      n.textContent = n.textContent.replace(p, `$1${totalText}`);
                      ta.value = tempDiv.innerHTML;
                      ta.dispatchEvent(new Event('input', { bubbles: true }));
                      console.log('MC InsertAndSave: ✓ Force-updated textarea right before save');
                      break;
                    }
                  }
                }
              }
            }
            
            console.log('MC InsertAndSave: Clicking Save');
            saveBtn.click();
          } else {
            console.log('MC InsertAndSave: Save button not found!');
          }
        }, 1000);
        
        sendResponse({ success: inserted, method: inserted ? 'iframe_execCommand' : 'failed' });
        return true;
      }

      case 'mc_syncEditorBeforeSave': {
        // No-op: Part 1 of mcInsertAtTotalField now updates textareas directly.
        // We no longer need to sync iframe→textarea (that was overwriting our changes).
        console.log('MC Sync: Skipped — textarea already updated directly by Part 1');
        sendResponse({ success: true, synced: 0 });
        return true;
      }

      case 'mc_extractNoteText':
        const text = mcExtractCurrentNoteText();
        sendResponse({ success: !!text, text });
        return true;

      case 'mc_parseText':
        const parsed = CCMMinuteParser.parseNote(message.text);
        sendResponse({
          success: true,
          entries: parsed.entries.map(e => ({
            date: CCMMinuteParser.formatDate(e.date), minutes: e.minutes,
            source: e.source, description: e.description, staff: e.staff || 'Unknown'
          })),
          totalMinutes: parsed.totalMinutes,
          monthYear: parsed.monthYear
        });
        return true;

      case 'mc_updateSettings':
        if (message.selectors) MC_PF = { ...MC_PF, ...message.selectors };
        if (message.timing) MC_TIMING = { ...MC_TIMING, ...message.timing };
        sendResponse({ success: true });
        return true;

      case 'mc_testSelectors':
        sendResponse({ results: mcTestSelectors() });
        return true;

      case 'mc_abortBatch':
        mcBatchAborted = true;
        sendResponse({ success: true });
        return true;
    }
  };

  // Register the MC handler
  chrome.runtime.onMessage.addListener(window.__ccmMCHandler);
  console.log('CCM MC: MC message handler registered');

  // ── MC Initialization ──
  if (window.location.hostname.includes('practicefusion.com')) {
    setTimeout(mcCreateFloatingButton, 3000);
  }

})();
