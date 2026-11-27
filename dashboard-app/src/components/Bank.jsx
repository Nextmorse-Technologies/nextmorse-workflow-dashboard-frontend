import { useState } from 'react';
import { money } from '../api.js';
import { fyOfAd, fyOfBs } from '../dates.js';
import { SortHeader, useTableSort } from '../sort.js';

/* Fiscal year a bank entry belongs to — the starting BS year,
   from its BS date (AD as a fallback). */
export function bankEntryFy(entry) {
  if (!entry) return null;
  const fromBs = fyOfBs(entry.date_bs);
  if (fromBs) return fromBs;
  return fyOfAd(entry.date_ad);
}

function signedAmount(e) {
  const amount = Number(e.amount_npr) || 0;
  return e.direction === 'Withdrawal' ? -amount : amount;
}

/* The register for the picked year: that year's entries, its
   deposits and withdrawals, and the balance at the end of the
   year — the signed sum of every entry up to and including that
   year. 'all' is the whole register and the current balance. */
export function bankForFy(entries, fy) {
  const list = entries || [];
  const sum = (rows, dir) => rows
    .filter((e) => e.direction === dir)
    .reduce((s, e) => s + (Number(e.amount_npr) || 0), 0);
  if (!fy || fy === 'all') {
    const deposits = sum(list, 'Deposit');
    const withdrawals = sum(list, 'Withdrawal');
    return {
      entries: list,
      deposits,
      withdrawals,
      net: deposits - withdrawals,
      balance: list.reduce((s, e) => s + signedAmount(e), 0),
    };
  }
  const fyStart = parseInt(String(fy).split('/')[0], 10);
  const inYear = list.filter((e) => bankEntryFy(e) === fyStart);
  const throughYear = list.filter((e) => {
    const y = bankEntryFy(e);
    return y !== null && y <= fyStart;
  });
  const deposits = sum(inYear, 'Deposit');
  const withdrawals = sum(inYear, 'Withdrawal');
  return {
    entries: inYear,
    deposits,
    withdrawals,
    net: deposits - withdrawals,
    balance: throughYear.reduce((s, e) => s + signedAmount(e), 0),
  };
}

export default function Bank({ data, fy }) {
  /* One sort state for the register; it starts in its original
     order. The table sorts only the entries actually shown, after
     the fiscal-year filter. */
  const sort = useTableSort(null);
  if (!data) return null;
  /* The fiscal year comes from the shared picker in the tab bar
     (App); this tab only filters on it. */
  const effectiveFy = fy || 'all';
  const { entries, deposits, withdrawals, net, balance } = bankForFy(data.entries, effectiveFy);
  const sortedEntries = sort.apply(entries, (e, key) => {
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
      <h3 className="h5">
        Bank register{' '}
        <span className="badge badge-secondary">{money(balance)}</span>
      </h3>
      <p className="text-muted small">
        {effectiveFy === 'all'
          ? 'Showing all years — balance is the current register balance.'
          : 'Showing ' + effectiveFy + ' — balance is the register balance at the end of ' + effectiveFy + '.'}
        {' '}Deposits {money(deposits)} &middot; Withdrawals {money(withdrawals)} &middot; Net {money(net)} &middot;{' '}
        {entries.length} entries
      </p>
      {entries.length ? (
        <div className="table-responsive">
          <table className="table table-striped table-sm bg-white">
            <thead>
              <tr>
                <SortHeader label="Date" sortKey="date" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                <SortHeader label="Direction" sortKey="direction" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                <SortHeader label="Amount" sortKey="amount" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} className="text-right" />
                <SortHeader label="Reference" sortKey="reference" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                <SortHeader label="Client" sortKey="client" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((e, i) => (
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
  );
}
