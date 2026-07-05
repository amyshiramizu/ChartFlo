// Practice Fusion fax composer auto-fill.
// Detects when the user is on a PF "Send fax" / "Compose fax" page and offers
// a one-click button that fills the recipient/facility, subject, and message
// body with the most recent orders queued from Chart Flo's Order Summary
// screen (stored in chrome.storage.local as `pendingOrders`).

(function () {
  'use strict';
  if (!location.hostname.includes('practicefusion.com')) return;
  if (window.top !== window.self) return;

  const CHECK_MS = 2000;
  let lastUrl = '';
  let lastInjectedFor = ''; // fingerprint of pending orders we already injected a banner for

  // ---------- DOM helpers ----------
  function setVal(el, value) {
    if (!el) return false;
    if (el.isContentEditable) {
      el.focus();
      el.innerText = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function findFieldByLabel(labels, tagPref = 'any') {
    const nodes = document.querySelectorAll('label, span, div, h3, h4, legend, p');
    for (const node of nodes) {
      const t = (node.textContent || '').trim().toLowerCase();
      if (!t || t.length > 60) continue;
      if (!labels.some((l) => t === l || t.startsWith(l + ':') || t.startsWith(l + ' ') || t === l + '*')) continue;
      const container = node.closest('div,section,fieldset,form') || node.parentElement;
      let target = null;
      if (tagPref === 'textarea') {
        target = container?.querySelector('textarea, [contenteditable="true"]');
      } else if (tagPref === 'input') {
        target = container?.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio])');
      } else {
        target =
          container?.querySelector('textarea, [contenteditable="true"]') ||
          container?.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio])');
      }
      if (target) return target;
    }
    return null;
  }

  // ---------- Page detection ----------
  function isFaxPage() {
    const url = location.href.toLowerCase();
    if (/(fax|compose-fax|send-fax|outbound-fax)/.test(url)) return true;

    const text = (document.body?.innerText || '').toLowerCase();
    // Look for telltale headings / buttons used by PF / Updox fax UI
    if (/send fax|compose fax|fax cover|fax number|recipient fax|to fax/.test(text)) {
      // Make sure there's at least a fax-number-style input on the page
      const faxInput =
        document.querySelector('input[name*="fax" i], input[id*="fax" i], input[placeholder*="fax" i]');
      if (faxInput) return true;
    }
    return false;
  }

  // ---------- Compose message body ----------
  function buildBody(orders) {
    if (!orders) return '';
    const lines = [];
    lines.push(`Patient: ${orders.patientName || ''}`);
    if (orders.mrn) lines.push(`MRN: ${orders.mrn}`);
    if (orders.date) lines.push(`Date: ${orders.date}`);
    lines.push('');
    lines.push('Orders:');
    (orders.orders || []).forEach((o) => lines.push(`  - ${o}`));
    return lines.join('\n');
  }

  function fillFax(orders) {
    const result = { filled: [], missed: [] };

    // Recipient / facility
    const recipient =
      findFieldByLabel(['recipient', 'recipient name', 'to', 'facility', 'company', 'practice'], 'input');
    if (recipient && orders.facility) {
      setVal(recipient, orders.facility);
      flash(recipient);
      result.filled.push('recipient');
    } else if (orders.facility) {
      result.missed.push('recipient');
    }

    // Subject
    const subject = findFieldByLabel(['subject', 're', 'regarding'], 'input');
    if (subject) {
      setVal(
        subject,
        `Orders – ${orders.patientName || ''}${orders.mrn ? ' (MRN ' + orders.mrn + ')' : ''}`,
      );
      flash(subject);
      result.filled.push('subject');
    }

    // Message / notes / body
    const body =
      findFieldByLabel(['message', 'note', 'notes', 'comments', 'body', 'memo', 'cover sheet'], 'textarea');
    if (body) {
      setVal(body, buildBody(orders));
      flash(body);
      result.filled.push('body');
    } else {
      result.missed.push('body');
    }

    return result;
  }

  function flash(el) {
    el.classList.add('cs-fax-flash');
    setTimeout(() => el.classList.remove('cs-fax-flash'), 1500);
  }

  // ---------- UI banner ----------
  function ensureBanner(orders) {
    if (document.getElementById('cs-fax-banner')) return;
    const el = document.createElement('div');
    el.id = 'cs-fax-banner';
    el.className = 'cs-fax-banner';
    el.innerHTML = `
      <div class="cs-fax-row">
        <div class="cs-fax-info">
          <strong>Chart Flo orders ready to fax</strong>
          <div class="cs-fax-meta">
            ${escapeHtml(orders.patientName || 'Unknown patient')}
            ${orders.mrn ? ' · MRN ' + escapeHtml(orders.mrn) : ''}
            ${orders.facility ? ' → ' + escapeHtml(orders.facility) : ''}
            · ${(orders.orders || []).length} order${(orders.orders || []).length === 1 ? '' : 's'}
          </div>
        </div>
        <div class="cs-fax-actions">
          <button id="cs-fax-fill">Fill fax</button>
          <button id="cs-fax-dismiss" title="Hide">×</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    document.getElementById('cs-fax-fill').addEventListener('click', () => {
      const r = fillFax(orders);
      if (r.filled.length) {
        showFlash(
          `Filled ${r.filled.join(', ')}${r.missed.length ? ' · missed ' + r.missed.join(', ') : ''}`,
        );
      } else {
        showFlash('No matching fax fields found on this page', true);
      }
    });
    document.getElementById('cs-fax-dismiss').addEventListener('click', () => el.remove());
  }

  function removeBanner() {
    document.getElementById('cs-fax-banner')?.remove();
  }

  function showFlash(msg, err = false) {
    const f = document.createElement('div');
    f.className = 'cs-fax-toast' + (err ? ' err' : '');
    f.textContent = msg;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 3000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------- Tick ----------
  function tick() {
    const onFax = isFaxPage();
    if (!onFax) { removeBanner(); return; }

    chrome.storage.local.get(['pendingOrders'], (d) => {
      const orders = d.pendingOrders;
      if (!orders || !orders.orders || orders.orders.length === 0) {
        removeBanner();
        return;
      }
      const fp = JSON.stringify(orders);
      if (fp === lastInjectedFor && document.getElementById('cs-fax-banner')) return;
      lastInjectedFor = fp;
      removeBanner();
      ensureBanner(orders);
    });
  }

  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastInjectedFor = '';
    }
    tick();
  }, CHECK_MS);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pendingOrders) tick();
  });

  tick();
})();
