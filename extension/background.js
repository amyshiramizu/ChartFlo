// Accept messages from the Chart Scribe web app via chrome.runtime.sendMessage
chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  if (!msg?.type) {
    sendResponse({ ok: false, error: 'no type' });
    return false;
  }

  if (msg.type === 'CHART_SCRIBE_NOTE' && msg.payload) {
    const medChanges = Array.isArray(msg.payload.medicationChanges) ? msg.payload.medicationChanges : [];
    chrome.storage.local.set(
      {
        draft: msg.payload,
        draftMeta: {
          updatedAt: new Date().toISOString(),
          patientName: msg.payload.patientName || null,
          mrn: msg.payload.mrn || null,
          medicationChangeCount: medChanges.length,
        },
        // Also stash structured med changes so the Medications workflow can pick them up
        ...(medChanges.length ? { pendingMeds: medChanges } : {}),
      },
      () => sendResponse({ ok: true }),
    );
    return true;
  }

  if (msg.type === 'CHART_SCRIBE_MEDS' && Array.isArray(msg.data)) {
    chrome.storage.local.set({ pendingMeds: msg.data }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'CHART_SCRIBE_ORDERS' && msg.data) {
    chrome.storage.local.set({ pendingOrders: msg.data }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'SET_ACTIVE_PATIENT' && msg.data) {
    chrome.storage.local.set(
      { activePatient: { id: msg.data.id, name: msg.data.name, manual: true } },
      () => sendResponse({ ok: true }),
    );
    return true;
  }

  if (msg.type === 'CLEAR_ACTIVE_PATIENT') {
    chrome.storage.local.remove('activePatient', () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'GET_EXTERNAL_TIME') {
    chrome.storage.local.get(['externalTimeLog'], (d) =>
      sendResponse({ log: d.externalTimeLog || [] }),
    );
    return true;
  }

  if (msg.type === 'CLEAR_EXTERNAL_TIME') {
    chrome.storage.local.set({ externalTimeLog: [] }, () => sendResponse({ ok: true }));
    return true;
  }

  sendResponse({ ok: false, error: 'unknown message' });
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Chart Scribe → Practice Fusion extension installed.');
});

// Open the side panel (docked on the right edge of the browser) when the
// toolbar icon is clicked. Falls back silently on older Chrome versions
// that do not expose the sidePanel API.
try {
  chrome.sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: true })
    ?.catch?.((e) => console.warn('sidePanel setPanelBehavior failed:', e));
} catch (e) {
  console.warn('sidePanel API unavailable:', e);
}
