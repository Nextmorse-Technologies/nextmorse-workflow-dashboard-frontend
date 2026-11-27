import { useEffect, useState } from 'react';
import { friendlyError, money } from '../api.js';
import { dateLabel } from '../dates.js';
import { amountInWords } from '../words.js';
import { displayNumber } from './Invoices.jsx';

/* One invoice — the red paper tax-invoice form, for printing, in
   here instead of a redirect to the Laravel app. A port of the
   Laravel invoice-sheet component: the same pink sheet, the same
   fields, the same Print behaviour — the Print button records the
   print first (a fire-and-forget POST, the first print is the
   Original, later prints are copies), then opens the print dialog;
   only the sheet prints, on A4. The buyer address and PAN come
   from the linked client where one is on record. */

const SELLER_VAT_DIGITS = '606861294'.split('');

export function isTaxInvoice(inv) {
  return ['vat_tds', 'vat_only'].includes(inv.treatment) || (Number(inv.vat_npr) || 0) > 0;
}

/* The print label: the first print is the Original; every later
   print is a numbered copy. A non-taxed invoice never claims to
   be a tax invoice. */
export function printLabel(inv) {
  if (!isTaxInvoice(inv)) return 'NON TAXED INVOICE';
  const n = Math.max(0, Number(inv.print_count) || 0);
  return n === 0 ? 'TAX INVOICE (Original)' : 'COPY OF ORIGINAL (' + n + ')';
}

export function buyerVatDigits(client) {
  const digits = ((client && client.pan_vat) || '').replace(/\D/g, '').split('');
  return Array.from({ length: 9 }, (_, i) => digits[i] || '');
}

const SHEET_CSS = `
@page{size:A4;margin:12mm}
@media print{body *{visibility:hidden}.tax-wrap,.tax-wrap *{visibility:visible}.tax-wrap{position:absolute;top:0;left:0;display:block;background:#fff;padding:0;box-shadow:none;max-width:100%}.preview-actions,.tax-wrap .muted{display:none}.tax-sheet{box-shadow:none;max-width:100%;padding:20px 24px;font-size:13px}.tax-head{margin-bottom:8px}.tax-title{margin:10px 0}.tax-ids{margin:6px 0}.tax-buyer{margin:10px 0}.tax-table th,.tax-table td{padding:5px 6px}.tax-grand{margin-top:8px}.tax-signs{margin-top:16px}}
.tax-wrap{background:#fff;border-radius:14px;max-width:780px;width:100%;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.25);margin:0 auto}
.tax-wrap .muted{color:#334155}
.tax-sheet{position:relative;background:#f8b4ad;color:#111;max-width:720px;margin:0 auto 8px;padding:32px 36px;box-shadow:0 10px 32px rgba(0,0,0,.28);font-size:14px;line-height:1.5;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.tax-head{display:flex;gap:16px;align-items:flex-start}
.tax-logo{flex:0 0 auto;width:52px;height:52px;border:2.5px solid #111;display:flex;align-items:center;justify-content:center;font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:34px;line-height:1}
.tax-company{font-family:Georgia,'Times New Roman',serif;font-variant:small-caps;font-weight:700;font-size:20px;letter-spacing:1.5px}
.tax-addr{font-size:13px}
.tax-title{text-align:center;font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:28px;letter-spacing:10px;margin:20px 0 12px;border-top:2px dotted #111;padding-top:10px}
.tax-copy{text-align:center;font-weight:700;letter-spacing:2px;margin:-4px 0 12px}
.tax-ids{display:flex;justify-content:space-between;gap:12px;margin:10px 0}
.tax-ids .vat-label{white-space:nowrap}
.vatbox{display:inline-block;width:18px;height:22px;border:1px solid #111;text-align:center;font-size:12px;line-height:22px;margin-right:1px;vertical-align:middle}
.tax-red{color:#b91c1c}
.tax-hand{background:transparent;border:0;border-bottom:1px solid #111;color:#1e40af;font:inherit;padding:0 2px}
.tax-blank{display:inline-block;min-width:180px;border-bottom:1px solid #111}
.tax-buyer{margin:14px 0}
.tax-buyer>div{margin:4px 0}
.tax-table{width:100%;border-collapse:collapse;border:1.5px solid #111;margin-top:14px}
.tax-table th,.tax-table td{border:1px solid #111;padding:7px 8px;font-size:13px;vertical-align:top;color:#111}
.tax-table th{text-align:center;font-weight:700;letter-spacing:.5px}
.tax-table td.c{text-align:center}
.tax-table td.num{text-align:right}
.tax-bottom{display:flex;justify-content:space-between;gap:24px;margin-top:14px}
.tax-words{flex:1;text-align:left}
.tax-totals{flex:0 0 auto}
.tax-totals>div{display:flex;justify-content:space-between;gap:28px}
.tax-totals .num{text-align:right}
.tax-grand{font-weight:700;font-size:15px}
.tax-signs{display:flex;justify-content:space-between;margin-top:48px;font-size:13px}
.tax-signs>div{text-align:center}
.tax-sign-line{display:block;width:140px;border-top:1px solid #111;margin:0 auto 4px}
.tax-stamp{display:block;width:56px;height:56px;border:1.5px solid #111;margin:0 auto 4px}
.preview-actions{margin:16px auto;max-width:780px;display:flex;gap:10px;align-items:center}
.preview-actions .inv-print{cursor:pointer;background:#047857;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:700}
`;

