import { useEffect, useState } from 'react';
import { friendlyError } from '../api.js';
import { useLocale } from '../i18n.js';
import { dateLabel, fyOfBs } from '../dates.js';
import { SortHeader, sortInvoices, useTableSort } from '../sort.js';
import { displayNumber, displayReceiptNumber, GroupTable, isPettyInvoice, isSent, isTaxInvoice, lockedPettyCash, receiptNumberValue } from './Invoices.jsx';

/* The Petty cash register: the petty-cash invoices for the
   fiscal year (treatment no_vat/no_vat_no_tds, not in the
   tax-invoice book), then the locked (paid) petty cash invoices,
   then the receipts that pay only those invoices. Lists only —
   nothing here is government-tracked. A separate card lists the
   sent invoices that fit neither tax nor petty cash — most have
   no treatment recorded; one (Kathalaya, 55,000, FY 2079/80)
   carries a VAT-only treatment but no tax-invoice marker. They
   stay listed separately, never hidden, until confirmed. The live
   Laravel page has no locked card (its Locked card view was never
   pushed) — that view is still unpushed; this React card reads
   from the API and does not depend on it. */

function receiptNumber(r) {
  return displayReceiptNumber(r);
}

export function total(items) {
  return items.reduce((sum, x) => sum + (Number(x.amount_npr) || 0), 0);
}

