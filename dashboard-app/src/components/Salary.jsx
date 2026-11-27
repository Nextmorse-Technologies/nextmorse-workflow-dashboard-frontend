import { Fragment, useEffect, useState } from 'react';
import { friendlyError, money } from '../api.js';
import { dateLabel } from '../dates.js';
import { SortHeader, useTableSort } from '../sort.js';

/* Salary — the monthly staff salaries and the Dashain allowance.
   The rates are standing facts confirmed by Bijaya (21 Nov 2026,
   re-confirmed 27 Nov 2026); the payments come from the invoices
   API, the way VendorBills does it — fetched once, derived
   client-side, and filtered to the shared Fiscal year picker.
   Salary is recorded as lump-sum "Staff salaries" rows, kind
   paid_salary, all Paid — there is no per-person split in the
   data, so the split below is only shown where a payment equals
   the current monthly total of NPR 28,000. */

export const SALARY_RATES = [
  { name: 'Kedar Kunwar', monthly: 10000 },
  { name: 'Bijaya Poudel', monthly: 10000 },
  { name: 'Anishma Bhattarai', monthly: 8000 },
];

/* The monthly total at the current rates, and the yearly total
   with the Dashain allowance: 12 months plus one extra month. */
export const MONTHLY_TOTAL = SALARY_RATES.reduce((sum, r) => sum + r.monthly, 0);
export const DASHAIN_MONTHS = 13;
export const ANNUAL_TOTAL = MONTHLY_TOTAL * DASHAIN_MONTHS;

/* Annual pay per person at the current rates (13 months). */
export function annualFor(rate) {
  return rate.monthly * DASHAIN_MONTHS;
}

/* The paid salary rows for the picked year ('all' keeps every
   year), newest first; total derived from the rows, never
   hardcoded. */
export function salaryRows(invoices, fy) {
  const rows = (invoices || []).filter((inv) => {
    if (inv.status !== 'Paid') return false;
    if (inv.kind !== 'paid_salary') return false;
    if (fy && fy !== 'all' && inv.fiscal_year !== fy) return false;
    return true;
  }).sort((a, b) => String(b.date_ad || b.date_bs || '').localeCompare(String(a.date_ad || a.date_bs || '')));
  const total = Math.round(rows.reduce((sum, inv) => sum + (Number(inv.amount_npr) || 0), 0) * 100) / 100;
  return { rows, total };
}

/* The per-person split of one payment, at the current rates — only
   where the payment equals the current monthly total, so the split
   is exact. Anything else predates the current rates and is shown
   without a split (never forced). */
export function splitSalary(amount) {
  const n = Number(amount);
  if (!n || n !== MONTHLY_TOTAL) return null;
  return {
    kedar: SALARY_RATES[0].monthly,
    bijaya: SALARY_RATES[1].monthly,
    anishma: SALARY_RATES[2].monthly,
  };
}

/* A Dashain allowance payment is a paid_salary row that says so in
   its service or notes. The FY 2083/84 allowance is confirmed paid
   (Bijaya, 27 Nov 2026) but its payment date is still to be
   recorded, so no row is in the data yet — when the row lands it
   appears here, and the confirmed-paid line in the component below
   goes away for that year. */
export function dashainRows(invoices, fy) {
  return (invoices || []).filter((inv) => {
    if (inv.status !== 'Paid') return false;
    if (inv.kind !== 'paid_salary') return false;
    if (fy && fy !== 'all' && inv.fiscal_year !== fy) return false;
    const text = String((inv.service || '') + ' ' + (inv.notes || '')).toLowerCase();
    return text.includes('dashain');
  });
}

