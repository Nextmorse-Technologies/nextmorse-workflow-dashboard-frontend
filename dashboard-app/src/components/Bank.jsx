import { useState } from 'react';
import { fetchAllPages } from '../api.js';
import { useLocale } from '../i18n.js';
import { fyOfAd, fyOfBs } from '../dates.js';
import { SortHeader, useTableSort } from '../sort.js';
import {
  parseCsv,
  detectColumns,
  statementMovements,
  importEntryKey,
  toImportEntries,
} from '../statement.js';

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

/* Import a bank statement (CSV) into the register.
 *
 * The register only holds the movements Bijaya recorded by hand
 * — 14 rows, and only 58,000 of 1,208,000 salary and 26,405 of
 * 996,600 rent. A statement fills the gaps the bank assumption
 * papered over, instead of relying on it.
 *
 * Nothing is saved until the preview is confirmed: the file is
 * parsed in the browser, the columns are guessed from the
 * headers and can be corrected, and every row is shown with
 * whether it is already in the register. Rows already there are
 * left out unless Bijaya ticks one back in — the same rule the
 * API applies, so the preview and the import agree. */
function StatementImport({ api, onImported }) {
  const { t, money, digits } = useLocale();
  const [open, setOpen] = useState(false);
  const [bank, setBank] = useState('Nabil Bank');
  const [bankOther, setBankOther] = useState('');
  const [text, setText] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [headers, setHeaders] = useState(null);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({ date: null, description: null, debit: null, credit: null });
  const [movements, setMovements] = useState([]);
  const [skipped, setSkipped] = useState([]);
  const [registerKeys, setRegisterKeys] = useState(null);
  const [selected, setSelected] = useState({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const effectiveBank = bank === 'Other' ? bankOther.trim() : bank;

  async function loadRegisterKeys() {
    if (!api) return;
    try {
      const entries = await fetchAllPages(api, '/bank-entries');
      const keys = new Set((entries || []).map((e) => importEntryKey(e.bank, e)));
      setRegisterKeys(keys);
    } catch (err) {
      /* The preview still works without the register check —
         the API skips exact duplicates itself. */
      setRegisterKeys(new Set());
    }
  }

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && registerKeys === null) loadRegisterKeys();
  }

  function applyParsed(allRows, headerRow, map) {
    const body = headerRow ? allRows.slice(1) : allRows;
    const found = statementMovements(body, map);
    setRows(body);
    setHeaders(headerRow);
    setMapping(map);
    setMovements(found.movements);
    setSkipped(found.skipped);
    const entries = toImportEntries(found.movements, effectiveBank);
    const nextSelected = {};
    found.movements.forEach((m, i) => {
      nextSelected[i] = registerKeys ? !registerKeys.has(importEntryKey(effectiveBank, entries[i])) : true;
    });
    setSelected(nextSelected);
    setResult('');
    setError('');
  }

  function parseText(nextText, headerFlag) {
    setText(nextText);
    const allRows = parseCsv(nextText);
    if (!allRows.length) {
      setRows([]); setHeaders(null); setMovements([]); setSkipped([]); setSelected({});
      return;
    }
    const headerRow = headerFlag ? allRows[0] : null;
    const map = headerRow
      ? detectColumns(headerRow)
      : { date: 0, description: 1, debit: 2, credit: 3 };
    applyParsed(allRows, headerRow, map);
  }

  function changeMapping(field, value) {
    const map = { ...mapping, [field]: value === '' ? null : Number(value) };
    applyParsed(headers ? [headers, ...rows] : rows, headers, map);
  }

  function columnLabel(i) {
    if (headers && headers[i] !== undefined) return headers[i] || ('Column ' + (i + 1));
    return 'Column ' + (i + 1);
  }

  const columnCount = headers ? headers.length : (rows[0] ? rows[0].length : 0);
  const entries = toImportEntries(movements, effectiveBank);
  const checkedCount = movements.filter((m, i) => selected[i]).length;
  const duplicateCount = movements.filter((m, i) => !selected[i]).length;

  async function submitImport() {
    if (!api || !effectiveBank || !checkedCount || importing) return;
    setImporting(true);
    setError('');
    setResult('');
    try {
      const chosen = entries.filter((e, i) => selected[i]);
      const resp = await api('/bank-entries/import', {
        method: 'POST',
        body: { bank: effectiveBank, entries: chosen },
      });
      const d = (resp && resp.data) || {};
      setResult(
        t('Imported {n} entries into the register', { n: digits(d.created ?? 0) })
        + ((d.skipped ?? 0) > 0 ? t(' — {n} skipped as already in the register.', { n: digits(d.skipped) }) : '.'),
      );
      setText('');
      setRows([]); setHeaders(null); setMovements([]); setSkipped([]); setSelected({});
      await loadRegisterKeys();
      if (onImported) onImported();
    } catch (err) {
      setError((err && err.message) || t('The import did not go through.'));
    } finally {
      setImporting(false);
    }
  }

  const columnLabels = {
    date: t('Date column'),
    description: t('Description column'),
    debit: t('Debit column'),
    credit: t('Credit column'),
  };

  return (
    <div className="card mt-4">
      <div className="card-body">
        <h4 className="h6 mb-1">{t('Import a bank statement')}</h4>
        <p className="text-muted small mb-2">
          {t('Download the statement as CSV from your bank — it needs Date, Description, Debit and Credit columns. Nothing is saved until you confirm the preview below.')}
        </p>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={toggleOpen}>
          {open ? t('Close the import') : t('Import a statement (CSV)')}
        </button>
        {open && (
          <div className="mt-3">
            <div className="row g-2 mb-2">
              <div className="col-md-4">
                <label className="form-label small">{t('Bank')}</label>
                <select className="form-select form-select-sm" value={bank} onChange={(e) => setBank(e.target.value)}>
                  <option>Nabil Bank</option>
                  <option>Kumari Bank</option>
                  <option value="Other">{t('Other')}</option>
                </select>
                {bank === 'Other' && (
                  <input
                    className="form-control form-control-sm mt-1"
                    placeholder={t('Bank name')}
                    value={bankOther}
                    onChange={(e) => setBankOther(e.target.value)}
                  />
                )}
              </div>
              <div className="col-md-8">
                <label className="form-label small">{t('Statement file (.csv)')}</label>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="form-control form-control-sm"
                  onChange={(e) => {
                    const file = e.target.files && e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => parseText(String(reader.result || ''), hasHeader);
                    reader.readAsText(file);
                  }}
                />
              </div>
            </div>
            <div className="form-check mb-2">
              <input
                type="checkbox"
                className="form-check-input"
                id="statement-header"
                checked={hasHeader}
                onChange={(e) => { setHasHeader(e.target.checked); if (text) parseText(text, e.target.checked); }}
              />
              <label className="form-check-label small" htmlFor="statement-header">{t('First row is a header')}</label>
            </div>
            <textarea
              className="form-control form-control-sm mb-2"
              rows={4}
              placeholder={t('Or paste the CSV here…')}
              value={text}
              onChange={(e) => parseText(e.target.value, hasHeader)}
            />
            {movements.length > 0 && (
              <>
                <div className="row g-2 mb-2">
                  {['date', 'description', 'debit', 'credit'].map((field) => (
                    <div className="col-md-3" key={field}>
                      <label className="form-label small">{columnLabels[field]}</label>
                      <select
                        className="form-select form-select-sm"
                        value={mapping[field] === null || mapping[field] === undefined ? '' : String(mapping[field])}
                        onChange={(e) => changeMapping(field, e.target.value)}
                      >
                        <option value="">—</option>
                        {Array.from({ length: columnCount }, (_, i) => (
                          <option key={i} value={String(i)}>{columnLabel(i)}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <p className="text-muted small">
                  {t('{n} movements', { n: digits(movements.length) })}
                  {duplicateCount > 0 && (' · ' + t('{n} already in the register — left out unless ticked back in', { n: digits(duplicateCount) }))}
                  {skipped.length > 0 && (' · ' + t('{n} rows skipped ({reasons})', { n: digits(skipped.length), reasons: [...new Set(skipped.map((s) => t(s.reason)))].join(', ') }))}
                  {registerKeys === null && (' · ' + t('Checking against the register…'))}
                </p>
                <div className="table-responsive" style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  <table className="table table-striped table-sm bg-white">
                    <thead>
                      <tr>
                        <th></th>
                        <th>{t('Date')}</th>
                        <th>{t('Description')}</th>
                        <th>{t('Direction')}</th>
                        <th className="text-right">{t('Amount')}</th>
                        <th>{t('Status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.slice(0, 100).map((m, i) => {
                        const isDuplicate = registerKeys ? registerKeys.has(importEntryKey(effectiveBank, entries[i])) : false;
                        return (
                          <tr key={i}>
                            <td>
                              <input
                                type="checkbox"
                                checked={!!selected[i]}
                                onChange={(e) => setSelected((s) => ({ ...s, [i]: e.target.checked }))}
                              />
                            </td>
                            <td>{m.date_ad}</td>
                            <td>{m.description || '—'}</td>
                            <td>{t(m.direction)}</td>
                            <td className="text-right">{money(m.amount_npr)}</td>
                            <td>{isDuplicate ? t('Already in register') : t('New')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {movements.length > 100 && (
                  <p className="text-muted small">{t('Showing the first 100 of {n} movements — all ticked rows are imported.', { n: digits(movements.length) })}</p>
                )}
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!checkedCount || importing || !effectiveBank}
                  onClick={submitImport}
                >
                  {importing ? t('Importing…') : t('Import {n} entries', { n: digits(checkedCount) })}
                </button>
              </>
            )}
            {text && movements.length === 0 && (
              <p className="text-muted small">{t('No movements found — check the Date, Debit and Credit columns above.')}</p>
            )}
            {result && <div className="alert alert-success mt-2 mb-0" role="alert">{result}</div>}
            {error && <div className="alert alert-danger mt-2 mb-0" role="alert">{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Bank({ data, fy, api, onImported }) {
  const { t, money, digits } = useLocale();
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
        {t('Bank register')}{' '}
        <span className="badge badge-secondary">{money(balance)}</span>
      </h3>
      <p className="text-muted small">
        {effectiveFy === 'all'
          ? t('Showing all years — balance is the current register balance.')
          : t('Showing {fy} — balance is the register balance at the end of {fy}.', { fy: digits(effectiveFy) })}
        {' '}{t('Deposits')} {money(deposits)} &middot; {t('Withdrawals')} {money(withdrawals)} &middot; {t('Net')} {money(net)} &middot;{' '}
        {t('{n} entries', { n: digits(entries.length) })}
      </p>
      {entries.length ? (
        <div className="table-responsive">
          <table className="table table-striped table-sm bg-white">
            <thead>
              <tr>
                <SortHeader label={t('Date')} sortKey="date" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                <SortHeader label={t('Direction')} sortKey="direction" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                <SortHeader label={t('Amount')} sortKey="amount" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} className="text-right" />
                <SortHeader label={t('Reference')} sortKey="reference" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
                <SortHeader label={t('Client')} sortKey="client" activeKey={sort.sortKey} dir={sort.sortDir} onSort={sort.onSort} />
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((e, i) => (
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
      <StatementImport api={api} onImported={onImported} />
    </>
  );
}
