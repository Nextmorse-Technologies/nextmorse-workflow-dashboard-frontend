import { useEffect, useState } from 'react';
import { friendlyError, money } from '../api.js';
import { dateLabel, fyOfBs } from '../dates.js';
import { displayNumber, GroupTable, isPettyInvoice, isSent, isTaxInvoice, lockedPettyCash } from './Invoices.jsx';

/* The Petty cash register: the no-VAT-no-TDS invoices for the
   fiscal year, then the locked (paid) petty cash invoices, then
   the receipts that pay only those invoices. Lists only — nothing
   here is government-tracked. A separate card lists the sent
   invoices whose treatment was never recorded — no VAT and no TDS
   on them, but unclassified until Bijaya confirms they are petty
   cash. The live Laravel page has no locked card (its Locked card
   view was never pushed) — that view is still unpushed; this React
   card reads from the API and does not depend on it. */

function receiptNumber(r) {
  return r.display_number || '—';
}

export function total(items) {
  return items.reduce((sum, x) => sum + (Number(x.amount_npr) || 0), 0);
}

export default function PettyCash({ api, refreshKey, fy, initialInvoices, initialReceipts, onPrintInvoice, onPrintReceipt }) {
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
    // Re-fetch when a Billing write lands; api is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  /* The fiscal year comes from the shared picker in the tab bar
     (App); this tab only filters on it. */
  const effectiveFy = fy || 'all';

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

  /* Locked petty cash: the Paid petty invoices in this fiscal year. */
  const lockedPetty = lockedPettyCash(shownInvoices);

  /* Sent invoices that are neither tax nor petty — their treatment
     was never recorded. Shown separately, never hidden, until
     Bijaya confirms they are petty cash. */
  const unclassified = !invoices
    ? []
    : invoices.filter((inv) =>
      isSent(inv) &&
      !isTaxInvoice(inv) &&
      !isPettyInvoice(inv) &&
      (effectiveFy === 'all' || inv.fiscal_year === effectiveFy));

  return (
    <>
      <h3 className="h5">Petty cash</h3>
      <p className="mb-2 text-muted">
        {effectiveFy === 'all'
          ? 'Showing all years.'
          : 'Showing ' + effectiveFy + ' — money and government figures follow this fiscal year.'}
      </p>
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
                <GroupTable items={shownInvoices} onPrint={onPrintInvoice} />
              ) : (
                <p className="text-muted mb-0">No petty cash invoices in this fiscal year.</p>
              )}
            </div>
          </div>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                Locked petty cash invoices — Subtotal: {money(total(lockedPetty))}
              </h4>
              <p className="text-muted small">
                Paid invoices in this fiscal year — cash that remains as petty cash.
              </p>
              {lockedPetty.length ? (
                <GroupTable items={lockedPetty} onPrint={onPrintInvoice} />
              ) : (
                <p className="text-muted mb-0">No locked petty cash invoices in this fiscal year.</p>
              )}
            </div>
          </div>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                Invoices with no treatment recorded — Subtotal: {money(total(unclassified))}
              </h4>
              <p className="text-muted small">
                Sent invoices with no treatment on file — no VAT and no TDS recorded. They are listed here separately, not as petty cash, until confirmed.
              </p>
              {unclassified.length ? (
                <GroupTable items={unclassified} onPrint={onPrintInvoice} />
              ) : (
                <p className="text-muted mb-0">No unclassified invoices in this fiscal year.</p>
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
                            {onPrintReceipt ? (
                              <button type="button" className="btn btn-sm btn-secondary" onClick={() => onPrintReceipt(r.id)}>
                                {'Receipt ' + receiptNumber(r)}
                              </button>
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
