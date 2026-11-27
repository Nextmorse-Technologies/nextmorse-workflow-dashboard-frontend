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
   so a one-year comparison against it would not balance. */
export default function Ledger({ api, fy, refreshKey, initialTrial, initialAccounts, initialBalances, initialBank }) {
  const [trial, setTrial] = useState(initialTrial || null);
  const [accounts, setAccounts] = useState(initialAccounts || null);
  const [balances, setBalances] = useState(initialBalances || null);
  const [bank, setBank] = useState(initialBank || null);
  const [loading, setLoading] = useState(!initialTrial || !initialAccounts || !initialBalances || !initialBank);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (initialTrial && initialAccounts && initialBalances && initialBank) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const fyParam = 'fiscal_year=' + encodeURIComponent(fy || 'all');
        const [t, a, b, k] = await Promise.all([
          api('/ledger/trial-balance?' + fyParam),
          api('/ledger/accounts?per_page=200'),
          api('/ledger/balances?' + fyParam),
          api('/bank'),
        ]);
        if (cancelled) return;
        setTrial((t && t.data) || null);
        setAccounts((a && a.data) || []);
        setBalances((b && b.data) || {});
        setBank(k || null);
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
    </>
  );
}
