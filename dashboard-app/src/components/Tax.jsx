import { money } from '../api.js';
import { fyOfAd, fyOfBs, fyString } from '../dates.js';

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
            <th>Item</th>
            <th className="text-right">Amount</th>
            <th className="text-right">Turnover</th>
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
                <td>{r.item}</td>
                <td className="text-right">{money(r.amount_npr)}</td>
                <td className="text-right">{money(r.turnover_npr)}</td>
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

export default function Tax({ data, fy }) {
  if (!data) return null;
  const rows = data.rows || [];
  /* The fiscal year comes from the shared picker in the tab bar
     (App); this tab only filters on it. */
  const effectiveFy = fy || 'all';
  const { shown, unplaced } = taxRowsForFy(rows, effectiveFy);
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
