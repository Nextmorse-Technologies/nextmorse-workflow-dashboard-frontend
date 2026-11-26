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

export default function Billing({ api, clients, openInvoices, meta, onWrote, prefill, onPrefillApplied }) {
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

  const todayAd = meta && meta.today && meta.today.ad
    ? meta.today.ad
    : new Date().toISOString().slice(0, 10);
  const treatments = (meta && meta.enums && meta.enums.invoice_treatment) ||
    TREATMENTS_FALLBACK;

  /* Default the two date fields from the API's "today" once meta loads,
     matching the plain dashboard's applyMeta(). */
  useEffect(() => {
    if (todayAd) {
      setInvDate((d) => d || todayAd);
      setPayDate((d) => d || todayAd);
    }
  }, [todayAd]);

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
      setRules((resp && resp.data) || []);
    } catch (err) {
      /* No rules, no problem: the service stays a free-text field. */
      setRulesError(friendlyError(err));
    } finally {
      setRulesLoading(false);
    }
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
    setSelectedRule(ruleId);
    const rule = rules.find((r) => String(r.id) === String(ruleId)) || null;
    const clientDomain = (clients || []).find((c) => String(c.id) === String(invClient))?.domain ||
      (prefillClient && prefillClient.domain) || '';
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
    setSelectedRule(fill.ruleId);
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

  const selectedOpenInvoice = openInvoices.find(
    (inv) => String(inv.id) === String(payInvoiceId),
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
                  {invClient && rulesLoading ? (
                    <input
                      id="invService"
                      className="form-control"
                      type="text"
                      placeholder="Loading services…"
                      disabled
                      value=""
                      readOnly
                    />
                  ) : invClient && rules.length > 0 ? (
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
                    </select>
                  ) : (
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
                  )}
                  {invClient && !rulesLoading && rules.length === 0 && (
                    <small className="form-text text-muted">
                      No services on file for this client — type the service.
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
                    {selectedRule && (
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
                    {openInvoices.length ? (
                      openInvoices.map((inv) => (
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
      <p className="text-muted small">
        Credit notes are not in this first version — invoice and payment only.
      </p>
    </>
  );
}