export default function Salary({ api, fy, refreshKey, initialInvoices }) {
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

  const paid = salaryRows(invoices, effectiveFy);
  const dashain = dashainRows(invoices, effectiveFy);
  const anyUnsplit = paid.rows.some((r) => splitSalary(r.amount_npr) === null);
  /* One sort state per table; each starts in its original order
     (rates in their set order, the paid list newest first). Each
     table sorts only the rows actually shown, after the
     fiscal-year filter. In the all-years view the paid list stays
     grouped by fiscal year with its subtotal rows — the sort
     orders the rows inside each year, never the groups. */
  const rateSort = useTableSort(null);
  const dashainSort = useTableSort(null);
  const paidSort = useTableSort('paid', 'desc');
  const paidDateOf = (r) => r.paid_date_ad || r.paid_date_bs || r.date_ad || r.date_bs || '';
  const paidValueOf = (r, key) => {
    switch (key) {
      case 'amount': return r.amount_npr;
      case 'kedar': { const s = splitSalary(r.amount_npr); return s ? s.kedar : null; }
      case 'bijaya': { const s = splitSalary(r.amount_npr); return s ? s.bijaya : null; }
      case 'anishma': { const s = splitSalary(r.amount_npr); return s ? s.anishma : null; }
      default: return paidDateOf(r);
    }
  };
  const sortedPaid = paidSort.apply(paid.rows, paidValueOf);
  const sortedDashain = dashainSort.apply(dashain, (d, key) => (key === 'amount' ? d.amount_npr : paidDateOf(d)));
  const sortedRates = rateSort.apply(SALARY_RATES, (r, key) => (key === 'annual' ? annualFor(r) : key === 'monthly' ? r.monthly : r.name));

  /* Per-year subtotals for the all-years view, newest year first.
     Built from the sorted rows, so a sort orders the rows inside
     each year while the year groups and their subtotal rows stay
     where they are. */
  const byFy = {};
  sortedPaid.forEach((r) => {
    const key = r.fiscal_year || 'No fiscal year';
    byFy[key] = byFy[key] || { rows: [], total: 0 };
    byFy[key].rows.push(r);
    byFy[key].total = Math.round((byFy[key].total + (Number(r.amount_npr) || 0)) * 100) / 100;
  });
  const fyGroups = Object.keys(byFy).sort().reverse();

  const fyLabel = effectiveFy === 'all' ? 'all years' : effectiveFy;

  return (
    <div>
      <h4>Salary</h4>
      <p className="text-muted">
        The monthly staff salaries, paid on the 1st of the Nepali month by bank transfer.
      </p>
      <p className="text-muted small">
        Showing {fyLabel}.
      </p>

      <h5 className="h6 mt-3">Salary rates</h5>
      <div className="card">
        <div className="card-body">
          <table className="table table-sm mb-2">
            <thead>
              <tr>
                <SortHeader label="Person" sortKey="person" activeKey={rateSort.sortKey} dir={rateSort.sortDir} onSort={rateSort.onSort} />
                <SortHeader label="Monthly" sortKey="monthly" activeKey={rateSort.sortKey} dir={rateSort.sortDir} onSort={rateSort.onSort} className="text-right" />
                <SortHeader label="Annual (13 months)" sortKey="annual" activeKey={rateSort.sortKey} dir={rateSort.sortDir} onSort={rateSort.onSort} className="text-right" />
              </tr>
            </thead>
            <tbody>
              {sortedRates.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="text-right">{money(r.monthly)}</td>
                  <td className="text-right">{money(annualFor(r))}</td>
                </tr>
              ))}
              <tr>
                <td><strong>Total</strong></td>
                <td className="text-right"><strong>{money(MONTHLY_TOTAL)}</strong></td>
                <td className="text-right"><strong>{money(ANNUAL_TOTAL)}</strong></td>
              </tr>
            </tbody>
          </table>
          <p className="card-text mb-1">
            12 months plus the Dashain allowance (one extra month — salary doubled at
            Dashain) = 13 months a year, {money(ANNUAL_TOTAL)} at the current rates.
          </p>
          <p className="card-text mb-0 text-muted">
            Standing rates confirmed 21 Nov 2026. Paid on the 1st of the Nepali month
            by bank transfer.
          </p>
        </div>
      </div>

      <h5 className="h6 mt-4">Dashain allowance</h5>
      <div className="card">
        <div className="card-body">
          <p className="card-text mb-1">
            One extra month&apos;s salary at Dashain — {money(MONTHLY_TOTAL)} at the
            current rates, on top of the 12 monthly payments.
          </p>
          {dashain.length > 0 ? (
            <table className="table table-sm mb-0">
              <thead>
                <tr>
                  <SortHeader label="Paid" sortKey="paid" activeKey={dashainSort.sortKey} dir={dashainSort.sortDir} onSort={dashainSort.onSort} />
                  <SortHeader label="Amount" sortKey="amount" activeKey={dashainSort.sortKey} dir={dashainSort.sortDir} onSort={dashainSort.onSort} className="text-right" />
                </tr>
              </thead>
              <tbody>
                {sortedDashain.map((d) => (
                  <tr key={d.id}>
                    <td>{d.paid_date_ad || d.paid_date_bs ? dateLabel(d.paid_date_ad, d.paid_date_bs) : dateLabel(d.date_ad, d.date_bs)}</td>
                    <td className="text-right">{money(d.amount_npr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : effectiveFy === '2083/84' || effectiveFy === 'all' ? (
            <p className="card-text mb-0">
              Dashain allowance for FY 2083/84: confirmed paid — {money(MONTHLY_TOTAL)}.
              The payment date is still to be recorded, so it is not in the list below
              yet and is not counted in the total below.
              {effectiveFy === '2083/84' ? ' Dashain 2083 was in early October 2026.' : ' No Dashain allowance payment on record for other years.'}
            </p>
          ) : (
            <p className="card-text mb-0">
              No Dashain allowance payment on record for {effectiveFy} yet.
            </p>
          )}
        </div>
      </div>

      <h5 className="h6 mt-4">Salary paid</h5>
      <p className="text-muted small">
        Showing {fyLabel}.
      </p>
      {loading && <p className="text-muted">Loading salary payments…</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {invoices && (
        <>
          <p className="text-muted">Total paid: {money(paid.total)}</p>
          {paid.rows.length === 0 ? (
            <p className="text-muted">No salary payments on record{effectiveFy === 'all' ? '' : ' for ' + effectiveFy}.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped table-sm bg-white">
                <thead>
                  <tr>
                    <SortHeader label="Paid" sortKey="paid" activeKey={paidSort.sortKey} dir={paidSort.sortDir} onSort={paidSort.onSort} />
                    <SortHeader label="Amount" sortKey="amount" activeKey={paidSort.sortKey} dir={paidSort.sortDir} onSort={paidSort.onSort} className="text-right" />
                    <SortHeader label="Kedar" sortKey="kedar" activeKey={paidSort.sortKey} dir={paidSort.sortDir} onSort={paidSort.onSort} className="text-right" />
                    <SortHeader label="Bijaya" sortKey="bijaya" activeKey={paidSort.sortKey} dir={paidSort.sortDir} onSort={paidSort.onSort} className="text-right" />
                    <SortHeader label="Anishma" sortKey="anishma" activeKey={paidSort.sortKey} dir={paidSort.sortDir} onSort={paidSort.onSort} className="text-right" />
                  </tr>
                </thead>
                <tbody>
                  {effectiveFy === 'all' ? (
                    fyGroups.map((g) => (
                      <Fragment key={g}>                        {byFy[g].rows.map((r) => {
                          const split = splitSalary(r.amount_npr);
                          return (
                            <tr key={r.id}>
                              <td>{r.paid_date_ad || r.paid_date_bs ? dateLabel(r.paid_date_ad, r.paid_date_bs) : dateLabel(r.date_ad, r.date_bs)}</td>
                              <td className="text-right">{money(r.amount_npr)}</td>
                              <td className="text-right">{split ? money(split.kedar) : '—'}</td>
                              <td className="text-right">{split ? money(split.bijaya) : '—'}</td>
                              <td className="text-right">{split ? money(split.anishma) : '—'}</td>
                            </tr>
                          );
                        })}
                        <tr key={'subtotal-' + g}>
                          <td><strong>{g} subtotal</strong></td>
                          <td className="text-right"><strong>{money(byFy[g].total)}</strong></td>
                          <td className="text-right">—</td>
                          <td className="text-right">—</td>
                          <td className="text-right">—</td>
                        </tr>
                      </Fragment>
                    ))
                  ) : (
                    sortedPaid.map((r) => {
                      const split = splitSalary(r.amount_npr);
                      return (
                        <tr key={r.id}>
                          <td>{r.paid_date_ad || r.paid_date_bs ? dateLabel(r.paid_date_ad, r.paid_date_bs) : dateLabel(r.date_ad, r.date_bs)}</td>
                          <td className="text-right">{money(r.amount_npr)}</td>
                          <td className="text-right">{split ? money(split.kedar) : '—'}</td>
                          <td className="text-right">{split ? money(split.bijaya) : '—'}</td>
                          <td className="text-right">{split ? money(split.anishma) : '—'}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
          {anyUnsplit && (
            <p className="text-muted small">
              The per-person split is shown only where a payment equals the current
              monthly total of {money(MONTHLY_TOTAL)} — earlier years predate the
              current rates, so no split is shown for them.
            </p>
          )}
        </>
      )}
    </div>
  );
}
