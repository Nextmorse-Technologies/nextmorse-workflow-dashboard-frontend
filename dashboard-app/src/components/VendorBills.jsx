import { useEffect, useState } from 'react';
import { friendlyError, money } from '../api.js';
import { dateLabel } from '../dates.js';
import { statusBadge } from './Invoices.jsx';

/* The Laravel /billing/vendors page, from the API: the open vendor
   bills first (kind=received, not Paid), then what is still owed to
   suppliers, then what suppliers have been paid (GET
   /reports/suppliers). The owed figure is the same sum the server
   computes — the remaining amount on each open received bill. The
   page has no fiscal-year filter, so this section is all-years. */
export default function VendorBills({ api, refreshKey, initialBills, initialSuppliers }) {
  const [bills, setBills] = useState(initialBills || null);
  const [suppliers, setSuppliers] = useState(initialSuppliers || null);
  const [loading, setLoading] = useState(!initialBills || !initialSuppliers);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (initialBills && initialSuppliers) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const [sup, all] = await Promise.all([
          api('/reports/suppliers'),
          (async () => {
            let rows = [];
            let page = 1;
            let total = Infinity;
            while (rows.length < total) {
              const resp = await api('/invoices?kind=received&per_page=200&page=' + page);
              const d = (resp && resp.data) || [];
              total = (resp && resp.meta && resp.meta.pagination && resp.meta.pagination.total) || d.length;
              rows = rows.concat(d);
              page += 1;
              if (!d.length) break;
            }
            return rows;
          })(),
        ]);
        if (cancelled) return;
        setSuppliers((sup && sup.data) || []);
        setBills(all);
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

  const openBills = (bills || [])
    .filter((b) => b.status !== 'Paid')
    .sort((a, b) => String(b.date_ad || '').localeCompare(String(a.date_ad || '')));
  const owed = openBills.reduce((sum, b) => sum + (Number(b.remaining_amount_npr) || 0), 0);

  return (
    <>
      <h3 className="h5">Vendor Bills</h3>
      <p className="mb-2 text-muted">What suppliers have been paid, and what is still owed to them.</p>
      {loading && <p className="text-muted">Loading vendor bills…</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {bills && suppliers && (
        <>
          <h4 className="h6 mt-3">Open vendor bills</h4>
          {openBills.length === 0 ? (
            <p className="text-muted">No open vendor bills.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped table-sm bg-white">
                <thead>
                  <tr>
                    <th>Invoice no.</th>
                    <th>Supplier</th>
                    <th>Service</th>
                    <th className="text-right">Amount</th>
                    <th>Status</th>
                    <th>Issued</th>
                  </tr>
                </thead>
                <tbody>
                  {openBills.map((b) => (
                    <tr key={b.id}>
                      <td>{b.invoice_number || '—'}</td>
                      <td>{b.client_name}</td>
                      <td>{b.service}</td>
                      <td className="text-right">{money(b.amount_npr)}</td>
                      <td><span className={'badge ' + statusBadge(b.status)}>{b.status}</span></td>
                      <td>{dateLabel(b.date_ad, b.date_bs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h4 className="h6 mt-3">Owed to vendors</h4>
          <p className="text-muted">{money(owed)}</p>
          <h4 className="h6 mt-3">Suppliers — paid totals</h4>
          <div className="table-responsive">
            <table className="table table-striped table-sm bg-white">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="text-right">Payments</th>
                  <th className="text-right">Total paid</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s, i) => (
                  <tr key={i}>
                    <td>{s.name}</td>
                    <td className="text-right">{s.count}</td>
                    <td className="text-right">{money(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
