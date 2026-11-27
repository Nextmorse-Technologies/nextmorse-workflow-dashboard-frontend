import { useEffect, useState } from 'react';
import MenuPicker from './MenuPicker';
import { fieldErrors, friendlyError } from '../api.js';
import { useLocale } from '../i18n.js';
import { dateLabel } from '../dates.js';
import { SortHeader, useTableSort } from '../sort.js';
import { SUPPLIERS, SUPPLIER_OTHER } from '../suppliers.js';
import { RPM_NAME, RPM_UTILITY_LABEL } from './VendorBills.jsx';

/* The supplier-side mirror of the Billing rules tab: a supplier's
   saved services. The Record vendor bill form picks from these
   instead of typing a service each time, and a service with a TDS
   rate posts that TDS to the tax register when a bill is recorded
   from it. The tab follows the shared Fiscal year picker: each
   service shows the bills recorded for it in the picked year. A
   service with no bills that year stays listed, showing none. */

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

/* The money-out bill kinds — the recorded bills for a service. */
const BILL_KINDS = ['paid_rent', 'paid_utility', 'paid_supplier', 'paid_babal', 'paid_receipt'];

/* Does a paid bill belong to a saved service? The supplier must
   match (the utility rows billed as 'Utility Payment — 9851073311'
   fold into Real Property Management, as on the Vendor bills tab).
   The service matches by kind for rent and for the RPM utilities —
   the utility bills cover water, electricity and waste together on
   one meter note, so they cannot be split by utility — and by exact
   service text for anything else (a bill recorded from the picker
   carries the saved service's name). */
export function billMatchesService(inv, service) {
  if (!inv || !service) return false;
  const name = inv.client_name === RPM_UTILITY_LABEL ? RPM_NAME : inv.client_name;
  if (name !== service.supplier) return false;
  if (/rent/i.test(String(service.service || ''))) return inv.kind === 'paid_rent';
  if (service.supplier === RPM_NAME) return inv.kind === 'paid_utility';
  const want = String(service.service || '').trim().toLowerCase();
  const got = String(inv.service || '').trim().toLowerCase();
  return want !== '' && got === want;
}

/* Each saved service with the bills recorded for it in the picked
   fiscal year — count and total, derived from the rows, never
   hardcoded. 'all' keeps every year. A service with no bills in
   the year comes back with an empty list, not dropped. */
export function serviceActivity(services, invoices, fy) {
  const bills = (invoices || []).filter((inv) =>
    inv.status === 'Paid' &&
    BILL_KINDS.includes(inv.kind) &&
    (!fy || fy === 'all' || inv.fiscal_year === fy),
  );
  return (services || []).map((s) => {
    const mine = bills.filter((inv) => billMatchesService(inv, s));
    const total = Math.round(mine.reduce((sum, inv) => sum + (Number(inv.amount_npr) || 0), 0) * 100) / 100;
    return { service: s, bills: mine, count: mine.length, total };
  });
}

function FieldError({ msg }) {
  return msg ? <small className="form-text text-danger">{msg}</small> : null;
}

