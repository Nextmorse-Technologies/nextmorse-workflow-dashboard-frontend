import { useEffect, useState } from 'react';
import { friendlyError, money } from '../api.js';
import { dateLabel } from '../dates.js';

/* The Client Invoices register, like the Laravel page: the sent
   invoices for the fiscal year grouped into Tax / Petty cash /
   Other, then the locked tax invoices and the locked petty cash
   invoices, then the credit notes that reverse (part of) a locked
   tax invoice. Lists only — adding lives in the Billing tab. The
   credit-notes card reads from GET /api/v1/credit-notes and is
   read-only: a credit note is created through the existing
   credit-note flow, not from this card. */

/* The invoice number as shown: a tax invoice (a VAT treatment, or
   any VAT charged) shows its number; anything else carries NT in
   front — the same rule as InvoiceNumbering::displayNumber. */
export function displayNumber(inv) {
  const num = inv.invoice_number || '—';
  if (num === '—') return num;
  const isTax = ['vat_tds', 'vat_only'].includes(inv.treatment) ||
    (Number(inv.vat_npr) || 0) > 0;
  return isTax ? num : 'NT-' + num;
}

export function isSent(inv) {
  return inv.kind === 'sent' || inv.kind === 'mou_receivable';
}

/* The three groups of the register — the same rule as
   BillingSimulatorService::groupInvoices. */
export function groupInvoices(rows) {
  const groups = { tax: [], petty_cash: [], other: [] };
  rows.forEach((inv) => {
    if (['vat_tds', 'vat_only'].includes(inv.treatment)) groups.tax.push(inv);
    else if (inv.treatment === 'no_vat_no_tds') groups.petty_cash.push(inv);
    else groups.other.push(inv);
  });
  return groups;
}

export function groupTotal(items) {
  return items.reduce((sum, inv) => sum + (Number(inv.amount_npr) || 0), 0);
}

/* A locked tax invoice carries the tax-invoice marker. */
export function lockedTax(rows) {
  return rows.filter((inv) => inv.tax_invoice_issued);
}

/* Locked petty cash: Paid no-VAT invoices (kind sent only). */
export function lockedPettyCash(rows) {
  return rows.filter((inv) =>
    inv.kind === 'sent' &&
    ['no_vat', 'no_vat_no_tds'].includes(inv.treatment) &&
    inv.status === 'Paid');
}

/* Credit notes for a fiscal year ('all' keeps every year). */
export function creditNotesForFy(rows, fy) {
  const list = rows || [];
  if (!fy || fy === 'all') return list;
  return list.filter((cn) => cn.fiscal_year === fy);
}

/* The total returned by a list of credit notes. */
export function creditNotesTotal(rows) {
  return (rows || []).reduce((sum, cn) => sum + (Number(cn.total_return_npr) || 0), 0);
}

/* Hover text for a locked invoice's Status badge — the same rule as
   BillingSimulatorService::statusTitle. */
export function statusTitle(inv) {
  if (inv.status === 'Paid' && inv.paid_date_ad) {
    return 'Paid on ' + dateLabel(inv.paid_date_ad, inv.paid_date_bs);
  }
  if (inv.due_date_ad) {
    return 'Due on ' + dateLabel(inv.due_date_ad, inv.due_date_bs);
  }
  return '';
}

export function statusBadge(status) {
  if (status === 'Paid') return 'badge-success';
  if (status === 'Open') return 'badge-warning';
  if (status === 'Due') return 'badge-danger';
  if (status === 'Partially paid') return 'badge-info';
  return 'badge-secondary';
}

const GROUPS = [
  { key: 'tax', heading: 'Tax invoices' },
  { key: 'petty_cash', heading: 'Petty cash' },
  { key: 'other', heading: 'Other invoices' },
];

