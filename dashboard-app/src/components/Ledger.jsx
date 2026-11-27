import { useEffect, useState } from 'react';
import { friendlyError, money } from '../api.js';
import { SortHeader, useTableSort } from '../sort.js';
import { bankForFy } from './Bank.jsx';

/* The Laravel /ledger page, from the API: trial balance (the new
   endpoint), chart of accounts + FY balances, and the bank
   reconciliation + register entries (from /bank, as the Bank tab
   reads them). The trial balance and the chart follow the shared
   fiscal-year picker, and so does the bank register table below;
   the ledger-vs-register comparison stays all-years — the ledger
   bank is cumulative cash from all invoice records (2020–2026),
   so a one-year comparison against it would not balance. The
   Profit and Loss table at the bottom is calculated from the
   invoice records (no journal entries) and follows the picker
   too: one year picked shows that year only. */

const EXPENSE_KIND = {
  paid_rent: 'rent',
  paid_salary: 'salaries',
  paid_babal: 'hosting',
  paid_supplier: 'suppliers',
  paid_utility: 'utilities',
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

/* Profit and loss by fiscal year, calculated from the invoice
   records — no journal entries, no sent-invoice ledger backfill
   (Bijaya, 27 Nov 2026). Bucketed by the invoice's STORED
   fiscal_year (not by date — the By fiscal year table buckets by
   date, this one does not). Revenue is kind 'sent' only (the
   mou_receivable rows are excluded); per row it is subtotal_npr
   where set, else amount_npr − vat_npr (net of VAT). Expenses
   are the gross amount_npr as recorded, by kind: paid_rent →
   rent, paid_salary → salaries, paid_babal → hosting & domains,
   paid_supplier → suppliers, paid_utility → utilities. One row
   per fiscal year present in the invoices; a year with no sent
   invoices still shows (revenue 0) when it has expense rows. */
export function profitAndLoss(invoices) {
  const byFy = {};
  for (const inv of invoices || []) {
    const fy = inv.fiscal_year;
    if (!fy) continue;
    const row = byFy[fy] || (byFy[fy] = {
      fy, label: 'FY ' + fy,
      revenue: 0, rent: 0, salaries: 0, hosting: 0,
      suppliers: 0, utilities: 0,
    });
    if (inv.kind === 'sent') {
      row.revenue += inv.subtotal_npr != null
        ? Number(inv.subtotal_npr)
        : (Number(inv.amount_npr) || 0) - (Number(inv.vat_npr) || 0);
    } else {
      const field = EXPENSE_KIND[inv.kind];
      if (field) row[field] += Number(inv.amount_npr) || 0;
    }
  }
  return Object.values(byFy)
    .sort((a, b) => (a.fy < b.fy ? -1 : a.fy > b.fy ? 1 : 0))
    .map((r) => {
      const expenses = round2(r.rent + r.salaries + r.hosting + r.suppliers + r.utilities);
      return {
        fy: r.fy,
        label: r.label,
        revenue: round2(r.revenue),
        rent: round2(r.rent),
        salaries: round2(r.salaries),
        hosting: round2(r.hosting),
        suppliers: round2(r.suppliers),
        utilities: round2(r.utilities),
        expenses,
        profit: round2(r.revenue - expenses),
      };
    });
}

/* The sort value for one Profit and Loss row, shared by the
   component and the smoke tests. */
export function plRowValue(r, key) {
  switch (key) {
    case 'fy': return r.fy || '';
    case 'revenue': return r.revenue;
    case 'rent': return r.rent;
    case 'salaries': return r.salaries;
    case 'hosting': return r.hosting;
    case 'suppliers': return r.suppliers;
    case 'utilities': return r.utilities;
    case 'expenses': return r.expenses;
    case 'profit': return r.profit;
    default: return r.fy || '';
  }
}

export default function Ledger({ api, fy, refreshKey, initialTrial, initialAccounts, initialBalances, initialBank, initialInvoices }) {
  const [trial, setTrial] = useState(initialTrial || null);
  const [accounts, setAccounts] = useState(initialAccounts || null);
  const [balances, setBalances] = useState(initialBalances || null);
  const [bank, setBank] = useState(initialBank || null);
  const [invoices, setInvoices] = useState(initialInvoices || null);
  const [loading, setLoading] = useState(!initialTrial || !initialAccounts || !initialBalances || !initialBank || !initialInvoices);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (initialTrial && initialAccounts && initialBalances && initialBank && initialInvoices) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const fyParam = 'fiscal_year=' + encodeURIComponent(fy || 'all');
        /* All invoices, paginated — the Profit and Loss table is
           calculated from these, the same while-loop pattern as
           the Vendor bills tab. */
        const fetchAllInvoices = async () => {
          let rows = [];
          let page = 1;
          let total = Infinity;
          while (rows.length < total) {
            const resp = await api('/invoices?per_page=200&page=' + page);
            const d = (resp && resp.data) || [];
            total = (resp && resp.meta && resp.meta.pagination && resp.meta.pagination.total) || d.length;
            rows = rows.concat(d);
            page += 1;
            if (!d.length) break;
          }
          return rows;
        };
        const [t, a, b, k, inv] = await Promise.all([
          api('/ledger/trial-balance?' + fyParam),
          api('/ledger/accounts?per_page=200'),
          api('/ledger/balances?' + fyParam),
          api('/bank'),
          fetchAllInvoices(),
        ]);
        if (cancelled) return;
        setTrial((t && t.data) || null);
        setAccounts((a && a.data) || []);
        setBalances((b && b.data) || {});
        setBank(k || null);
        setInvoices(inv);
      } catch (err) {
        if (!cancelled) setLoadError(friendlyError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Re-fetch when the fiscal year changes or a Billing write lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fy, refreshKey]);

  const effectiveFy = fy || 'all';
  const entries = (bank && bank.entries) || [];
  /* The register entries follow the picker, like the Bank tab;
     the balance shown with them is the register balance at the
     end of the picked year. */
  const bankShown = bank ? bankForFy(entries, effectiveFy) : null;
  /* One sort state per table; each starts in its original order.
     Each table sorts only the rows actually shown, after the
     fiscal-year filter. The trial balance Total row and the
     bank ledger-vs-register table have no sortable headings and
     are untouched. */
  const trialSort = useTableSort(null);
  const chartSort = useTableSort(null);
  const bankSort = useTableSort(null);
  const sortedTrial = trialSort.apply((trial && trial.rows) || [], (r, key) => {
    switch (key) {
      case 'account': return r.name || '';
      case 'debit': return r.debit;
      case 'credit': return r.credit;
      case 'net': return r.net;
      default: return r.code || '';
    }
  });
  const sortedAccounts = chartSort.apply(accounts || [], (a, key) => {
    switch (key) {
      case 'account': return a.name || '';
      case 'type': return a.type || '';
      case 'balance': return (balances && balances[a.code]) ?? 0;
      default: return a.code || '';
    }
  });
  const sortedBankEntries = bankSort.apply(bankShown ? bankShown.entries : [], (e, key) => {
    switch (key) {
      case 'direction': return e.direction || '';
      case 'amount': return e.amount_npr;
      case 'reference': return e.reference || '';
      case 'client': return e.client === 'unknown' ? '' : (e.client || '');
      default: return e.date_ad || e.date_bs || e.date || '';
    }
  });
  /* Profit and Loss: one sort state of its own. A single year
     picked shows that year only, like the trial balance above;
     'all' shows every year plus an all-years Total row. */
  const plSort = useTableSort(null);
  const plRows = profitAndLoss(invoices || []);
  const plShown = effectiveFy === 'all' ? plRows : plRows.filter((r) => r.fy === effectiveFy);
  const sortedPl = plSort.apply(plShown, plRowValue);
  const plTotal = plRows.reduce((t, r) => ({
    revenue: round2(t.revenue + r.revenue),
    rent: round2(t.rent + r.rent),
    salaries: round2(t.salaries + r.salaries),
    hosting: round2(t.hosting + r.hosting),
    suppliers: round2(t.suppliers + r.suppliers),
    utilities: round2(t.utilities + r.utilities),
    expenses: round2(t.expenses + r.expenses),
    profit: round2(t.profit + r.profit),
  }), { revenue: 0, rent: 0, salaries: 0, hosting: 0, suppliers: 0, utilities: 0, expenses: 0, profit: 0 });

  return (
    <>
      <h3 className="h5">Ledger</h3>
      <p className="mb-2 text-muted">Double-entry, integer paisa, Dr = Cr — NFRS.</p>
      <p className="mb-2 text-muted">
        {effectiveFy === 'all'
          ? 'Showing all years.'
          : 'Showing ' + effectiveFy + ' — money and government figures follow this fiscal year.'}
      </p>
      {loading && <p className="text-muted">Loading ledger…</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {trial && (
        <>
          <h4 className="h6 mt-3">
            Trial balance{' '}
            <span className={'badge ' + (trial.balanced ? 'badge-success' : 'badge-danger')}>
              {trial.balanced ? 'Balanced' : 'NOT balanced'}
            </span>
          </h4>
          <div className="table-responsive">
            <table className="table table-striped table-sm bg-white">
              <thead>
                <tr>
                  <SortHeader label="Code" sortKey="code" activeKey={trialSort.sortKey} dir={trialSort.sortDir} onSort={trialSort.onSort} />
                  <SortHeader label="Account" sortKey="account" activeKey={trialSort.sortKey} dir={trialSort.sortDir} onSort={trialSort.onSort} />
                  <SortHeader label="Debit" sortKey="debit" activeKey={trialSort.sortKey} dir={trialSort.sortDir} onSort={trialSort.onSort} className="text-right" />
                  <SortHeader label="Credit" sortKey="credit" activeKey={trialSort.sortKey} dir={trialSort.sortDir} onSort={trialSort.onSort} className="text-right" />
                  <SortHeader label="Net" sortKey="net" activeKey={trialSort.sortKey} dir={trialSort.sortDir} onSort={trialSort.onSort} className="text-right" />
                </tr>
              </thead>
              <tbody>
                {sortedTrial.map((r) => (
                  <tr key={r.code}>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td className="text-right">{money(r.debit)}</td>
                    <td className="text-right">{money(r.credit)}</td>
                    <td className="text-right">{money(r.net)}</td>
                  </tr>
                ))}
                <tr>
                  <td></td>
                  <td><strong>Total</strong></td>
                  <td className="text-right"><strong>{money(trial.total_debit)}</strong></td>
                  <td className="text-right"><strong>{money(trial.total_credit)}</strong></td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
      {accounts && balances && (
        <>
          <h4 className="h6 mt-3">Chart of accounts</h4>
          <div className="table-responsive">
            <table className="table table-striped table-sm bg-white">
              <thead>
                <tr>
                  <SortHeader label="Code" sortKey="code" activeKey={chartSort.sortKey} dir={chartSort.sortDir} onSort={chartSort.onSort} />
                  <SortHeader label="Account" sortKey="account" activeKey={chartSort.sortKey} dir={chartSort.sortDir} onSort={chartSort.onSort} />
                  <SortHeader label="Type" sortKey="type" activeKey={chartSort.sortKey} dir={chartSort.sortDir} onSort={chartSort.onSort} />
                  <SortHeader label="Balance" sortKey="balance" activeKey={chartSort.sortKey} dir={chartSort.sortDir} onSort={chartSort.onSort} className="text-right" />
                </tr>
              </thead>
              <tbody>
                {sortedAccounts.map((a) => (
                  <tr key={a.code}>
                    <td>{a.code}</td>
                    <td>{a.name}</td>
                    <td>{a.type}</td>
                    <td className="text-right">{money(balances[a.code] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {bank && (
        <>
          <h4 className="h6 mt-3">Bank: ledger vs register (all years)</h4>
          <p className="text-muted small">
            The ledger bank is cumulative cash from all invoice records (2020–2026); the register holds only{' '}
            {bank.entry_count !== undefined ? bank.entry_count : entries.length} entries from 2026, and most client
            payments have no bank entry. The gap is documented, not forced equal. This comparison is all-years by
            nature — the ledger side is cumulative, not one year's flow.
          </p>
          <div className="table-responsive">
            <table className="table table-striped table-sm bg-white">
              <tbody>
                <tr><td>Ledger bank</td><td className="text-right">{money(bank.ledger_bank)}</td></tr>
                <tr><td>Bank register</td><td className="text-right">{money(bank.balance)}</td></tr>
                <tr><td>Deposits on record</td><td className="text-right">{money(bank.deposits)}</td></tr>
                <tr><td>Withdrawals on record</td><td className="text-right">{money(bank.withdrawals)}</td></tr>
                <tr><td><strong>Gap</strong></td><td className="text-right"><strong>{money(bank.gap_ledger_minus_register)}</strong></td></tr>
              </tbody>
            </table>
          </div>
          <h4 className="h6 mt-3">Bank register</h4>
          <p className="text-muted small">
            {bankShown.entries.length} entries &middot; Register balance{' '}
            {effectiveFy === 'all' ? '' : 'at the end of ' + effectiveFy + ' '}:{' '}
            {money(bankShown.balance)}
            {effectiveFy !== 'all' && (
              <> &middot; Deposits {money(bankShown.deposits)} &middot; Withdrawals {money(bankShown.withdrawals)}</>
            )}
          </p>
          {bankShown.entries.length ? (
          <div className="table-responsive">
            <table className="table table-striped table-sm bg-white">
              <thead>
                <tr>
                  <SortHeader label="Date" sortKey="date" activeKey={bankSort.sortKey} dir={bankSort.sortDir} onSort={bankSort.onSort} />
                  <SortHeader label="Direction" sortKey="direction" activeKey={bankSort.sortKey} dir={bankSort.sortDir} onSort={bankSort.onSort} />
                  <SortHeader label="Amount" sortKey="amount" activeKey={bankSort.sortKey} dir={bankSort.sortDir} onSort={bankSort.onSort} className="text-right" />
                  <SortHeader label="Reference" sortKey="reference" activeKey={bankSort.sortKey} dir={bankSort.sortDir} onSort={bankSort.onSort} />
                  <SortHeader label="Client" sortKey="client" activeKey={bankSort.sortKey} dir={bankSort.sortDir} onSort={bankSort.onSort} />
                </tr>
              </thead>
              <tbody>
                {sortedBankEntries.map((e, i) => (
                  <tr key={e.id || i}>
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
          ) : (
            <p className="text-muted">No bank entries in this fiscal year.</p>
          )}
        </>
      )}
      {invoices && (
        <>
          <h4 className="h6 mt-3">Profit and Loss</h4>
          {plShown.length ? (
            <div className="table-responsive">
              <table className="table table-striped table-sm bg-white">
                <thead>
                  <tr>
                    <SortHeader label="Fiscal year" sortKey="fy" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} />
                    <SortHeader label="Revenue" sortKey="revenue" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label="Rent" sortKey="rent" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label="Salaries" sortKey="salaries" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label="Hosting & domains" sortKey="hosting" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label="Suppliers" sortKey="suppliers" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label="Utilities" sortKey="utilities" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label="Total expenses" sortKey="expenses" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label="Net profit" sortKey="profit" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                  </tr>
                </thead>
                <tbody>
                  {sortedPl.map((r) => (
                    <tr key={r.fy}>
                      <td>{r.label}</td>
                      <td className="text-right">{money(r.revenue)}</td>
                      <td className="text-right">{money(r.rent)}</td>
                      <td className="text-right">{money(r.salaries)}</td>
                      <td className="text-right">{money(r.hosting)}</td>
                      <td className="text-right">{money(r.suppliers)}</td>
                      <td className="text-right">{money(r.utilities)}</td>
                      <td className="text-right">{money(r.expenses)}</td>
                      <td className="text-right">{money(r.profit)}</td>
                    </tr>
                  ))}
                  {effectiveFy === 'all' && (
                    <tr>
                      <td><strong>Total</strong></td>
                      <td className="text-right"><strong>{money(plTotal.revenue)}</strong></td>
                      <td className="text-right"><strong>{money(plTotal.rent)}</strong></td>
                      <td className="text-right"><strong>{money(plTotal.salaries)}</strong></td>
                      <td className="text-right"><strong>{money(plTotal.hosting)}</strong></td>
                      <td className="text-right"><strong>{money(plTotal.suppliers)}</strong></td>
                      <td className="text-right"><strong>{money(plTotal.utilities)}</strong></td>
                      <td className="text-right"><strong>{money(plTotal.expenses)}</strong></td>
                      <td className="text-right"><strong>{money(plTotal.profit)}</strong></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted">No invoices on record for {effectiveFy}.</p>
          )}
          <p className="text-muted small">
            Calculated from the invoice records, not from journal entries. Expenses are gross as recorded — supplier
            bills include input VAT (e.g. Bagmati 107,500 includes 12,367.27 VAT). FY 2080/81 has no salary or rent
            rows on record, so its profit is overstated; the same gap, smaller, in FY 2076/77 and FY 2081/82–2082/83,
            which have no salary rows. This is accrual-based (invoiced revenue vs incurred expenses), unlike the By
            fiscal year Profit column, which is cash-based (received − paid out).
          </p>
        </>
      )}
    </>
  );
}
