import { useEffect, useState } from 'react';
import { fieldErrors, friendlyError, money, TREATMENT_LABELS, TREATMENTS_FALLBACK } from '../api.js';
import { dateLabel, fyOfAd } from '../dates.js';
import { SortHeader, useTableSort } from '../sort.js';

/* The Laravel /billing/rules page, from the API: the recurring
   charges (AMCs), with treatment and TDS status. The rules endpoint
   returns the raw rows (no client name, no BS date), so client names
   come from the Active list the app already loads, plus one fetch
   each for any rule whose client is not Active. The tab follows the
   shared Fiscal year picker, by each rule's next due date; rules
   with no due date are listed separately, never hidden. Only active
   rules are shown: the two no-billing rules (status 'none') and the
   inactive Multigate rule are hidden. The Billing tab's attach
   list is unaffected — it picks by amount, not status. */

/* Only the rules that bill: status 'active'. The hidden ones are
   the two no-billing rules (Mountain Fund, Anishma — 'none') and
   the inactive Multigate rule. */
export function activeRules(rows) {
  return (rows || []).filter((r) => r.status === 'active');
}

/* The fiscal year a rule belongs to — the starting BS year of its
   next due date. Null when the rule has no next due date (Saptabhume,
   the NOSHA cost-share, GeoNext, Nep Tours). */
export function ruleFy(rule) {
  if (!rule) return null;
  return fyOfAd(rule.next_due_ad);
}

/* Split the active rules for the picked year: the rules due that
   year, and the active rules with no due date — never silently
   dropped, shown separately and labelled. 'all' keeps everything
   in the one table. */
export function rulesForFy(rows, fy) {
  const list = activeRules(rows);
  if (!fy || fy === 'all') return { shown: list, undated: [] };
  const fyStart = parseInt(String(fy).split('/')[0], 10);
  const shown = [];
  const undated = [];
  list.forEach((r) => {
    const y = ruleFy(r);
    if (y === null) undated.push(r);
    else if (y === fyStart) shown.push(r);
  });
  return { shown, undated };
}
/* One rules table, with its own sort state — each table sorts
   only the rules actually shown, after the fiscal-year filter.
   It starts in its original order (client, then rule). The
   Issue invoice column has no sort; it is an action. */
function RuleTable({ rows, clientNames, clientDomains, onIssueInvoice }) {
  const sort = useTableSort(null);
  const sorted = sort.apply(rows, (r, key) => {
    switch (key) {
      case 'service': return r.service || '';
      case 'cycle': return r.cycle || '';
      case 'amount': return r.amount_npr;
      case 'treatment': return r.treatment || '';
      case 'tds': return r.tds_status || '';
      case 'nextDue': return r.next_due_ad || '';
      default: return clientNames[r.client_id] || '';
    }
  });
  const ruleRow = (r) => (
    <tr key={r.id}>
      <td>{clientNames[r.client_id] || '—'}</td>
      <td>{r.service}</td>
      <td>{r.cycle || '—'}</td>
      <td className="text-right">{r.amount_npr != null ? money(r.amount_npr) : '—'}</td>
      <td>{r.treatment || '—'}</td>
      <td>{r.tds_status || '—'}</td>
      <td>{r.next_due_ad ? dateLabel(r.next_due_ad) : '—'}</td>
      <td>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => onIssueInvoice && onIssueInvoice(r, clientNames[r.client_id] || '', clientDomains[r.client_id] || '')}
        >
          Issue invoice
        </button>
      </td>
    </tr>
  );
  return (
    <div className="table-responsive">
      <table className="table table-striped table-sm bg-white">
        <thead>
          <tr>
            <SortHeader label="Client" sortKey="client" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
            <SortHeader label="Service" sortKey="service" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
            <SortHeader label="Cycle" sortKey="cycle" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
            <SortHeader label="Amount" sortKey="amount" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} className="text-right" />
            <SortHeader label="Treatment" sortKey="treatment" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
            <SortHeader label="TDS" sortKey="tds" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
            <SortHeader label="Next due" sortKey="nextDue" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
            <th>Invoice</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(ruleRow)}
        </tbody>
      </table>
    </div>
  );
}

/* One field error, under its input — the same shape as the
   Billing tab's forms. */
function FieldError({ msg }) {
  return msg ? <small className="form-text text-danger">{msg}</small> : null;
}

/* The cycles a rule can bill on — the same set the API accepts. */
const CYCLES = ['none', 'monthly', 'quarterly', '3-monthly', '4-monthly', 'annual'];

/* The payload a create-rule submit sends: empty fields go as null
   (the API treats them as unset), never as empty strings. */
