import { useState } from 'react';
import MenuPicker from './MenuPicker';
import { fieldErrors, friendlyError, money } from '../api.js';
import { dateLabel } from '../dates.js';
import { SUPPLIERS, SUPPLIER_OTHER } from '../suppliers.js';

/* The supplier-side mirror of the Billing rules tab: a supplier's
   saved services. The Record vendor bill form picks from these
   instead of typing a service each time, and a service with a TDS
   rate posts that TDS to the tax register when a bill is recorded
   from it. The list is all-years, like the Billing rules tab. */

export const VENDOR_SERVICE_CYCLES = ['none', 'monthly', 'quarterly', '3-monthly', '4-monthly', 'annual'];
export const CYCLE_LABELS = {
  none: 'One-time',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  '3-monthly': '3-monthly',
  '4-monthly': '4-monthly',
  annual: 'Annual',
};

/* The TDS a service accrues per cycle: the rate % of the service
   amount. The API returns it as tds_amount_npr; the fallback
   computes it the same way for test seams. Null when the service
   carries no TDS — no rate, or no amount to base it on (utilities
   vary by reading). */
export function tdsAmountOf(service) {
  if (!service) return null;
  if (service.tds_amount_npr !== null && service.tds_amount_npr !== undefined) return service.tds_amount_npr;
  if (service.tds_rate === null || service.tds_rate === undefined) return null;
  if (service.amount_npr === null || service.amount_npr === undefined) return null;
  return Math.round(service.amount_npr * service.tds_rate) / 100;
}

/* "10% of NPR 15,400.00 = NPR 1,540.00 — payable to KMC", or null. */
export function tdsLabel(service) {
  const amount = tdsAmountOf(service);
  if (amount === null) return null;
  return service.tds_rate + '% of ' + money(service.amount_npr) + ' = ' + money(amount) +
    ' — payable to ' + (service.tds_payee || '—');
}

/* The active saved services of one supplier, for the vendor bill
   picker. Sorted by service name, like the tab's table. */
export function servicesForSupplier(services, supplier) {
  return (services || [])
    .filter((s) => s.status === 'active' && s.supplier === supplier)
    .slice()
    .sort((a, b) => String(a.service).localeCompare(String(b.service)));
}

function FieldError({ msg }) {
  return msg ? <small className="form-text text-danger">{msg}</small> : null;
}

