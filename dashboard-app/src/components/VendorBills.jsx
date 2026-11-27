import { useEffect, useState } from 'react';
import { friendlyError, money } from '../api.js';
import { dateLabel } from '../dates.js';
import { statusBadge } from './Invoices.jsx';

/* The Laravel /billing/vendors page, from the API — and it follows
   the shared Fiscal year picker, like the register tabs. The open
   vendor bills, what is still owed, and what suppliers have been
   paid are all filtered to the picked fiscal year ('all' shows
   every year, as before). The paid totals are computed here from
   the invoice list with the server's own rule, so the year filter
   can apply: Finance::supplierTotals() counts paid money-out
   invoices only — kind paid_rent / paid_utility / paid_salary /
   paid_supplier, plus paid_babal / paid_receipt rows billed by
   Babal.Host — grouped by supplier, with the RPM utility rows
   folded into Real Property Management. A paid received bill is
   NOT money out, so it never lands in the paid totals, on the
   server or here. Verified against the live page: all-years gives
   exactly 23 payees and NPR 2,550,462.50. */
export const MONEY_OUT_KINDS = ['paid_rent', 'paid_utility', 'paid_salary', 'paid_supplier'];
export const RPM_UTILITY_LABEL = 'Utility Payment — 9851073311';
export const RPM_NAME = 'Real Property Management Services Pvt. Ltd.';

export function isMoneyOut(inv) {
  return ((inv.kind === 'paid_babal' || inv.kind === 'paid_receipt') && inv.client_name === 'Babal.Host') ||
    MONEY_OUT_KINDS.includes(inv.kind);
}

export function paidSupplierTotals(invoices, fy) {
  const byName = {};
  const counts = {};
  (invoices || []).forEach((inv) => {
    if (!isMoneyOut(inv) || inv.status !== 'Paid') return;
    if (fy && fy !== 'all' && inv.fiscal_year !== fy) return;
    let name = inv.client_name || 'Unknown';
    if (inv.kind === 'paid_utility' && name === RPM_UTILITY_LABEL) name = RPM_NAME;
    byName[name] = Math.round(((byName[name] || 0) + (Number(inv.amount_npr) || 0)) * 100) / 100;
    counts[name] = (counts[name] || 0) + 1;
  });
  const rows = Object.entries(byName)
    .map(([name, total]) => ({ name, total, count: counts[name] }))
    .sort((a, b) => b.total - a.total);
  return rows;
}

/* The vendor bills that are paid (kind=received, status Paid),
   grouped by supplier — the counterpart to the open bills list.
   The Suppliers paid totals below count paid money-out invoices,
   which never include a paid received bill, so a bill that is paid
   would otherwise vanish from this tab entirely. Groups sort by
   total paid, biggest first; bills inside a group newest first. */
export function groupPaidBills(invoices, fy) {
  const groups = {};
  (invoices || []).forEach((inv) => {
    if (inv.kind !== 'received' || inv.status !== 'Paid') return;
    if (fy && fy !== 'all' && inv.fiscal_year !== fy) return;
    const name = inv.client_name || 'Unknown';
    if (!groups[name]) groups[name] = { name, total: 0, bills: [] };
    groups[name].total = Math.round((groups[name].total + (Number(inv.amount_npr) || 0)) * 100) / 100;
    groups[name].bills.push(inv);
  });
  return Object.values(groups)
    .map((g) => ({ ...g, bills: g.bills.sort((a, b) => String(b.date_ad || '').localeCompare(String(a.date_ad || ''))) }))
    .sort((a, b) => b.total - a.total);
}

