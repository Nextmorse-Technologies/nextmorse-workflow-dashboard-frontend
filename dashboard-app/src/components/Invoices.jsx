import { useEffect, useState } from 'react';
import { friendlyError } from '../api.js';
import { useLocale } from '../i18n.js';
import { dateLabel, fyOfAd, fyOfBs, fyString } from '../dates.js';
import { SortHeader, sortInvoices, useTableSort } from '../sort.js';

/* Sorting lives in the shared sort module (src/sort.js) so every
   tab sorts the same way; these names are re-exported here for
   any importer that already reads them from this file. */
export { compareInvoiceNumber, sortInvoices } from '../sort.js';

/* The Tax invoices register: the sent tax invoices for the fiscal
   year, then the credit notes that reverse (part of) a locked tax
   invoice. Petty cash lives on its
   own tab — nothing non-taxed is shown here. Lists only — adding
   lives in the Billing tab. The credit-notes card reads from
   GET /api/v1/credit-notes and is read-only: a credit note is
   created through the existing credit-note flow, not from this
   card. */

/* A tax invoice: only the paper tax-invoice book counts — the
   marker tax_invoice_issued ('tax invoice') set. Bijaya's rule
   (27 Nov 2026): "if not in book its not tax invoice". This is
   NOT the server's InvoiceNumbering::isTaxInvoice rule (a VAT
   treatment, or any VAT charged) — that rule leaks rows onto the
   tax tab, e.g. invoice 39 (Mutu, VAT 1,950 on the row, no
   marker). */
export function isTaxInvoice(inv) {
  return !!inv.tax_invoice_issued;
}

/* A petty-cash invoice: treatment no_vat or no_vat_no_tds, and
   NOT in the tax-invoice book (no marker). No amount check — a
   row stays petty cash by its treatment and the book rule even
   when VAT is recorded on it (invoice 39, Mutu, VAT 1,950); the
   VAT totals already exclude it. A row whose treatment was never
   recorded is NOT petty — it is unclassified. */
export function isPettyInvoice(inv) {
  return ['no_vat', 'no_vat_no_tds'].includes(inv.treatment) &&
    !inv.tax_invoice_issued;
}

/* The fiscal-year label for a petty invoice with no stored
   fiscal_year — from its BS date first, AD date as fallback. */
export function pettyFy(inv) {
  const fromBs = inv.date_bs ? fyOfBs(inv.date_bs) : null;
  if (fromBs) return fyString(fromBs);
  const fromAd = inv.date_ad ? fyOfAd(inv.date_ad) : null;
  if (fromAd) return fyString(fromAd);
  return null;
}

/* The invoice number as shown. A tax invoice shows its number
   as-is. A petty-cash invoice carries its year and NT in front —
   {fiscal_year}-NT-{number} — so the year is visible wherever
   the number is shown. Only client (sent) invoices use this
   helper; received vendor bills keep the supplier's bill number
   as-is and never pass through here. */
export function displayNumber(inv) {
  const num = inv.invoice_number || '—';
  if (num === '—') return num;
  if (isTaxInvoice(inv)) return num;
  const fy = inv.fiscal_year || pettyFy(inv);
  return fy ? fy + '-NT-' + num : 'NT-' + num;
}

export function isSent(inv) {
  return inv.kind === 'sent' || inv.kind === 'mou_receivable';
}

/* Split a stored receipt number on its last '-': '2083/84-001'
   becomes { fy: '2083/84', serial: '001' } — the fiscal year is
   stored with the serial (Bijaya, 27 Nov 2026) because
   receipts.receipt_number is UNIQUE and a plain '001' would
   repeat across years. A plain number ('72') has no fiscal-year
   prefix — { fy: null, serial: '72' }. Null when the receipt
   carries no stored number. */
export function parseReceiptNumber(number) {
  if (number == null || number === '') return null;
  const s = String(number);
  const i = s.lastIndexOf('-');
  if (i > 0) {
    const prefix = s.slice(0, i);
    const serial = s.slice(i + 1);
    if (/^\d{4}\/\d{2}$/.test(prefix) && serial !== '') return { fy: prefix, serial };
  }
  return { fy: null, serial: s };
}

/* The fiscal-year label for a receipt — from its stored number
   first (the fiscal year is stored with the serial), then the
   API's fiscal_year, then its BS date, AD date as a fallback. */