export default function InvoicePrint({ api, id, onClose, initialInvoice, initialClient }) {
  const [inv, setInv] = useState(initialInvoice || null);
  const [client, setClient] = useState(initialClient || null);
  const [loading, setLoading] = useState(!initialInvoice);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (initialInvoice) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await api('/invoices/' + id);
        const invoice = (resp && resp.data && resp.data.invoice) || null;
        if (cancelled) return;
        setInv(invoice);
        /* The buyer address and PAN are best-effort: a missing
           client leaves them blank, like the Laravel page. */
        if (invoice) {
          try {
            let found = null;
            if (invoice.client_id) {
              const c = await api('/clients/' + invoice.client_id);
              found = (c && c.data && c.data.client) || null;
            } else if (invoice.client_name) {
              const list = await api('/clients?q=' + encodeURIComponent(invoice.client_name) + '&per_page=5');
              found = ((list && list.data) || []).find((c) => c.name === invoice.client_name) || null;
            }
            if (!cancelled) setClient(found);
          } catch (e) { /* no client on record — blank address */ }
        }
      } catch (err) {
        if (!cancelled) setLoadError(friendlyError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function handlePrint() {
    /* Fire-and-forget, like the Laravel page: the print is
       recorded, then the dialog opens. A failed record never
       blocks printing. */
    api('/invoices/' + inv.id + '/print', { method: 'POST' }).catch(() => {});
    window.print();
  }

  if (loading) return <p className="text-muted">Loading invoice…</p>;
  if (loadError) return <div className="alert alert-danger" role="alert">{loadError}</div>;
  if (!inv) return <p className="text-muted">No such invoice.</p>;

  const vat = Number(inv.vat_npr) || 0;
  let subtotal = inv.subtotal_npr !== null && inv.subtotal_npr !== undefined ? Number(inv.subtotal_npr) : null;
  let total = inv.amount_npr !== null && inv.amount_npr !== undefined ? Number(inv.amount_npr) : null;
  if (subtotal === null && total !== null) subtotal = total - vat;
  /* The three figures are recomputed from each other on display,
     so the sheet always adds up: subtotal + VAT = total. */
  if (subtotal !== null) total = subtotal + vat;
  const tax = isTaxInvoice(inv);
  const particulars = ((inv.service || '') + (inv.domain ? ' — ' + inv.domain : '')).trim() || '—';
  const words = total !== null ? amountInWords(total) : null;

  return (
    <>
      <style>{SHEET_CSS}</style>
      <h3 className="h5">Invoice {displayNumber(inv)}</h3>
      <div className="preview-actions">
        <button type="button" className="inv-print" onClick={handlePrint}>Print / Save as PDF</button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
      <div className="tax-wrap">
        <div className="tax-sheet">
          <div className="tax-head">
            <div className="tax-logo">N</div>
            <div>
              <div className="tax-company">NEXTMORSE TECHNOLOGIES PVT. LTD.</div>
              <div className="tax-addr">Kathmandu - 02, Nepal</div>
              <div className="tax-addr">Contact: 9843714666</div>
            </div>
          </div>
          <div className="tax-title">{tax ? 'TAX INVOICE' : 'NON TAXED INVOICE'}</div>
          <div className="tax-copy">{printLabel(inv)}</div>
          <div className="tax-ids">
            {vat > 0 && (
              <span className="vat-label"><b>VAT Number:</b>
                {SELLER_VAT_DIGITS.map((d, i) => <span className="vatbox" key={i}>{d}</span>)}
              </span>
            )}
            <span style={{ marginLeft: 'auto' }}>Invoice No. <span className="tax-red"><b>{displayNumber(inv)}</b></span> &nbsp; Invoice Date: <span className="tax-hand">{dateLabel(inv.date_ad, inv.date_bs)}</span></span>
          </div>
          <div className="tax-ids">
            <span>Due: <span className="tax-hand">{dateLabel(inv.due_date_ad, inv.due_date_bs)}</span></span>
            <span style={{ marginLeft: 'auto' }}>Kind: {inv.kind} · Status: {inv.status}</span>
          </div>
          <div className="tax-buyer">
            <div><strong>Buyer&apos;s M/S</strong> <span className="tax-hand">{inv.client_name || '—'}</span></div>
            <div><strong>Address:</strong>
              {client && client.address ? (
                <span className="tax-hand">{client.address}</span>
              ) : (
                <span className="tax-blank"></span>
              )}
            </div>
            {vat > 0 && (
              <div><strong>Buyer&apos;s VAT No.:</strong>
                {buyerVatDigits(client).map((d, i) => <span className="vatbox" key={i}>{d}</span>)}
              </div>
            )}
            <div>Mode of Payment: Cash / Cheque / Credit</div>
          </div>
          <table className="tax-table">
            <tbody>
              <tr><th style={{ width: '7%' }}>S.No.</th><th style={{ width: '11%' }}>H.S. Code</th><th>Particulars</th><th style={{ width: '8%' }}>Qty</th><th style={{ width: '14%' }}>Rate</th><th style={{ width: '15%' }}>Amount</th></tr>
              <tr><td className="c">1</td><td></td><td>{particulars}</td><td className="c">1</td><td className="num">{subtotal !== null ? money(subtotal) : 'unknown'}</td><td className="num">{subtotal !== null ? money(subtotal) : 'unknown'}</td></tr>
              <tr><td colSpan="6" style={{ height: '110px' }}></td></tr>
            </tbody>
          </table>
          <div className="tax-bottom">
            <div className="tax-words"><b>In Words</b><br /><i>{words ? words + '.' : 'Amount unknown — see the register.'}</i></div>
            <div className="tax-totals">
              {vat > 0 && (
                <>
                  <div><span>Total Taxable amount</span><span className="num">{subtotal !== null ? money(subtotal) : '—'}</span></div>
                  <div><span>13% VAT</span><span className="num">{money(vat)}</span></div>
                </>
              )}
              <div className="tax-grand"><span>Grand Total</span><span className="num">{total !== null ? money(total) : 'unknown'}</span></div>
            </div>
          </div>
          <div className="tax-signs">
            <div><span className="tax-sign-line"></span>Received By</div>
            <div><span className="tax-stamp"></span>Stamp</div>
            <div><span className="tax-sign-line"></span>Nextmorse Technologies</div>
          </div>
        </div>
        <p className="muted" style={{ margin: '14px 8px 0' }}>
          {inv.status === 'Paid' && inv.paid_date_ad ? 'Paid on ' + dateLabel(inv.paid_date_ad, inv.paid_date_bs) + '. ' : ''}
          {inv.notes || ''}
        </p>
      </div>
    </>
  );
}
