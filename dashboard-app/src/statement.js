/* Bank statement parsing — CSV text in, bank-entry rows out.
 *
 * Nepali bank statements (Nabil, Kumari) download as CSV with a
 * header row and separate Debit and Credit columns. A statement
 * debit is money out of the account — a Withdrawal in the
 * register; a credit is money in — a Deposit. The column mapping
 * is guessed from the headers and can be corrected in the form;
 * the preview shows exactly what will be imported before
 * anything is saved, and rows already in the register are left
 * out unless Bijaya ticks them back in. */

/** Split CSV text into rows of fields: quoted fields, escaped
 *  quotes (""), commas inside quotes, CRLF or LF line endings.
 *  Empty trailing lines are dropped. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((f) => String(f).trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((f) => String(f).trim() !== '')) rows.push(row);
  }
  return rows;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** An AD date in the shapes bank statements use — YYYY-MM-DD,
 *  DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD Mon YYYY — as
 *  'YYYY-MM-DD', or null when it is not a real date. Day first:
 *  05/06/2026 is 5 June, not 6 May. */
export function parseAdDate(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  let y; let m; let d;
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]);
  } else {
    const named = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{4})$/);
    if (named) {
      d = Number(named[1]);
      m = MONTHS[String(named[2]).slice(0, 3).toLowerCase()];
      y = Number(named[3]);
      if (!m) return null;
    } else {
      const parts = s.split(/[-/.]/);
      if (parts.length !== 3) return null;
      d = Number(parts[0]); m = Number(parts[1]); y = Number(parts[2]);
    }
  }
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** An amount: commas stripped, (1,000) reads as -1000. Returns a
 *  number, or null when there is no amount at all. */
export function parseAmount(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  let neg = false;
  let t = s.replace(/,/g, '').trim();
  if (t.startsWith('(') && t.endsWith(')')) { neg = true; t = t.slice(1, -1); }
  t = t.replace(/[^0-9.\-]/g, '');
  if (!t || t === '-' || t === '.') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

/** Guess which column is which from the header row. Returns
 *  { date, description, debit, credit } with column indexes or
 *  null. The transaction date wins over the value date — the
 *  value date can be a day later, and the register is dated by
 *  when the money moved. */
export function detectColumns(headers) {
  const lower = (headers || []).map((h) => String(h || '').trim().toLowerCase());
  const find = (test) => {
    const i = lower.findIndex((h) => test(h));
    return i === -1 ? null : i;
  };
  const date = find((h) => h.includes('txn') && h.includes('date'))
    ?? find((h) => h.includes('transaction') && h.includes('date'))
    ?? find((h) => h.includes('date'));
  const description = find((h) => h.includes('desc'))
    ?? find((h) => h.includes('remark'))
    ?? find((h) => h.includes('particular'))
    ?? find((h) => h.includes('narration'))
    ?? find((h) => h.includes('detail'));
  const debit = find((h) => h.includes('debit'))
    ?? find((h) => h === 'dr' || h.endsWith(' dr'));
  const credit = find((h) => h.includes('credit'))
    ?? find((h) => h === 'cr' || h.endsWith(' cr'));
  return { date, description, debit, credit };
}

/** Map parsed CSV rows to statement movements using the column
 *  mapping { date, description, debit, credit }. Returns
 *  { movements, skipped }: a movement is { date_ad,
 *  description, direction, amount_npr }; a skipped row carries
 *  its reason — no date, no amount, or both debit and credit
 *  (a statement row is one movement or the other). */
export function statementMovements(rows, mapping) {
  const movements = [];
  const skipped = [];
  (rows || []).forEach((row, i) => {
    const cell = (idx) => (idx === null || idx === undefined ? '' : String(row[idx] ?? '').trim());
    const dateAd = parseAdDate(cell(mapping.date));
    if (!dateAd) { skipped.push({ row: i, reason: 'no date' }); return; }
    const debit = parseAmount(cell(mapping.debit));
    const credit = parseAmount(cell(mapping.credit));
    const hasDebit = debit !== null && debit !== 0;
    const hasCredit = credit !== null && credit !== 0;
    if (hasDebit && hasCredit) { skipped.push({ row: i, reason: 'both debit and credit' }); return; }
    if (!hasDebit && !hasCredit) { skipped.push({ row: i, reason: 'no amount' }); return; }
    movements.push({
      date_ad: dateAd,
      description: cell(mapping.description),
      direction: hasDebit ? 'Withdrawal' : 'Deposit',
      amount_npr: Math.abs(hasDebit ? debit : credit),
    });
  });
  return { movements, skipped };
}

/** The dedupe key the import endpoint uses: bank, date,
 *  direction, amount and reference. Two rows match only when
 *  all five match, so the two 10,000 salary withdrawals on the
 *  1st of the month — different references — are two rows, not
 *  one. */
export function importEntryKey(bank, entry) {
  return [bank, entry.date_ad, entry.direction, String(entry.amount_npr), entry.reference || ''].join('|');
}

/** Movements into the payload POST /bank-entries/import takes:
 *  the statement's description is the reference, and the notes
 *  say the row came from a statement import. */
export function toImportEntries(movements, bank) {
  return (movements || []).map((m) => ({
    date_ad: m.date_ad,
    direction: m.direction,
    amount_npr: m.amount_npr,
    reference: (m.description || '').slice(0, 255) || null,
    notes: 'Imported from ' + bank + ' statement',
  }));
}
