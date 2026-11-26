/* Login page for the dashboard: the API connection (base URL + token)
   lives here, on its own centered page — the dashboard itself shows no
   connect card. After sign-in the app switches to the dashboard. */
export default function Login({
  baseInput,
  setBaseInput,
  tokenInput,
  setTokenInput,
  onSignIn,
  loading,
  error,
  status,
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f172a',
        padding: '24px 16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          background: '#ffffff',
          borderRadius: '12px',
          padding: '32px 28px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <span
            style={{
              display: 'inline-block',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '8px 12px',
            }}
          >
            <img
              src="/images/logo.svg"
              alt="Nextmorse"
              style={{ height: '36px', display: 'block' }}
            />
          </span>
          <h1
            style={{
              fontSize: '20px',
              margin: '16px 0 4px',
              color: '#0f172a',
            }}
          >
            Dashboard login
          </h1>
          <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
            Nextmorse Technologies Pvt. Ltd.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSignIn();
          }}
        >
          <div className="form-group">
            <label htmlFor="apiBase">API base URL</label>
            <input
              id="apiBase"
              className="form-control"
              type="url"
              placeholder="https://nextmorse-dashboard.onrender.com"
              autoComplete="off"
              value={baseInput}
              onChange={(e) => setBaseInput(e.target.value)}
            />
            <small className="form-text text-muted">
              The API currently runs on the Render dashboard; it will move to
              poudelbijaya.com.np.
            </small>
          </div>
          <div className="form-group">
            <label htmlFor="apiToken">API token</label>
            <input
              id="apiToken"
              className="form-control"
              type="password"
              placeholder="Paste your API token"
              autoComplete="off"
              autoFocus
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
          </div>
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p
          style={{
            margin: '16px 0 0',
            color: '#94a3b8',
            fontSize: '12px',
            textAlign: 'center',
          }}
        >
          {status}
          <br />
          The address and token are kept in this tab only and are sent only to
          the address you set.
        </p>
      </div>
    </div>
  );
}