export default function VendorBills({ api, refreshKey, fy, initialInvoices }) {
  const effectiveFy = fy || 'all';
  const [invoices, setInvoices] = useState(initialInvoices || null);
  const [loading, setLoading] = useState(!initialInvoices);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (initialInvoices) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        let rows = [];
        let page = 1;
        let total = Infinity;
        while (rows.length < total) {
          const resp = await api('/invoices?per_page=200&page=' + page);
          const d = (resp && resp.data) || [];
          total = (resp && resp.meta && resp.meta.pagination && resp.meta.pagination.total) || d.length;
          rows = rows.concat(d);
          page += 1;
          if (!d.length) break;
        }
        if (cancelled) return;
        setInvoices(rows);
      } catch (err) {
        if (!cancelled) setLoadError(friendlyError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Re-fetch when a Billing write lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const inFy = (inv) => effectiveFy === 'all' || inv.fiscal_year === effectiveFy;
  const openBills = (invoices || [])
    .filter((b) => b.kind === 'received' && b.status !== 'Paid' && inFy(b))
    .sort((a, b) => String(b.date_ad || '').localeCompare(String(a.date_ad || '')));
  const owed = openBills.reduce((sum, b) => sum + (Number(b.remaining_amount_npr) || 0), 0);
  const paidRows = paidSupplierTotals(invoices, effectiveFy);
  const paidGroups = groupPaidBills(invoices, effectiveFy);

  return (
    <>
      <h3 className="h5">Vendor Bills</h3>
      <p className="mb-2 text-muted">What suppliers have been paid, and what is still owed to them.</p>
      <p className="mb-2 text-muted small">Showing {effectiveFy === 'all' ? 'all years' : effectiveFy}.</p>
      {loading && <p className="text-muted">Loading vendor bills…</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {invoices && (
        <>
          <h4 className="h6 mt-3">Open vendor bills</h4>
          {openBills.length === 0 ? (
            <p className="text-muted">No open vendor bills.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped table-sm bg-white">
                <thead>
                  <tr>
                    <th>Invoice no.</th>
                    <th>Supplier</th>
                    <th>Service</th>
                    <th className="text-right">Amount</th>
                    <th>Status</th>
                    <th>Issued</th>
                  </tr>
                </thead>
                <tbody>
                  {openBills.map((b) => (
                    <tr key={b.id}>
                      <td>{b.invoice_number || '—'}</td>
                      <td>{b.client_name}</td>
                      <td>{b.service}</td>
                      <td className="text-right">{money(b.amount_npr)}</td>
                      <td><span className={'badge ' + statusBadge(b.status)}>{b.status}</span></td>
                      <td>{dateLabel(b.date_ad, b.date_bs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h4 className="h6 mt-3">Paid vendor bills</h4>
          {paidGroups.length === 0 ? (
            <p className="text-muted">No paid vendor bills{effectiveFy === 'all' ? '' : ' in ' + effectiveFy}.</p>
          ) : (
            paidGroups.map((g) => (
              <div key={g.name}>
                <h5 className="h6 mt-3">{g.name} — {money(g.total)}</h5>
                <div className="table-responsive">
                  <table className="table table-striped table-sm bg-white">
                    <thead>
                      <tr>
                        <th>Invoice no.</th>
                        <th>Service</th>
                        <th className="text-right">Amount</th>
                        <th>Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.bills.map((b) => (
                        <tr key={b.id}>
                          <td>{b.invoice_number || '—'}</td>
                          <td>{b.service}</td>
                          <td className="text-right">{money(b.amount_npr)}</td>
                          <td>{b.paid_date_ad || b.paid_date_bs ? dateLabel(b.paid_date_ad, b.paid_date_bs) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
          <h4 className="h6 mt-3">Owed to vendors</h4>
          <p className="text-muted">{money(owed)}</p>
          <h4 className="h6 mt-3">Suppliers — paid totals</h4>
          {paidRows.length === 0 ? (
            <p className="text-muted">No paid vendor bills in {effectiveFy === 'all' ? 'any year' : effectiveFy}.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped table-sm bg-white">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th className="text-right">Payments</th>
                    <th className="text-right">Total paid</th>
                  </tr>
                </thead>
                <tbody>
                  {paidRows.map((s, i) => (
                    <tr key={i}>
                      <td>{s.name}</td>
                      <td className="text-right">{s.count}</td>
                      <td className="text-right">{money(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