export function GroupTable({ items, onPrint }) {
  return (
    <div className="table-responsive">
      <table className="table table-striped table-sm bg-white">
        <thead>
          <tr>
            <th>Invoice no.</th>
            <th>Client</th>
            <th>Package / Service / Product</th>
            <th className="text-right">Amount</th>
            <th>Status</th>
            <th>Issued</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((inv) => (
            <tr key={inv.id}>
              <td>{displayNumber(inv)}</td>
              <td>{inv.client_name || '—'}</td>
              <td>{inv.service || '—'}</td>
              <td className="text-right">{money(inv.amount_npr)}</td>
              <td><span className={'badge ' + statusBadge(inv.status)}>{inv.status}</span></td>
              <td>{dateLabel(inv.date_ad, inv.date_bs)}</td>
              <td>
                {onPrint ? (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => onPrint(inv.id)}>Print</button>
                ) : (
                  <span className="text-muted">Print</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Invoices({ api, refreshKey, fy, initialRows, initialCreditNotes, onPrintInvoice }) {
  const [rows, setRows] = useState(initialRows || null);
  const [creditNotes, setCreditNotes] = useState(initialCreditNotes || null);
  const [loading, setLoading] = useState(!initialRows || !initialCreditNotes);
  const [loadError, setLoadError] = useState('');

  /* The whole invoice list, once — 324 rows over two pages at most —
     so the fiscal-year filter works client-side with no refetch.
     The credit notes come along the same way, from
     GET /api/v1/credit-notes. */
  useEffect(() => {
    if (initialRows && initialCreditNotes) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const fetchAll = async (path) => {
          let all = [];
          let page = 1;
          let totalRows = Infinity;
          while (all.length < totalRows) {
            const resp = await api(path + (path.includes('?') ? '&' : '?') + 'per_page=200&page=' + page);
            const d = (resp && resp.data) || [];
            totalRows = (resp && resp.meta && resp.meta.pagination && resp.meta.pagination.total) || d.length;
            all = all.concat(d);
            page += 1;
            if (!d.length) break;
          }
          return all;
        };
        const [inv, cn] = await Promise.all([
          initialRows ? Promise.resolve(null) : fetchAll('/invoices'),
          initialCreditNotes ? Promise.resolve(null) : fetchAll('/credit-notes'),
        ]);
        if (!cancelled) {
          if (inv !== null) setRows(inv);
          if (cn !== null) setCreditNotes(cn);
        }
      } catch (err) {
        if (!cancelled) setLoadError(friendlyError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Re-fetch when a Billing write lands; api is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  /* The fiscal year comes from the shared picker in the tab bar
     (App); this tab only filters on it. */
  const effectiveFy = fy || 'all';
  const shown = !rows
    ? []
    : effectiveFy === 'all'
      ? rows
      : rows.filter((r) => r.fiscal_year === effectiveFy);

  const sent = shown.filter(isSent);
  const groups = groupInvoices(sent);
  const locked = lockedTax(shown);
  const lockedPetty = lockedPettyCash(shown);
  const shownCreditNotes = creditNotesForFy(creditNotes, effectiveFy);

  return (
    <>
      <h3 className="h5">Client Invoices</h3>
      <p className="mb-2 text-muted">
        {effectiveFy === 'all'
          ? 'Showing all years.'
          : 'Showing ' + effectiveFy + ' — money and government figures follow this fiscal year.'}
      </p>
      {loading && <p className="text-muted">Loading invoices…</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {rows && creditNotes && (
        <>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">Sent invoices</h4>
              {GROUPS.map((g) => {
                const items = groups[g.key];
                return (
                  <div key={g.key}>
                    <h5 className="h6 mt-3">
                      {g.heading} — Subtotal: {money(groupTotal(items))}
                    </h5>
                    {items.length ? (
                      <GroupTable items={items} onPrint={onPrintInvoice} />
                    ) : (
                      <p className="text-muted">No client invoices in this fiscal year.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                Locked tax invoices — Subtotal: {money(groupTotal(locked))}
              </h4>
              {locked.length ? (
                <div className="table-responsive">
                  <table className="table table-striped table-sm bg-white">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Client</th>
                        <th className="text-right">Amount</th>
                        <th>Issued</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {locked.map((inv) => (
                        <tr key={inv.id}>
                          <td>{inv.invoice_number || '—'}</td>
                          <td>{inv.client_name || '—'}</td>
                          <td className="text-right">{money(inv.amount_npr)}</td>
                          <td>{dateLabel(inv.date_ad, inv.date_bs)}</td>
                          <td>
                            <span className="badge badge-success" title={statusTitle(inv) || undefined}>Locked</span>
                          </td>
                          <td>
                            {onPrintInvoice ? (
                              <button type="button" className="btn btn-sm btn-secondary" onClick={() => onPrintInvoice(inv.id)}>Print</button>
                            ) : (
                              <span className="text-muted">Print</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted mb-0">No locked tax invoices in this fiscal year.</p>
              )}
            </div>
          </div>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                Locked petty cash invoices — Subtotal: {money(groupTotal(lockedPetty))}
              </h4>
              <p className="text-muted small">
                Paid invoices in this fiscal year — cash that remains as petty cash.
              </p>
              {lockedPetty.length ? (
                <GroupTable items={lockedPetty} onPrint={onPrintInvoice} />
              ) : (
                <p className="text-muted mb-0">No locked petty cash invoices in this fiscal year.</p>
              )}
            </div>
          </div>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                Credit notes — Subtotal: {money(creditNotesTotal(shownCreditNotes))}
              </h4>
              <p className="text-muted small">
                Amounts returned to clients on locked tax invoices. This card is read-only.
              </p>
              {shownCreditNotes.length ? (
                <div className="table-responsive">
                  <table className="table table-striped table-sm bg-white">
                    <thead>
                      <tr>
                        <th>Credit note no.</th>
                        <th>Invoice</th>
                        <th>Client</th>
                        <th>Reason</th>
                        <th className="text-right">Amount</th>
                        <th>Issued</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownCreditNotes.map((cn) => (
                        <tr key={cn.id}>
                          <td>{cn.credit_note_number || '—'}</td>
                          <td>{cn.invoice_number || '—'}</td>
                          <td>{cn.client_name || '—'}</td>
                          <td>{cn.reason || '—'}</td>
                          <td className="text-right">{money(cn.total_return_npr)}</td>
                          <td>{dateLabel(cn.issued_date_ad, cn.issued_date_bs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted mb-0">No credit notes in this fiscal year.</p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
