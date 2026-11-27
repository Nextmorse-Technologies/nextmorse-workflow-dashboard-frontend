import { useEffect, useState } from 'react';
import { fetchAllPages, friendlyError, money } from '../api.js';
import { dateLabel, fyOfBs } from '../dates.js';
import { SortHeader, useTableSort } from '../sort.js';
import { displayNumber, displayReceiptNumber, receiptNumberValue, sortInvoices } from './Invoices.jsx';

/* Fiscal year a receipt belongs to, from its BS date. */
function fyOfReceipt(r) {
  return fyOfBs(r.date_bs);
}

/* The four groups of the Laravel receipts register, from the API's
   own flags — the same rules as BillingSimulatorService::groupReceipts:
   petty cash first (no-VAT-no-TDS invoices only), then money out,
   then money in, and what links to no invoice goes in Not linked. */
const GROUPS = [
  { key: 'receipts', heading: 'Received from', party: 'Received from', amount: 'Amount received (NPR)' },
  { key: 'payments', heading: 'Paid to', party: 'Paid to', amount: 'Paid amount (NPR)' },
  { key: 'petty_cash', heading: 'Petty cash', party: 'Details', amount: 'Amount (NPR)' },
  { key: 'unlinked', heading: 'Not linked to an invoice', party: 'Details', amount: 'Amount (NPR)' },
];

function groupOf(r) {
  if (r.is_petty_cash) return 'petty_cash';
  if (r.is_outgoing) return 'payments';
  if (r.invoice_numbers && r.invoice_numbers.length) return 'receipts';
  return 'unlinked';
}

function receiptNumber(r) {
  return displayReceiptNumber(r);
}

/* One of the four groups, with its own sort state — each table
   sorts only the receipts actually shown, after the fiscal-year
   filter. The Print column has no sort; it is an action. */
function ReceiptGroup({ group, items, onPrintReceipt }) {
  const sort = useTableSort(null);
  const total = items.reduce((sum, r) => sum + (Number(r.amount_npr) || 0), 0);
  const sorted = sort.apply(items, (r, key) => {
    switch (key) {
      case 'party': return r.covers || '';
      case 'amount': return r.amount_npr;
      case 'date': return r.date_ad || '';
      default: return receiptNumberValue(r);
    }
  });
  return (
    <div className="card mb-4">
      <div className="card-body">
        <h4 className="card-title h6">
          {group.heading} — Subtotal: {money(total)}
        </h4>
        {items.length ? (
          <div className="table-responsive">
            <table className="table table-striped table-sm bg-white">
              <thead>
                <tr>
                  <SortHeader label="Receipt no." sortKey="number" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                  <SortHeader label={group.party} sortKey="party" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                  <SortHeader label={group.amount} sortKey="amount" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} className="text-right" />
                  <SortHeader label="Payment date" sortKey="date" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <td>{receiptNumber(r)}</td>
                    <td>{r.covers || '—'}</td>
                    <td className="text-right">{money(r.amount_npr)}</td>
                    <td>{dateLabel(r.date_ad, r.date_bs)}</td>
                    <td>
                      {onPrintReceipt ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => onPrintReceipt(r.id)}
                        >
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
          <p className="text-muted mb-0">No receipts in this fiscal year.</p>
        )}
      </div>
    </div>
  );
}

/* Paid sent invoices with no receipt linked (the pivot), for a
   fiscal year — 'all' or one year. Only invoices the API counted
   (receipts_count present and 0) can be placed: an invoice the
   API did not count is left out, never assumed receipted. */
export function paidWithoutReceiptRows(invoices, fy) {
  if (!invoices) return [];
  return invoices.filter((inv) =>
    inv.kind === 'sent' && inv.status === 'Paid' && inv.receipts_count === 0 &&
    (fy === 'all' || !fy || inv.fiscal_year === fy));
}

/* Paid invoices with no receipt linked — the money came in but
   there is no receipt to prove it. From the invoice list (the
   API's receipts_count, the invoice_receipt pivot), not from the
   receipts: a receipt only ever names the invoices it covers.
   A row leaves this list the moment a receipt is recorded for it
   in the Billing tab. */