export function receiptFy(receipt) {
  const parsed = parseReceiptNumber(receipt.receipt_number);
  if (parsed && parsed.fy) return parsed.fy;
  if (receipt.fiscal_year) return receipt.fiscal_year;
  const fromBs = receipt.date_bs ? fyOfBs(receipt.date_bs) : null;
  if (fromBs) return fyString(fromBs);
  const fromAd = receipt.date_ad ? fyOfAd(receipt.date_ad) : null;
  if (fromAd) return fyString(fromAd);
  return null;
}

/* The receipt number as shown. A tax receipt shows the serial
   part only ('001'). A petty-cash receipt shows the fiscal year
   and NT in front — {fiscal_year}-NT-{serial} — like a petty
   invoice, so it reads as non-taxed wherever the number is
   shown. A plain number with no fiscal-year prefix (an existing
   paper number, e.g. '72') is shown as-is. Only what is stored
   in receipt_number is shown; a receipt with no stored number
   shows '—'. A receipt is petty when the server flags it
   is_petty_cash — every linked invoice is kind sent with
   treatment no_vat/no_vat_no_tds and no tax-invoice marker. The
   NT prefix is added by the display, never stored. */
export function displayReceiptNumber(receipt) {
  const parsed = parseReceiptNumber(receipt.receipt_number);
  if (!parsed) return '—';
  if (!parsed.fy) return parsed.serial;
  if (receipt.is_petty_cash) return parsed.fy + '-NT-' + parsed.serial;
  return parsed.serial;
}

/* The sortable value of a receipt number: fiscal year then
   serial, so numbers repeat correctly across years. Null when
   the receipt carries no stored number. */
export function receiptNumberValue(receipt) {
  const parsed = parseReceiptNumber(receipt.receipt_number);
  if (!parsed) return null;
  const n = Number(parsed.serial);
  if (!Number.isFinite(n)) return parsed.serial;
  const fy = parsed.fy || receiptFy(receipt);
  const fyStart = fy ? parseInt(String(fy).split('/')[0], 10) : 0;
  return (Number.isFinite(fyStart) ? fyStart : 0) * 1000000 + n;
}

export function groupTotal(items) {
  return items.reduce((sum, inv) => sum + (Number(inv.amount_npr) || 0), 0);
}

/* A locked tax invoice: the tax-invoice marker on a tax invoice. */
export function lockedTax(rows) {
  return rows.filter((inv) => inv.tax_invoice_issued && isTaxInvoice(inv));
}

/* Locked petty cash: Paid petty-cash invoices (kind sent only).
   A row stays petty cash by its treatment and no marker, even
   when VAT is recorded on it (invoice 39, Mutu, VAT 1,950) —
   the book rule decides, not the amount. */
