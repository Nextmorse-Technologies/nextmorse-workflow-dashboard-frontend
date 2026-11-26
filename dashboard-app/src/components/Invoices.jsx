import { useEffect, useState } from 'react';
import { friendlyError, money } from '../api.js';
import { dateLabel } from '../dates.js';

/* The Client Invoices register, like the Laravel page: the sent
   invoices for the fiscal year grouped into Tax / Petty cash /
   Other, then the locked tax invoices and the locked petty cash
   invoices. Lists only — adding lives in the Billing tab.
   Credit notes have no card here: the API has no endpoint that
   lists them, only POST to create one. */

/* The invoice number as shown: a tax invoice (a VAT treatment, or
   any VAT charged) shows its number; anything else carries NT in
   front — the same rule as InvoiceNumbering::displayNumber. */
export function displayNumber(inv) {
  const num = inv.invoice_number || '—';
  if (num === '—') return num;
  const isTax = ['vat_tds', 'vat_only'].includes(inv.treatment) ||
    (Number(inv.vat_npr) || 0) > 0;
  return isTax ? num : 'NT-' + num;
}

export function isSent(inv) {
  return inv.kind === 'sent' || inv.kind === 'mou_receivable';
}

/* The three groups of the register — the same rule as
   BillingSimulatorService::groupInvoices. */
export function groupInvoices(rows) {
  const groups = { tax: [], petty_cash: [], other: [] };
  rows.forEach((inv) => {
    if (['vat_tds', 'vat_only'].includes(inv.treatment)) groups.tax.push(inv);
    else if (inv.treatment === 'no_vat_no_tds') groups.petty_cash.push(inv);
    else groups.other.push(inv);
  });
  return groups;
}

export function groupTotal(items) {
  return items.reduce((sum, inv) => sum + (Number(inv.amount_npr) || 0), 0);
}

/* A locked tax invoice carries the tax-invoice marker. */
export function lockedTax(rows) {
  return rows.filter((inv) => inv.tax_invoice_issued);
}

/* Locked petty cash: Paid no-VAT invoices (kind sent only). */
export function lockedPettyCash(rows) {
  return rows.filter((inv) =>
    inv.kind === 'sent' &&
    ['no_vat', 'no_vat_no_tds'].includes(inv.treatment) &&
    inv.status === 'Paid');
}

/* Hover text for a locked invoice's Status badge — the same rule as
   BillingSimulatorService::statusTitle. */
export function statusTitle(inv) {
  if (inv.status === 'Paid' && inv.paid_date_ad) {
    return 'Paid on ' + dateLabel(inv.paid_date_ad, inv.paid_date_bs);
  }
  if (inv.due_date_ad) {
    return 'Due on ' + dateLabel(inv.due_date_ad, inv.due_date_bs);
  }
  return '';
}

export function statusBadge(status) {
  if (status === 'Paid') return 'badge-success';
  if (status === 'Open') return 'badge-warning';
  if (status === 'Due') return 'badge-danger';
  if (status === 'Partially paid') return 'badge-info';
  return 'badge-secondary';
}

function printUrl(apiBase, inv) {
  if (!apiBase) return null;
  return apiBase.replace(/\/+$/, '') + '/invoices/' + inv.id + '/print';
}

const GROUPS = [
  { key: 'tax', heading: 'Tax invoices' },
  { key: 'petty_cash', heading: 'Petty cash' },
  { key: 'other', heading: 'Other invoices' },
];