function PaidWithoutReceipt({ items, onPrintInvoice }) {
  const sort = useTableSort('number', 'asc');
  const total = items.reduce((sum, inv) => sum + (Number(inv.amount_npr) || 0), 0);
  const sorted = sortInvoices(items, sort.sortKey, sort.sortDir);
  return (
    <div className="card mb-4">
      <div className="card-body">
        <h4 className="card-title h6">
          Paid without a receipt ({items.length}) — Subtotal: {money(total)}
        </h4>
        <p className="text-muted small">
          Paid invoices with no receipt linked. Record the receipt from the Billing tab to close each one.
        </p>
        {items.length ? (
          <div className="table-responsive">
            <table className="table table-striped table-sm bg-white">
              <thead>
                <tr>
                  <SortHeader label="Invoice" sortKey="number" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                  <SortHeader label="Client" sortKey="client" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                  <SortHeader label="Amount" sortKey="amount" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} className="text-right" />
                  <SortHeader label="Paid" sortKey="paid" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((inv) => (
                  <tr key={inv.id}>
                    <td>{displayNumber(inv)}</td>
                    <td>{inv.client_name || '—'}</td>
                    <td className="text-right">{money(inv.amount_npr)}</td>
                    <td>{dateLabel(inv.paid_date_ad || inv.date_ad, inv.paid_date_bs || inv.date_bs)}</td>
                    <td>
                      {onPrintInvoice ? (
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => onPrintInvoice(inv.id)}>Print</button>
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
          <p className="text-muted mb-0">No paid invoices without a receipt in this fiscal year.</p>
        )}
      </div>
    </div>
  );
}

export default function Receipts({ api, data, fy, refreshKey, onPrintReceipt, onPrintInvoice }) {
  /* The invoice list, for the paid-without-a-receipt card — the
     receipts alone cannot show it (a receipt only names the
     invoices it covers). Same fetch-every-page pattern as the
     Invoices tab; refreshes when a Billing write lands. */
  const [invoices, setInvoices] = useState(null);
  const [invoicesError, setInvoicesError] = useState('');
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchAllPages(api, '/invoices');
        if (!cancelled) setInvoices(rows);
      } catch (err) {
        if (!cancelled) setInvoicesError(friendlyError(err));
      }
    })();
    return () => { cancelled = true; };
    // Re-fetch when a Billing write lands; api is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (!data) return null;
  const list = data.data || [];

  /* The fiscal year comes from the shared picker in the tab bar
     (App); this tab only filters on it. */
  const effectiveFy = fy || 'all';
  const shown = effectiveFy === 'all'
    ? list
    : list.filter((r) => fyOfReceipt(r) === parseInt(effectiveFy.slice(0, 4), 10));

  const grouped = { receipts: [], payments: [], petty_cash: [], unlinked: [] };
  shown.forEach((r) => grouped[groupOf(r)].push(r));

  /* Paid sent invoices with no receipt linked (the pivot), for
     the picked fiscal year — the same 63 rows the data check
     found (8 + 16 + 13 + 25 + 1 by FY). */
  const paidWithoutReceipt = paidWithoutReceiptRows(invoices, effectiveFy);

  return (
    <>
      <h3 className="h5">Receipts</h3>
      <p className="mb-2 text-muted">
        {effectiveFy === 'all'
          ? 'Showing all years.'
          : 'Showing ' + effectiveFy + ' — money and government figures follow this fiscal year.'}
      </p>
      {GROUPS.map((g) => (
        <ReceiptGroup key={g.key} group={g} items={grouped[g.key]} onPrintReceipt={onPrintReceipt} />
      ))}
      {invoicesError && <div className="alert alert-danger" role="alert">{invoicesError}</div>}
      <PaidWithoutReceipt items={paidWithoutReceipt} onPrintInvoice={onPrintInvoice} />
    </>
  );
}