export function lockedPettyCash(rows) {
  return rows.filter((inv) =>
    inv.kind === 'sent' &&
    isPettyInvoice(inv) &&
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

/* The invoice list table, shared with the Petty cash tab. The
   caller sorts the items and passes the sort state, so every
   heading is a sort button; without sort props the headings stay
   plain, as before. The Print column has no sort — it is an
   action, not data. */
export function GroupTable({ items, onPrint, sortKey, sortDir, onSort }) {
  const { t, money } = useLocale();
  return (
    <div className="table-responsive">
      <table className="table table-striped table-sm bg-white">
        <thead>
          <tr>
            <SortHeader label={t('Invoice no.')} sortKey="number" activeKey={sortKey} dir={sortDir} onSort={onSort} />
            <SortHeader label={t('Client')} sortKey="client" activeKey={sortKey} dir={sortDir} onSort={onSort} />
            <SortHeader label={t('Package / Service / Product')} sortKey="service" activeKey={sortKey} dir={sortDir} onSort={onSort} />
            <SortHeader label={t('Amount')} sortKey="amount" activeKey={sortKey} dir={sortDir} onSort={onSort} className="text-right" />
            <SortHeader label={t('Status')} sortKey="status" activeKey={sortKey} dir={sortDir} onSort={onSort} />
            <SortHeader label={t('Issued')} sortKey="issued" activeKey={sortKey} dir={sortDir} onSort={onSort} />
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
              <td><span className={'badge ' + statusBadge(inv.status)}>{t(inv.status)}</span></td>
              <td>{dateLabel(inv.date_ad, inv.date_bs)}</td>
              <td>
                {onPrint ? (
                  <button type="button" className="btn btn-sm btn-secondary" onClick={() => onPrint(inv.id)}>{t('Print')}</button>
                ) : (
                  <span className="text-muted">{t('Print')}</span>
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
  const { t, money, digits } = useLocale();
  const [rows, setRows] = useState(initialRows || null);
  const [creditNotes, setCreditNotes] = useState(initialCreditNotes || null);
  const [loading, setLoading] = useState(!initialRows || !initialCreditNotes);
  const [loadError, setLoadError] = useState('');
  /* One sort state per table. The tax invoices start sorted by
     invoice number, ascending (Bijaya, 27 Nov 2026); the credit
     notes start in their original order. Each table sorts only
     the rows actually shown, after the fiscal-year filter. */
  const taxSort = useTableSort('number', 'asc');
  const cnSort = useTableSort(null);

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
  const taxInvoices = sortInvoices(sent.filter(isTaxInvoice), taxSort.sortKey, taxSort.sortDir);
  const shownCreditNotes = cnSort.apply(creditNotesForFy(creditNotes, effectiveFy), (cn, key) => {
    switch (key) {
      case 'invoice': return cn.invoice_number || '';
      case 'client': return cn.client_name || '';
      case 'reason': return cn.reason || '';
      case 'amount': return cn.total_return_npr;
      case 'issued': return cn.issued_date_ad || '';
      default: return cn.credit_note_number || '';
    }
  });

  return (
    <>
      <h3 className="h5">{t('Tax invoices')}</h3>
      <p className="mb-2 text-muted">
        {effectiveFy === 'all'
          ? t('Showing all years.')
          : t('Showing {fy} — money and government figures follow this fiscal year.', { fy: digits(effectiveFy) })}
      </p>
      {loading && <p className="text-muted">{t('Loading invoices…')}</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {rows && creditNotes && (
        <>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                {t('Tax invoices ({n})', { n: digits(taxInvoices.length) })} — {t('Subtotal: {amount}', { amount: money(groupTotal(taxInvoices)) })}
              </h4>
              <p className="text-muted small">
                {t('Tax invoices only — the paper tax-invoice book. A row without the tax-invoice marker is not a tax invoice, even when VAT is recorded on it. Petty cash lives on its own tab.')}
              </p>
              {taxInvoices.length ? (
                <GroupTable items={taxInvoices} onPrint={onPrintInvoice} sortKey={taxSort.sortKey} sortDir={taxSort.sortDir} onSort={taxSort.onSort} />
              ) : (
                <p className="text-muted mb-0">{t('No tax invoices in this fiscal year.')}</p>
              )}
            </div>
          </div>
          <div className="card mb-4">
            <div className="card-body">
              <h4 className="card-title h6">
                {t('Credit notes')} — {t('Subtotal: {amount}', { amount: money(creditNotesTotal(shownCreditNotes)) })}
              </h4>
              <p className="text-muted small">
                {t('Amounts returned to clients on locked tax invoices. This card is read-only.')}
              </p>
              {shownCreditNotes.length ? (
                <div className="table-responsive">
                  <table className="table table-striped table-sm bg-white">
                    <thead>
                      <tr>
                        <SortHeader label={t('Credit note no.')} sortKey="number" activeKey={cnSort.sortKey} dir={cnSort.sortDir} onSort={cnSort.onSort} />
                        <SortHeader label={t('Invoice')} sortKey="invoice" activeKey={cnSort.sortKey} dir={cnSort.sortDir} onSort={cnSort.onSort} />
                        <SortHeader label={t('Client')} sortKey="client" activeKey={cnSort.sortKey} dir={cnSort.sortDir} onSort={cnSort.onSort} />
                        <SortHeader label={t('Reason')} sortKey="reason" activeKey={cnSort.sortKey} dir={cnSort.sortDir} onSort={cnSort.onSort} />
                        <SortHeader label={t('Amount')} sortKey="amount" activeKey={cnSort.sortKey} dir={cnSort.sortDir} onSort={cnSort.onSort} className="text-right" />
                        <SortHeader label={t('Issued')} sortKey="issued" activeKey={cnSort.sortKey} dir={cnSort.sortDir} onSort={cnSort.onSort} />
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
                <p className="text-muted mb-0">{t('No credit notes in this fiscal year.')}</p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
