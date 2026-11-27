import { useEffect, useState } from 'react';
import { friendlyError, money } from '../api.js';
import { dateLabel } from '../dates.js';
import { amountInWords } from '../words.js';

/* One receipt — the blue paper cash-receipt slip, as issued, in
   here instead of a redirect to the Laravel app. A port of the
   Laravel receipt-slip component: the same blue slip, the same
   fields. Print opens the print dialog only — a receipt print is
   not counted the way an invoice print is. */

const SLIP_CSS = `
@page{size:A4;margin:12mm}
@media print{body *{visibility:hidden}.receipt-wrap,.receipt-wrap *{visibility:visible}.receipt-wrap{position:absolute;top:0;left:0;display:block;background:#fff;padding:0;box-shadow:none;max-width:100%}.preview-actions,.receipt-wrap .muted{display:none}.receipt-sheet{box-shadow:none;max-width:100%}}
.receipt-wrap{background:#fff;border-radius:14px;max-width:560px;width:100%;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.25);margin:0 auto}
.receipt-sheet{position:relative;background:#dbe7f5;color:#111;max-width:520px;margin:0 auto 8px;padding:28px 30px;box-shadow:0 10px 32px rgba(0,0,0,.28);font-size:14px;line-height:1.6;print-color-adjust:exact;-webkit-print-color-adjust:exact;border:2px solid #111;border-radius:18px}
.rc-company{font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:26px;text-align:center;line-height:1.2}
.rc-addr{text-align:center;font-size:13px;margin-top:2px}
.rc-badge{display:table;margin:18px auto 6px;background:#111;color:#fff;font-weight:700;letter-spacing:2px;padding:8px 22px;border-radius:10px;font-size:17px}
.rc-ids{display:flex;justify-content:space-between;gap:12px;margin:14px 0}
.rc-line{margin:12px 0}
.rc-val{border-bottom:1px dotted #111;padding:0 2px}
.rc-blank{display:inline-block;min-width:130px;border-bottom:1px dotted #111}
.rc-amount{text-align:right;margin-top:18px}
.rc-amount span{display:inline-block;border:3px double #111;padding:10px 18px;font-weight:700;font-size:18px}
.rc-signs{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-top:30px}
.rc-stamp{color:#5b6b7f;opacity:.8;transform:rotate(-8deg);flex:0 0 auto}
.rc-sigcol{display:flex;flex-direction:column;gap:24px}
.rc-sig{text-align:center;font-size:13px}
.rc-sigline{display:block;width:150px;height:26px;border-bottom:1px dotted #111;margin:0 auto 4px}
.preview-actions{margin:16px auto;max-width:560px;display:flex;gap:10px;align-items:center}
.preview-actions .inv-print{cursor:pointer;background:#047857;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:700}
`;

export default function ReceiptPrint({ api, id, onClose, initialReceipt }) {
  const [receipt, setReceipt] = useState(initialReceipt || null);
  const [loading, setLoading] = useState(!initialReceipt);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (initialReceipt) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await api('/receipts/' + id);
        if (!cancelled) setReceipt((resp && resp.data) || null);
      } catch (err) {
        if (!cancelled) setLoadError(friendlyError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <p className="text-muted">Loading receipt…</p>;
  if (loadError) return <div className="alert alert-danger" role="alert">{loadError}</div>;
  if (!receipt) return <p className="text-muted">No such receipt.</p>;

  const outgoing = !!receipt.is_outgoing;
  const receivedFrom = receipt.received_from || receipt.covers || '—';
  const words = receipt.amount_npr !== null && receipt.amount_npr !== undefined
    ? amountInWords(receipt.amount_npr)
    : null;

  return (
    <>
      <style>{SLIP_CSS}</style>
      <h3 className="h5">Receipt {receipt.display_number || '—'}</h3>
      <div className="preview-actions">
        <button type="button" className="inv-print" onClick={() => window.print()}>Print / Save as PDF</button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
      <div className="receipt-wrap">
        <div className="receipt-sheet">
          <div className="rc-company">Nextmorse Technologies Pvt. Ltd.</div>
          <div className="rc-addr">Kathmandu, Nepal</div>
          <div className="rc-badge">{outgoing ? 'PAYMENT' : 'CASH RECEIPT'}</div>
          {receipt.is_petty_cash && (
            <div style={{ textAlign: 'center', fontWeight: 700, letterSpacing: '1px', margin: '4px 0 0' }}>NON TAXED INVOICE</div>
          )}
          <div className="rc-ids">
            <span>S. No. <b>{receipt.display_number || '—'}</b></span>
            <span>Date: {dateLabel(receipt.date_ad, receipt.date_bs)}</span>
          </div>
          <div className="rc-line">
            {outgoing ? 'Paid to ' : 'Received with thanks from '}
            <span className="rc-val">{receivedFrom}</span>
          </div>
          <div className="rc-line">The sum of Rs. In words <span className="rc-val">{words ? words + ' only.' : 'Amount unknown — see the register.'}</span></div>
          <div className="rc-line">by Cash/Cheque No./Draft No. <span className="rc-blank"></span> Bank Name <span className="rc-blank"></span></div>
          <div className="rc-amount"><span>{receipt.amount_npr !== null && receipt.amount_npr !== undefined ? money(receipt.amount_npr) : 'unknown'}</span></div>
          <div className="rc-signs">
            <svg className="rc-stamp" viewBox="0 0 120 120" width="104" height="104" aria-hidden="true">
              <circle cx="60" cy="60" r="56" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="60" cy="60" r="38" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <text x="60" y="54" textAnchor="middle" fontSize="34" fontWeight="700" fontFamily="Georgia, 'Times New Roman', serif" fill="currentColor">N</text>
              <text x="60" y="72" textAnchor="middle" fontSize="10" letterSpacing="1" fill="currentColor">nextmorse</text>
              <text x="60" y="86" textAnchor="middle" fontSize="9" fill="currentColor">PVT. LTD</text>
            </svg>
            <div className="rc-sigcol">
              {outgoing ? (
                <>
                  <div className="rc-sig"><span className="rc-sigline"></span>Paid by</div>
                  <div className="rc-sig"><span className="rc-sigline"></span>Received by</div>
                </>
              ) : (
                <>
                  <div className="rc-sig"><span className="rc-sigline"></span>Received by</div>
                  <div className="rc-sig"><span className="rc-sigline"></span>Paid by</div>
                </>
              )}
            </div>
          </div>
        </div>
        <p className="muted" style={{ margin: '14px 8px 0' }}>
          {outgoing ? 'Outgoing — money we paid' : 'Incoming — money we received'}
        </p>
      </div>
    </>
  );
}
