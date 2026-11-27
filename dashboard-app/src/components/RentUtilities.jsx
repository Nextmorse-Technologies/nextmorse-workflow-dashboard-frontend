import { useEffect, useState } from 'react';
import { friendlyError, money } from '../api.js';
import { BS_MONTHS, dateLabel, fyOfBs, fyString, parseBs } from '../dates.js';
import { tdsAmountOf, tdsLabel } from './VendorServices.jsx';
import { RPM_NAME, RPM_UTILITY_LABEL } from './VendorBills.jsx';

/* Rent and utilities — the office premises and what they cost.
   The rent service comes from the saved vendor services (the same
   list the Vendor services tab manages); the landlord and term are
   standing facts, not in the API, so they are text on the card.
   The paid rent and utility bills come from the invoices API, the
   way VendorBills does it — fetched once, derived client-side, and
   filtered to the shared Fiscal year picker. */

const FY_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]; /* Shrawan … Ashadh */

/* The active rent service (Real Property Management). */
export function rentServiceOf(services) {
  return (services || []).find((s) =>
    s.status === 'active' && s.supplier === RPM_NAME && /rent/i.test(String(s.service || '')),
  ) || null;
}

/* The other active Real Property Management services — the
   utilities. Sorted by service name, like the Vendor services tab. */
export function utilityServicesOf(services) {
  const rent = rentServiceOf(services);
  return (services || [])
    .filter((s) => s.status === 'active' && s.supplier === RPM_NAME && s !== rent)
    .slice()
    .sort((a, b) => String(a.service).localeCompare(String(b.service)));
}

/* How many months of the picked fiscal year have elapsed, from
   today's BS date. Current FY: Shrawan up to the current BS month.
   Past FY: the whole year (12). Future FY: nothing yet (0). 'all'
   shows the current year. Null when today's BS date is not known. */
export function elapsedMonthsForFy(fy, todayBs) {
  const today = parseBs(todayBs);
  if (!today) return { elapsed: null, state: 'unknown', fyStart: null };
  const currentFyStart = fyOfBs(todayBs);
  const fyStart = fy === 'all' ? currentFyStart : parseInt(String(fy).split('/')[0], 10);
  if (!fyStart) return { elapsed: null, state: 'unknown', fyStart: null };
  if (fyStart < currentFyStart) return { elapsed: 12, state: 'past', fyStart };
  if (fyStart > currentFyStart) return { elapsed: 0, state: 'future', fyStart };
  return { elapsed: ((today.mo - 4 + 12) % 12) + 1, state: 'current', fyStart };
}

function monthYearInFy(fyStart, mo) {
  return mo >= 4 ? fyStart : fyStart + 1;
}

/* 'Shrawan–Mangsir 2083' for 5 elapsed months; 'Shrawan 2083'
   for 1; null when nothing has accrued yet. */
export function accruedSpanLabel(fyStart, elapsed) {
  if (!elapsed) return null;
  const first = FY_MONTHS[0];
  const last = FY_MONTHS[elapsed - 1];
  if (elapsed === 1) return BS_MONTHS[first - 1] + ' ' + monthYearInFy(fyStart, first);
  return BS_MONTHS[first - 1] + '–' + BS_MONTHS[last - 1] + ' ' + monthYearInFy(fyStart, last);
}

/* 'Poush–Ashadh 2084' for 5 elapsed months; the whole year
   'Shrawan 2083–Ashadh 2084' when nothing has accrued; null when
   the year is fully accrued. */
export function remainingSpanLabel(fyStart, elapsed) {
  if (elapsed >= 12) return null;
  const first = FY_MONTHS[elapsed];
  const last = FY_MONTHS[11];
  if (elapsed === 0) {
    return BS_MONTHS[first - 1] + ' ' + fyStart + '–' + BS_MONTHS[last - 1] + ' ' + monthYearInFy(fyStart, last);
  }
  return BS_MONTHS[first - 1] + '–' + BS_MONTHS[last - 1] + ' ' + monthYearInFy(fyStart, last);
}

/* The rent TDS calculation: 10% of the agreement rent per month,
   paid once a year. Amounts as strings, like the other helpers.
   Null when the service carries no TDS rate or no amount to base
   it on. Accrued/remaining are null when the elapsed months are
   not known. */
export function rentTds(service, elapsedMonths) {
  if (!service) return null;
  const monthly = tdsAmountOf(service);
  if (monthly === null) return null;
  const elapsed = elapsedMonths === null || elapsedMonths === undefined
    ? null
    : Math.max(0, Math.min(12, elapsedMonths));
  const annual = Math.round(monthly * 12 * 100) / 100;
  return {
    rate: service.tds_rate,
    payee: service.tds_payee,
    monthly: money(monthly),
    annual: money(annual),
    accrued: elapsed === null ? null : money(Math.round(monthly * elapsed * 100) / 100),
    remaining: elapsed === null ? null : money(Math.round((annual - monthly * elapsed) * 100) / 100),
  };
}

/* The rent and utility bills paid to Real Property Management:
   paid_rent / paid_utility invoices with status Paid (the utility
   rows billed as 'Utility Payment — 9851073311' fold into RPM, as
   on the Vendor bills tab). Newest first; total derived from the
   rows, never hardcoded. */
export function rentUtilityBills(invoices, fy) {
  const rows = (invoices || []).filter((inv) => {
    if (inv.status !== 'Paid') return false;
    if (inv.kind !== 'paid_rent' && inv.kind !== 'paid_utility') return false;
    const name = inv.client_name === RPM_UTILITY_LABEL ? RPM_NAME : inv.client_name;
    if (name !== RPM_NAME) return false;
    if (fy && fy !== 'all' && inv.fiscal_year !== fy) return false;
    return true;
  }).sort((a, b) => String(b.date_ad || b.date_bs || '').localeCompare(String(a.date_ad || a.date_bs || '')));
  const total = Math.round(rows.reduce((sum, inv) => sum + (Number(inv.amount_npr) || 0), 0) * 100) / 100;
  return { rows, total };
}