export default function PettyCash({ api, refreshKey, fy, initialInvoices, initialReceipts, onPrintInvoice, onPrintReceipt }) {
  const { t, money, digits } = useLocale();
  const [invoices, setInvoices] = useState(initialInvoices || null);
  const [receipts, setReceipts] = useState(initialReceipts || null);
  const [loading, setLoading] = useState(!initialInvoices || !initialReceipts);
  const [loadError, setLoadError] = useState('');
  /* One sort state per table; each starts in its original order.
     Each table sorts only the rows actually shown, after the
     fiscal-year filter. */
  const pettySort = useTableSort(null);
  const lockedSort = useTableSort(null);
  const unclassifiedSort = useTableSort(null);
  const receiptSort = useTableSort(null);

  /* The whole invoice list (324 rows over two pages) plus the
     receipts, once — so the fiscal-year filter works client-side
     with no refetch. */
  useEffect(() => {
    if (initialInvoices && initialReceipts) return;
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
        const [inv, rec] = await Promise.all([
          fetchAll('/invoices'),
          fetchAll('/receipts'),
        ]);
        if (!cancelled) {
          setInvoices(inv);
          setReceipts(rec);
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

  const shownInvoices = !invoices
    ? []
    : invoices.filter((inv) =>
      isPettyInvoice(inv) &&
      (effectiveFy === 'all' || inv.fiscal_year === effectiveFy));
  const shownReceipts = !receipts
    ? []
    : receipts.filter((r) =>
      r.is_petty_cash &&
      (effectiveFy === 'all' || fyOfBs(r.date_bs) === parseInt(effectiveFy.slice(0, 4), 10)));

  /* Sent invoices that are neither tax nor petty: most have no
     treatment recorded; invoice 100 (Kathalaya, VAT-only, no
     marker) fits neither either. Shown separately, never hidden,
     until Bijaya confirms they are petty cash. */
  const unclassified = !invoices
    ? []
    : invoices.filter((inv) =>
      isSent(inv) &&
      !isTaxInvoice(inv) &&
      !isPettyInvoice(inv) &&
      (effectiveFy === 'all' || inv.fiscal_year === effectiveFy));

  /* Locked petty cash: the Paid petty invoices in this fiscal year. */
  const lockedPetty = sortInvoices(lockedPettyCash(shownInvoices), lockedSort.sortKey, lockedSort.sortDir);
  const sortedPetty = sortInvoices(shownInvoices, pettySort.sortKey, pettySort.sortDir);
  const sortedUnclassified = sortInvoices(unclassified, unclassifiedSort.sortKey, unclassifiedSort.sortDir);
  const sortedReceipts = receiptSort.apply(shownReceipts, (r, key) => {
    switch (key) {
      case 'details': return r.covers || '';
      case 'amount': return r.amount_npr;
      case 'date': return r.date_ad || '';
      default: return receiptNumberValue(r);
    }
  });

  return (
    <>
      <h3 className="h5">{t('Petty cash')}</h3>
      <p className="mb-2 text-muted">
        {effectiveFy === 'all'
          ? t('Showing all years.')
          : t('Showing {fy} — money and government figures follow this fiscal year.', { fy: digits(effectiveFy) })}
      </p>
      {loading && <p className="text-muted">{t('Loading petty cash…')}</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {invoices && receipts && (
        <>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                {t('Petty cash invoices')} — {t('Subtotal: {amount}', { amount: money(total(shownInvoices)) })}
              </h4>
              {shownInvoices.length ? (
                <GroupTable items={sortedPetty} onPrint={onPrintInvoice} sortKey={pettySort.sortKey} sortDir={pettySort.sortDir} onSort={pettySort.onSort} />
              ) : (
                <p className="text-muted mb-0">{t('No petty cash invoices in this fiscal year.')}</p>
              )}
            </div>
          </div>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                {t('Locked petty cash invoices')} — {t('Subtotal: {amount}', { amount: money(total(lockedPetty)) })}
              </h4>
              <p className="text-muted small">
                {t('Paid invoices in this fiscal year — cash that remains as petty cash.')}
              </p>
              {lockedPetty.length ? (
                <GroupTable items={lockedPetty} onPrint={onPrintInvoice} sortKey={lockedSort.sortKey} sortDir={lockedSort.sortDir} onSort={lockedSort.onSort} />
              ) : (
                <p className="text-muted mb-0">{t('No locked petty cash invoices in this fiscal year.')}</p>
              )}
            </div>
          </div>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                {t('Invoices that fit neither tax nor petty cash')} — {t('Subtotal: {amount}', { amount: money(total(unclassified)) })}
              </h4>
              <p className="text-muted small">
                {t('Sent invoices that are neither in the tax-invoice book nor petty cash — most have no treatment on file (no VAT, no TDS recorded); one carries a VAT-only treatment but no tax-invoice marker. They are listed here separately, never hidden, until confirmed.')}
              </p>
              {unclassified.length ? (
                <GroupTable items={sortedUnclassified} onPrint={onPrintInvoice} sortKey={unclassifiedSort.sortKey} sortDir={unclassifiedSort.sortDir} onSort={unclassifiedSort.onSort} />
              ) : (
                <p className="text-muted mb-0">{t('No unclassified invoices in this fiscal year.')}</p>
              )}
            </div>
          </div>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                {t('Petty cash receipts')} — {t('Subtotal: {amount}', { amount: money(total(shownReceipts)) })}
              </h4>
              {shownReceipts.length ? (
                <div className="table-responsive">
                  <table className="table table-striped table-sm bg-white">
                    <thead>
                      <tr>
                        <SortHeader label={t('Receipt no.')} sortKey="number" activeKey={receiptSort.sortKey} dir={receiptSort.sortDir} onSort={receiptSort.onSort} />
                        <SortHeader label={t('Details')} sortKey="details" activeKey={receiptSort.sortKey} dir={receiptSort.sortDir} onSort={receiptSort.onSort} />
                        <SortHeader label={t('Amount (NPR)')} sortKey="amount" activeKey={receiptSort.sortKey} dir={receiptSort.sortDir} onSort={receiptSort.onSort} className="text-right" />
                        <SortHeader label={t('Payment date')} sortKey="date" activeKey={receiptSort.sortKey} dir={receiptSort.sortDir} onSort={receiptSort.onSort} />
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedReceipts.map((r) => (
                        <tr key={r.id}>
                          <td>{receiptNumber(r)}</td>
                          <td>{r.covers || '—'}</td>
                          <td className="text-right">{money(r.amount_npr)}</td>
                          <td>{dateLabel(r.date_ad, r.date_bs)}</td>
                          <td>
                            {onPrintReceipt ? (
                              <button type="button" className="btn btn-sm btn-secondary" onClick={() => onPrintReceipt(r.id)}>
                                {t('Receipt {number}', { number: receiptNumber(r) })}
                              </button>
                            ) : (
                              <span className="text-muted">{t('Receipt {number}', { number: receiptNumber(r) })}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted mb-0">{t('No petty cash receipts in this fiscal year.')}</p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
