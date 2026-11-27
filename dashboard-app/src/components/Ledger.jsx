import { Fragment, useEffect, useState } from 'react';
import { friendlyError } from '../api.js';
import { useLocale } from '../i18n.js';
import { dateLabel } from '../dates.js';
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

/* The six Profit and Loss buckets, in table order, with the rule
   each one follows — shown in the expandable detail so Bijaya can
   see what is included in each number. */
export const PL_BUCKETS = [
  { key: 'revenue', title: 'Revenue', hint: 'Sent invoices only, net of VAT (subtotal where set, else amount − VAT)' },
  { key: 'rent', title: 'Rent', hint: 'paid_rent rows, gross amount as recorded' },
  { key: 'salaries', title: 'Salaries', hint: 'paid_salary rows, gross amount as recorded' },
  { key: 'hosting', title: 'Hosting & domains', hint: 'paid_babal rows, gross amount as recorded' },
  { key: 'suppliers', title: 'Suppliers', hint: 'paid_supplier rows, gross amount as recorded' },
  { key: 'utilities', title: 'Utilities', hint: 'paid_utility rows, gross amount as recorded' },
];

/* Why a row is counted in NEITHER revenue nor expenses. */
export function excludedReason(kind) {
  switch (kind) {
    case 'mou_receivable': return 'MOU — not an invoice, not counted as revenue';
    case 'paid_receipt': return 'Payment receipt — not counted as an expense';
    case 'received': return 'Vendor bill received — not counted as revenue or expense';
    default: return 'Not counted in profit and loss';
  }
}

function emptyPlGroup(fy) {
  const g = { fy, label: fy ? 'FY ' + fy : 'No fiscal year' };
  for (const b of PL_BUCKETS) g[b.key] = { total: 0, items: [] };
  g.excluded = { total: 0, items: [] };
  g.expenses = 0;
  g.profit = 0;
  return g;
}

