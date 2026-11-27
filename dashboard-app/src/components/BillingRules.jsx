import { useEffect, useState } from 'react';
import { friendlyError, money } from '../api.js';
import { dateLabel, fyOfAd } from '../dates.js';

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
export default function BillingRules({ api, clients, refreshKey, fy, onIssueInvoice, initialRules, initialClientNames, initialClientDomains }) {
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

  /* The fiscal year comes from the shared picker in the tab bar
     (App); this tab only filters on it — by each rule's next due
     date. Laravel order: by client, then by rule. Non-active rules
     are hidden from this tab (see activeRules above). */
  const effectiveFy = fy || 'all';
  const { shown, undated } = rulesForFy(rules, effectiveFy);
  const sorted = shown.slice().sort((a, b) => (a.client_id - b.client_id) || (a.id - b.id));
  const undatedSorted = undated.slice().sort((a, b) => (a.client_id - b.client_id) || (a.id - b.id));
  const hiddenCount = (rules || []).length - activeRules(rules).length;

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

  const ruleTable = (rows) => (
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
          {rows.map(ruleRow)}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <h3 className="h5">Billing Rules</h3>
      <p className="mb-2 text-muted">The recurring charges, with treatment and TDS status.</p>
      <p className="mb-2 text-muted">
        {effectiveFy === 'all'
          ? 'Showing all years.'
          : 'Showing ' + effectiveFy + ' — rules due in ' + effectiveFy + ' by their next due date.'}
      </p>
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
              ruleTable(sorted)
            )}
            {undatedSorted.length > 0 && (
              <>
                <h4 className="h6 mt-4">No due date — active rules with no next due date</h4>
                <p className="text-muted small">
                  These rules have no next due date on record, so they cannot
                  be placed in a fiscal year — they are listed here instead
                  of being hidden.
                </p>
                {ruleTable(undatedSorted)}
              </>
            )}
          </>
        )
      )}
    </>
  );
}