export function createRulePayload(form) {
  return {
    client_id: Number(form.clientId),
    service: form.service.trim(),
    cycle: form.cycle,
    amount_npr: form.amount === '' ? null : Number(form.amount),
    vat_applies: form.vatApplies,
    treatment: form.treatment === '' ? null : form.treatment,
    next_due_ad: form.nextDue === '' ? null : form.nextDue,
    tds_status: form.tdsStatus,
    tds_amount_npr: form.tdsAmount === '' ? null : Number(form.tdsAmount),
    notes: form.notes.trim() === '' ? null : form.notes.trim(),
  };
}

export function emptyRuleForm() {
  return {
    clientId: '', service: '', cycle: 'annual', amount: '',
    vatApplies: 'unknown', treatment: '', nextDue: '',
    tdsStatus: 'unknown', tdsAmount: '', notes: '',
  };
}

/* Create a billing rule — the recurring charge itself. The new rule
   is active, so it shows in the list and in the Issue-invoice picker
   at once. Creating it posts nothing and numbers no invoice. */
function CreateRuleForm({ api, clients, onCreated }) {
  const [form, setForm] = useState(emptyRuleForm());
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [created, setCreated] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const sortedClients = (clients || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    setFormError('');
    setCreated('');
    setSubmitting(true);
    try {
      const resp = await api('/billing-rules', { method: 'POST', body: createRulePayload(form) });
      const rec = (resp && resp.data) || {};
      const name = (clients || []).find((c) => String(c.id) === String(form.clientId));
      setCreated('Rule created for ' + (name ? name.name : 'client ' + form.clientId) + ' — ' + (rec.service || form.service) + '.');
      setForm(emptyRuleForm());
      if (onCreated) onCreated();
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card mb-4">
      <div className="card-body">
        <h4 className="card-title h6">Create a billing rule</h4>
        <p className="text-muted small">
          A new recurring charge. It is active at once, so it shows in the list
          and in the Issue-invoice picker. Creating it posts nothing and numbers
          no invoice — issuing one from it is a separate step.
        </p>
        {created && <div className="alert alert-success" role="alert">{created}</div>}
        {formError && <div className="alert alert-danger" role="alert">{formError}</div>}
        <form onSubmit={submit}>
          <div className="form-row">
            <div className="form-group col-md-6">
              <label htmlFor="rule-client">Client</label>
              <select id="rule-client" className="form-control" value={form.clientId} onChange={(e) => set('clientId', e.target.value)} required>
                <option value="">Pick a client…</option>
                {sortedClients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <FieldError msg={errors.client_id && errors.client_id[0]} />
            </div>
            <div className="form-group col-md-6">
              <label htmlFor="rule-service">Service</label>
              <input id="rule-service" type="text" className="form-control" value={form.service} onChange={(e) => set('service', e.target.value)} placeholder="e.g. Hosting & domains" required />
              <FieldError msg={errors.service && errors.service[0]} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group col-md-4">
              <label htmlFor="rule-cycle">Cycle</label>
              <select id="rule-cycle" className="form-control" value={form.cycle} onChange={(e) => set('cycle', e.target.value)}>
                {CYCLES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <FieldError msg={errors.cycle && errors.cycle[0]} />
            </div>
            <div className="form-group col-md-4">
              <label htmlFor="rule-amount">Amount (NPR)</label>
              <input id="rule-amount" type="number" min="0" step="0.01" className="form-control" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="Blank when it varies" />
              <FieldError msg={errors.amount_npr && errors.amount_npr[0]} />
            </div>
            <div className="form-group col-md-4">
              <label htmlFor="rule-treatment">Treatment</label>
              <select id="rule-treatment" className="form-control" value={form.treatment} onChange={(e) => set('treatment', e.target.value)}>
                <option value="">Unknown</option>
                {TREATMENTS_FALLBACK.map((t) => (
                  <option key={t} value={t}>{TREATMENT_LABELS[t]}</option>
                ))}
              </select>
              <FieldError msg={errors.treatment && errors.treatment[0]} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group col-md-4">
              <label htmlFor="rule-vat">VAT applies</label>
              <select id="rule-vat" className="form-control" value={form.vatApplies} onChange={(e) => set('vatApplies', e.target.value)}>
                <option value="unknown">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="not applicable">Not applicable</option>
              </select>
              <FieldError msg={errors.vat_applies && errors.vat_applies[0]} />
            </div>
            <div className="form-group col-md-4">
              <label htmlFor="rule-next-due">Next due</label>
              <input id="rule-next-due" type="date" className="form-control" value={form.nextDue} onChange={(e) => set('nextDue', e.target.value)} />
              <FieldError msg={errors.next_due_ad && errors.next_due_ad[0]} />
            </div>
            <div className="form-group col-md-4">
              <label htmlFor="rule-tds">TDS</label>
              <select id="rule-tds" className="form-control" value={form.tdsStatus} onChange={(e) => set('tdsStatus', e.target.value)}>
                <option value="unknown">Unknown</option>
                <option value="applies">Applies — Nextmorse pays it</option>
                <option value="not applicable">Not applicable</option>
              </select>
              <FieldError msg={errors.tds_status && errors.tds_status[0]} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group col-md-4">
              <label htmlFor="rule-tds-amount">TDS amount (NPR)</label>
              <input id="rule-tds-amount" type="number" min="0" step="0.01" className="form-control" value={form.tdsAmount} onChange={(e) => set('tdsAmount', e.target.value)} placeholder="Only when TDS applies" />
              <FieldError msg={errors.tds_amount_npr && errors.tds_amount_npr[0]} />
            </div>
            <div className="form-group col-md-8">
              <label htmlFor="rule-notes">Notes</label>
              <input id="rule-notes" type="text" className="form-control" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              <FieldError msg={errors.notes && errors.notes[0]} />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create rule'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function BillingRules({ api, clients, refreshKey, fy, onIssueInvoice, initialRules, initialClientNames, initialClientDomains }) {
  const [rules, setRules] = useState(initialRules || null);
  /* Bumped when a rule is created from the form, so the list
     refetches and the new rule shows at once. */
  const [createdCount, setCreatedCount] = useState(0);
  const [clientNames, setClientNames] = useState(initialClientNames || {});
  const [clientDomains, setClientDomains] = useState(initialClientDomains || {});
  const [loading, setLoading] = useState(!initialRules);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (initialRules) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const resp = await api('/billing-rules?per_page=200');
        const rows = (resp && resp.data) || [];
        const known = {};
        const knownDomains = {};
        (clients || []).forEach((c) => { known[c.id] = c.name; if (c.domain) knownDomains[c.id] = c.domain; });
        const missing = [...new Set(rows.map((r) => r.client_id).filter((id) => id != null && known[id] === undefined))];
        const fetched = {};
        const fetchedDomains = {};
        await Promise.all(missing.map(async (id) => {
          try {
            const one = await api('/clients/' + id);
            /* The client show endpoint nests the record under
               `client`, not `data` — read both shapes. */
            const rec = (one && (one.client || one.data)) || {};
            if (rec.name) fetched[id] = rec.name;
            if (rec.domain) fetchedDomains[id] = rec.domain;
          } catch (e) { /* leave unknown — shown as — */ }
        }));
        if (cancelled) return;
        setClientNames({ ...known, ...fetched });
        setClientDomains({ ...knownDomains, ...fetchedDomains });
        setRules(rows);
      } catch (err) {
        if (!cancelled) setLoadError(friendlyError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Re-fetch on Reload, and when a rule is created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, createdCount]);

  /* The fiscal year comes from the shared picker in the tab bar
     (App); this tab only filters on it — by each rule's next due
     date. Laravel order: by client, then by rule. Non-active rules
     are hidden from this tab (see activeRules above). */
  const effectiveFy = fy || 'all';
  const { shown, undated } = rulesForFy(rules, effectiveFy);
  const sorted = shown.slice().sort((a, b) => (a.client_id - b.client_id) || (a.id - b.id));
  const undatedSorted = undated.slice().sort((a, b) => (a.client_id - b.client_id) || (a.id - b.id));
  const hiddenCount = (rules || []).length - activeRules(rules).length;

  return (
    <>
      <h3 className="h5">Billing Rules</h3>
      <p className="mb-2 text-muted">The recurring charges, with treatment and TDS status.</p>
      <p className="mb-2 text-muted">
        {effectiveFy === 'all'
          ? 'Showing all years.'
          : 'Showing ' + effectiveFy + ' — rules due in ' + effectiveFy + ' by their next due date.'}
      </p>
      <CreateRuleForm api={api} clients={clients} onCreated={() => setCreatedCount((n) => n + 1)} />
      {rules && hiddenCount > 0 && (
        <p className="text-muted small">
          Showing {activeRules(rules).length} active rules — {hiddenCount} hidden (no billing or inactive).
        </p>
      )}
      {loading && <p className="text-muted">Loading billing rules…</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {rules && (
        sorted.length === 0 && undatedSorted.length === 0 ? (
          <p className="text-muted">{rules.length === 0 ? 'No billing rules on record.' : 'No active billing rules.'}</p>
        ) : (
          <>
            {sorted.length === 0 ? (
              <p className="text-muted">No rules due in this fiscal year.</p>
            ) : (
              <RuleTable rows={sorted} clientNames={clientNames} clientDomains={clientDomains} onIssueInvoice={onIssueInvoice} />
            )}
            {undatedSorted.length > 0 && (
              <>
                <h4 className="h6 mt-4">No due date — active rules with no next due date</h4>
                <p className="text-muted small">
                  These rules have no next due date on record, so they cannot
                  be placed in a fiscal year — they are listed here instead
                  of being hidden.
                </p>
                <RuleTable rows={undatedSorted} clientNames={clientNames} clientDomains={clientDomains} onIssueInvoice={onIssueInvoice} />
              </>
            )}
          </>
        )
      )}
    </>
  );
}