function finalizePlGroup(g) {
  for (const b of PL_BUCKETS) {
    g[b.key].total = round2(g[b.key].items.reduce((t, it) => t + it.amount, 0));
  }
  g.excluded.total = round2(g.excluded.items.reduce((t, it) => t + it.amount, 0));
  g.expenses = round2(g.rent.total + g.salaries.total + g.hosting.total + g.suppliers.total + g.utilities.total);
  g.profit = round2(g.revenue.total - g.expenses);
  return g;
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
   paid_supplier → suppliers, paid_utility → utilities. One group
   per fiscal year present in the invoices; a year with no sent
   invoices still shows (revenue 0) when it has expense rows.
   Rows that belong to a year but fit neither revenue nor any
   expense bucket land in `excluded` with the reason, so every
   row is accounted for. Rows with no fiscal_year at all go in a
   'No fiscal year' group (fy null), only when any exist — the
   P&L summary skips them, but the detail shows them. */
export function profitAndLossDetail(invoices) {
  const byFy = {};
  const noFy = emptyPlGroup(null);
  let hasNoFy = false;
  for (const inv of invoices || []) {
    const fy = inv.fiscal_year;
    const group = fy ? (byFy[fy] || (byFy[fy] = emptyPlGroup(fy))) : noFy;
    if (!fy) hasNoFy = true;
    const item = {
      id: inv.id,
      name: inv.client_name || '—',
      service: inv.service || '—',
      date_ad: inv.date_ad,
      date_bs: inv.date_bs,
      amount: 0,
    };
    if (!fy) {
      item.amount = Number(inv.amount_npr) || 0;
      item.reason = 'No fiscal year on the record — not counted in any year';
      group.excluded.items.push(item);
      continue;
    }
    if (inv.kind === 'sent') {
      item.amount = inv.subtotal_npr != null
        ? Number(inv.subtotal_npr)
        : (Number(inv.amount_npr) || 0) - (Number(inv.vat_npr) || 0);
      group.revenue.items.push(item);
    } else {
      const field = EXPENSE_KIND[inv.kind];
      if (field) {
        item.amount = Number(inv.amount_npr) || 0;
        group[field].items.push(item);
      } else {
        item.amount = Number(inv.amount_npr) || 0;
        item.reason = excludedReason(inv.kind);
        group.excluded.items.push(item);
      }
    }
  }
  const groups = Object.values(byFy)
    .sort((a, b) => (a.fy < b.fy ? -1 : a.fy > b.fy ? 1 : 0))
    .map(finalizePlGroup);
  if (hasNoFy) groups.push(finalizePlGroup(noFy));
  return groups;
}

/* The summary rows the table shows. Derived from
   profitAndLossDetail so the figures always agree with the
   expandable detail, by construction — the detail is the
   calculation, this is only its sums. */
export function profitAndLoss(invoices) {
  return profitAndLossDetail(invoices)
    .filter((g) => g.fy)
    .map((g) => ({
      fy: g.fy,
      label: g.label,
      revenue: g.revenue.total,
      rent: g.rent.total,
      salaries: g.salaries.total,
      hosting: g.hosting.total,
      suppliers: g.suppliers.total,
      utilities: g.utilities.total,
      expenses: g.expenses,
      profit: g.profit,
    }));
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

/* One fiscal year's full calculation, shown when its row is
   expanded: every item behind each bucket, with the bucket
   subtotal, plus the rows counted in neither — with the reason.
   Computed on the fly, in memory, from the same invoice list the
   table is built from (Bijaya, 27 Nov 2026: paid and issued
   invoices are the single source of truth — nothing is stored).
   Pass showProfit={false} for the 'No fiscal year' group, which
   has no profit figure. */
function PlDetail({ group, showProfit = true }) {
  const { t, money, digits } = useLocale();
  return (
    <div className="pl-detail text-left">
      {PL_BUCKETS.map((b) => {
        const bucket = group[b.key];
        return (
          <div key={b.key} className="mb-3">
            <p className="mb-1">
              <strong>{t(b.title)}</strong> — {money(bucket.total)} ({t(bucket.items.length === 1 ? '{n} item' : '{n} items', { n: digits(bucket.items.length) })})
              {' '}<span className="text-muted small">{t(b.hint)}</span>
            </p>
            {bucket.items.length ? (
              <table className="table table-sm mb-1 bg-white">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>{t('Client / Supplier')}</th>
                    <th>{t('Service')}</th>
                    <th>{t('Date')}</th>
                    <th className="text-right">{b.key === 'revenue' ? t('Revenue') : t('Amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {bucket.items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.id}</td>
                      <td>{it.name}</td>
                      <td>{it.service}</td>
                      <td>{dateLabel(it.date_ad, it.date_bs)}</td>
                      <td className="text-right">{money(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}><strong>{t('Subtotal')}</strong></td>
                    <td className="text-right"><strong>{money(bucket.total)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <p className="text-muted small mb-1">{t('No items in this year — 0.00.')}</p>
            )}
          </div>
        );
      })}
      <div className="mb-1">
        <p className="mb-1">
          <strong>{t('Not counted')}</strong> — {money(group.excluded.total)} ({t(group.excluded.items.length === 1 ? '{n} item' : '{n} items', { n: digits(group.excluded.items.length) })})
          {' '}<span className="text-muted small">{t('Rows in this year counted in neither revenue nor expenses.')}</span>
        </p>
        {group.excluded.items.length ? (
          <table className="table table-sm mb-1 bg-white">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t('Client / Supplier')}</th>
                <th>{t('Service')}</th>
                <th>{t('Date')}</th>
                <th className="text-right">{t('Amount')}</th>
                <th>{t('Reason')}</th>
              </tr>
            </thead>
            <tbody>
              {group.excluded.items.map((it) => (
                <tr key={it.id}>
                  <td>{it.id}</td>
                  <td>{it.name}</td>
                  <td>{it.service}</td>
                  <td>{dateLabel(it.date_ad, it.date_bs)}</td>
                  <td className="text-right">{money(it.amount)}</td>
                  <td>{t(it.reason)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}><strong>{t('Subtotal (not counted)')}</strong></td>
                <td className="text-right"><strong>{money(group.excluded.total)}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <p className="text-muted small mb-1">{t('Nothing excluded — every row in this year is counted.')}</p>
        )}
      </div>
      {showProfit && (
        <p className="text-muted small mb-0">
          {t('Net profit = Revenue {rev} − Total expenses {exp} = {profit}.', { rev: money(group.revenue.total), exp: money(group.expenses), profit: money(group.profit) })}
        </p>
      )}
    </div>
  );
}

export default function Ledger({ api, fy, refreshKey, initialTrial, initialAccounts, initialBalances, initialBank, initialInvoices, initialPlExpanded }) {
  const { t, money, digits } = useLocale();
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
  /* The expandable detail: the item lists behind each number,
     computed on the fly from the same fetched invoices — nothing
     stored, nothing snapshotted. Sorting stays on the summary
     rows only; a detail row always follows its own summary row.
     `initialPlExpanded` exists for the smoke tests (like the
     other initial* props); in the app every row starts closed. */
  const [plExpanded, setPlExpanded] = useState(initialPlExpanded || {});
  const togglePl = (key) => setPlExpanded((s) => ({ ...s, [key]: !s[key] }));
  const plDetail = profitAndLossDetail(invoices || []);
  const plDetailByFy = {};
  for (const g of plDetail) if (g.fy) plDetailByFy[g.fy] = g;
  const plNoFy = plDetail.find((g) => !g.fy) || null;
  /* The Total row's detail: all years' items merged. Its bucket
     totals are the Total row's figures, so the expansion agrees
     with the row above it by construction. */
  const plAllDetail = { fy: 'all', label: 'All years', expenses: plTotal.expenses, profit: plTotal.profit };
  for (const b of PL_BUCKETS) {
    plAllDetail[b.key] = { total: plTotal[b.key], items: [] };
  }
  plAllDetail.excluded = { total: 0, items: [] };
  for (const g of plDetail) {
    if (!g.fy) continue;
    for (const b of PL_BUCKETS) plAllDetail[b.key].items.push(...g[b.key].items);
    plAllDetail.excluded.items.push(...g.excluded.items);
  }
  plAllDetail.excluded.total = round2(plAllDetail.excluded.items.reduce((t, it) => t + it.amount, 0));

  return (
    <>
      <h3 className="h5">{t('Ledger')}</h3>
      <p className="mb-2 text-muted">{t('Double-entry, integer paisa, Dr = Cr — NFRS.')}</p>
      <p className="mb-2 text-muted">
        {effectiveFy === 'all'
          ? t('Showing all years.')
          : t('Showing {fy} — money and government figures follow this fiscal year.', { fy: digits(effectiveFy) })}
      </p>
      {loading && <p className="text-muted">{t('Loading ledger…')}</p>}
      {loadError && <div className="alert alert-danger" role="alert">{loadError}</div>}
      {trial && (
        <>
          <h4 className="h6 mt-3">
            {t('Trial balance')}{' '}
            <span className={'badge ' + (trial.balanced ? 'badge-success' : 'badge-danger')}>
              {trial.balanced ? t('Balanced') : t('NOT balanced')}
            </span>
          </h4>
          <div className="table-responsive">
            <table className="table table-striped table-sm bg-white">
              <thead>
                <tr>
                  <SortHeader label={t('Code')} sortKey="code" activeKey={trialSort.sortKey} dir={trialSort.sortDir} onSort={trialSort.onSort} />
                  <SortHeader label={t('Account')} sortKey="account" activeKey={trialSort.sortKey} dir={trialSort.sortDir} onSort={trialSort.onSort} />
                  <SortHeader label={t('Debit')} sortKey="debit" activeKey={trialSort.sortKey} dir={trialSort.sortDir} onSort={trialSort.onSort} className="text-right" />
                  <SortHeader label={t('Credit')} sortKey="credit" activeKey={trialSort.sortKey} dir={trialSort.sortDir} onSort={trialSort.onSort} className="text-right" />
                  <SortHeader label={t('Net')} sortKey="net" activeKey={trialSort.sortKey} dir={trialSort.sortDir} onSort={trialSort.onSort} className="text-right" />
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
                  <td><strong>{t('Total')}</strong></td>
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
          <h4 className="h6 mt-3">{t('Chart of accounts')}</h4>
          <div className="table-responsive">
            <table className="table table-striped table-sm bg-white">
              <thead>
                <tr>
                  <SortHeader label={t('Code')} sortKey="code" activeKey={chartSort.sortKey} dir={chartSort.sortDir} onSort={chartSort.onSort} />
                  <SortHeader label={t('Account')} sortKey="account" activeKey={chartSort.sortKey} dir={chartSort.sortDir} onSort={chartSort.onSort} />
                  <SortHeader label={t('Type')} sortKey="type" activeKey={chartSort.sortKey} dir={chartSort.sortDir} onSort={chartSort.onSort} />
                  <SortHeader label={t('Balance')} sortKey="balance" activeKey={chartSort.sortKey} dir={chartSort.sortDir} onSort={chartSort.onSort} className="text-right" />
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
          <h4 className="h6 mt-3">{t('Bank: ledger vs register (all years)')}</h4>
          <p className="text-muted small">
            {t('The ledger bank is cumulative cash from all invoice records (2020–2026); the register holds only {n} entries from 2026, and most client payments have no bank entry. The gap is documented, not forced equal. This comparison is all-years by nature — the ledger side is cumulative, not one year\'s flow.', { n: digits(bank.entry_count !== undefined ? bank.entry_count : entries.length) })}
          </p>
          <div className="table-responsive">
            <table className="table table-striped table-sm bg-white">
              <tbody>
                <tr><td>{t('Ledger bank')}</td><td className="text-right">{money(bank.ledger_bank)}</td></tr>
                <tr><td>{t('Bank register')}</td><td className="text-right">{money(bank.balance)}</td></tr>
                <tr><td>{t('Deposits on record')}</td><td className="text-right">{money(bank.deposits)}</td></tr>
                <tr><td>{t('Withdrawals on record')}</td><td className="text-right">{money(bank.withdrawals)}</td></tr>
                <tr><td><strong>{t('Gap')}</strong></td><td className="text-right"><strong>{money(bank.gap_ledger_minus_register)}</strong></td></tr>
              </tbody>
            </table>
          </div>
          <h4 className="h6 mt-3">{t('Bank register')}</h4>
          <p className="text-muted small">
            {t('{n} entries', { n: digits(bankShown.entries.length) })} &middot; {t('Register balance')}{' '}
            {effectiveFy === 'all' ? '' : t('at the end of {fy}', { fy: digits(effectiveFy) }) + ' '}:{' '}
            {money(bankShown.balance)}
            {effectiveFy !== 'all' && (
              <> &middot; {t('Deposits')} {money(bankShown.deposits)} &middot; {t('Withdrawals')} {money(bankShown.withdrawals)}</>
            )}
          </p>
          {bankShown.entries.length ? (
          <div className="table-responsive">
            <table className="table table-striped table-sm bg-white">
              <thead>
                <tr>
                  <SortHeader label={t('Date')} sortKey="date" activeKey={bankSort.sortKey} dir={bankSort.sortDir} onSort={bankSort.onSort} />
                  <SortHeader label={t('Direction')} sortKey="direction" activeKey={bankSort.sortKey} dir={bankSort.sortDir} onSort={bankSort.onSort} />
                  <SortHeader label={t('Amount')} sortKey="amount" activeKey={bankSort.sortKey} dir={bankSort.sortDir} onSort={bankSort.onSort} className="text-right" />
                  <SortHeader label={t('Reference')} sortKey="reference" activeKey={bankSort.sortKey} dir={bankSort.sortDir} onSort={bankSort.onSort} />
                  <SortHeader label={t('Client')} sortKey="client" activeKey={bankSort.sortKey} dir={bankSort.sortDir} onSort={bankSort.onSort} />
                </tr>
              </thead>
              <tbody>
                {sortedBankEntries.map((e, i) => (
                  <tr key={e.id || i}>
                    <td>{e.date}</td>
                    <td>{t(e.direction)}</td>
                    <td className="text-right">{money(e.amount_npr)}</td>
                    <td>{e.reference || '—'}</td>
                    <td>{e.client === 'unknown' ? '—' : e.client}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          ) : (
            <p className="text-muted">{t('No bank entries in this fiscal year.')}</p>
          )}
        </>
      )}
      {invoices && (
        <>
          <h4 className="h6 mt-3">{t('Profit and Loss')}</h4>
          {plShown.length ? (
            <div className="table-responsive">
              <table className="table table-striped table-sm bg-white">
                <thead>
                  <tr>
                    <SortHeader label={t('Fiscal year')} sortKey="fy" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} />
                    <SortHeader label={t('Revenue')} sortKey="revenue" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label={t('Rent')} sortKey="rent" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label={t('Salaries')} sortKey="salaries" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label={t('Hosting & domains')} sortKey="hosting" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label={t('Suppliers')} sortKey="suppliers" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label={t('Utilities')} sortKey="utilities" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label={t('Total expenses')} sortKey="expenses" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                    <SortHeader label={t('Net profit')} sortKey="profit" activeKey={plSort.sortKey} dir={plSort.sortDir} onSort={plSort.onSort} className="text-right" />
                  </tr>
                </thead>
                <tbody>
                  {sortedPl.map((r) => (
                    <Fragment key={r.fy}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 mr-1"
                            onClick={() => togglePl(r.fy)}
                            aria-expanded={!!plExpanded[r.fy]}
                            aria-label={plExpanded[r.fy] ? t('Hide calculation for {fy}', { fy: digits(r.fy) }) : t('Show calculation for {fy}', { fy: digits(r.fy) })}
                          >
                            {plExpanded[r.fy] ? '▾' : '▸'}
                          </button>
                          {' '}{r.fy ? t('FY') + ' ' + digits(r.fy) : t('No fiscal year')}
                        </td>
                        <td className="text-right">{money(r.revenue)}</td>
                        <td className="text-right">{money(r.rent)}</td>
                        <td className="text-right">{money(r.salaries)}</td>
                        <td className="text-right">{money(r.hosting)}</td>
                        <td className="text-right">{money(r.suppliers)}</td>
                        <td className="text-right">{money(r.utilities)}</td>
                        <td className="text-right">{money(r.expenses)}</td>
                        <td className="text-right">{money(r.profit)}</td>
                      </tr>
                      {plExpanded[r.fy] && plDetailByFy[r.fy] && (
                        <tr>
                          <td colSpan={9}>
                            <PlDetail group={plDetailByFy[r.fy]} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {effectiveFy === 'all' && (
                    <Fragment>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 mr-1"
                            onClick={() => togglePl('all')}
                            aria-expanded={!!plExpanded.all}
                            aria-label={plExpanded.all ? t('Hide calculation for all years') : t('Show calculation for all years')}
                          >
                            {plExpanded.all ? '▾' : '▸'}
                          </button>
                          {' '}<strong>{t('Total')}</strong>
                        </td>
                        <td className="text-right"><strong>{money(plTotal.revenue)}</strong></td>
                        <td className="text-right"><strong>{money(plTotal.rent)}</strong></td>
                        <td className="text-right"><strong>{money(plTotal.salaries)}</strong></td>
                        <td className="text-right"><strong>{money(plTotal.hosting)}</strong></td>
                        <td className="text-right"><strong>{money(plTotal.suppliers)}</strong></td>
                        <td className="text-right"><strong>{money(plTotal.utilities)}</strong></td>
                        <td className="text-right"><strong>{money(plTotal.expenses)}</strong></td>
                        <td className="text-right"><strong>{money(plTotal.profit)}</strong></td>
                      </tr>
                      {plExpanded.all && (
                        <tr>
                          <td colSpan={9}>
                            <PlDetail group={plAllDetail} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted">{t('No invoices on record for {fy}.', { fy: digits(effectiveFy) })}</p>
          )}
          {plNoFy && (
            <>
              <h4 className="h6 mt-3">{t('Invoices with no fiscal year — not counted in any year')}</h4>
              <PlDetail group={plNoFy} showProfit={false} />
            </>
          )}
          <p className="text-muted small">
            {t('Calculated from the invoice records, not from journal entries. Expenses are gross as recorded — supplier bills include input VAT (e.g. Bagmati 107,500 includes 12,367.27 VAT). FY 2080/81 has no rent rows on record, so its profit is overstated by the rent; the same gap, smaller, in FY 2076/77 and FY 2081/82–2082/83, which have no salary rows. This is accrual-based (invoiced revenue vs incurred expenses), unlike the By fiscal year Profit column, which is cash-based (received − paid out).')}
          </p>
        </>
      )}
    </>
  );
}
