import { useEffect, useState } from 'react';
import { friendlyError, money } from '../api.js';
import { dateLabel, fyOfBs, parseBs } from '../dates.js';
import { displayNumber, GroupTable } from './Invoices.jsx';

/* The Petty cash register, like the Laravel page: the no-VAT-no-TDS
   invoices for the fiscal year, then the receipts that pay only
   those invoices. Lists only — nothing here is government-tracked.
   The live Laravel page has no locked card (its Locked card view
   was never pushed), so this tab has none either. */

function fyString(fyStart) {
  return fyStart + '/' + String(fyStart + 1).slice(2);
}

function receiptNumber(r) {
  return r.display_number || '—';
}

function receiptUrl(apiBase, r) {
  if (!apiBase) return null;
  return apiBase.replace(/\/+$/, '') + '/billing/receipts/' + r.id;
}

export function isPettyInvoice(inv) {
  return inv.kind === 'sent' &&
    ['no_vat', 'no_vat_no_tds'].includes(inv.treatment);
}

export function total(items) {
  return items.reduce((sum, x) => sum + (Number(x.amount_npr) || 0), 0);
}

export default function PettyCash({ api, meta, apiBase, refreshKey, initialInvoices, initialReceipts }) {
  const [fyFilter, setFyFilter] = useState('');
  const [invoices, setInvoices] = useState(initialInvoices || null);
  const [receipts, setReceipts] = useState(initialReceipts || null);
  const [loading, setLoading] = useState(!initialInvoices || !initialReceipts);
  const [loadError, setLoadError] = useState('');

  /* The whole invoice list (324 rows over two pages) plus the
     receipts, once — so the fiscal-year filter works client-side
     with no refetch. */
  useEffect(() => {
    if (initialInvoices && initialReceipts) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const fetchAll = async (path) => {
          let all = [];
          let page = 1;
          let totalRows = Infinity;
          while (all.length < totalRows) {
            const resp = await api(path + (path.includes('?') ? '&' : '?') + 'per_page=200&page=' + page);
            const d = (resp && resp.data) || [];
            totalRows = (resp && resp.meta && resp.meta.pagination && resp.meta.pagination.total) || d.length;
            all = all.concat(d);
            page += 1;
            if (!d.length) break;
          }
          return all;
        };
        const [inv, rec] = await Promise.all([
          fetchAll('/invoices'),
          fetchAll('/receipts'),
        ]);
        if (!cancelled) {
          setInvoices(inv);
          setReceipts(rec);
        }
      } catch (err) {
        if (!cancelled) setLoadError(friendlyError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Re-fetch when a Billing write lands; api/meta are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  /* Current FY from the API's today (BS); the list's latest FY if
     the API has no today yet. */
  const todayBs = meta && meta.today && meta.today.bs;
  const todayFy = (() => {
    const p = parseBs(todayBs);
    if (!p) return null;
    return fyString(p.mo >= 4 ? p.y : p.y - 1);
  })();
  const fys = [...new Set((invoices || []).map((r) => r.fiscal_year).filter(Boolean))].sort().reverse();
  if (todayFy && !fys.includes(todayFy)) fys.unshift(todayFy);
  const effectiveFy = fyFilter === 'all'
    ? 'all'
    : (fyFilter !== '' ? fyFilter : (todayFy || (fys[0] !== undefined ? fys[0] : 'all')));

  const shownInvoices = !invoices
    ? []
    : invoices.filter((inv) =>
      isPettyInvoice(inv) &&
      (effectiveFy === 'all' || inv.fiscal_year === effectiveFy));
  const shownReceipts = !receipts
    ? []
    : receipts.filter((r) =>
      r.is_petty_cash &&
      (effectiveFy === 'all' || fyOfBs(r.date_bs) === parseInt(effectiveFy.slice(0, 4), 10)));

  return (
    <>
      <h3 className="h5">Petty cash</h3>
      <p className="mb-2 text-muted">
        {effectiveFy === 'all'
          ? 'Showing all years.'
          : 'Showing ' + effectiveFy + ' — money and government figures follow this fiscal year.'}
      </p>
      <div className="form-group" style={{ maxWidth: 260 }}>
        <label htmlFor="pettyFy">Fiscal year</label>
        <select
          id="pettyFy"
          className="form-control"
          value={effectiveFy === 'all' ? 'all' : effectiveFy}
          onChange={(e) => setFyFilter(e.target.value)}
        >
          <option value="all">All years</option>
          {fys.map((f) => (
            <option key={f} value={f}>{'FY ' + f}</option>
          ))}
        </select>
      </div>
      {loading && <p className="text-muted">Loading petty cash…</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {invoices && receipts && (
        <>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                Petty cash invoices — Subtotal: {money(total(shownInvoices))}
              </h4>
              {shownInvoices.length ? (
                <GroupTable items={shownInvoices} apiBase={apiBase} />
              ) : (
                <p className="text-muted mb-0">No petty cash invoices in this fiscal year.</p>
              )}
            </div>
          </div>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                Petty cash receipts — Subtotal: {money(total(shownReceipts))}
              </h4>
              {shownReceipts.length ? (
                <div className="table-responsive">
                  <table className="table table-striped table-sm bg-white">
                    <thead>
                      <tr>
                        <th>Receipt no. (paper s. no., if known)</th>
                        <th>Details</th>
                        <th className="text-right">Amount (NPR)</th>
                        <th>Payment date</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownReceipts.map((r) => (
                        <tr key={r.id}>
                          <td>{receiptNumber(r)}</td>
                          <td>{r.covers || '—'}</td>
                          <td className="text-right">{money(r.amount_npr)}</td>
                          <td>{dateLabel(r.date_ad, r.date_bs)}</td>
                          <td>
                            {receiptUrl(apiBase, r) ? (
                              <a className="btn btn-sm btn-secondary" href={receiptUrl(apiBase, r)}>
                                {'Receipt ' + receiptNumber(r)}
                              </a>
                            ) : (
                              <span className="text-muted">{'Receipt ' + receiptNumber(r)}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted mb-0">No petty cash receipts in this fiscal year.</p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
