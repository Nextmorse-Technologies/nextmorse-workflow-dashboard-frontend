import { money } from '../api.js';

export default function Invoices({ summary, openList }) {
  if (!summary) return null;
  const sent = summary.sent_invoices || {};
  const open = summary.open_receivables || {};
  const anomalies = summary.anomalies || [];
  return (
    <>
      <h3 className="h5">Invoices</h3>
      <p className="mb-2">
        {(summary.total_invoices !== undefined ? summary.total_invoices : 0)} invoices in
        total &middot; {sent.count || 0} sent &middot; {sent.paid_count || 0} paid &middot;{' '}
        {sent.open_count || 0} open &middot; open receivables{' '}
        {money(open.total_remaining)}.
      </p>
      <div className="table-responsive">
        <table className="table table-striped table-sm bg-white">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Status</th>
              <th className="text-right">Count</th>
            </tr>
          </thead>
          <tbody>
            {(summary.by_kind_and_status || []).map((r, i) => (
              <tr key={i}>
                <td>{r.kind}</td>
                <td>{r.status}</td>
                <td className="text-right">{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 className="h6 mt-3">Open receivables</h4>
      <div className="table-responsive">
        <table className="table table-striped table-sm bg-white">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Client</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Still to receive</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {(open.invoices || []).map((r, i) => (
              <tr key={i}>
                <td>{r.invoice_number}</td>
                <td>{r.client}</td>
                <td className="text-right">{money(r.amount_npr)}</td>
                <td className="text-right">{money(r.remaining_npr)}</td>
                <td>{r.due || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 className="h6 mt-3">Open invoices (from the invoice list)</h4>
      <div className="table-responsive">
        <table className="table table-striped table-sm bg-white">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Client</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Received</th>
              <th className="text-right">Remaining</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {(openList || []).length ? (
              openList.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.invoice_number}</td>
                  <td>{inv.client_name}</td>
                  <td className="text-right">{money(inv.amount_npr)}</td>
                  <td className="text-right">{money(inv.received_amount_npr)}</td>
                  <td className="text-right">{money(inv.remaining_amount_npr)}</td>
                  <td>{inv.status}</td>
                  <td>{inv.date_ad}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="7" className="text-muted">No open invoices.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <h4 className="h6 mt-3">Things to check</h4>
      <ul className="list-group list-group-flush">
        {anomalies.length ? (
          anomalies.map((a, i) => {
            let line = a.invoice_number + ' — ' + a.client + ' — ' + a.detail +
              ' (' + money(a.amount_npr) + ')';
            if (a.explained_by_tds) line += ' Explained by TDS.';
            return <li key={i} className="list-group-item">{line}</li>;
          })
        ) : (
          <li className="list-group-item">Nothing to check.</li>
        )}
      </ul>
    </>
  );
}
