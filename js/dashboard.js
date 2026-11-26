/* ==========================================================================
   Nextmorse Dashboard — dashboard.html companion
   --------------------------------------------------------------------------
   Vanilla JavaScript, no build step. Consumes the unified API (/api/v1):
   one base URL, one bearer token.

   - The base URL and token are typed in on the page. They are kept in
     sessionStorage (this tab only) and are sent ONLY to the base URL
     typed in, as an Authorization header. Nothing is written into this
     file: no token, no base URL, no password.
   - Reads: Overview (GET /v1/dashboard), Tax (/v1/tax), Bank (/v1/bank),
     Invoices (/v1/invoices/summary + /v1/invoices?open_only=1),
     Reports (/v1/reports). Meta (/v1/meta) supplies today and the
     treatment list.
   - Writes (Billing only): create invoice (POST /v1/invoices) and
     record a payment (POST /v1/receipts). Credit notes are not in
     this first version.
   - Error states: 401 = token not accepted; unreachable API =
     a distinct message; 422 = field errors shown under the field.
   ========================================================================== */
(function () {
  'use strict';

  var SS_BASE = 'nextmorse_dash_base';
  var SS_TOKEN = 'nextmorse_dash_token';

  var TREATMENTS_FALLBACK = ['vat_tds', 'vat_only', 'no_vat', 'no_vat_no_tds'];
  var TREATMENT_LABELS = {
    vat_tds: 'VAT + TDS',
    vat_only: 'VAT only',
    no_vat: 'No VAT',
    no_vat_no_tds: 'No VAT, no TDS (petty cash)'
  };

  function $(id) { return document.getElementById(id); }

  var el = {};
  var IDS = [
    'apiBase', 'apiToken', 'loadBtn', 'signoutBtn', 'signinError',
    'signinStatus', 'dashApp', 'dashStatus', 'dashError', 'reloadBtn',
    'verifiedAt', 'dashSource',
    'ovCards', 'ovFyRows',
    'taxCount', 'taxClearances', 'taxRows',
    'bankBalance', 'bankDeposits', 'bankWithdrawals', 'bankCount', 'bankRows',
    'invoiceSummary', 'invoiceRows', 'openRows', 'openListRows', 'anomalies',
    'auditRows', 'meetingRows', 'shareRows', 'logCount',
    'invClientFilter', 'invClient', 'invService', 'invAmount',
    'invTreatment', 'invDate', 'invDueDate', 'invDomain', 'invNotes',
    'invFormError', 'invFormSuccess', 'invSubmit', 'invoiceForm',
    'payInvoice', 'payInvoiceHint', 'payAmount', 'payDate', 'payTxnRef',
    'payReceiptNo', 'payFormError', 'payFormSuccess', 'paySubmit',
    'paymentForm'
  ];
  IDS.forEach(function (id) { el[id] = $(id); });

  var state = {
    base: '',
    token: '',
    meta: null,
    clients: [],
    openInvoices: [],
    loaded: {},   /* section key -> true once loaded */
    signedIn: false
  };

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function money(n) {
    if (n === null || n === undefined || n === '') return '—';
    var num = Number(n);
    if (isNaN(num)) return '—';
    return 'NPR ' + num.toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function show(box, msg) {
    if (!box) return;
    box.textContent = msg;
    box.classList.remove('d-none');
  }

  function hide(box) {
    if (!box) return;
    box.classList.add('d-none');
    box.textContent = '';
  }

  function setText(node, text) {
    if (node) node.textContent = text;
  }

  function setHtml(node, html) {
    if (node) node.innerHTML = html;
  }

  function todayAd() {
    if (state.meta && state.meta.today && state.meta.today.ad) {
      return state.meta.today.ad;
    }
    return new Date().toISOString().slice(0, 10);
  }

  /* ------------------------------------------------------------------ */
  /* API layer                                                           */
  /* ------------------------------------------------------------------ */

  function ApiError(status, body) {
    this.name = 'ApiError';
    this.status = status;
    this.body = body || {};
    this.message = (this.body && this.body.error) ||
      ('The API answered with status ' + status + '.');
  }
  ApiError.prototype = Object.create(Error.prototype);

  function apiBase() {
    return state.base.replace(/\/+$/, '');
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = {
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + state.token
    };
    var body;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    return fetch(apiBase() + '/api/v1' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: body
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) throw new ApiError(res.status, data);
        return data;
      });
    });
  }

  function friendlyError(err) {
    /* Network failures surface as a TypeError from fetch. Match on the
       name (not instanceof) so the check also holds across realms. */
    if (err && err.name === 'TypeError') {
      return 'Could not reach the API. Check the API base URL, and that the API is running.';
    }
    if (err instanceof ApiError) {
      if (err.status === 401) {
        return 'That token was not accepted (401). Check the token and try again.';
      }
      if (err.status === 403) {
        return 'The API refused this (403): ' + err.message;
      }
      if (err.status === 404) {
        return 'The API has no such record (404): ' + err.message;
      }
      if (err.status === 422) {
        return 'The API rejected the data (422). See the field messages below.';
      }
      if (err.status === 503) {
        return 'The API has no token configured (503). Ask whoever runs the API to set one.';
      }
      return err.message;
    }
    return (err && err.message) || 'Something went wrong.';
  }

  function fieldErrors(err) {
    if (err instanceof ApiError && err.status === 422 &&
        err.body && err.body.errors && typeof err.body.errors === 'object') {
      return err.body.errors;
    }
    return {};
  }

  /* ------------------------------------------------------------------ */
  /* Sign in / out                                                       */
  /* ------------------------------------------------------------------ */

  function setSignedInUI(signedIn) {
    state.signedIn = signedIn;
    if (signedIn) {
      el.dashApp.classList.remove('d-none');
      el.signoutBtn.classList.remove('d-none');
      el.loadBtn.textContent = 'Reload dashboard';
    } else {
      el.dashApp.classList.add('d-none');
      el.signoutBtn.classList.add('d-none');
      el.loadBtn.textContent = 'Load dashboard';
    }
  }

  function signIn() {
    hide(el.signinError);
    var base = (el.apiBase.value || '').trim().replace(/\/+$/, '');
    var token = (el.apiToken.value || '').trim();
    if (!base) {
      show(el.signinError, 'Enter the API base URL first — e.g. the Render dashboard address.');
      return;
    }
    if (base.indexOf('http://') !== 0 && base.indexOf('https://') !== 0) {
      show(el.signinError, 'Enter a full API base URL starting with https://');
      return;
    }
    if (!token) {
      show(el.signinError, 'Paste your API token first.');
      return;
    }
    state.base = base;
    state.token = token;
    try {
      sessionStorage.setItem(SS_BASE, base);
      sessionStorage.setItem(SS_TOKEN, token);
    } catch (e) { /* private mode: keep going without saving */ }

    setText(el.signinStatus, 'Loading…');
    el.loadBtn.disabled = true;
    api('/meta').then(function (resp) {
      state.meta = (resp && resp.data) || null;
      applyMeta();
      return api('/dashboard');
    }).then(function (d) {
      renderOverview(d);
      setSignedInUI(true);
      setText(el.signinStatus, 'Loaded. Click Reload to refresh.');
      loadClients();
      loadOpenInvoices();
    }).catch(function (err) {
      show(el.signinError, friendlyError(err));
      setText(el.signinStatus, 'Not loaded yet.');
    }).finally(function () {
      el.loadBtn.disabled = false;
    });
  }

  function signOut() {
    try {
      sessionStorage.removeItem(SS_BASE);
      sessionStorage.removeItem(SS_TOKEN);
    } catch (e) { /* ignore */ }
    state.base = '';
    state.token = '';
    state.meta = null;
    state.clients = [];
    state.openInvoices = [];
    state.loaded = {};
    el.apiToken.value = '';
    hide(el.signinError);
    hide(el.dashError);
    setText(el.signinStatus, 'Signed out. Enter the API base URL and your token, then load.');
    setText(el.dashStatus, '');
    setSignedInUI(false);
  }

  function applyMeta() {
    var m = state.meta;
    if (!m) return;
    if (m.today && m.today.ad) {
      if (el.invDate && !el.invDate.value) el.invDate.value = m.today.ad;
      if (el.payDate && !el.payDate.value) el.payDate.value = m.today.ad;
    }
    var list = (m.enums && m.enums.invoice_treatment) || TREATMENTS_FALLBACK;
    if (el.invTreatment) {
      el.invTreatment.innerHTML = list.map(function (t) {
        return '<option value="' + esc(t) + '">' +
          esc(TREATMENT_LABELS[t] || t) + '</option>';
      }).join('');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Renders (field names match the API; see the one-pager for the      */
  /* dashboard bundle shape)                                             */
  /* ------------------------------------------------------------------ */

  function figureCard(title, value) {
    return '<div class="col-6 col-md-3 mb-3"><div class="card h-100"><div class="card-body">' +
      '<div class="text-muted small">' + esc(title) + '</div>' +
      '<div class="h5 mb-0">' + esc(value) + '</div></div></div></div>';
  }

  function renderOverview(d) {
    var f = (d && d.figures) || {};
    var at = f.all_time || {};
    var br = f.bank_register || {};
    var vat = f.vat || {};
    var tds = f.tds || {};
    setHtml(el.ovCards,
      figureCard('Invoiced (confirmed)', money(at.invoiced_confirmed)) +
      figureCard('Received', money(at.received)) +
      figureCard('Paid out', money(at.paid_out)) +
      figureCard('Net', money(at.net)) +
      figureCard('Open receivables', money(at.open_receivables)) +
      figureCard('Bank balance', money(br.balance)) +
      figureCard('VAT payable', money(vat.payable)) +
      figureCard('TDS payable', money(tds.payable)));
    setHtml(el.ovFyRows, (f.by_fiscal_year || []).map(function (r) {
      return '<tr><td>' + esc(r.label) + '</td><td class="text-right">' + money(r.invoiced) +
        '</td><td class="text-right">' + money(r.received) +
        '</td><td class="text-right">' + money(r.paid) +
        '</td><td class="text-right">' + money(r.profit) + '</td></tr>';
    }).join(''));
    setText(el.verifiedAt, d && d.verified_at ? d.verified_at : '');
    setText(el.dashSource, d && d.source ? ('Source: ' + d.source) : '');
    state.loaded.overview = true;
  }

  function renderTax(t) {
    var rows = (t && t.rows) || [];
    setText(el.taxCount, (t && t.total_rows !== undefined ? t.total_rows : rows.length) + ' rows');
    setText(el.taxClearances, t && t.clearances_on_file !== undefined ? t.clearances_on_file : '—');
    setHtml(el.taxRows, rows.map(function (r) {
      var cert = (r.certificate && r.certificate.clearance_no) ? r.certificate.clearance_no : '—';
      var flag = (r.flags || []).join('; ');
      var rowClass = flag ? ' class="table-warning"' : '';
      return '<tr' + rowClass + '><td>' + esc(r.fiscal_year) + '</td><td>' + esc(r.item) +
        '</td><td class="text-right">' + money(r.amount_npr) +
        '</td><td class="text-right">' + money(r.turnover_npr) +
        '</td><td>' + esc(r.status) + '</td><td>' + esc(cert) +
        '</td><td class="small">' + esc(flag) + '</td></tr>';
    }).join(''));
    state.loaded.tax = true;
  }

  function renderBank(b) {
    setText(el.bankBalance, money(b && b.balance));
    setText(el.bankDeposits, money(b && b.deposits));
    setText(el.bankWithdrawals, money(b && b.withdrawals));
    setText(el.bankCount, (b && b.entry_count !== undefined ? b.entry_count : (b.entries || []).length) + '');
    setHtml(el.bankRows, ((b && b.entries) || []).map(function (e) {
      return '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.direction) +
        '</td><td class="text-right">' + money(e.amount_npr) +
        '</td><td>' + esc(e.reference || '—') + '</td><td>' +
        esc(e.client === 'unknown' ? '—' : e.client) + '</td></tr>';
    }).join(''));
    state.loaded.bank = true;
  }

  function renderInvoices(s) {
    var sent = (s && s.sent_invoices) || {};
    setText(el.invoiceSummary,
      (s && s.total_invoices !== undefined ? s.total_invoices : 0) + ' invoices in total · ' +
      (sent.count || 0) + ' sent · ' +
      (sent.paid_count || 0) + ' paid · ' +
      (sent.open_count || 0) + ' open · open receivables ' +
      money(s && s.open_receivables ? s.open_receivables.total_remaining : null) + '.');
    setHtml(el.invoiceRows, ((s && s.by_kind_and_status) || []).map(function (r) {
      return '<tr><td>' + esc(r.kind) + '</td><td>' + esc(r.status) +
        '</td><td class="text-right">' + esc(r.count) + '</td></tr>';
    }).join(''));
    var open = (s && s.open_receivables) || {};
    setHtml(el.openRows, ((open && open.invoices) || []).map(function (r) {
      return '<tr><td>' + esc(r.invoice_number) + '</td><td>' + esc(r.client) +
        '</td><td class="text-right">' + money(r.amount_npr) +
        '</td><td class="text-right">' + money(r.remaining_npr) +
        '</td><td>' + esc(r.due || '—') + '</td></tr>';
    }).join(''));
    setHtml(el.anomalies, ((s && s.anomalies) || []).length
      ? s.anomalies.map(function (a) {
          var line = a.invoice_number + ' — ' + a.client + ' — ' + a.detail +
            ' (' + money(a.amount_npr) + ')';
          if (a.explained_by_tds) line += ' Explained by TDS.';
          return '<li class="list-group-item">' + esc(line) + '</li>';
        }).join('')
      : '<li class="list-group-item">Nothing to check.</li>');
    state.loaded.invoicesSummary = true;
  }

  function renderOpenList(list) {
    setHtml(el.openListRows, (list || []).map(function (inv) {
      return '<tr><td>' + esc(inv.invoice_number) + '</td><td>' + esc(inv.client_name) +
        '</td><td class="text-right">' + money(inv.amount_npr) +
        '</td><td class="text-right">' + money(inv.received_amount_npr) +
        '</td><td class="text-right">' + money(inv.remaining_amount_npr) +
        '</td><td>' + esc(inv.status) + '</td><td>' + esc(inv.date_ad) + '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="text-muted">No open invoices.</td></tr>');
    state.loaded.invoices = true;
  }

  function renderReports(r) {
    setHtml(el.auditRows, ((r && r.audits_on_file) || []).map(function (a) {
      return '<tr><td>' + esc(a.fiscal_year) + '</td><td>' + esc(a.udin) +
        '</td><td>' + esc(a.opinion) + '</td></tr>';
    }).join(''));
    setHtml(el.meetingRows, ((r && r.meetings) || []).map(function (m) {
      return '<tr><td>' + esc(m.meeting_type) + '</td><td>' + esc(m.fiscal_year) +
        '</td><td>' + esc(m.date) + '</td><td>' + (m.filed ? 'Filed' : 'Not filed') + '</td></tr>';
    }).join(''));
    var holders = (r && r.shareholders && r.shareholders.holders) || [];
    setHtml(el.shareRows, holders.map(function (h) {
      return '<tr><td>' + esc(h.name) + '</td><td class="text-right">' + esc(h.shares) +
        '</td><td class="text-right">' + money(h.paid) + '</td></tr>';
    }).join(''));
    setText(el.logCount, r && r.audit_log && r.audit_log.entry_count !== undefined
      ? r.audit_log.entry_count : '—');
    state.loaded.reports = true;
  }

  /* ------------------------------------------------------------------ */
  /* Section loaders (lazy: each section loads on first view)           */
  /* ------------------------------------------------------------------ */

  function loadSection(key, force) {
    if (!state.signedIn) return Promise.resolve();
    hide(el.dashError);
    setText(el.dashStatus, 'Loading ' + key + '…');
    var work;
    if (key === 'overview') {
      work = api('/dashboard').then(renderOverview);
    } else if (key === 'tax') {
      work = api('/tax').then(renderTax);
    } else if (key === 'bank') {
      work = api('/bank').then(renderBank);
    } else if (key === 'invoices') {
      work = Promise.all([
        api('/invoices/summary').then(renderInvoices),
        api('/invoices?open_only=1&per_page=50').then(function (resp) {
          renderOpenList(resp && resp.data ? resp.data : []);
        })
      ]);
    } else if (key === 'reports') {
      work = api('/reports').then(renderReports);
    } else if (key === 'billing') {
      work = Promise.all([loadClients(), loadOpenInvoices()]);
    } else {
      work = Promise.resolve();
    }
    return work.then(function () {
      setText(el.dashStatus, 'Loaded ' + key + ' · ' + new Date().toLocaleTimeString());
    }).catch(function (err) {
      show(el.dashError, friendlyError(err));
      setText(el.dashStatus, 'Could not load ' + key + '.');
    });
  }

  function activeSection() {
    var active = document.querySelector('#dashTabs .nav-link.active');
    if (!active) return 'overview';
    var href = active.getAttribute('href') || '#tab-overview';
    return href.replace('#tab-', '') || 'overview';
  }

  /* ------------------------------------------------------------------ */
  /* Billing: pickers                                                    */
  /* ------------------------------------------------------------------ */

  function loadClients() {
    return api('/clients?per_page=200').then(function (resp) {
      state.clients = (resp && resp.data) || [];
      renderClientOptions('');
    }).catch(function (err) {
      show(el.dashError, friendlyError(err));
    });
  }

  function renderClientOptions(filter) {
    var q = (filter || '').toLowerCase();
    var list = state.clients.filter(function (c) {
      return !q || (c.name || '').toLowerCase().indexOf(q) !== -1;
    });
    el.invClient.innerHTML = list.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name) +
        ' (' + esc(c.status || '') + ')</option>';
    }).join('') || '<option value="">No clients found</option>';
  }

  function loadOpenInvoices() {
    return api('/invoices?open_only=1&per_page=200').then(function (resp) {
      state.openInvoices = (resp && resp.data) || [];
      el.payInvoice.innerHTML = state.openInvoices.map(function (inv) {
        return '<option value="' + esc(inv.id) + '">' + esc(inv.invoice_number) +
          ' — ' + esc(inv.client_name) + ' — remaining ' +
          money(inv.remaining_amount_npr) + '</option>';
      }).join('') || '<option value="">No open invoices</option>';
      updatePayHint();
    }).catch(function (err) {
      show(el.dashError, friendlyError(err));
    });
  }

  function selectedOpenInvoice() {
    var id = el.payInvoice ? el.payInvoice.value : '';
    for (var i = 0; i < state.openInvoices.length; i++) {
      if (String(state.openInvoices[i].id) === String(id)) return state.openInvoices[i];
    }
    return null;
  }

  function updatePayHint() {
    var inv = selectedOpenInvoice();
    setText(el.payInvoiceHint, inv
      ? 'Still to receive on this invoice: ' + money(inv.remaining_amount_npr) +
        ' · issued ' + (inv.date_ad || '—')
      : '');
  }

  /* ------------------------------------------------------------------ */
  /* Billing: writes                                                     */
  /* ------------------------------------------------------------------ */

  function clearFieldErrors(prefix) {
    ['client_id', 'service', 'amount_npr', 'treatment', 'date_ad',
     'due_date_ad', 'domain', 'notes',
     'invoice_id', 'txn_ref', 'receipt_number'].forEach(function (f) {
      var node = $(prefix + f);
      if (node) node.textContent = '';
    });
  }

  function applyFieldErrors(prefix, errors) {
    Object.keys(errors).forEach(function (field) {
      var node = $(prefix + field);
      if (node) node.textContent = (errors[field] || []).join(' ');
    });
  }

  function createInvoice(event) {
    if (event) event.preventDefault();
    hide(el.invFormError);
    hide(el.invFormSuccess);
    clearFieldErrors('err-inv-');

    var amount = parseFloat(el.invAmount.value);
    if (!el.invClient.value) {
      show(el.invFormError, 'Pick a client first.');
      return;
    }
    if (!(amount > 0)) {
      show(el.invFormError, 'Enter an amount above 0.');
      return;
    }
    if (!el.invDate.value) {
      show(el.invFormError, 'Pick an issue date.');
      return;
    }

    var payload = {
      client_id: parseInt(el.invClient.value, 10),
      service: el.invService.value.trim(),
      amount_npr: amount,
      treatment: el.invTreatment.value,
      date_ad: el.invDate.value
    };
    if (el.invDueDate.value) payload.due_date_ad = el.invDueDate.value;
    if (el.invDomain.value.trim()) payload.domain = el.invDomain.value.trim();
    if (el.invNotes.value.trim()) payload.notes = el.invNotes.value.trim();

    el.invSubmit.disabled = true;
    api('/invoices', { method: 'POST', body: payload }).then(function (resp) {
      var d = (resp && resp.data) || {};
      var lines = ['Invoice ' + (d.invoice_number || ('#' + d.id)) + ' created — ' +
        money(d.amount_npr) + ' (' + (d.treatment_label || d.treatment || '') + ').'];
      if (d.vat_npr !== undefined || d.tds_npr !== undefined) {
        lines.push('VAT ' + money(d.vat_npr) + ' · TDS ' + money(d.tds_npr) +
          ' · subtotal ' + money(d.subtotal_npr) + '.');
      }
      if (d.tax_invoice_issued) {
        lines.push('Tax invoice issued (' + d.tax_invoice_issued + ').');
      }
      if (resp && resp.meta && resp.meta.pan_warning) {
        lines.push('Warning: ' + resp.meta.pan_warning);
      }
      show(el.invFormSuccess, lines.join(' '));
      el.invService.value = '';
      el.invAmount.value = '';
      el.invDomain.value = '';
      el.invNotes.value = '';
      state.loaded.invoices = false;
      state.loaded.invoicesSummary = false;
      loadOpenInvoices();
    }).catch(function (err) {
      applyFieldErrors('err-inv-', fieldErrors(err));
      show(el.invFormError, friendlyError(err));
    }).finally(function () {
      el.invSubmit.disabled = false;
    });
  }

  function recordPayment(event) {
    if (event) event.preventDefault();
    hide(el.payFormError);
    hide(el.payFormSuccess);
    clearFieldErrors('err-pay-');

    var inv = selectedOpenInvoice();
    var amount = parseFloat(el.payAmount.value);
    if (!inv) {
      show(el.payFormError, 'Pick an open invoice first.');
      return;
    }
    if (!(amount > 0)) {
      show(el.payFormError, 'Enter an amount above 0.');
      return;
    }
    if (inv.remaining_amount_npr !== undefined &&
        inv.remaining_amount_npr !== null &&
        amount > Number(inv.remaining_amount_npr)) {
      show(el.payFormError, 'The payment exceeds the ' +
        money(inv.remaining_amount_npr) + ' still owed on this invoice.');
      return;
    }
    if (!el.payDate.value) {
      show(el.payFormError, 'Pick a payment date.');
      return;
    }

    var payload = {
      invoice_id: inv.id,
      amount_npr: amount,
      date_ad: el.payDate.value
    };
    if (el.payTxnRef.value.trim()) payload.txn_ref = el.payTxnRef.value.trim();
    if (el.payReceiptNo.value.trim()) payload.receipt_number = el.payReceiptNo.value.trim();

    el.paySubmit.disabled = true;
    api('/receipts', { method: 'POST', body: payload }).then(function (resp) {
      var d = (resp && resp.data) || {};
      var metaInv = (resp && resp.meta && resp.meta.invoice) || {};
      var lines = ['Payment of ' + money(d.amount_npr || amount) + ' recorded' +
        (d.linked_invoice ? (' against invoice ' + d.linked_invoice) : '') +
        (d.id ? (' (receipt #' + d.id + ')') : '') + '.'];
      if (metaInv.invoice_number) {
        lines.push('Invoice ' + metaInv.invoice_number + ' is now ' +
          (metaInv.status || '') + ' — ' + money(metaInv.remaining_amount_npr) +
          ' still to receive.');
      }
      show(el.payFormSuccess, lines.join(' '));
      el.payAmount.value = '';
      el.payTxnRef.value = '';
      el.payReceiptNo.value = '';
      state.loaded.invoices = false;
      state.loaded.invoicesSummary = false;
      loadOpenInvoices();
    }).catch(function (err) {
      applyFieldErrors('err-pay-', fieldErrors(err));
      show(el.payFormError, friendlyError(err));
    }).finally(function () {
      el.paySubmit.disabled = false;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  function init() {
    if (el.loadBtn) el.loadBtn.addEventListener('click', signIn);
    if (el.signoutBtn) el.signoutBtn.addEventListener('click', signOut);
    if (el.reloadBtn) el.reloadBtn.addEventListener('click', function () {
      loadSection(activeSection(), true);
    });
    if (el.invoiceForm) el.invoiceForm.addEventListener('submit', createInvoice);
    if (el.paymentForm) el.paymentForm.addEventListener('submit', recordPayment);
    if (el.invClientFilter) el.invClientFilter.addEventListener('input', function () {
      renderClientOptions(el.invClientFilter.value);
    });
    if (el.payInvoice) el.payInvoice.addEventListener('change', updatePayHint);

    /* Lazy-load each section the first time its tab is opened.
       Billing reloads its pickers on every visit (fresh lists). */
    var tabLinks = document.querySelectorAll('#dashTabs .nav-link');
    for (var i = 0; i < tabLinks.length; i++) {
      (function (link) {
        link.addEventListener('click', function () {
          var key = (link.getAttribute('href') || '').replace('#tab-', '') || 'overview';
          if (key === 'billing') { loadSection('billing'); return; }
          if (!state.loaded[key]) loadSection(key);
        });
      })(tabLinks[i]);
    }

    /* Restore a tab session (token + base live in sessionStorage only). */
    var savedBase = null;
    var savedToken = null;
    try {
      savedBase = sessionStorage.getItem(SS_BASE);
      savedToken = sessionStorage.getItem(SS_TOKEN);
    } catch (e) { /* private mode */ }
    if (savedBase) el.apiBase.value = savedBase;
    if (savedToken) el.apiToken.value = savedToken;
    if (savedBase && savedToken) signIn();
  }

  init();
})();
