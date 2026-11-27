import { money } from '../api.js';

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
  if (!data) return null;
  const holders = (data.shareholders && data.shareholders.holders) || [];
  /* The fiscal year comes from the shared picker in the tab bar
     (App, via Overview); the audits and meetings follow it. The
     shareholders are a standing record and the audit-log count is
     all-time — both stay, labelled. */
  const effectiveFy = fy || 'all';
  const audits = reportRowsForFy(data.audits_on_file, effectiveFy);
  const meetings = reportRowsForFy(data.meetings, effectiveFy);
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
              <th>FY</th>
              <th>UDIN</th>
              <th>Opinion</th>
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
              <th>Type</th>
              <th>FY</th>
              <th>Date</th>
              <th>Filing</th>
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
              <th>Name</th>
              <th className="text-right">Shares</th>
              <th className="text-right">Paid up</th>
            </tr>
          </thead>
          <tbody>
            {holders.map((h, i) => (
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
