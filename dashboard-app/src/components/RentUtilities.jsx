import { useEffect, useState } from 'react';
import { friendlyError, money as moneyEn } from '../api.js';
import { useLocale } from '../i18n.js';
import { BS_MONTHS, dateLabel, fyOfBs, fyString, parseBs } from '../dates.js';
import { SortHeader, useTableSort } from '../sort.js';
import { CYCLE_LABELS, tdsAmountOf } from './VendorServices.jsx';
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
    monthly: moneyEn(monthly),
    annual: moneyEn(annual),
    accrued: elapsed === null ? null : moneyEn(Math.round(monthly * elapsed * 100) / 100),
    remaining: elapsed === null ? null : moneyEn(Math.round((annual - monthly * elapsed) * 100) / 100),
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
  const { t, money, digits } = useLocale();
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
  /* The rent-TDS money, localized: rentTds() formats its figures
     in English for the tests, so the raw monthly amount is
     recomputed here for the locale-aware money(). */
  const monthlyRaw = rent ? tdsAmountOf(rent) : null;
  const annualRaw = monthlyRaw === null ? null : Math.round(monthlyRaw * 12 * 100) / 100;
  const accruedRaw = monthlyRaw === null || calc.elapsed === null ? null : Math.round(monthlyRaw * calc.elapsed * 100) / 100;
  const remainingRaw = monthlyRaw === null || calc.elapsed === null || annualRaw === null ? null : Math.round((annualRaw - monthlyRaw * calc.elapsed) * 100) / 100;
  const tdsSentence = rent && monthlyRaw !== null && tds
    ? t('{rate}% of {amount} = {tds} — payable to {payee}', {
      rate: digits(tds.rate),
      amount: money(rent.amount_npr),
      tds: money(monthlyRaw),
      payee: tds.payee,
    })
    : null;
  const bills = rentUtilityBills(invoices, effectiveFy);
  const calcFy = calc.fyStart ? fyString(calc.fyStart) : effectiveFy;
  /* One sort state per table; each starts in its original order
     (utilities by service name, bills newest first). Each table
     sorts only the rows actually shown, after the fiscal-year
     filter. */
  const utilitySort = useTableSort(null);
  const billSort = useTableSort('paid', 'desc');
  const sortedUtilities = utilitySort.apply(utilities, (s, key) => {
    switch (key) {
      case 'cycle': return s.cycle || '';
      case 'amount': return s.amount_npr;
      case 'notes': return s.notes || '';
      default: return s.service || '';
    }
  });
  const sortedBills = billSort.apply(bills.rows, (b, key) => {
    switch (key) {
      case 'service': return b.service || '';
      case 'type': return b.kind === 'paid_rent' ? 'Rent' : 'Utility';
      case 'amount': return b.amount_npr;
      default: return b.paid_date_ad || b.paid_date_bs || b.date_ad || b.date_bs || '';
    }
  });

  return (
    <div>
      <h4>{t('Rent and utilities')}</h4>
      <p className="text-muted">
        {t('The office rent and utilities, and the rent tax owed on them.')}
      </p>
      <p className="text-muted small">
        {effectiveFy === 'all' ? t('Showing {fy} (current year)', { fy: digits(calcFy) }) : t('Showing {fy}.', { fy: digits(effectiveFy) })}
      </p>

      <h5 className="h6 mt-3">{t('Rent')}</h5>
      {!rent ? (
        <p className="text-muted">{t('No rent service saved yet — add one on the Vendor services tab.')}</p>
      ) : (
        <div className="card">
          <div className="card-body">
            <h6 className="card-title">{rent.service}</h6>
            <p className="card-text mb-1">
              {rent.supplier} &middot; {t(CYCLE_LABELS[rent.cycle] || rent.cycle)} &middot;{' '}
              {rent.amount_npr === null || rent.amount_npr === undefined ? t('— varies') : money(rent.amount_npr)}
              {' '}{t('a month')} &middot; {rent.vat_included ? t('13% VAT included') : t('No VAT')}
            </p>
            <p className="card-text mb-1">
              {t('Landlord: Pramod Kumar Rimal (Ward 2). Term: 1 Shrawan 2083 – end Ashar 2085. Rent is paid to Real Property Management Services Pvt. Ltd.')}
            </p>
            {tdsSentence && (
              <p className="card-text mb-1">{t('TDS: {label} a month.', { label: tdsSentence })}</p>
            )}
            <p className="card-text mb-0 text-muted">
              {t('The 10% TDS is on the agreement rent of NPR 15,400 a month — not on what was actually paid. The actual rent paid Jul–Nov 2026 was NPR 132,000 (NPR 24,000–28,800 a month), so the two numbers must never be confused.')}
            </p>
          </div>
        </div>
      )}

      {rent && tds && (
        <>
          <h5 className="h6 mt-4">{t('Rent TDS — how much rent tax is owed')}</h5>
          <div className="card">
            <div className="card-body">
              <p className="card-text mb-1">
                {tdsSentence} {t('a month')}.
              </p>
              <p className="card-text mb-1">
                {t('Paid once a year, not monthly — the {monthly} a month accrues through the year and is paid to {payee} once a year.', { monthly: money(monthlyRaw), payee: tds.payee })}
              </p>
              <p className="card-text mb-1">
                {t('Annual total (12 × {monthly}): {annual}', { monthly: money(monthlyRaw), annual: money(annualRaw) })}
              </p>
              {accruedRaw !== null ? (
                <>
                  <p className="card-text mb-1">
                    {t('Accrued so far — {span} ({months} months): {accrued}', { span: accruedSpanLabel(calc.fyStart, calc.elapsed), months: digits(calc.elapsed), accrued: money(accruedRaw) })}
                  </p>
                  <p className="card-text mb-1">
                    {t('Still to come — {span} ({months} months): {remaining}', { span: remainingSpanLabel(calc.fyStart, calc.elapsed) || t('nothing remaining'), months: digits(12 - calc.elapsed), remaining: money(remainingRaw) })}
                  </p>
                </>
              ) : (
                <p className="card-text mb-1">
                  {t('Today\'s date was not available, so the accrued split is not shown.')}
                </p>
              )}
              <p className="card-text mb-0 text-muted">
                {t('Marked on the record only — it is not counted into TDS payable (NPR 3,749.42).')}
              </p>
            </div>
          </div>
        </>
      )}

      <h5 className="h6 mt-4">{t('Utilities')}</h5>
      {utilities.length === 0 ? (
        <p className="text-muted">{t('No utility services saved yet — add them on the Vendor services tab.')}</p>
      ) : (
        <table className="table table-sm">
          <thead>
            <tr>
              <SortHeader label={t('Service')} sortKey="service" activeKey={utilitySort.sortKey} dir={utilitySort.sortDir} onSort={utilitySort.onSort} />
              <SortHeader label={t('Cycle')} sortKey="cycle" activeKey={utilitySort.sortKey} dir={utilitySort.sortDir} onSort={utilitySort.onSort} />
              <SortHeader label={t('Amount')} sortKey="amount" activeKey={utilitySort.sortKey} dir={utilitySort.sortDir} onSort={utilitySort.onSort} />
              <SortHeader label={t('Notes')} sortKey="notes" activeKey={utilitySort.sortKey} dir={utilitySort.sortDir} onSort={utilitySort.onSort} />
            </tr>
          </thead>
          <tbody>
            {sortedUtilities.map((s) => (
              <tr key={s.id}>
                <td>{s.service}</td>
                <td>{t(CYCLE_LABELS[s.cycle] || s.cycle || '—')}</td>
                <td>{(s.amount_npr === null || s.amount_npr === undefined) ? t('— varies') : money(s.amount_npr)}</td>
                <td>{s.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h5 className="h6 mt-4">{t('Rent and utility bills paid')}</h5>
      <p className="text-muted small">
        {t('Showing {fy}.', { fy: effectiveFy === 'all' ? t('all years') : digits(effectiveFy) })}
      </p>
      {loading && <p className="text-muted">{t('Loading rent and utility bills…')}</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {invoices && (
        <>
          <p className="text-muted">{t('Total paid: {amount}', { amount: money(bills.total) })}</p>
          {bills.rows.length === 0 ? (
            <p className="text-muted">{effectiveFy === 'all' ? t('No rent or utility bills paid.') : t('No rent or utility bills paid in {fy}.', { fy: digits(effectiveFy) })}</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped table-sm bg-white">
                <thead>
                  <tr>
                    <SortHeader label={t('Payment date')} sortKey="paid" activeKey={billSort.sortKey} dir={billSort.sortDir} onSort={billSort.onSort} />
                    <SortHeader label={t('Service')} sortKey="service" activeKey={billSort.sortKey} dir={billSort.sortDir} onSort={billSort.onSort} />
                    <SortHeader label={t('Type')} sortKey="type" activeKey={billSort.sortKey} dir={billSort.sortDir} onSort={billSort.onSort} />
                    <SortHeader label={t('Amount')} sortKey="amount" activeKey={billSort.sortKey} dir={billSort.sortDir} onSort={billSort.onSort} className="text-right" />
                  </tr>
                </thead>
                <tbody>
                  {sortedBills.map((b) => (
                    <tr key={b.id}>
                      <td>{b.paid_date_ad || b.paid_date_bs ? dateLabel(b.paid_date_ad, b.paid_date_bs) : dateLabel(b.date_ad, b.date_bs)}</td>
                      <td>{b.service || '—'}</td>
                      <td>{b.kind === 'paid_rent' ? t('Rent') : t('Utility')}</td>
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
