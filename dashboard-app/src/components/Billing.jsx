import { useEffect, useState } from 'react';
import {
  TREATMENTS_FALLBACK,
  TREATMENT_LABELS,
  fieldErrors,
  friendlyError,
  money,
} from '../api.js';

function FieldError({ msg }) {
  return msg ? <small className="form-text text-danger">{msg}</small> : null;
}

/* The invoice form's fill from one billing rule: the service, amount
   and treatment the rule carries, plus the due date (the rule's next
   due date) and the domain — named in the service text when the rule
   is for one domain, else the client's domain. When the rule is
   among the client's active rules it is also the selected rule in
   the Service dropdown; otherwise (inactive, or a no-billing rule)
   the service is free text and only the fields fill. The amount
   stays blank when the rule has none (e.g. a cost-share on actuals). */
export function prefillFromRule(rule, activeRules, clientDomain) {
  if (!rule) {
    return { ruleId: '', service: '', amount: '', treatment: 'vat_tds', dueDate: '', domain: '' };
  }
  const inDropdown = (activeRules || []).some((r) => String(r.id) === String(rule.id));
  const named = (rule.service || '').match(/[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/i);
  return {
    ruleId: inDropdown ? String(rule.id) : '',
    service: rule.service || '',
    amount: (rule.amount_npr !== null && rule.amount_npr !== undefined)
      ? String(rule.amount_npr)
      : '',
    treatment: rule.treatment || 'vat_tds',
    dueDate: rule.next_due_ad || '',
    domain: named ? named[0] : (clientDomain || ''),
  };
}

/* The suppliers on record (contacts categorised Supplier, Nov 2026).
   Suppliers are not clients — no client row exists for any of them —
   so a vendor bill names its supplier as free text, from this list
   or typed in. */
export const SUPPLIERS = [
  'Babal.Host',
  'Real Property Management Services Pvt. Ltd.',
  'Bijay Khadya and Gas Store',
  'Bagmati Office Suppliers',
  'Print Bazar',
  'Dish Home',
];
export const SUPPLIER_OTHER = '__other';

/* A payment is only ever recorded against a client invoice (sent or
   MOU receivable) in the Record payment form — vendor bills have
   their own form below. */
export function receivableInvoices(openInvoices) {
  return (openInvoices || []).filter((inv) => inv.kind === 'sent' || inv.kind === 'mou_receivable');
}

/* The Service field's mode: a dropdown of the client's rules, a
   loading placeholder, or a free-text field — the last when the
   client has no rules, or when "Other" was picked to type a new
   service instead of one of the listed rules. */
export const SERVICE_OTHER = '__other';
export function serviceFieldMode({ hasClient, rulesLoading, rules, selectedRule }) {
  if (hasClient && rulesLoading) return 'loading';
  if (hasClient && rules.length > 0 && selectedRule !== SERVICE_OTHER) return 'select';
  return 'text';
}

/* The services that can be attached to a client with no rules of
   their own: every billing rule that has an amount — the amount is
   what makes it a real service or AMC. The two no-billing rules
   (Mountain Fund, Anishma) and the NOSHA cost-share rule have no
   amount, so they are not attachable. Status does not matter: an
   inactive rule is still a real service. Order matches the Billing
   rules tab: by client, then rule. */
export function attachableRules(allRules) {
  return (allRules || [])
    .filter((r) => r && r.service && r.amount_npr !== null && r.amount_npr !== undefined)
    .sort((a, b) => (a.client_id - b.client_id) || (a.id - b.id));
}

/* Fill the form from an existing rule attached to this client: the
   service, amount and treatment come from that rule. The due date
   does NOT come over — the other client's next due date is not this
   client's — so it stays blank to fill in. The domain comes from the
   service text when it names one, else the client's own domain. */
export function attachServiceFromRule(rule, clientDomain) {
  if (!rule) {
    return { service: '', amount: '', treatment: 'vat_tds', domain: '' };
  }
  const named = (rule.service || '').match(/[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/i);
  return {
    service: rule.service || '',
    amount: (rule.amount_npr !== null && rule.amount_npr !== undefined)
      ? String(rule.amount_npr)
      : '',
    treatment: rule.treatment || 'vat_tds',
    domain: named ? named[0] : (clientDomain || ''),
  };
}

export default function Billing({ api, clients, openInvoices, meta, onWrote, prefill, onPrefillApplied, vendorRefresh, initialVendorBills }) {
  const [invClient, setInvClient] = useState('');
  /* The client picked by an "Issue invoice" button (the Billing rules
     tab) when that client is not Active — the Client dropdown only
     lists Active clients, so the name and domain are kept here to show
     the picked client as a one-off option and to fill the domain. */
  const [prefillClient, setPrefillClient] = useState(null);
  /* A rule waiting to fill the form once its client's rules load. */
  const [pendingPrefill, setPendingPrefill] = useState(null);
  /* The selected client's billing rules (their services). Loaded from
     GET /billing-rules?client_id=…&status=active when the client
     changes; the service, amount and treatment fill in from the rule. */
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState('');
  const [selectedRule, setSelectedRule] = useState('');
  /* Every billing rule, for attaching an existing service or AMC to
     a client with no rules of their own. Loaded once, the first time
     such a client is picked. */
  const [allRules, setAllRules] = useState([]);
  const [allRulesLoaded, setAllRulesLoaded] = useState(false);
  /* Names of rule owners that are not Active clients (the client
     list only carries Active ones) — fetched per id, like the
     Billing rules tab does. */
  const [allRuleNames, setAllRuleNames] = useState({});
  const [invService, setInvService] = useState('');
  const [invAmount, setInvAmount] = useState('');
  const [invTreatment, setInvTreatment] = useState('vat_tds');
  const [invDate, setInvDate] = useState('');
  const [invDueDate, setInvDueDate] = useState('');
  const [invDomain, setInvDomain] = useState('');
  const [invNotes, setInvNotes] = useState('');
  const [invErrors, setInvErrors] = useState({});
  const [invFormError, setInvFormError] = useState('');
  const [invFormSuccess, setInvFormSuccess] = useState('');
  const [invSubmitting, setInvSubmitting] = useState(false);

  const [payInvoiceId, setPayInvoiceId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState('');
  const [payTxnRef, setPayTxnRef] = useState('');
  const [payReceiptNo, setPayReceiptNo] = useState('');
  const [payErrors, setPayErrors] = useState({});
  const [payFormError, setPayFormError] = useState('');
  const [payFormSuccess, setPayFormSuccess] = useState('');
  const [paySubmitting, setPaySubmitting] = useState(false);

  /* Record vendor bill: a bill from a supplier (kind 'received'). */
  const [vbSupplier, setVbSupplier] = useState('');
  const [vbSupplierOther, setVbSupplierOther] = useState('');
  const [vbService, setVbService] = useState('');
  const [vbAmount, setVbAmount] = useState('');
  const [vbVatIncluded, setVbVatIncluded] = useState('yes');
  const [vbDate, setVbDate] = useState('');
  const [vbDueDate, setVbDueDate] = useState('');
  const [vbBillNo, setVbBillNo] = useState('');
  const [vbNotes, setVbNotes] = useState('');
  const [vbErrors, setVbErrors] = useState({});
  const [vbFormError, setVbFormError] = useState('');
  const [vbFormSuccess, setVbFormSuccess] = useState('');
  const [vbSubmitting, setVbSubmitting] = useState(false);

  /* Record vendor receipt: a payment against an open vendor bill. */
  const [vendorBills, setVendorBills] = useState(initialVendorBills || []);
  const [vendorBillsLoading, setVendorBillsLoading] = useState(false);
  const [vendorBillsError, setVendorBillsError] = useState('');
  const [vrBillId, setVrBillId] = useState('');
  const [vrAmount, setVrAmount] = useState('');
  const [vrDate, setVrDate] = useState('');
  const [vrTxnRef, setVrTxnRef] = useState('');
  const [vrReceiptNo, setVrReceiptNo] = useState('');
  const [vrErrors, setVrErrors] = useState({});
  const [vrFormError, setVrFormError] = useState('');
  const [vrFormSuccess, setVrFormSuccess] = useState('');
  const [vrSubmitting, setVrSubmitting] = useState(false);

  const todayAd = meta && meta.today && meta.today.ad
    ? meta.today.ad
    : new Date().toISOString().slice(0, 10);
  const treatments = (meta && meta.enums && meta.enums.invoice_treatment) ||
    TREATMENTS_FALLBACK;

  /* Default the date fields from the API's "today" once meta loads,
     matching the plain dashboard's applyMeta(). */
  useEffect(() => {
    if (todayAd) {
      setInvDate((d) => d || todayAd);
      setPayDate((d) => d || todayAd);
      setVbDate((d) => d || todayAd);
      setVrDate((d) => d || todayAd);
    }
  }, [todayAd]);

  /* Open vendor bills for the receipt form. A test seam
     (initialVendorBills) skips the fetch, like the other tabs. */
  useEffect(() => {
    if (initialVendorBills) { setVendorBills(initialVendorBills); return; }
    loadVendorBills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorRefresh]);

  async function loadVendorBills() {
    setVendorBillsLoading(true);
    setVendorBillsError('');
    try {
      const resp = await api('/invoices?kind=received&open_only=1&per_page=200');
      setVendorBills((resp && resp.data) || []);
    } catch (err) {
      setVendorBillsError(friendlyError(err));
    } finally {
      setVendorBillsLoading(false);
    }
  }

  /* The client list arrives pre-filtered to Active from the API; keep
     only Active here too, in case an older API ignores the filter. */
  const activeClients = clients.filter((c) => c.status === 'Active');

  async function loadRules(clientId) {
    setRules([]);
    setSelectedRule('');
    setRulesError('');
    if (!clientId) return;
    setRulesLoading(true);
    try {
      const resp = await api(
        '/billing-rules?client_id=' + clientId + '&status=active&per_page=100',
      );
      const rows = (resp && resp.data) || [];
      setRules(rows);
      /* No rules of their own: fetch every rule once, so an existing
         service or AMC can be attached to this client instead. */
      if (rows.length === 0) loadAllRules();
    } catch (err) {
      /* No rules, no problem: the service stays a free-text field. */
      setRulesError(friendlyError(err));
    } finally {
      setRulesLoading(false);
    }
  }

  async function loadAllRules() {
    if (allRulesLoaded) return;
    setAllRulesLoaded(true);
    try {
      const resp = await api('/billing-rules?per_page=200');
      const rows = (resp && resp.data) || [];
      setAllRules(rows);
      const known = {};
      (clients || []).forEach((c) => { known[c.id] = c.name; });
      const missing = [...new Set(rows.map((r) => r.client_id))].filter((id) => !known[id]);
      if (missing.length > 0) {
        const names = {};
        await Promise.all(missing.map(async (id) => {
          try {
            const one = await api('/clients/' + id);
            names[id] = (one && one.data && one.data.name) || '';
          } catch (err) { /* the option still shows, without a name */ }
        }));
        setAllRuleNames(names);
      }
    } catch (err) {
      /* Attaching stays unavailable; the free-text field still works. */
    }
  }

  /* The attach dropdown's options: the attachable rules with their
     owner's name, so two clients' same-named services stay apart. */
  function ruleOwnerName(clientId) {
    return (clients || []).find((c) => String(c.id) === String(clientId))?.name ||
      allRuleNames[clientId] || '';
  }
  const attachOptions = attachableRules(allRules).map((r) => ({
    id: r.id,
    label: r.service + ' — ' + ruleOwnerName(r.client_id) + ' — ' + money(r.amount_npr),
  }));

  function handleAttach(ruleId) {
    const rule = (allRules || []).find((r) => String(r.id) === String(ruleId)) || null;
    const clientDomain = (clients || []).find((c) => String(c.id) === String(invClient))?.domain ||
      (prefillClient && prefillClient.domain) || '';
    const fill = attachServiceFromRule(rule, clientDomain);
    setInvService(fill.service);
    setInvAmount(fill.amount);
    setInvTreatment(fill.treatment);
    /* The due date stays blank: the other client's next due date is
       not this client's. */
    setInvDueDate('');
    setInvDomain(fill.domain);
  }

  function handleClientChange(clientId) {
    setInvClient(clientId);
    setInvService('');
    setInvAmount('');
    setInvTreatment('vat_tds');
    setInvDueDate('');
    setInvDomain('');
    loadRules(clientId);
  }

  function handleRuleChange(ruleId) {
    const clientDomain = (clients || []).find((c) => String(c.id) === String(invClient))?.domain ||
      (prefillClient && prefillClient.domain) || '';
    if (ruleId === SERVICE_OTHER) {
      /* A new service, not one of the listed rules: clear the
         rule-filled fields and let the user type. The domain stays
         the client's own domain. */
      setSelectedRule(SERVICE_OTHER);
      setInvService('');
      setInvAmount('');
      setInvTreatment('vat_tds');
      setInvDueDate('');
      setInvDomain(clientDomain);
      return;
    }
    setSelectedRule(ruleId);
    const rule = rules.find((r) => String(r.id) === String(ruleId)) || null;
    const fill = prefillFromRule(rule, rules, clientDomain);
    setInvService(fill.service);
    setInvAmount(fill.amount);
    setInvTreatment(fill.treatment);
    setInvDueDate(fill.dueDate);
    setInvDomain(fill.domain);
  }

  /* "Issue invoice" from the Billing rules tab: the rule arrives as a
     prefill (client + rule). Pick the client first — its active rules
     load — then fill the form from the rule once they are in. */
  useEffect(() => {
    if (!prefill || !prefill.rule) return;
    setPrefillClient({ name: prefill.clientName || '', domain: prefill.clientDomain || '' });
    setPendingPrefill(prefill);
    handleClientChange(String(prefill.clientId));
    // handleClientChange is stable enough for this one-shot effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  useEffect(() => {
    if (!pendingPrefill || rulesLoading) return;
    const clientDomain = pendingPrefill.clientDomain ||
      (clients || []).find((c) => String(c.id) === String(pendingPrefill.clientId))?.domain || '';
    const fill = prefillFromRule(pendingPrefill.rule, rules, clientDomain);
    /* A rule that is not among the client's active rules fills as
       free text — show the text field, with the way back to the list. */
    setSelectedRule(fill.ruleId || (rules.length > 0 ? SERVICE_OTHER : ''));
    setInvService(fill.service);
    setInvAmount(fill.amount);
    setInvTreatment(fill.treatment);
    setInvDueDate(fill.dueDate);
    setInvDomain(fill.domain);
    setPendingPrefill(null);
    if (onPrefillApplied) onPrefillApplied();
    // Runs when the rules for the prefilled client finish loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, rulesLoading, pendingPrefill]);

  /* Record payment lists client invoices only — a vendor bill never
     appears here; it has its own form below. */
  const receivable = receivableInvoices(openInvoices);
  const selectedOpenInvoice = receivable.find(
    (inv) => String(inv.id) === String(payInvoiceId),
  ) || null;
  const selectedVendorBill = vendorBills.find(
    (inv) => String(inv.id) === String(vrBillId),
  ) || null;

  async function createInvoice(e) {
    e.preventDefault();
    setInvFormError('');
    setInvFormSuccess('');
    setInvErrors({});

    const amount = parseFloat(invAmount);
    if (!invClient) { setInvFormError('Pick a client first.'); return; }
    if (!(amount > 0)) { setInvFormError('Enter an amount above 0.'); return; }
    if (!invDate) { setInvFormError('Pick an issue date.'); return; }

    const payload = {
      client_id: parseInt(invClient, 10),
      service: invService.trim(),
      amount_npr: amount,
      treatment: invTreatment,
      date_ad: invDate,
    };
    if (invDueDate) payload.due_date_ad = invDueDate;
    if (invDomain.trim()) payload.domain = invDomain.trim();
    if (invNotes.trim()) payload.notes = invNotes.trim();

    setInvSubmitting(true);
    try {
      const resp = await api('/invoices', { method: 'POST', body: payload });
      const d = (resp && resp.data) || {};
      const lines = [
        'Invoice ' + (d.invoice_number || ('#' + d.id)) + ' created — ' +
        money(d.amount_npr) + ' (' + (d.treatment_label || d.treatment || '') + ').',
      ];
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
      setInvFormSuccess(lines.join(' '));
      setInvService('');
      setInvAmount('');
      setSelectedRule('');
      setInvDomain('');
      setInvNotes('');
      onWrote();
    } catch (err) {
      setInvErrors(fieldErrors(err));
      setInvFormError(friendlyError(err));
    } finally {
      setInvSubmitting(false);
    }
  }

  async function recordPayment(e) {
    e.preventDefault();
    setPayFormError('');
    setPayFormSuccess('');
    setPayErrors({});

    const inv = selectedOpenInvoice;
    const amount = parseFloat(payAmount);
    if (!inv) { setPayFormError('Pick an open invoice first.'); return; }
    if (!(amount > 0)) { setPayFormError('Enter an amount above 0.'); return; }
    if (inv.remaining_amount_npr !== undefined && inv.remaining_amount_npr !== null &&
        amount > Number(inv.remaining_amount_npr)) {
      setPayFormError('The payment exceeds the ' +
        money(inv.remaining_amount_npr) + ' still owed on this invoice.');
      return;
    }
    if (!payDate) { setPayFormError('Pick a payment date.'); return; }

    const payload = {
      invoice_id: inv.id,
      amount_npr: amount,
      date_ad: payDate,
    };
    if (payTxnRef.trim()) payload.txn_ref = payTxnRef.trim();
    if (payReceiptNo.trim()) payload.receipt_number = payReceiptNo.trim();

    setPaySubmitting(true);
    try {
      const resp = await api('/receipts', { method: 'POST', body: payload });
      const d = (resp && resp.data) || {};
      const metaInv = (resp && resp.meta && resp.meta.invoice) || {};
      const lines = [
        'Payment of ' + money(d.amount_npr || amount) + ' recorded' +
        (d.linked_invoice ? (' against invoice ' + d.linked_invoice) : '') +
        (d.id ? (' (receipt #' + d.id + ')') : '') + '.',
      ];
      if (metaInv.invoice_number) {
        lines.push('Invoice ' + metaInv.invoice_number + ' is now ' +
          (metaInv.status || '') + ' — ' + money(metaInv.remaining_amount_npr) +
          ' still to receive.');
      }
      setPayFormSuccess(lines.join(' '));
      setPayAmount('');
      setPayTxnRef('');
      setPayReceiptNo('');
      onWrote();
    } catch (err) {
      setPayErrors(fieldErrors(err));
      setPayFormError(friendlyError(err));
    } finally {
      setPaySubmitting(false);
    }
  }

  async function createVendorBill(e) {
    e.preventDefault();
    setVbFormError('');
    setVbFormSuccess('');
    setVbErrors({});

    const supplier = vbSupplier === SUPPLIER_OTHER ? vbSupplierOther.trim() : vbSupplier;
    const amount = parseFloat(vbAmount);
    if (!supplier) { setVbFormError('Pick a supplier first.'); return; }
    if (!vbService.trim()) { setVbFormError('Enter the service or item.'); return; }
    if (!(amount > 0)) { setVbFormError('Enter an amount above 0.'); return; }
    if (!vbDate) { setVbFormError('Pick a bill date.'); return; }

    const payload = {
      supplier,
      service: vbService.trim(),
      amount_npr: amount,
      vat_included: vbVatIncluded === 'yes',
      date_ad: vbDate,
    };
    if (vbDueDate) payload.due_date_ad = vbDueDate;
    if (vbBillNo.trim()) payload.supplier_bill_no = vbBillNo.trim();
    if (vbNotes.trim()) payload.notes = vbNotes.trim();

    setVbSubmitting(true);
    try {
      const resp = await api('/invoices/vendor-bills', { method: 'POST', body: payload });
      const d = (resp && resp.data) || {};
      const meta = (resp && resp.meta) || {};
      const lines = [
        'Vendor bill recorded — ' + (d.client_name || supplier) +
        (d.invoice_number ? ' (bill No. ' + d.invoice_number + ')' : '') +
        ' — ' + money(d.amount_npr || amount) + '.',
      ];
      if (meta.vat_npr !== undefined) {
        lines.push('VAT ' + money(meta.vat_npr) + ' included · subtotal ' +
          money(meta.subtotal_npr) + '.');
      }
      lines.push('It is Open — pay it from Record vendor receipt, or see it on the Vendor bills tab.');
      setVbFormSuccess(lines.join(' '));
      setVbService('');
      setVbAmount('');
      setVbDueDate('');
      setVbBillNo('');
      setVbNotes('');
      onWrote();
    } catch (err) {
      setVbErrors(fieldErrors(err));
      setVbFormError(friendlyError(err));
    } finally {
      setVbSubmitting(false);
    }
  }

  async function recordVendorPayment(e) {
    e.preventDefault();
    setVrFormError('');
    setVrFormSuccess('');
    setVrErrors({});

    const bill = selectedVendorBill;
    const amount = parseFloat(vrAmount);
    if (!bill) { setVrFormError('Pick an open vendor bill first.'); return; }
    if (!(amount > 0)) { setVrFormError('Enter an amount above 0.'); return; }
    if (bill.remaining_amount_npr !== undefined && bill.remaining_amount_npr !== null &&
        amount > Number(bill.remaining_amount_npr)) {
      setVrFormError('The payment exceeds the ' +
        money(bill.remaining_amount_npr) + ' still to pay on this bill.');
      return;
    }
    if (!vrDate) { setVrFormError('Pick a payment date.'); return; }

    const payload = {
      invoice_id: bill.id,
      amount_npr: amount,
      date_ad: vrDate,
    };
    if (vrTxnRef.trim()) payload.txn_ref = vrTxnRef.trim();
    if (vrReceiptNo.trim()) payload.receipt_number = vrReceiptNo.trim();

    setVrSubmitting(true);
    try {
      const resp = await api('/receipts', { method: 'POST', body: payload });
      const d = (resp && resp.data) || {};
      const metaInv = (resp && resp.meta && resp.meta.invoice) || {};
      const lines = [
        'Payment of ' + money(d.amount_npr || amount) + ' recorded' +
        (d.linked_invoice ? (' against vendor bill ' + d.linked_invoice) : '') +
        (d.id ? (' (receipt #' + d.id + ')') : '') + '.',
      ];
      if (metaInv.invoice_number) {
        lines.push('Bill ' + metaInv.invoice_number + ' is now ' +
          (metaInv.status || '') + ' — ' + money(metaInv.remaining_amount_npr) +
          ' still to pay.');
      }
      setVrFormSuccess(lines.join(' '));
      setVrAmount('');
      setVrTxnRef('');
      setVrReceiptNo('');
      onWrote();
    } catch (err) {
      setVrErrors(fieldErrors(err));
      setVrFormError(friendlyError(err));
    } finally {
      setVrSubmitting(false);
    }
  }

  return (
    <>
      <div className="row">
        <div className="col-lg-6 mb-4">
          <div className="card h-100">
            <div className="card-body">
              <h5 className="card-title">Create invoice</h5>
              <p className="text-muted small">
                Pick a client — their services and amounts fill in from
                their billing rules. The API numbers the invoice, works out
                the fiscal year and the VAT/TDS split, and marks tax invoices.
              </p>
              <form onSubmit={createInvoice} noValidate>
                <div className="form-group">
                  <label htmlFor="invClient">Client</label>
                  <select
                    id="invClient"
                    className="form-control"
                    value={invClient}
                    onChange={(e) => { setPrefillClient(null); handleClientChange(e.target.value); }}
                  >
                    <option value="">Pick a client…</option>
                    {invClient && prefillClient && prefillClient.name &&
                      !activeClients.some((c) => String(c.id) === String(invClient)) && (
                      <option value={invClient}>{prefillClient.name}</option>
                    )}
                    {activeClients.length ? (
                      activeClients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))
                    ) : (
                      <option value="">No active clients</option>
                    )}
                  </select>
                  <FieldError msg={invErrors.client_id && invErrors.client_id.join(' ')} />
                </div>
                <div className="form-group">
                  <label htmlFor="invService">Service</label>
                  {serviceFieldMode({ hasClient: !!invClient, rulesLoading, rules, selectedRule }) === 'loading' ? (
                    <input
                      id="invService"
                      className="form-control"
                      type="text"
                      placeholder="Loading services…"
                      disabled
                      value=""
                      readOnly
                    />
                  ) : serviceFieldMode({ hasClient: !!invClient, rulesLoading, rules, selectedRule }) === 'select' ? (
                    <select
                      id="invService"
                      className="form-control"
                      value={selectedRule}
                      onChange={(e) => handleRuleChange(e.target.value)}
                    >
                      <option value="">Pick a service…</option>
                      {rules.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.service}
                          {r.amount_npr !== null && r.amount_npr !== undefined
                            ? ' — ' + money(r.amount_npr)
                            : ''}
                        </option>
                      ))}
                      <option value={SERVICE_OTHER}>Other — type a new service</option>
                    </select>
                  ) : (
                    <>
                      {invClient && !rulesLoading && rules.length === 0 && attachOptions.length > 0 && (
                        <select
                          className="form-control mb-2"
                          value=""
                          onChange={(e) => { if (e.target.value) handleAttach(e.target.value); }}
                          aria-label="Attach an existing service or AMC"
                        >
                          <option value="">Attach an existing service or AMC…</option>
                          {attachOptions.map((o) => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                          ))}
                        </select>
                      )}
                      <input
                        id="invService"
                        className="form-control"
                        type="text"
                        placeholder={invClient
                          ? 'e.g. Hosting renewal — example.com'
                          : 'Pick a client first'}
                        maxLength="1000"
                        disabled={!invClient}
                        value={invService}
                        onChange={(e) => setInvService(e.target.value)}
                      />
                    </>
                  )}
                  {invClient && !rulesLoading && rules.length === 0 && (
                    <small className="form-text text-muted">
                      {attachOptions.length > 0
                        ? 'No services on file for this client — type a new service, or attach an existing one above.'
                        : 'No services on file for this client — type the service.'}
                    </small>
                  )}
                  {invClient && selectedRule === SERVICE_OTHER && rules.length > 0 && (
                    <small className="form-text text-muted">
                      A new service, not one of the listed rules.{' '}
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 align-baseline"
                        onClick={() => handleRuleChange('')}
                      >
                        Back to services
                      </button>
                    </small>
                  )}
                  {rulesError && (
                    <small className="form-text text-danger">{rulesError}</small>
                  )}
                  <FieldError msg={invErrors.service && invErrors.service.join(' ')} />
                </div>
                <div className="form-row">
                  <div className="form-group col-md-6">
                    <label htmlFor="invAmount">Amount (NPR)</label>
                    <input
                      id="invAmount"
                      className="form-control"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={invAmount}
                      onChange={(e) => setInvAmount(e.target.value)}
                    />
                    {selectedRule && selectedRule !== SERVICE_OTHER && (
                      <small className="form-text text-muted">
                        Filled from the billing rule — change it if this
                        invoice differs.
                      </small>
                    )}
                    <FieldError msg={invErrors.amount_npr && invErrors.amount_npr.join(' ')} />
                  </div>
                  <div className="form-group col-md-6">
                    <label htmlFor="invTreatment">Treatment</label>
                    <select
                      id="invTreatment"
                      className="form-control"
                      value={invTreatment}
                      onChange={(e) => setInvTreatment(e.target.value)}
                    >
                      {treatments.map((t) => (
                        <option key={t} value={t}>{TREATMENT_LABELS[t] || t}</option>
                      ))}
                    </select>
                    <FieldError msg={invErrors.treatment && invErrors.treatment.join(' ')} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group col-md-6">
                    <label htmlFor="invDate">Issue date</label>
                    <input
                      id="invDate"
                      className="form-control"
                      type="date"
                      value={invDate}
                      onChange={(e) => setInvDate(e.target.value)}
                    />
                    <FieldError msg={invErrors.date_ad && invErrors.date_ad.join(' ')} />
                  </div>
                  <div className="form-group col-md-6">
                    <label htmlFor="invDueDate">Due date (optional)</label>
                    <input
                      id="invDueDate"
                      className="form-control"
                      type="date"
                      value={invDueDate}
                      onChange={(e) => setInvDueDate(e.target.value)}
                    />
                    <FieldError msg={invErrors.due_date_ad && invErrors.due_date_ad.join(' ')} />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="invDomain">Domain (optional)</label>
                  <input
                    id="invDomain"
                    className="form-control"
                    type="text"
                    placeholder="example.com"
                    maxLength="255"
                    value={invDomain}
                    onChange={(e) => setInvDomain(e.target.value)}
                  />
                  <FieldError msg={invErrors.domain && invErrors.domain.join(' ')} />
                </div>
                <div className="form-group">
                  <label htmlFor="invNotes">Notes (optional)</label>
                  <textarea
                    id="invNotes"
                    className="form-control"
                    rows="2"
                    maxLength="2000"
                    value={invNotes}
                    onChange={(e) => setInvNotes(e.target.value)}
                  />
                  <FieldError msg={invErrors.notes && invErrors.notes.join(' ')} />
                </div>
                {invFormError && <div className="alert alert-danger" role="alert">{invFormError}</div>}
                {invFormSuccess && <div className="alert alert-success" role="alert">{invFormSuccess}</div>}
                <button className="btn btn-primary" type="submit" disabled={invSubmitting}>
                  Create invoice
                </button>
              </form>
            </div>
          </div>
        </div>
        <div className="col-lg-6 mb-4">
          <div className="card h-100">
            <div className="card-body">
              <h5 className="card-title">Record payment</h5>
              <p className="text-muted small">
                Records a payment against an open invoice. The amount cannot be
                more than what is still to receive.
              </p>
              <form onSubmit={recordPayment} noValidate>
                <div className="form-group">
                  <label htmlFor="payInvoice">Open invoice</label>
                  <select
                    id="payInvoice"
                    className="form-control"
                    value={payInvoiceId}
                    onChange={(e) => setPayInvoiceId(e.target.value)}
                  >
                    {receivable.length ? (
                      receivable.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoice_number} — {inv.client_name} — remaining{' '}
                          {money(inv.remaining_amount_npr)}
                        </option>
                      ))
                    ) : (
                      <option value="">No open invoices</option>
                    )}
                  </select>
                  <small className="form-text text-muted">
                    {selectedOpenInvoice
                      ? 'Still to receive on this invoice: ' +
                        money(selectedOpenInvoice.remaining_amount_npr) +
                        ' · issued ' + (selectedOpenInvoice.date_ad || '—')
                      : ''}
                  </small>
                  <FieldError msg={payErrors.invoice_id && payErrors.invoice_id.join(' ')} />
                </div>
                <div className="form-row">
                  <div className="form-group col-md-6">
                    <label htmlFor="payAmount">Amount (NPR)</label>
                    <input
                      id="payAmount"
                      className="form-control"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                    />
                    <FieldError msg={payErrors.amount_npr && payErrors.amount_npr.join(' ')} />
                  </div>
                  <div className="form-group col-md-6">
                    <label htmlFor="payDate">Payment date</label>
                    <input
                      id="payDate"
                      className="form-control"
                      type="date"
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                    />
                    <FieldError msg={payErrors.date_ad && payErrors.date_ad.join(' ')} />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="payTxnRef">Transaction ref (optional)</label>
                  <input
                    id="payTxnRef"
                    className="form-control"
                    type="text"
                    placeholder="e.g. cheque no. or transfer ref"
                    maxLength="255"
                    value={payTxnRef}
                    onChange={(e) => setPayTxnRef(e.target.value)}
                  />
                  <FieldError msg={payErrors.txn_ref && payErrors.txn_ref.join(' ')} />
                </div>
                <div className="form-group">
                  <label htmlFor="payReceiptNo">Receipt number (optional)</label>
                  <input
                    id="payReceiptNo"
                    className="form-control"
                    type="text"
                    placeholder="Leave empty for the next number"
                    maxLength="50"
                    value={payReceiptNo}
                    onChange={(e) => setPayReceiptNo(e.target.value)}
                  />
                  <FieldError msg={payErrors.receipt_number && payErrors.receipt_number.join(' ')} />
                </div>
                {payFormError && <div className="alert alert-danger" role="alert">{payFormError}</div>}
                {payFormSuccess && <div className="alert alert-success" role="alert">{payFormSuccess}</div>}
                <button className="btn btn-success" type="submit" disabled={paySubmitting}>
                  Record payment
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
      <div className="row">
        <div className="col-lg-6 mb-4">
          <div className="card h-100">
            <div className="card-body">
              <h5 className="card-title">Record vendor bill</h5>
              <p className="text-muted small">
                Records a bill from a supplier — what we owe. The
                supplier&apos;s own bill number is the invoice number; no
                IRD number is used, and it is never a tax invoice.
              </p>
              <form onSubmit={createVendorBill} noValidate>
                <div className="form-group">
                  <label htmlFor="vbSupplier">Supplier</label>
                  <select
                    id="vbSupplier"
                    className="form-control"
                    value={vbSupplier}
                    onChange={(e) => setVbSupplier(e.target.value)}
                  >
                    <option value="">Pick a supplier…</option>
                    {SUPPLIERS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                    <option value={SUPPLIER_OTHER}>Other — type a new supplier</option>
                  </select>
                  {vbSupplier === SUPPLIER_OTHER && (
                    <input
                      className="form-control mt-2"
                      type="text"
                      placeholder="Supplier name"
                      maxLength="255"
                      value={vbSupplierOther}
                      onChange={(e) => setVbSupplierOther(e.target.value)}
                    />
                  )}
                  <FieldError msg={vbErrors.supplier && vbErrors.supplier.join(' ')} />
                </div>
                <div className="form-group">
                  <label htmlFor="vbService">Service / item</label>
                  <input
                    id="vbService"
                    className="form-control"
                    type="text"
                    placeholder="e.g. Single Unlimited hosting — example.com"
                    maxLength="1000"
                    value={vbService}
                    onChange={(e) => setVbService(e.target.value)}
                  />
                  <FieldError msg={vbErrors.service && vbErrors.service.join(' ')} />
                </div>
                <div className="form-row">
                  <div className="form-group col-md-6">
                    <label htmlFor="vbAmount">Amount (NPR)</label>
                    <input
                      id="vbAmount"
                      className="form-control"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={vbAmount}
                      onChange={(e) => setVbAmount(e.target.value)}
                    />
                    <FieldError msg={vbErrors.amount_npr && vbErrors.amount_npr.join(' ')} />
                  </div>
                  <div className="form-group col-md-6">
                    <label htmlFor="vbVatIncluded">Amount includes 13% VAT?</label>
                    <select
                      id="vbVatIncluded"
                      className="form-control"
                      value={vbVatIncluded}
                      onChange={(e) => setVbVatIncluded(e.target.value)}
                    >
                      <option value="yes">Yes — 13% included</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group col-md-6">
                    <label htmlFor="vbDate">Bill date</label>
                    <input
                      id="vbDate"
                      className="form-control"
                      type="date"
                      value={vbDate}
                      onChange={(e) => setVbDate(e.target.value)}
                    />
                    <FieldError msg={vbErrors.date_ad && vbErrors.date_ad.join(' ')} />
                  </div>
                  <div className="form-group col-md-6">
                    <label htmlFor="vbDueDate">Due date (optional)</label>
                    <input
                      id="vbDueDate"
                      className="form-control"
                      type="date"
                      value={vbDueDate}
                      onChange={(e) => setVbDueDate(e.target.value)}
                    />
                    <FieldError msg={vbErrors.due_date_ad && vbErrors.due_date_ad.join(' ')} />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="vbBillNo">Supplier&apos;s bill no. (optional)</label>
                  <input
                    id="vbBillNo"
                    className="form-control"
                    type="text"
                    placeholder="e.g. 73408"
                    maxLength="50"
                    value={vbBillNo}
                    onChange={(e) => setVbBillNo(e.target.value)}
                  />
                  <FieldError msg={vbErrors.supplier_bill_no && vbErrors.supplier_bill_no.join(' ')} />
                </div>
                <div className="form-group">
                  <label htmlFor="vbNotes">Notes (optional)</label>
                  <textarea
                    id="vbNotes"
                    className="form-control"
                    rows="2"
                    maxLength="2000"
                    value={vbNotes}
                    onChange={(e) => setVbNotes(e.target.value)}
                  />
                  <FieldError msg={vbErrors.notes && vbErrors.notes.join(' ')} />
                </div>
                {vbFormError && <div className="alert alert-danger" role="alert">{vbFormError}</div>}
                {vbFormSuccess && <div className="alert alert-success" role="alert">{vbFormSuccess}</div>}
                <button className="btn btn-primary" type="submit" disabled={vbSubmitting}>
                  Record vendor bill
                </button>
              </form>
            </div>
          </div>
        </div>
        <div className="col-lg-6 mb-4">
          <div className="card h-100">
            <div className="card-body">
              <h5 className="card-title">Record vendor receipt</h5>
              <p className="text-muted small">
                Records a payment against an open vendor bill. The amount
                cannot be more than what is still to pay.
              </p>
              <form onSubmit={recordVendorPayment} noValidate>
                <div className="form-group">
                  <label htmlFor="vrBill">Open vendor bill</label>
                  <select
                    id="vrBill"
                    className="form-control"
                    value={vrBillId}
                    onChange={(e) => setVrBillId(e.target.value)}
                  >
                    {vendorBills.length ? (
                      vendorBills.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {(inv.invoice_number || ('#' + inv.id))} — {inv.client_name} — still to pay{' '}
                          {money(inv.remaining_amount_npr)}
                        </option>
                      ))
                    ) : (
                      <option value="">No open vendor bills</option>
                    )}
                  </select>
                  <small className="form-text text-muted">
                    {selectedVendorBill
                      ? 'Still to pay on this bill: ' +
                        money(selectedVendorBill.remaining_amount_npr) +
                        ' · billed ' + (selectedVendorBill.date_ad || '—')
                      : ''}
                  </small>
                  {vendorBillsError && (
                    <small className="form-text text-danger">{vendorBillsError}</small>
                  )}
                  <FieldError msg={vrErrors.invoice_id && vrErrors.invoice_id.join(' ')} />
                </div>
                <div className="form-row">
                  <div className="form-group col-md-6">
                    <label htmlFor="vrAmount">Amount (NPR)</label>
                    <input
                      id="vrAmount"
                      className="form-control"
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={vrAmount}
                      onChange={(e) => setVrAmount(e.target.value)}
                    />
                    <FieldError msg={vrErrors.amount_npr && vrErrors.amount_npr.join(' ')} />
                  </div>
                  <div className="form-group col-md-6">
                    <label htmlFor="vrDate">Payment date</label>
                    <input
                      id="vrDate"
                      className="form-control"
                      type="date"
                      value={vrDate}
                      onChange={(e) => setVrDate(e.target.value)}
                    />
                    <FieldError msg={vrErrors.date_ad && vrErrors.date_ad.join(' ')} />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="vrTxnRef">Transaction ref (optional)</label>
                  <input
                    id="vrTxnRef"
                    className="form-control"
                    type="text"
                    placeholder="e.g. cheque no. or transfer ref"
                    maxLength="255"
                    value={vrTxnRef}
                    onChange={(e) => setVrTxnRef(e.target.value)}
                  />
                  <FieldError msg={vrErrors.txn_ref && vrErrors.txn_ref.join(' ')} />
                </div>
                <div className="form-group">
                  <label htmlFor="vrReceiptNo">Receipt number (optional)</label>
                  <input
                    id="vrReceiptNo"
                    className="form-control"
                    type="text"
                    placeholder="Leave empty for the next number"
                    maxLength="50"
                    value={vrReceiptNo}
                    onChange={(e) => setVrReceiptNo(e.target.value)}
                  />
                  <FieldError msg={vrErrors.receipt_number && vrErrors.receipt_number.join(' ')} />
                </div>
                {vrFormError && <div className="alert alert-danger" role="alert">{vrFormError}</div>}
                {vrFormSuccess && <div className="alert alert-success" role="alert">{vrFormSuccess}</div>}
                <button className="btn btn-success" type="submit" disabled={vrSubmitting}>
                  Record vendor receipt
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
      <p className="text-muted small">
        Credit notes are not in this first version — invoice and payment only.
      </p>
    </>
  );
}
