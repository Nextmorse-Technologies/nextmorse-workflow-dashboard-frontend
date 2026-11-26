import { useEffect, useState } from 'react';
import { friendlyError, money } from '../api.js';
import { dateLabel } from '../dates.js';

/* The Laravel /billing/rules page, from the API: the recurring
   charges (AMCs), with treatment and TDS status. The rules endpoint
   returns the raw rows (no client name, no BS date), so client names
   come from the Active list the app already loads, plus one fetch
   each for any rule whose client is not Active. The page has no
   fiscal-year filter, so this tab is all-years. */
export default function BillingRules({ api, clients, refreshKey, onIssueInvoice, initialRules, initialClientNames, initialClientDomains }) {
  const [rules, setRules] = useState(initialRules || null);
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
    // Re-fetch on Reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  /* Laravel order: by client, then by rule. */
  const sorted = (rules || []).slice().sort((a, b) => (a.client_id - b.client_id) || (a.id - b.id));

  return (
    <>
      <h3 className="h5">Billing Rules</h3>
      <p className="mb-2 text-muted">The recurring charges, with treatment and TDS status.</p>
      {loading && <p className="text-muted">Loading billing rules…</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {rules && (
        sorted.length === 0 ? (
          <p className="text-muted">No billing rules on record.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-striped table-sm bg-white">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Service</th>
                  <th>Cycle</th>
                  <th className="text-right">Amount</th>
                  <th>Treatment</th>
                  <th>TDS</th>
                  <th>Next due</th>
                  <th>Invoice</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
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
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}