export default function RentUtilities({ api, services, meta, fy, refreshKey, initialInvoices, initialTodayBs }) {
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

  const todayBs = initialTodayBs || (meta && meta.today && meta.today.bs) || null;
  const calc = elapsedMonthsForFy(effectiveFy, todayBs);
  const rent = rentServiceOf(services);
  const utilities = utilityServicesOf(services);
  const tds = rent ? rentTds(rent, calc.elapsed) : null;
  const bills = rentUtilityBills(invoices, effectiveFy);
  const calcFy = calc.fyStart ? fyString(calc.fyStart) : effectiveFy;

  return (
    <div>
      <h4>Rent and utilities</h4>
      <p className="text-muted">
        The office rent and utilities, and the rent tax owed on them.
      </p>
      <p className="text-muted small">
        Showing {effectiveFy === 'all' ? calcFy + ' (current year)' : effectiveFy}.
      </p>

      <h5 className="h6 mt-3">Rent</h5>
      {!rent ? (
        <p className="text-muted">No rent service saved yet — add one on the Vendor services tab.</p>
      ) : (
        <div className="card">
          <div className="card-body">
            <h6 className="card-title">{rent.service}</h6>
            <p className="card-text mb-1">
              {rent.supplier} &middot; {rent.cycle === 'monthly' ? 'Monthly' : rent.cycle} &middot;{' '}
              {rent.amount_npr === null || rent.amount_npr === undefined ? '— varies' : money(rent.amount_npr)}
              {' '}a month &middot; {rent.vat_included ? '13% VAT included' : 'No VAT'}
            </p>
            <p className="card-text mb-1">
              Landlord: Pramod Kumar Rimal (Ward 2). Term: 1 Shrawan 2083 – end Ashar 2085.
              Rent is paid to Real Property Management Services Pvt. Ltd.
            </p>
            {tdsLabel(rent) && (
              <p className="card-text mb-1">TDS: {tdsLabel(rent)} a month.</p>
            )}
            <p className="card-text mb-0 text-muted">
              The 10% TDS is on the agreement rent of NPR 15,400 a month — not on what was
              actually paid. The actual rent paid Jul–Nov 2026 was NPR 132,000
              (NPR 24,000–28,800 a month), so the two numbers must never be confused.
            </p>
          </div>
        </div>
      )}

      {rent && tds && (
        <>
          <h5 className="h6 mt-4">Rent TDS — how much rent tax is owed</h5>
          <div className="card">
            <div className="card-body">
              <p className="card-text mb-1">
                {tds.rate}% of {money(rent.amount_npr)} = {tds.monthly} a month — payable to {tds.payee}.
              </p>
              <p className="card-text mb-1">
                Paid once a year, not monthly — the {tds.monthly} a month accrues through the
                year and is paid to {tds.payee} once a year.
              </p>
              <p className="card-text mb-1">
                Annual total (12 × {tds.monthly}): {tds.annual}
              </p>
              {tds.accrued !== null ? (
                <>
                  <p className="card-text mb-1">
                    Accrued so far — {accruedSpanLabel(calc.fyStart, calc.elapsed)} ({calc.elapsed} months): {tds.accrued}
                  </p>
                  <p className="card-text mb-1">
                    Still to come — {remainingSpanLabel(calc.fyStart, calc.elapsed) || 'nothing remaining'} ({12 - calc.elapsed} months): {tds.remaining}
                  </p>
                </>
              ) : (
                <p className="card-text mb-1">
                  Today&apos;s date was not available, so the accrued split is not shown.
                </p>
              )}
              <p className="card-text mb-0 text-muted">
                Marked on the record only — it is not counted into TDS payable (NPR 3,749.42).
              </p>
            </div>
          </div>
        </>
      )}

      <h5 className="h6 mt-4">Utilities</h5>
      {utilities.length === 0 ? (
        <p className="text-muted">No utility services saved yet — add them on the Vendor services tab.</p>
      ) : (
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Service</th>
              <th>Cycle</th>
              <th>Amount</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {utilities.map((s) => (
              <tr key={s.id}>
                <td>{s.service}</td>
                <td>{s.cycle === 'monthly' ? 'Monthly' : (s.cycle || '—')}</td>
                <td>{(s.amount_npr === null || s.amount_npr === undefined) ? '— varies' : money(s.amount_npr)}</td>
                <td>{s.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h5 className="h6 mt-4">Rent and utility bills paid</h5>
      <p className="text-muted small">
        Showing {effectiveFy === 'all' ? 'all years' : effectiveFy}.
      </p>
      {loading && <p className="text-muted">Loading rent and utility bills…</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {invoices && (
        <>
          <p className="text-muted">Total paid: {money(bills.total)}</p>
          {bills.rows.length === 0 ? (
            <p className="text-muted">No rent or utility bills paid{effectiveFy === 'all' ? '' : ' in ' + effectiveFy}.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped table-sm bg-white">
                <thead>
                  <tr>
                    <th>Paid</th>
                    <th>Service</th>
                    <th>Type</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.rows.map((b) => (
                    <tr key={b.id}>
                      <td>{b.paid_date_ad || b.paid_date_bs ? dateLabel(b.paid_date_ad, b.paid_date_bs) : dateLabel(b.date_ad, b.date_bs)}</td>
                      <td>{b.service || '—'}</td>
                      <td>{b.kind === 'paid_rent' ? 'Rent' : 'Utility'}</td>
                      <td className="text-right">{money(b.amount_npr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
