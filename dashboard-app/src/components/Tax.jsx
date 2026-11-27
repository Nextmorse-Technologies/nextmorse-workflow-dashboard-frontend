import { useEffect, useState } from 'react';
import { useLocale } from '../i18n.js';
import { dateLabel, fyOfAd, fyOfBs, fyString } from '../dates.js';
import { SortHeader, useTableSort } from '../sort.js';

/* The fiscal year a tax row belongs to — the starting BS year.
   Order: the row's own fiscal_year, then its linked invoice's
   year, then its due date (BS first, AD as a fallback). Null for
   standing records with no year of their own — the rent-tax
   explanation, the clearance tasks, the registration rows. */
export function taxRowFy(row) {
  if (!row) return null;
  if (row.fiscal_year) {
    const y = parseInt(String(row.fiscal_year).split('/')[0], 10);
    if (y) return y;
  }
  if (row.invoice_fiscal_year) {
    const y = parseInt(String(row.invoice_fiscal_year).split('/')[0], 10);
    if (y) return y;
  }
  const fromBs = fyOfBs(row.due_bs);
  if (fromBs) return fromBs;
  return fyOfAd(row.due_ad);
}

/* The tax invoice number a row links to: the invoice's fiscal year
   in short form plus its number, e.g. "82/83-011" (FY 2082/83,
   invoice No. 011). '—' where there is no linked invoice or the
   invoice carries no number; the number as-is where the invoice
   has no fiscal year. */
export function invoiceNumberLabel(row) {
  if (!row || !row.invoice_number) return '—';
  const fy = row.invoice_fiscal_year;
  if (!fy) return String(row.invoice_number);
  const short = String(fy).split('/').map((p) => p.slice(-2)).join('/');
  return short + '-' + row.invoice_number;
}

/* Split the rows for the picked year: the rows that belong to it,
   and the standing records with no fiscal year — never silently
   dropped, shown separately and labelled. 'all' keeps everything
   in the one table. */
export function taxRowsForFy(rows, fy) {
  const list = rows || [];
  if (!fy || fy === 'all') return { shown: list, unplaced: [] };
  const fyStart = parseInt(String(fy).split('/')[0], 10);
  const shown = [];
  const unplaced = [];
  list.forEach((r) => {
    const y = taxRowFy(r);
    if (y === null) unplaced.push(r);
    else if (y === fyStart) shown.push(r);
  });
  return { shown, unplaced };
}

/* The tax rows table. The caller sorts the rows and passes the
   sort state, so every heading is a sort button. The sort values
   come from the row as shown: FY from taxRowFy, the invoice number
   as its FY-number label, the due date from its AD date. */
