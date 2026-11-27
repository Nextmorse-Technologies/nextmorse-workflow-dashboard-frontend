import { useEffect, useState } from 'react';
import { money } from '../api.js';
import { dateLabel, fyOfAd, fyOfBs, fyString } from '../dates.js';

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

function TaxTable({ rows }) {
  return (
    <div className="table-responsive">
      <table className="table table-striped table-sm bg-white">
        <thead>
          <tr>
            <th>FY</th>
            <th>Invoice no.</th>
            <th>Client</th>
            <th>Item</th>
            <th className="text-right">Amount</th>
            <th className="text-right">Turnover</th>
            <th>Due</th>
            <th>Status</th>
            <th>Certificate no.</th>
            <th>Flag</th>
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
                <td>{y ? fyString(y) : '—'}</td>
                <td>{invoiceNumberLabel(r)}</td>
                <td>{r.client_name || '—'}</td>
                <td>{r.item}</td>
                <td className="text-right">{money(r.amount_npr)}</td>
                <td className="text-right">{money(r.turnover_npr)}</td>
                <td>{dateLabel(r.due_ad, r.due_bs)}</td>
                <td>{r.status}</td>
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

  if (!data) return null;
  const rows = data.rows || [];
  const { shown, unplaced } = taxRowsForFy(rows, effectiveFy);
  const vat = (figures && figures.vat) || {};
  const tds = (figures && figures.tds) || {};
  return (
    <>
      <h3 className="h5">
        Tax records{' '}
        <span className="badge badge-secondary">
          {shown.length + ' rows'}
        </span>
      </h3>
      <p className="text-muted small">
        {effectiveFy === 'all'
          ? 'Showing all years.'
          : 'Showing ' + effectiveFy + ' — money and government figures follow this fiscal year.'}
        {' '}Clearance certificates on file:{' '}
        {data.clearances_on_file !== undefined ? data.clearances_on_file : '—'}
        {' '}(all years). Rows in yellow need attention.
      </p>
      {figures && (
        <>
          <h4 className="h6 mt-3">VAT and TDS position</h4>
          <p className="text-muted small">
            {effectiveFy === 'all' ? 'Showing all years.' : 'Showing ' + effectiveFy + '.'}
            {' '}VAT credit is the VAT on suppliers' tax invoices (input VAT);
            VAT payable is VAT collected less that credit. TDS credit is
            the TDS clients deducted on paid invoices.
          </p>
          <div className="row">
            <FigureCard title="VAT charged" value={money(vat.charged)} />
            <FigureCard title="VAT collected" value={money(vat.collected)} />
            <FigureCard title="VAT credit" value={money(vat.credit)} />
            <FigureCard title="VAT payable (to IRD)" value={money(vat.payable)} />
            <FigureCard title="TDS credit" value={money(tds.credit)} />
            <FigureCard title="TDS payable" value={money(tds.payable)} />
          </div>
        </>
      )}
      {shown.length ? (
        <TaxTable rows={shown} />
      ) : (
        <p className="text-muted">No tax records in this fiscal year.</p>
      )}
      {unplaced.length > 0 && (
        <>
          <h4 className="h6 mt-4">No fiscal year — standing records</h4>
          <p className="text-muted small">
            These records carry no fiscal year of their own — the rent-tax
            explanation, clearance tasks and registrations — so they are
            listed here instead of being hidden.
          </p>
          <TaxTable rows={unplaced} />
        </>
      )}
    </>
  );
}