export function GroupTable({ items, apiBase }) {
  return (
    <div className="table-responsive">
      <table className="table table-striped table-sm bg-white">
        <thead>
          <tr>
            <th>Invoice no.</th>
            <th>Client</th>
            <th>Package / Service / Product</th>
            <th className="text-right">Amount</th>
            <th>Status</th>
            <th>Issued</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((inv) => (
            <tr key={inv.id}>
              <td>{displayNumber(inv)}</td>
              <td>{inv.client_name || '—'}</td>
              <td>{inv.service || '—'}</td>
              <td className="text-right">{money(inv.amount_npr)}</td>
              <td><span className={'badge ' + statusBadge(inv.status)}>{inv.status}</span></td>
              <td>{dateLabel(inv.date_ad, inv.date_bs)}</td>
              <td>
                {printUrl(apiBase, inv) ? (
                  <a className="btn btn-sm btn-secondary" href={printUrl(apiBase, inv)}>Print</a>
                ) : (
                  <span className="text-muted">Print</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Invoices({ api, apiBase, refreshKey, fy, initialRows }) {
  const [rows, setRows] = useState(initialRows || null);
  const [loading, setLoading] = useState(!initialRows);
  const [loadError, setLoadError] = useState('');

  /* The whole invoice list, once — 324 rows over two pages at most —
     so the fiscal-year filter works client-side with no refetch. */
  useEffect(() => {
    if (initialRows) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        let all = [];
        let page = 1;
        let total = Infinity;
        while (all.length < total) {
          const resp = await api('/invoices?per_page=200&page=' + page);
          const d = (resp && resp.data) || [];
          total = (resp && resp.meta && resp.meta.pagination && resp.meta.pagination.total) || d.length;
          all = all.concat(d);
          page += 1;
          if (!d.length) break;
        }
        if (!cancelled) setRows(all);
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
  const shown = !rows
    ? []
    : effectiveFy === 'all'
      ? rows
      : rows.filter((r) => r.fiscal_year === effectiveFy);

  const sent = shown.filter(isSent);
  const groups = groupInvoices(sent);
  const locked = lockedTax(shown);
  const lockedPetty = lockedPettyCash(shown);

  return (
    <>
      <h3 className="h5">Client Invoices</h3>
      <p className="mb-2 text-muted">
        {effectiveFy === 'all'
          ? 'Showing all years.'
          : 'Showing ' + effectiveFy + ' — money and government figures follow this fiscal year.'}
      </p>
      {loading && <p className="text-muted">Loading invoices…</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {rows && (
        <>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">Sent invoices</h4>
              {GROUPS.map((g) => {
                const items = groups[g.key];
                return (
                  <div key={g.key}>
                    <h5 className="h6 mt-3">
                      {g.heading} — Subtotal: {money(groupTotal(items))}
                    </h5>
                    {items.length ? (
                      <GroupTable items={items} apiBase={apiBase} />
                    ) : (
                      <p className="text-muted">No client invoices in this fiscal year.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                Locked tax invoices — Subtotal: {money(groupTotal(locked))}
              </h4>
              {locked.length ? (
                <div className="table-responsive">
                  <table className="table table-striped table-sm bg-white">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Client</th>
                        <th className="text-right">Amount</th>
                        <th>Issued</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {locked.map((inv) => (
                        <tr key={inv.id}>
                          <td>{inv.invoice_number || '—'}</td>
                          <td>{inv.client_name || '—'}</td>
                          <td className="text-right">{money(inv.amount_npr)}</td>
                          <td>{dateLabel(inv.date_ad, inv.date_bs)}</td>
                          <td>
                            <span className="badge badge-success" title={statusTitle(inv) || undefined}>Locked</span>
                          </td>
                          <td>
                            {printUrl(apiBase, inv) ? (
                              <a className="btn btn-sm btn-secondary" href={printUrl(apiBase, inv)}>Print</a>
                            ) : (
                              <span className="text-muted">Print</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted mb-0">No locked tax invoices in this fiscal year.</p>
              )}
            </div>
          </div>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                Locked petty cash invoices — Subtotal: {money(groupTotal(lockedPetty))}
              </h4>
              <p className="text-muted small">
                Paid invoices in this fiscal year — cash that remains as petty cash.
              </p>
              {lockedPetty.length ? (
                <GroupTable items={lockedPetty} apiBase={apiBase} />
              ) : (
                <p className="text-muted mb-0">No locked petty cash invoices in this fiscal year.</p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
