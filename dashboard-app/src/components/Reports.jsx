import { money } from '../api.js';

export default function Reports({ data }) {
  if (!data) return null;
  const holders = (data.shareholders && data.shareholders.holders) || [];
  return (
    <>
      <h3 className="h5">Reports</h3>
      <h4 className="h6">Statutory audits on file</h4>
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
            {(data.audits_on_file || []).map((a, i) => (
              <tr key={i}>
                <td>{a.fiscal_year}</td>
                <td>{a.udin}</td>
                <td>{a.opinion}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 className="h6 mt-3">Meetings</h4>
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
            {(data.meetings || []).map((m, i) => (
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
      <h4 className="h6 mt-3">Shareholders (verified, s.51)</h4>
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
        Audit-log entries:{' '}
        {data.audit_log && data.audit_log.entry_count !== undefined
          ? data.audit_log.entry_count
          : '—'}
      </p>
    </>
  );
}
