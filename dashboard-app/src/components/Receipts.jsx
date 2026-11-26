import { useState } from 'react';
import { money } from '../api.js';

/* Nepali months, Baisakh first — the API returns BS dates either as
   ISO (2083-08-07) or written out (4 Mangsir 2083 BS). */
const BS_MONTHS = [
  'Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
];

function parseBs(bs) {
  if (!bs) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bs);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
  m = /^(\d{1,2}) (\w+) (\d{4})/.exec(bs);
  if (m) {
    const mo = BS_MONTHS.indexOf(m[2]) + 1;
    if (mo) return { y: +m[3], mo, d: +m[1] };
  }
  return null;
}

/* Fiscal year a receipt belongs to — the FY starts in Shrawan
   (month 4), so Baisakh–Ashadh belong to the previous FY. */
function fyOfReceipt(r) {
  const p = parseBs(r.date_bs);
  if (!p) return null;
  return p.mo >= 4 ? p.y : p.y - 1;
}

function fyLabel(fy) {
  return 'FY ' + fy + '/' + String(fy + 1).slice(2);
}

function bsLabel(bs) {
  const p = parseBs(bs);
  if (!p) return '';
  return p.d + ' ' + BS_MONTHS[p.mo - 1] + ' ' + p.y;
}

function adLabel(ad) {
  if (!ad) return '';
  const d = new Date(ad + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return ad;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/* Same date line as the Laravel receipts page: BS first, AD after. */
function dateLabel(r) {
  const bs = bsLabel(r.date_bs);
  const ad = adLabel(r.date_ad);
  if (bs && ad) return bs + ' (' + ad + ')';
  return bs || ad || '—';
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
                          <td>{dateLabel(r)}</td>
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
