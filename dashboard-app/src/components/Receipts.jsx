import { useState } from 'react';
import { money } from '../api.js';
import { dateLabel, fyLabel, fyOfBs, parseBs } from '../dates.js';

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
  return r.display_number || '—';
}

export default function Receipts({ data, meta, apiBase }) {
  const [fyFilter, setFyFilter] = useState('');
  if (!data) return null;
  const list = data.data || [];

  /* Current FY from the API's today (BS); the list's latest FY if
     the API has no today yet. */
  const todayBs = meta && meta.today && meta.today.bs;
  const todayFy = (() => {
    const p = parseBs(todayBs);
    if (!p) return null;
    return p.mo >= 4 ? p.y : p.y - 1;
  })();
  const fys = [...new Set(list.map(fyOfReceipt).filter((f) => f !== null))].sort((a, b) => b - a);
  if (todayFy !== null && !fys.includes(todayFy)) fys.unshift(todayFy);
  const effectiveFy = fyFilter === 'all'
    ? 'all'
    : (fyFilter !== '' ? parseInt(fyFilter, 10) : (todayFy !== null ? todayFy : (fys[0] !== undefined ? fys[0] : 'all')));
  const shown = effectiveFy === 'all'
    ? list
    : list.filter((r) => fyOfReceipt(r) === effectiveFy);

  const grouped = { receipts: [], payments: [], petty_cash: [], unlinked: [] };
  shown.forEach((r) => grouped[groupOf(r)].push(r));

  return (
    <>
      <h3 className="h5">Receipts</h3>
      <p className="mb-2 text-muted">
        {effectiveFy === 'all'
          ? 'Showing all years.'
          : 'Showing ' + fyLabel(effectiveFy) + ' — money and government figures follow this fiscal year.'}
      </p>
      <div className="form-group" style={{ maxWidth: 260 }}>
        <label htmlFor="receiptFy">Fiscal year</label>
        <select
          id="receiptFy"
          className="form-control"
          value={effectiveFy === 'all' ? 'all' : String(effectiveFy)}
          onChange={(e) => setFyFilter(e.target.value)}
        >
          <option value="all">All years</option>
          {fys.map((f) => (
            <option key={f} value={String(f)}>{fyLabel(f)}</option>
          ))}
        </select>
      </div>
      {GROUPS.map((g) => {
        const items = grouped[g.key];
        const total = items.reduce((sum, r) => sum + (Number(r.amount_npr) || 0), 0);
        return (
          <div className="card mb-4" key={g.key}>
            <div className="card-body">
              <h4 className="card-title h6">
                {g.heading} — Subtotal: {money(total)}
              </h4>
              {items.length ? (
                <div className="table-responsive">
                  <table className="table table-striped table-sm bg-white">
                    <thead>
                      <tr>
                        <th>Receipt no. (paper s. no., if known)</th>
                        <th>{g.party}</th>
                        <th className="text-right">{g.amount}</th>
                        <th>Payment date</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((r) => (
                        <tr key={r.id}>
                          <td>{receiptNumber(r)}</td>
                          <td>{r.covers || '—'}</td>
                          <td className="text-right">{money(r.amount_npr)}</td>
                          <td>{dateLabel(r.date_ad, r.date_bs)}</td>
                          <td>
                            {apiBase ? (
                              <a
                                className="btn btn-sm btn-secondary"
                                href={apiBase.replace(/\/+$/, '') + '/billing/receipts/' + r.id}
                              >
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
                <p className="text-muted mb-0">No receipts in this fiscal year.</p>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