export default function VendorServices({ api, services, onWrote, initialServices }) {
  const rows = (initialServices || services || []).slice().sort(
    (a, b) => String(a.supplier).localeCompare(String(b.supplier)) || String(a.service).localeCompare(String(b.service)),
  );

  const [vsSupplier, setVsSupplier] = useState('');
  const [vsSupplierOther, setVsSupplierOther] = useState('');
  const [vsService, setVsService] = useState('');
  const [vsAmount, setVsAmount] = useState('');
  const [vsCycle, setVsCycle] = useState('monthly');
  const [vsVatIncluded, setVsVatIncluded] = useState('yes');
  const [vsTdsRate, setVsTdsRate] = useState('');
  const [vsTdsPayee, setVsTdsPayee] = useState('');
  const [vsNextDue, setVsNextDue] = useState('');
  const [vsNotes, setVsNotes] = useState('');
  const [vsErrors, setVsErrors] = useState({});
  const [vsFormError, setVsFormError] = useState('');
  const [vsFormSuccess, setVsFormSuccess] = useState('');
  const [vsSubmitting, setVsSubmitting] = useState(false);
  const [openPicker, setOpenPicker] = useState(null);

  async function createVendorService(e) {
    e.preventDefault();
    setVsFormError('');
    setVsFormSuccess('');
    setVsErrors({});

    const supplier = vsSupplier === SUPPLIER_OTHER ? vsSupplierOther.trim() : vsSupplier;
    const tdsRate = vsTdsRate === '' ? null : parseFloat(vsTdsRate);
    if (!supplier) { setVsFormError('Pick a supplier first.'); return; }
    if (!vsService.trim()) { setVsFormError('Enter the service.'); return; }
    if (tdsRate !== null && !(tdsRate > 0)) { setVsFormError('Enter a TDS rate above 0, or leave it blank.'); return; }
    if (tdsRate !== null && !vsTdsPayee.trim()) { setVsFormError('Say who the TDS is payable to.'); return; }

    const payload = {
      supplier,
      service: vsService.trim(),
      cycle: vsCycle,
      vat_included: vsVatIncluded === 'yes',
    };
    if (vsAmount !== '') payload.amount_npr = parseFloat(vsAmount);
    if (tdsRate !== null) {
      payload.tds_rate = tdsRate;
      payload.tds_payee = vsTdsPayee.trim();
    }
    if (vsNextDue) payload.next_due_ad = vsNextDue;
    if (vsNotes.trim()) payload.notes = vsNotes.trim();

    setVsSubmitting(true);
    try {
      const resp = await api('/vendor-services', { method: 'POST', body: payload });
      const d = (resp && resp.data) || {};
      setVsFormSuccess('Vendor service saved — ' + (d.supplier || supplier) + ' — ' + (d.service || vsService.trim()) + '.');
      setVsService('');
      setVsAmount('');
      setVsTdsRate('');
      setVsTdsPayee('');
      setVsNextDue('');
      setVsNotes('');
      if (onWrote) onWrote();
    } catch (err) {
      setVsErrors(fieldErrors(err));
      setVsFormError(friendlyError(err));
    } finally {
      setVsSubmitting(false);
    }
  }

  return (
    <div>
      <h4>Vendor services</h4>
      <p className="text-muted">
        The services our suppliers provide, saved once so the Record
        vendor bill form can pick them instead of typing a service
        each time. Rent carries its 10% TDS — 1,540 a month on the
        15,400 agreement rent, payable to KMC — marked on the record
        here, not counted into TDS payable.
      </p>
      {rows.length === 0 ? (
        <p className="text-muted">No vendor services saved yet.</p>
      ) : (
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Service</th>
              <th>Cycle</th>
              <th>Amount</th>
              <th>VAT</th>
              <th>TDS</th>
              <th>Next due</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{s.supplier}</td>
                <td>{s.service}</td>
                <td>{CYCLE_LABELS[s.cycle] || s.cycle}</td>
                <td>{(s.amount_npr === null || s.amount_npr === undefined) ? '— varies' : money(s.amount_npr)}</td>
                <td>{s.vat_included ? '13% included' : 'No VAT'}</td>
                <td>{tdsLabel(s) || '—'}</td>
                <td>{s.next_due_ad ? dateLabel(s.next_due_ad) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="card mt-4">
        <div className="card-body">
          <h5 className="card-title">Add a vendor service</h5>
          <form onSubmit={createVendorService} noValidate>
            <div className="form-group">
              <label>Supplier</label>
              <MenuPicker
                buttonLabel={vsSupplier === SUPPLIER_OTHER ? 'Other — type a new supplier' : (vsSupplier || 'Pick a supplier…')}
                options={[{ value: '', label: 'Pick a supplier…' }]
                  .concat(SUPPLIERS.map((s) => ({ value: s, label: s })))
                  .concat([{ value: SUPPLIER_OTHER, label: 'Other — type a new supplier' }])}
                open={openPicker === 'vsSupplier'}
                onToggle={() => setOpenPicker(openPicker === 'vsSupplier' ? null : 'vsSupplier')}
                onPick={(v) => { setVsSupplier(v); setOpenPicker(null); }}
                ariaLabel="Supplier"
              />
              {vsSupplier === SUPPLIER_OTHER && (
                <input
                  className="form-control mt-2"
                  type="text"
                  placeholder="Supplier name"
                  maxLength="255"
                  value={vsSupplierOther}
                  onChange={(e) => setVsSupplierOther(e.target.value)}
                />
              )}
              <FieldError msg={vsErrors.supplier && vsErrors.supplier.join(' ')} />
            </div>
            <div className="form-group">
              <label htmlFor="vsService">Service</label>
              <input
                id="vsService"
                className="form-control"
                type="text"
                placeholder="e.g. Rent — office premises (Ward 2)"
                maxLength="1000"
                value={vsService}
                onChange={(e) => setVsService(e.target.value)}
              />
              <FieldError msg={vsErrors.service && vsErrors.service.join(' ')} />
            </div>
            <div className="form-row">
              <div className="form-group col-md-6">
                <label htmlFor="vsAmount">Amount (NPR) — blank when it varies</label>
                <input
                  id="vsAmount"
                  className="form-control"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={vsAmount}
                  onChange={(e) => setVsAmount(e.target.value)}
                />
                <FieldError msg={vsErrors.amount_npr && vsErrors.amount_npr.join(' ')} />
              </div>
              <div className="form-group col-md-6">
                <label>Cycle</label>
                <MenuPicker
                  buttonLabel={CYCLE_LABELS[vsCycle] || vsCycle}
                  options={VENDOR_SERVICE_CYCLES.map((c) => ({ value: c, label: CYCLE_LABELS[c] }))}
                  open={openPicker === 'vsCycle'}
                  onToggle={() => setOpenPicker(openPicker === 'vsCycle' ? null : 'vsCycle')}
                  onPick={(v) => { setVsCycle(v); setOpenPicker(null); }}
                  ariaLabel="Cycle"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group col-md-6">
                <label>Amount includes 13% VAT?</label>
                <MenuPicker
                  buttonLabel={vsVatIncluded === 'yes' ? 'Yes — 13% included' : 'No'}
                  options={[
                    { value: 'yes', label: 'Yes — 13% included' },
                    { value: 'no', label: 'No' },
                  ]}
                  open={openPicker === 'vsVatIncluded'}
                  onToggle={() => setOpenPicker(openPicker === 'vsVatIncluded' ? null : 'vsVatIncluded')}
                  onPick={(v) => { setVsVatIncluded(v); setOpenPicker(null); }}
                  ariaLabel="Amount includes 13% VAT?"
                />
              </div>
              <div className="form-group col-md-6">
                <label htmlFor="vsTdsRate">TDS rate % (optional)</label>
                <input
                  id="vsTdsRate"
                  className="form-control"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g. 10"
                  value={vsTdsRate}
                  onChange={(e) => setVsTdsRate(e.target.value)}
                />
                <FieldError msg={vsErrors.tds_rate && vsErrors.tds_rate.join(' ')} />
              </div>
            </div>
            {vsTdsRate !== '' && (
              <div className="form-group">
                <label htmlFor="vsTdsPayee">TDS payable to</label>
                <input
                  id="vsTdsPayee"
                  className="form-control"
                  type="text"
                  placeholder="e.g. KMC"
                  maxLength="100"
                  value={vsTdsPayee}
                  onChange={(e) => setVsTdsPayee(e.target.value)}
                />
                <FieldError msg={vsErrors.tds_payee && vsErrors.tds_payee.join(' ')} />
                <small className="form-text text-muted">Marked on the record only — it is not counted into TDS payable.</small>
              </div>
            )}
            <div className="form-row">
              <div className="form-group col-md-6">
                <label htmlFor="vsNextDue">Next due (optional)</label>
                <input
                  id="vsNextDue"
                  className="form-control"
                  type="date"
                  value={vsNextDue}
                  onChange={(e) => setVsNextDue(e.target.value)}
                />
              </div>
              <div className="form-group col-md-6">
                <label htmlFor="vsNotes">Notes (optional)</label>
                <input
                  id="vsNotes"
                  className="form-control"
                  type="text"
                  maxLength="2000"
                  value={vsNotes}
                  onChange={(e) => setVsNotes(e.target.value)}
                />
              </div>
            </div>
            {vsFormError && <div className="alert alert-danger" role="alert">{vsFormError}</div>}
            {vsFormSuccess && <div className="alert alert-success" role="alert">{vsFormSuccess}</div>}
            <button className="btn btn-primary" type="submit" disabled={vsSubmitting}>
              Save vendor service
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