export default function VendorServices({ api, services, onWrote, fy, refreshKey, initialServices, initialInvoices }) {
  const { t, money, digits } = useLocale();
  /* The TDS label, localized — tdsLabel() itself stays English
     (it is exported for the tests); the table renders this one. */
  const tdsText = (service) => {
    const amount = tdsAmountOf(service);
    if (amount === null) return null;
    return t('{rate}% of {amount} = {tds} — payable to {payee}', {
      rate: digits(service.tds_rate),
      amount: money(service.amount_npr),
      tds: money(amount),
      payee: service.tds_payee || '—',
    });
  };
  const rows = (initialServices || services || []).slice().sort(
    (a, b) => String(a.supplier).localeCompare(String(b.supplier)) || String(a.service).localeCompare(String(b.service)),
  );
  /* The fiscal year comes from the shared picker in the tab bar
     (App); the activity column only filters on it. The bills come
     from the invoices API, the way VendorBills does it — fetched
     once, derived client-side. */
  const effectiveFy = fy || 'all';
  const [invoices, setInvoices] = useState(initialInvoices || null);
  const [invoicesLoading, setInvoicesLoading] = useState(!initialInvoices);
  const [invoicesError, setInvoicesError] = useState('');

  useEffect(() => {
    if (initialInvoices) return;
    let cancelled = false;
    (async () => {
      setInvoicesLoading(true);
      setInvoicesError('');
      try {
        let all = [];
        let page = 1;
        let total = Infinity;
        while (all.length < total) {
          const resp = await api('/invoices?per_page=200&page=' + page);
          const d = (resp && resp.data) || [];
          total = (resp && resp.meta && resp.meta.pagination && resp.meta.pagination.total) || d.length;
          all = all.concat(d);
          page += 1;
          if (!d.length) break;
        }
        if (!cancelled) setInvoices(all);
      } catch (err) {
        if (!cancelled) setInvoicesError(friendlyError(err));
      } finally {
        if (!cancelled) setInvoicesLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Re-fetch when a Billing write lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const activity = serviceActivity(rows, invoices, effectiveFy);
  const activityById = {};
  activity.forEach((a) => { activityById[a.service.id] = a; });
  /* One sort state for the services table; it starts in its
     original order (supplier, then service). The table sorts only
     the services actually shown; the Bills column sorts by how
     many bills each service has in the picked year. */
  const sort = useTableSort(null);
  const sortedRows = sort.apply(rows, (s, key) => {
    const a = activityById[s.id] || { count: 0, total: 0 };
    switch (key) {
      case 'service': return s.service || '';
      case 'cycle': return CYCLE_LABELS[s.cycle] || s.cycle || '';
      case 'amount': return s.amount_npr;
      case 'vat': return s.vat_included ? '13% included' : 'No VAT';
      case 'tds': return tdsLabel(s) || '';
      case 'nextDue': return s.next_due_ad || '';
      case 'bills': return a.count;
      default: return s.supplier || '';
    }
  });

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
    if (!supplier) { setVsFormError(t('Pick a supplier first.')); return; }
    if (!vsService.trim()) { setVsFormError(t('Enter the service.')); return; }
    if (tdsRate !== null && !(tdsRate > 0)) { setVsFormError(t('Enter a TDS rate above 0, or leave it blank.')); return; }
    if (tdsRate !== null && !vsTdsPayee.trim()) { setVsFormError(t('Say who the TDS is payable to.')); return; }

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
      setVsFormSuccess(t('Vendor service saved — {supplier} — {service}.', { supplier: d.supplier || supplier, service: d.service || vsService.trim() }));
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
      <h4>{t('Vendor services')}</h4>
      <p className="text-muted">
        {t('The services our suppliers provide, saved once so the Record vendor bill form can pick them instead of typing a service each time. Rent carries its 10% TDS — 1,540 a month on the 15,400 agreement rent, payable to KMC — marked on the record here, not counted into TDS payable.')}
      </p>
      <p className="text-muted small">
        {effectiveFy === 'all'
          ? t('Showing all years — the Bills column counts every bill recorded for each service.')
          : t('Showing {fy} — the Bills column counts only the bills recorded for each service in {fy}.', { fy: digits(effectiveFy) })}
      </p>
      {invoicesLoading && <p className="text-muted">{t('Loading bills…')}</p>}
      {invoicesError && <div className="alert alert-danger" role="alert">{invoicesError}</div>}
      {rows.length === 0 ? (
        <p className="text-muted">{t('No vendor services saved yet.')}</p>
      ) : (
        <>
          <table className="table table-sm">
            <thead>
              <tr>
                <SortHeader label={t('Supplier')} sortKey="supplier" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                <SortHeader label={t('Service')} sortKey="service" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                <SortHeader label={t('Cycle')} sortKey="cycle" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                <SortHeader label={t('Amount')} sortKey="amount" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                <SortHeader label={t('VAT')} sortKey="vat" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                <SortHeader label={t('TDS')} sortKey="tds" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                <SortHeader label={t('Next due')} sortKey="nextDue" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                <SortHeader label={effectiveFy === 'all' ? t('Bills') : t('Bills in {fy}', { fy: digits(effectiveFy) })} sortKey="bills" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} className="text-right" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((s) => {
                const a = activityById[s.id] || { count: 0, total: 0 };
                return (
                  <tr key={s.id}>
                    <td>{s.supplier}</td>
                    <td>{s.service}</td>
                    <td>{t(CYCLE_LABELS[s.cycle] || s.cycle)}</td>
                    <td>{(s.amount_npr === null || s.amount_npr === undefined) ? t('— varies') : money(s.amount_npr)}</td>
                    <td>{s.vat_included ? t('13% included') : t('No VAT')}</td>
                    <td>{tdsText(s) || '—'}</td>
                    <td>{s.next_due_ad ? dateLabel(s.next_due_ad) : '—'}</td>
                    <td className="text-right">
                      {a.count === 0
                        ? (effectiveFy === 'all' ? t('No bills') : t('No bills in {fy}', { fy: digits(effectiveFy) }))
                        : t(a.count === 1 ? '{n} bill' : '{n} bills', { n: digits(a.count) }) + ' — ' + money(a.total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-muted small">
            {t('Utility bills cover water, electricity and waste together on one meter note, so the same bills appear under each utility service — do not add the three rows together.')}
          </p>
        </>
      )}

      <div className="card mt-4">
        <div className="card-body">
          <h5 className="card-title">{t('Add a vendor service')}</h5>
          <form onSubmit={createVendorService} noValidate>
            <div className="form-group">
              <label>{t('Supplier')}</label>
              <MenuPicker
                buttonLabel={vsSupplier === SUPPLIER_OTHER ? t('Other — type a new supplier') : (vsSupplier || t('Pick a supplier…'))}
                options={[{ value: '', label: t('Pick a supplier…') }]
                  .concat(SUPPLIERS.map((s) => ({ value: s, label: s })))
                  .concat([{ value: SUPPLIER_OTHER, label: t('Other — type a new supplier') }])}
                open={openPicker === 'vsSupplier'}
                onToggle={() => setOpenPicker(openPicker === 'vsSupplier' ? null : 'vsSupplier')}
                onPick={(v) => { setVsSupplier(v); setOpenPicker(null); }}
                ariaLabel={t('Supplier')}
              />
              {vsSupplier === SUPPLIER_OTHER && (
                <input
                  className="form-control mt-2"
                  type="text"
                  placeholder={t('Supplier name')}
                  maxLength="255"
                  value={vsSupplierOther}
                  onChange={(e) => setVsSupplierOther(e.target.value)}
                />
              )}
              <FieldError msg={vsErrors.supplier && vsErrors.supplier.join(' ')} />
            </div>
            <div className="form-group">
              <label htmlFor="vsService">{t('Service')}</label>
              <input
                id="vsService"
                className="form-control"
                type="text"
                placeholder={t('e.g. Rent — office premises (Ward 2)')}
                maxLength="1000"
                value={vsService}
                onChange={(e) => setVsService(e.target.value)}
              />
              <FieldError msg={vsErrors.service && vsErrors.service.join(' ')} />
            </div>
            <div className="form-row">
              <div className="form-group col-md-6">
                <label htmlFor="vsAmount">{t('Amount (NPR) — blank when it varies')}</label>
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
                <label>{t('Cycle')}</label>
                <MenuPicker
                  buttonLabel={t(CYCLE_LABELS[vsCycle] || vsCycle)}
                  options={VENDOR_SERVICE_CYCLES.map((c) => ({ value: c, label: t(CYCLE_LABELS[c]) }))}
                  open={openPicker === 'vsCycle'}
                  onToggle={() => setOpenPicker(openPicker === 'vsCycle' ? null : 'vsCycle')}
                  onPick={(v) => { setVsCycle(v); setOpenPicker(null); }}
                  ariaLabel={t('Cycle')}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group col-md-6">
                <label>{t('Amount includes 13% VAT?')}</label>
                <MenuPicker
                  buttonLabel={vsVatIncluded === 'yes' ? t('Yes — 13% included') : t('No')}
                  options={[
                    { value: 'yes', label: t('Yes — 13% included') },
                    { value: 'no', label: t('No') },
                  ]}
                  open={openPicker === 'vsVatIncluded'}
                  onToggle={() => setOpenPicker(openPicker === 'vsVatIncluded' ? null : 'vsVatIncluded')}
                  onPick={(v) => { setVsVatIncluded(v); setOpenPicker(null); }}
                  ariaLabel={t('Amount includes 13% VAT?')}
                />
              </div>
              <div className="form-group col-md-6">
                <label htmlFor="vsTdsRate">{t('TDS rate % (optional)')}</label>
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
                <label htmlFor="vsTdsPayee">{t('TDS payable to')}</label>
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
                <small className="form-text text-muted">{t('Marked on the record only — it is not counted into TDS payable.')}</small>
              </div>
            )}
            <div className="form-row">
              <div className="form-group col-md-6">
                <label htmlFor="vsNextDue">{t('Next due (optional)')}</label>
                <input
                  id="vsNextDue"
                  className="form-control"
                  type="date"
                  value={vsNextDue}
                  onChange={(e) => setVsNextDue(e.target.value)}
                />
              </div>
              <div className="form-group col-md-6">
                <label htmlFor="vsNotes">{t('Notes (optional)')}</label>
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
              {t('Save vendor service')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
