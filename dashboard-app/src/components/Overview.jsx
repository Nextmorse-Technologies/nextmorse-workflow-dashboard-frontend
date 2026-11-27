import { money } from '../api.js';
import { SortHeader, useTableSort } from '../sort.js';
import Reports from './Reports.jsx';
import Ledger from './Ledger.jsx';

function FigureCard({ title, value }) {
  return (
    <div className="col-6 col-md-3 mb-3">
      <div className="card h-100">
        <div className="card-body">
          <div className="text-muted small">{title}</div>
          <div className="h5 mb-0">{value}</div>
        </div>
      </div>
    </div>
  );
}

export default function Overview({ data, api, fy, refreshKey }) {
  /* One sort state for the By fiscal year table; it starts in its
     original order. The table sorts only the years actually shown. */
  const sort = useTableSort(null);
  if (!data) return null;
  const f = data.figures || {};
  const at = f.all_time || {};
  const br = f.bank_register || {};
  const vat = f.vat || {};
  const tds = f.tds || {};
  const sortedYears = sort.apply(f.by_fiscal_year || [], (r, key) => {
    switch (key) {
      case 'invoiced': return r.invoiced;
      case 'received': return r.received;
      case 'paid': return r.paid;
      case 'profit': return r.profit;
      default: return r.label || '';
    }
  });
  return (
    <>
      <h3 className="h5">Headline figures</h3>
      <p className="mb-3 text-muted small">Showing {fy === 'all' ? 'all years' : fy}.</p>
      <div className="row">
        <FigureCard title="Invoiced (confirmed)" value={money(at.invoiced_confirmed)} />
        <FigureCard title="Received" value={money(at.received)} />
        <FigureCard title="Paid out" value={money(at.paid_out)} />
        <FigureCard title="Net" value={money(at.net)} />
        <FigureCard title="Open receivables" value={money(at.open_receivables)} />
        {/* The bank balance is the current balance — a balance, not a
            year's amount — so it never follows the year picker. */}
        <FigureCard title={fy && fy !== 'all' ? 'Bank balance (current)' : 'Bank balance'} value={money(br.balance)} />
        <FigureCard title="VAT payable" value={money(vat.payable)} />
        <FigureCard title="TDS payable" value={money(tds.payable)} />
      </div>
      <h3 className="h5 mt-4">By fiscal year</h3>
      <div className="table-responsive">
        <table className="table table-striped table-sm bg-white">
          <thead>
            <tr>
              <SortHeader label="Fiscal year" sortKey="fy" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
              <SortHeader label="Invoiced" sortKey="invoiced" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} className="text-right" />
              <SortHeader label="Received" sortKey="received" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} className="text-right" />
              <SortHeader label="Paid out" sortKey="paid" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} className="text-right" />
              <SortHeader label="Profit" sortKey="profit" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} className="text-right" />
            </tr>
          </thead>
          <tbody>
            {sortedYears.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="text-right">{money(r.invoiced)}</td>
                <td className="text-right">{money(r.received)}</td>
                <td className="text-right">{money(r.paid)}</td>
                <td className="text-right">{money(r.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* The report, last on this page — the same tables as the
          Laravel /reports page, from the same payload. The audits
          and meetings follow the Fiscal year picker; the
          shareholders and the audit-log count are all-years. */}
      <div className="mt-5">
        <Reports data={data.reports} fy={fy} />
      </div>
      {/* The ledger, after the report — the same sections as the
          Laravel /ledger page, from the API. */}
      <div className="mt-5">
        <Ledger api={api} fy={fy} refreshKey={refreshKey} />
      </div>
    </>
  );
}
