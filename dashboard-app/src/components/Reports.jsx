import { money } from '../api.js';
import { SortHeader, useTableSort } from '../sort.js';

/* The fiscal year an audit or meeting belongs to, from its own
   fiscal_year label ('2083/84' → 2083). */
export function reportRowFy(row) {
  if (!row || !row.fiscal_year) return null;
  const y = parseInt(String(row.fiscal_year).split('/')[0], 10);
  return y || null;
}

/* The rows for the picked year; 'all' keeps every year. */
export function reportRowsForFy(rows, fy) {
  const list = rows || [];
  if (!fy || fy === 'all') return list;
  const fyStart = parseInt(String(fy).split('/')[0], 10);
  return list.filter((r) => reportRowFy(r) === fyStart);
}

export default function Reports({ data, fy }) {
  /* One sort state per table; each starts in its original order.
     Each table sorts only the rows actually shown, after the
     fiscal-year filter (the shareholders are all-years by nature). */
  const auditSort = useTableSort(null);
  const meetingSort = useTableSort(null);
  const holderSort = useTableSort(null);
  if (!data) return null;
  const holders = (data.shareholders && data.shareholders.holders) || [];
  /* The fiscal year comes from the shared picker in the tab bar
     (App, via Overview); the audits and meetings follow it. The
     shareholders are a standing record and the audit-log count is
     all-time — both stay, labelled. */
  const effectiveFy = fy || 'all';
  const audits = auditSort.apply(reportRowsForFy(data.audits_on_file, effectiveFy), (a, key) => {
    switch (key) {
      case 'udin': return a.udin || '';
      case 'opinion': return a.opinion || '';
      default: return a.fiscal_year || '';
    }
  });
  const meetings = meetingSort.apply(reportRowsForFy(data.meetings, effectiveFy), (m, key) => {
    switch (key) {
      case 'fy': return m.fiscal_year || '';
      case 'date': return m.date || '';
      case 'filing': return m.filed ? 'Filed' : 'Not filed';
      default: return m.meeting_type || '';
    }
  });
  const sortedHolders = holderSort.apply(holders, (h, key) => {
    switch (key) {
      case 'shares': return h.shares;
      case 'paid': return h.paid;
      default: return h.name || '';
    }
  });
  return (
    <>
      <h3 className="h5">Reports</h3>
      <p className="mb-2 text-muted">
        {effectiveFy === 'all'
          ? 'Showing all years.'
          : 'Showing ' + effectiveFy + ' — audits and meetings for ' + effectiveFy + '; shareholders and the audit-log count are all-years.'}
      </p>
      <h4 className="h6">Statutory audits on file</h4>
      {audits.length ? (
      <div className="table-responsive">
        <table className="table table-striped table-sm bg-white">
          <thead>
            <tr>
              <SortHeader label="FY" sortKey="fy" activeKey={auditSort.sortKey} dir={auditSort.sortDir} onSort={auditSort.onSort} />
              <SortHeader label="UDIN" sortKey="udin" activeKey={auditSort.sortKey} dir={auditSort.sortDir} onSort={auditSort.onSort} />
              <SortHeader label="Opinion" sortKey="opinion" activeKey={auditSort.sortKey} dir={auditSort.sortDir} onSort={auditSort.onSort} />
            </tr>
          </thead>
          <tbody>
            {audits.map((a, i) => (
              <tr key={i}>
                <td>{a.fiscal_year}</td>
                <td>{a.udin}</td>
                <td>{a.opinion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      ) : (
        <p className="text-muted">No audits on file{effectiveFy === 'all' ? '.' : ' for ' + effectiveFy + '.'}</p>
      )}
      <h4 className="h6 mt-3">Meetings</h4>
      {meetings.length ? (
      <div className="table-responsive">
        <table className="table table-striped table-sm bg-white">
          <thead>
            <tr>
              <SortHeader label="Type" sortKey="type" activeKey={meetingSort.sortKey} dir={meetingSort.sortDir} onSort={meetingSort.onSort} />
              <SortHeader label="FY" sortKey="fy" activeKey={meetingSort.sortKey} dir={meetingSort.sortDir} onSort={meetingSort.onSort} />
              <SortHeader label="Date" sortKey="date" activeKey={meetingSort.sortKey} dir={meetingSort.sortDir} onSort={meetingSort.onSort} />
              <SortHeader label="Filing" sortKey="filing" activeKey={meetingSort.sortKey} dir={meetingSort.sortDir} onSort={meetingSort.onSort} />
            </tr>
          </thead>
          <tbody>
            {meetings.map((m, i) => (
              <tr key={i}>
                <td>{m.meeting_type}</td>
                <td>{m.fiscal_year}</td>
                <td>{m.date}</td>
                <td>{m.filed ? 'Filed' : 'Not filed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      ) : (
        <p className="text-muted">No meetings{effectiveFy === 'all' ? '.' : ' in ' + effectiveFy + '.'}</p>
      )}
      <h4 className="h6 mt-3">Shareholders (verified, s.51) — all years</h4>
      <div className="table-responsive">
        <table className="table table-striped table-sm bg-white">
          <thead>
            <tr>
              <SortHeader label="Name" sortKey="name" activeKey={holderSort.sortKey} dir={holderSort.sortDir} onSort={holderSort.onSort} />
              <SortHeader label="Shares" sortKey="shares" activeKey={holderSort.sortKey} dir={holderSort.sortDir} onSort={holderSort.onSort} className="text-right" />
              <SortHeader label="Paid up" sortKey="paid" activeKey={holderSort.sortKey} dir={holderSort.sortDir} onSort={holderSort.onSort} className="text-right" />
            </tr>
          </thead>
          <tbody>
            {sortedHolders.map((h, i) => (
              <tr key={i}>
                <td>{h.name}</td>
                <td className="text-right">{h.shares}</td>
                <td className="text-right">{money(h.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted small">
        Audit-log entries (all years):{' '}
        {data.audit_log && data.audit_log.entry_count !== undefined
          ? data.audit_log.entry_count
          : '—'}
      </p>
    </>
  );
}