function TaxTable({ rows, sortKey, sortDir, onSort }) {
  const { t, money, digits } = useLocale();
  return (
    <div className="table-responsive">
      <table className="table table-striped table-sm bg-white">
        <thead>
          <tr>
            <SortHeader label={t('FY')} sortKey="fy" activeKey={sortKey} dir={sortDir} onSort={onSort} />
            <SortHeader label={t('Invoice no.')} sortKey="number" activeKey={sortKey} dir={sortDir} onSort={onSort} />
            <SortHeader label={t('Client')} sortKey="client" activeKey={sortKey} dir={sortDir} onSort={onSort} />
            <SortHeader label={t('Item')} sortKey="item" activeKey={sortKey} dir={sortDir} onSort={onSort} />
            <SortHeader label={t('Amount')} sortKey="amount" activeKey={sortKey} dir={sortDir} onSort={onSort} className="text-right" />
            <SortHeader label={t('Turnover')} sortKey="turnover" activeKey={sortKey} dir={sortDir} onSort={onSort} className="text-right" />
            <SortHeader label={t('Due date')} sortKey="due" activeKey={sortKey} dir={sortDir} onSort={onSort} />
            <SortHeader label={t('Status')} sortKey="status" activeKey={sortKey} dir={sortDir} onSort={onSort} />
            <SortHeader label={t('Certificate no.')} sortKey="certificate" activeKey={sortKey} dir={sortDir} onSort={onSort} />
            <SortHeader label={t('Flag')} sortKey="flag" activeKey={sortKey} dir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const cert = r.certificate && r.certificate.clearance_no
              ? r.certificate.clearance_no
              : '—';
            const flag = (r.flags || []).join('; ');
            const y = taxRowFy(r);
            return (
              <tr key={r.id || i} className={flag ? 'table-warning' : ''}>
                <td>{y ? digits(fyString(y)) : '—'}</td>
                <td>{invoiceNumberLabel(r)}</td>
                <td>{r.client_name || '—'}</td>
                <td>{r.item}</td>
                <td className="text-right">{money(r.amount_npr)}</td>
                <td className="text-right">{money(r.turnover_npr)}</td>
                <td>{dateLabel(r.due_ad, r.due_bs)}</td>
                <td>{r.status ? t(r.status) : '—'}</td>
                <td>{cert}</td>
                <td className="small">{flag}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* One figure in the VAT and TDS summary — the same card style as
   the Overview tab's headline figures. */
function FigureCard({ title, value }) {
  return (
    <div className="col-6 col-md-4 mb-3">
      <div className="card h-100">
        <div className="card-body">
          <div className="text-muted small">{title}</div>
          <div className="h5 mb-0">{value}</div>
        </div>
      </div>
    </div>
  );
}

export default function Tax({ data, fy, api, initialFigures }) {
  const { t, money, digits } = useLocale();
  /* The fiscal year comes from the shared picker in the tab bar
     (App); this tab only filters on it. Hooks run before the
     early return below, so the figures fetch is unconditional. */
  const effectiveFy = fy || 'all';
  const [figures, setFigures] = useState(initialFigures || null);
  /* The VAT and TDS summary follows the picker exactly like the
     rows: the figures endpoint scopes them to the picked year
     (all years when 'all'). The standing records with no fiscal
     year stay out of the summary — it is the API's FY-scoped
     position for the picked year. If the fetch fails the summary
     stays hidden and the rows still show. */
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    api('/figures' + (effectiveFy !== 'all' ? '?fiscal_year=' + encodeURIComponent(effectiveFy) : ''))
      .then((d) => { if (!cancelled) setFigures(d); })
      .catch(() => { if (!cancelled) setFigures(null); });
    return () => { cancelled = true; };
  }, [api, effectiveFy]);

  /* One sort state per table; each starts in its original order.
     Each table sorts only the rows actually shown, after the
     fiscal-year filter. */
  const shownSort = useTableSort(null);
  const unplacedSort = useTableSort(null);

  if (!data) return null;
  const rows = data.rows || [];
  const { shown, unplaced } = taxRowsForFy(rows, effectiveFy);
  const taxValueOf = (r, key) => {
    switch (key) {
      case 'fy': return taxRowFy(r);
      case 'number': return invoiceNumberLabel(r);
      case 'client': return r.client_name || '';
      case 'item': return r.item || '';
      case 'amount': return r.amount_npr;
      case 'turnover': return r.turnover_npr;
      case 'due': return r.due_ad || '';
      case 'status': return r.status || '';
      case 'certificate': return (r.certificate && r.certificate.clearance_no) || '';
      case 'flag': return (r.flags || []).join('; ');
      default: return '';
    }
  };
  const sortedShown = shownSort.apply(shown, taxValueOf);
  const sortedUnplaced = unplacedSort.apply(unplaced, taxValueOf);
  const vat = (figures && figures.vat) || {};
  const tds = (figures && figures.tds) || {};
  return (
    <>
      <h3 className="h5">
        {t('Tax records')}{' '}
        <span className="badge badge-secondary">
          {t('{n} rows', { n: digits(shown.length) })}
        </span>
      </h3>
      <p className="text-muted small">
        {effectiveFy === 'all'
          ? t('Showing all years.')
          : t('Showing {fy} — money and government figures follow this fiscal year.', { fy: digits(effectiveFy) })}
        {' '}{t('Clearance certificates on file:')}{' '}
        {data.clearances_on_file !== undefined ? digits(data.clearances_on_file) : '—'}
        {' '}{t('(all years). Rows in yellow need attention.')}
      </p>
      {figures && (
        <>
          <h4 className="h6 mt-3">{t('VAT and TDS position')}</h4>
          <p className="text-muted small">
            {effectiveFy === 'all' ? t('Showing all years.') : t('Showing {fy}.', { fy: digits(effectiveFy) })}
            {' '}{t('VAT credit is the VAT on suppliers\' tax invoices (input VAT); VAT payable is VAT collected less that credit. TDS credit is the TDS clients deducted on paid invoices.')}
          </p>
          <div className="row">
            <FigureCard title={t('VAT charged')} value={money(vat.charged)} />
            <FigureCard title={t('VAT collected')} value={money(vat.collected)} />
            <FigureCard title={t('VAT credit')} value={money(vat.credit)} />
            <FigureCard title={t('VAT payable (to IRD)')} value={money(vat.payable)} />
            <FigureCard title={t('TDS credit')} value={money(tds.credit)} />
            <FigureCard title={t('TDS payable')} value={money(tds.payable)} />
          </div>
        </>
      )}
      {shown.length ? (
        <TaxTable rows={sortedShown} sortKey={shownSort.sortKey} sortDir={shownSort.sortDir} onSort={shownSort.onSort} />
      ) : (
        <p className="text-muted">{t('No tax records in this fiscal year.')}</p>
      )}
      {unplaced.length > 0 && (
        <>
          <h4 className="h6 mt-4">{t('No fiscal year — standing records')}</h4>
          <p className="text-muted small">
            {t('These records carry no fiscal year of their own — the rent-tax explanation, clearance tasks and registrations — so they are listed here instead of being hidden.')}
          </p>
          <TaxTable rows={sortedUnplaced} sortKey={unplacedSort.sortKey} sortDir={unplacedSort.sortDir} onSort={unplacedSort.onSort} />
        </>
      )}
    </>
  );
}
