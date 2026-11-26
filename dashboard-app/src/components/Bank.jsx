import { money } from '../api.js';

export default function Bank({ data }) {
  if (!data) return null;
  const entries = data.entries || [];
  return (
    <>
      <h3 className="h5">
        Bank register{' '}
        <span className="badge badge-secondary">{money(data.balance)}</span>
      </h3>
      <p className="text-muted small">
        Deposits {money(data.deposits)} &middot; Withdrawals {money(data.withdrawals)}{' '}
        &middot;{' '}
        {data.entry_count !== undefined ? data.entry_count : entries.length} entries
      </p>
      <div className="table-responsive">
        <table className="table table-striped table-sm bg-white">
          <thead>
            <tr>
              <th>Date</th>
              <th>Direction</th>
              <th className="text-right">Amount</th>
              <th>Reference</th>
              <th>Client</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i}>
                <td>{e.date}</td>
                <td>{e.direction}</td>
                <td className="text-right">{money(e.amount_npr)}</td>
                <td>{e.reference || '—'}</td>
                <td>{e.client === 'unknown' ? '—' : e.client}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
