import { money } from '../api.js';

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

export default function Overview({ data }) {
  if (!data) return null;
  const f = data.figures || {};
  const at = f.all_time || {};
  const br = f.bank_register || {};
  const vat = f.vat || {};
  const tds = f.tds || {};
  return (
    <>
      <h3 className="h5">Headline figures</h3>
      <div className="row">
        <FigureCard title="Invoiced (confirmed)" value={money(at.invoiced_confirmed)} />
        <FigureCard title="Received" value={money(at.received)} />
        <FigureCard title="Paid out" value={money(at.paid_out)} />
        <FigureCard title="Net" value={money(at.net)} />
        <FigureCard title="Open receivables" value={money(at.open_receivables)} />
        <FigureCard title="Bank balance" value={money(br.balance)} />
        <FigureCard title="VAT payable" value={money(vat.payable)} />
        <FigureCard title="TDS payable" value={money(tds.payable)} />
      </div>
      <h3 className="h5 mt-4">By fiscal year</h3>
      <div className="table-responsive">
        <table className="table table-striped table-sm bg-white">
          <thead>
            <tr>
              <th>Fiscal year</th>
              <th className="text-right">Invoiced</th>
              <th className="text-right">Received</th>
              <th className="text-right">Paid out</th>
              <th className="text-right">Profit</th>
            </tr>
          </thead>
          <tbody>
            {(f.by_fiscal_year || []).map((r) => (
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
    </>
  );
}
