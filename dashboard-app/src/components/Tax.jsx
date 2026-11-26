import { money } from '../api.js';

export default function Tax({ data }) {
  if (!data) return null;
  const rows = data.rows || [];
  return (
    <>
      <h3 className="h5">
        Tax records{' '}
        <span className="badge badge-secondary">
          {(data.total_rows !== undefined ? data.total_rows : rows.length) + ' rows'}
        </span>
      </h3>
      <p className="text-muted small">
        Clearance certificates on file:{' '}
        {data.clearances_on_file !== undefined ? data.clearances_on_file : '—'}. Rows in
        yellow need attention.
      </p>
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
              return (
                <tr key={i} className={flag ? 'table-warning' : ''}>
                  <td>{r.fiscal_year}</td>
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
    </>
  );
}
