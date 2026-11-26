import { useState } from 'react';
import { money } from '../api.js';

export default function Receipts({ data }) {
  const [kindFilter, setKindFilter] = useState('');
  if (!data) return null;
  const list = data.data || [];
  const total = (data.meta && data.meta.pagination && data.meta.pagination.total) || list.length;
  const filtered = kindFilter
    ? list.filter((r) => r.kind === kindFilter)
    : list;
  const pageTotal = filtered.reduce(
    (sum, r) => sum + (Number(r.amount_npr) || 0),
    0,
  );
  const kinds = [...new Set(list.map((r) => r.kind).filter(Boolean))];
  return (
    <>
      <h3 className="h5">Receipts</h3>
      <p className="mb-2">
        {total} receipts in total &middot; showing {filtered.length} &middot;
        page total {money(pageTotal)}.
      </p>
      {kinds.length > 1 && (
        <div className="form-group" style={{ maxWidth: 260 }}>
          <label htmlFor="receiptKind">Kind</label>
          <select
            id="receiptKind"
            className="form-control"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
          >
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
      )}
      <div className="table-responsive">
        <table className="table table-striped table-sm bg-white">
          <thead>
            <tr>
              <th>Receipt</th>
              <th>Date</th>
              <th>Covers</th>
              <th className="text-right">Amount</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length ? (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.display_number && r.display_number !== '—'
                      ? r.display_number
                      : 'Receipt #' + r.id}
                  </td>
                  <td>
                    {r.date_ad}
                    {r.date_bs ? ' · ' + r.date_bs : ''}
                  </td>
                  <td>
                    {r.covers ||
                      (r.invoice_numbers && r.invoice_numbers.length
                        ? r.invoice_numbers.join(', ')
                        : '—')}
                  </td>
                  <td className="text-right">{money(r.amount_npr)}</td>
                  <td>{r.txn_ref || '—'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="5" className="text-muted">No receipts.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
