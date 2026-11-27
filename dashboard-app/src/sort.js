import { createElement, useState } from 'react';
import { parseBs } from './dates.js';

/* Shared, data-driven table sorting — one module every tab uses.
   The sort works on whatever rows are actually shown (after the
   shared fiscal-year filter), by any column: text, numbers,
   amounts and dates are all compared by their value, not by a
   hardcoded column list. Bijaya (27 Nov 2026): "so that whatever
   is the data we can sort". A table with no sort picked shows its
   rows in the order they arrived — the default order never
   changes unless the user clicks a heading. */

/* A comparable value for one cell. Empty (null, undefined, blank
   or '—') is null and always sorts last, in either direction.
   Pure numbers compare numerically ('011' is 11, so 002 comes
   before 010). ISO dates (2026-11-23), written AD dates
   (23 Nov 2026) and BS dates in any of the three API shapes all
   compare as dates. Anything else compares as text,
   case-insensitive. */
export function sortValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? { kind: 'number', value } : null;
  const s = String(value).trim();
  if (s === '' || s === '—') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return { kind: 'number', value: Number(s) };
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return { kind: 'date', value: +iso[1] * 10000 + +iso[2] * 100 + +iso[3] };
  const adMonths = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const ad = /^(\d{1,2}) ([A-Za-z]+) (\d{4})/.exec(s);
  if (ad) {
    const mo = adMonths.indexOf(ad[2].slice(0, 3).toLowerCase()) + 1;
    if (mo) return { kind: 'date', value: +ad[3] * 10000 + mo * 100 + +ad[1] };
  }
  const bs = parseBs(s);
  if (bs) return { kind: 'date', value: bs.y * 10000 + bs.mo * 100 + bs.d };
  return { kind: 'text', value: s.toLowerCase() };
}

/* Compare two non-empty comparable values. Numbers and dates
   compare numerically; text compares alphabetically. Mixed kinds
   order numbers, then dates, then text — deterministic, and a
   column's values are homogeneous in practice. */
export function compareValues(a, b) {
  const order = { number: 0, date: 1, text: 2 };
  if (a.kind !== b.kind) return order[a.kind] - order[b.kind];
  if (a.kind === 'number' || a.kind === 'date') return a.value - b.value;
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}

/* Sort rows by a column key. valueOf(row, key) returns the raw
   cell value; when omitted it reads row[key]. key null (no sort
   picked) returns the rows untouched, in their original order.
   dir is 'asc' or 'desc'. Empty values always sort last, in
   either direction. Ties keep their original order, so a sort
   never disturbs rows that compare equal. */
export function sortRows(rows, key, dir, valueOf) {
  const list = rows || [];
  if (!key) return list;
  const get = typeof valueOf === 'function' ? valueOf : (row) => row[key];
  const d = dir === 'desc' ? -1 : 1;
  return list
    .map((row, i) => ({ row, i, v: sortValue(get(row, key)) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const c = compareValues(a.v, b.v);
      if (c) return c * d;
      return a.i - b.i;
    })
    .map((x) => x.row);
}

/* The next sort state for a heading click: clicking the active
   column flips its direction; clicking another column sorts it
   ascending. */
export function nextSort(currentKey, currentDir, key) {
  if (key === currentKey) return { key, dir: currentDir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

/* One table's sort state. defaultKey null means no sort picked —
   the table shows its rows in the order they arrived. apply(rows,
   valueOf) returns the rows sorted by the current state, or
   untouched when no sort is picked. */
export function useTableSort(defaultKey, defaultDir) {
  const [sortKey, setSortKey] = useState(defaultKey || null);
  const [sortDir, setSortDir] = useState(defaultDir || 'asc');
  const onSort = (key) => {
    const next = nextSort(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };
  const apply = (rows, valueOf) => sortRows(rows, sortKey, sortDir, valueOf);
  return { sortKey, sortDir, onSort, apply };
}

/* A table heading that is also a sort button. When onSort is
   passed the label is a small button: it shows an up arrow on the
   active column sorted ascending, a down arrow when descending,
   and sorts that column when clicked. Without onSort it renders
   a plain heading, as before. Written with createElement (no JSX)
   so this module stays a plain .js file — Vite cannot parse JSX
   in a .js file. */
export function SortHeader({ label, sortKey, activeKey, dir, onSort, className }) {
  const active = !!onSort && activeKey === sortKey;
  if (!onSort) return createElement('th', { className }, label);
  return createElement(
    'th',
    { className, 'aria-sort': active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none' },
    createElement(
      'button',
      { type: 'button', className: 'btn btn-link btn-sm p-0', onClick: () => onSort(sortKey) },
      label + (active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''),
    ),
  );
}

/* Compare two invoices by invoice number: fiscal year first, then
   the number ascending (numeric, so 002 comes before 010). Rows
   with no number sort last. */
export function compareInvoiceNumber(a, b) {
  const fyA = a.fiscal_year || '';
  const fyB = b.fiscal_year || '';
  if (fyA !== fyB) return fyA < fyB ? -1 : 1;
  const nA = a.invoice_number;
  const nB = b.invoice_number;
  if (nA == null || nA === '') return 1;
  if (nB == null || nB === '') return -1;
  const num = Number(nA) - Number(nB);
  if (num) return num;
  return String(nA) < String(nB) ? -1 : 1;
}

/* Sort invoices by a column: 'number' (fiscal year then number
   ascending), 'client', 'service', 'amount', 'status' or
   'issued'. dir is 'asc' or 'desc'. Built on the generic sort so
   every table shares the same behaviour; the number key carries
   the fiscal year in the value so numbers repeat correctly
   across years. */
export function sortInvoices(rows, key, dir) {
  const valueOf = (inv, k) => {
    switch (k) {
      case 'client': return inv.client_name || '';
      case 'service': return inv.service || '';
      case 'amount': return inv.amount_npr;
      case 'status': return inv.status || '';
      case 'issued': return inv.date_ad || '';
      case 'paid': return inv.paid_date_ad || inv.date_ad || '';
      default: {
        const n = inv.invoice_number;
        if (n == null || n === '') return null;
        const fy = parseInt(String(inv.fiscal_year || '').split('/')[0], 10);
        return (Number.isFinite(fy) ? fy : 0) * 1000000 + Number(n);
      }
    }
  };
  return sortRows(rows, key, dir, valueOf);
}
