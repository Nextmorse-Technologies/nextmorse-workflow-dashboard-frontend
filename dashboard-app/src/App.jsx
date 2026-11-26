import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SS_BASE,
  SS_TOKEN,
  createApiClient,
  friendlyError,
} from './api.js';
import Overview from './components/Overview.jsx';
import Tax from './components/Tax.jsx';
import Bank from './components/Bank.jsx';
import Invoices from './components/Invoices.jsx';
import Reports from './components/Reports.jsx';
import Billing from './components/Billing.jsx';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'tax', label: 'Tax' },
  { key: 'bank', label: 'Bank' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'reports', label: 'Reports' },
  { key: 'billing', label: 'Billing' },
];

function Header({ signedIn, onReload, onSignOut }) {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <header className="header">
      <div className="container">
        <div className="row">
          <div className="col-sm-12">
            <nav className="navbar navbar-static-top navbar-expand-lg">
              <button
                type="button"
                className="navbar-toggler"
                aria-label="Toggle navigation"
                onClick={() => setNavOpen((o) => !o)}
              >
                <i className="fas fa-align-left"></i>
              </button>
              <a className="navbar-brand" href="/index.html">
                <img className="img-fluid" src="/images/logo.svg" alt="logo" />
              </a>
              <div className={'navbar-collapse collapse' + (navOpen ? ' show' : '')}>
                <ul className="nav navbar-nav">
                  <li className="nav-item">
                    <a className="nav-link" href="/index.html">Home</a>
                  </li>
                  <li className="nav-item">
                    <a href="/index.html#service" className="nav-link">Services</a>
                  </li>
                  <li className="nav-item">
                    <a href="/index.html#about-us" className="nav-link">Company</a>
                  </li>
                  <li className="nav-item">
                    <a href="/index.html#contact" className="nav-link">Contact</a>
                  </li>
                  {signedIn && (
                    <>
                      <li className="nav-item">
                        <a
                          className="nav-link"
                          href="#reload"
                          onClick={(e) => { e.preventDefault(); onReload(); }}
                        >
                          Reload
                        </a>
                      </li>
                      <li className="nav-item">
                        <a
                          className="nav-link"
                          href="#signout"
                          onClick={(e) => { e.preventDefault(); onSignOut(); }}
                        >
                          Sign out
                        </a>
                      </li>
                    </>
                  )}
                </ul>
              </div>
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer space-ptb bg-light mt-n5">
      <div className="footer-bottom mt-5">
        <div className="container">
          <div className="row">
            <div className="col-lg-12 text-center">
              <ul className="list-unstyled mb-3 mb-md-5 social-icon social-icon-lg">
                <li><a href="#"><i className="fab fa-facebook-f fa-2x"></i></a></li>
                <li>
                  <a href="https://www.linkedin.com/company/nextmorse-technologies?originalSubdomain=nl">
                    <i className="fab fa-linkedin-in fa-2x"></i>
                  </a>
                </li>
              </ul>
              <p className="mb-0 text-dark">
                &copy;Copyright 2022 <a href="/index.html">Nextmorse</a> All Rights Reserved
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  const [signedIn, setSignedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [dashStatus, setDashStatus] = useState('');
  const [dashError, setDashError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [meta, setMeta] = useState(null);
  const [clients, setClients] = useState([]);
  const [openInvoices, setOpenInvoices] = useState([]);
  const [sections, setSections] = useState({});
  const [verifiedAt, setVerifiedAt] = useState('');
  const [dashSource, setDashSource] = useState('');

  const authRef = useRef({ base: '', token: '' });
  const apiClient = useMemo(
    () => createApiClient(() => authRef.current),
    [],
  );
  const api = apiClient.api;

  /* Section loaders (lazy: each section loads on first view). */
  async function loadSection(key) {
    setDashError('');
    setDashStatus('Loading ' + key + '…');
    try {
      if (key === 'overview') {
        const d = await api('/dashboard');
        setSections((s) => ({ ...s, overview: d }));
        if (d && d.verified_at) setVerifiedAt(d.verified_at);
        if (d && d.source) setDashSource('Source: ' + d.source);
      } else if (key === 'tax') {
        const d = await api('/tax');
        setSections((s) => ({ ...s, tax: d }));
      } else if (key === 'bank') {
        const d = await api('/bank');
        setSections((s) => ({ ...s, bank: d }));
      } else if (key === 'invoices') {
        const [s, list] = await Promise.all([
          api('/invoices/summary'),
          api('/invoices?open_only=1&per_page=50'),
        ]);
        setSections((prev) => ({
          ...prev,
          invoices: s,
          openList: list && list.data ? list.data : [],
        }));
      } else if (key === 'reports') {
        const d = await api('/reports');
        setSections((s) => ({ ...s, reports: d }));
      } else if (key === 'billing') {
        await Promise.all([loadClients(), loadOpenInvoices()]);
      }
      setDashStatus('Loaded ' + key + ' · ' + new Date().toLocaleTimeString());
    } catch (err) {
      setDashError(friendlyError(err));
      setDashStatus('Could not load ' + key + '.');
    }
  }

  async function loadClients() {
    try {
      const resp = await api('/clients?per_page=200');
      setClients((resp && resp.data) || []);
    } catch (err) {
      setDashError(friendlyError(err));
    }
  }

  async function loadOpenInvoices() {
    try {
      const resp = await api('/invoices?open_only=1&per_page=200');
      setOpenInvoices((resp && resp.data) || []);
    } catch (err) {
      setDashError(friendlyError(err));
    }
  }

  /* A write happened: the open-invoice lists and the invoice sections
     are stale — refresh the pickers and drop the cached invoice data. */
  function handleWrote() {
    setSections((s) => {
      const next = { ...s };
      delete next.invoices;
      delete next.openList;
      return next;
    });
    loadOpenInvoices();
  }

  function signOut() {
    try {
      sessionStorage.removeItem(SS_BASE);
      sessionStorage.removeItem(SS_TOKEN);
    } catch (e) { /* ignore */ }
    authRef.current = { base: '', token: '' };
    setMeta(null);
    setClients([]);
    setOpenInvoices([]);
    setSections({});
    setDashError('');
    setDashStatus('');
    setVerifiedAt('');
    setDashSource('');
    setSignedIn(false);
    window.location.replace('/login');
  }

  /* Sign-in lives at /login now. This page restores the tab session
     (token + base live in sessionStorage only); without one it sends
     the browser to /login, and a rejected token does the same. */
  useEffect(() => {
    let savedBase = null;
    let savedToken = null;
    try {
      savedBase = sessionStorage.getItem(SS_BASE);
      savedToken = sessionStorage.getItem(SS_TOKEN);
    } catch (e) { /* private mode */ }
    if (!savedBase || !savedToken) {
      window.location.replace('/login');
      return;
    }
    authRef.current = { base: savedBase, token: savedToken };
    api('/meta')
      .then((resp) => {
        setMeta((resp && resp.data) || null);
        return api('/dashboard');
      })
      .then((d) => {
        setSections((s) => ({ ...s, overview: d }));
        if (d && d.verified_at) setVerifiedAt(d.verified_at);
        if (d && d.source) setDashSource('Source: ' + d.source);
        setSignedIn(true);
        setAuthChecked(true);
        loadClients();
        loadOpenInvoices();
      })
      .catch(() => {
        try {
          sessionStorage.removeItem(SS_BASE);
          sessionStorage.removeItem(SS_TOKEN);
        } catch (e) { /* ignore */ }
        window.location.replace('/login');
      })
    // Run once on mount; api/loadClients/loadOpenInvoices are stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectTab(key) {
    setActiveTab(key);
    if (!signedIn) return;
    if (key === 'billing') { loadSection('billing'); return; }
    const loadedKey = key === 'invoices' ? 'invoices' : key;
    if (!sections[loadedKey]) loadSection(key);
  }

  /* While the session is being checked, show nothing but a loader —
     the dashboard itself only renders once signed in. */
  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          color: '#94a3b8',
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <>
      <Header
        signedIn={signedIn}
        onReload={() => loadSection(activeTab)}
        onSignOut={signOut}
      />
      <section className="space-ptb">
        <div className="container">
          {/* Dashboard sections */}
          <div className="row justify-content-center">
            <div className="col-lg-12">
              <div className="mb-3">
                <small className="text-muted">{dashStatus}</small>
              </div>
                {dashError && (
                  <div className="alert alert-danger" role="alert">{dashError}</div>
                )}

                <ul className="nav nav-tabs" role="tablist">
                  {TABS.map((t) => (
                    <li className="nav-item" key={t.key}>
                      <a
                        className={'nav-link' + (activeTab === t.key ? ' active' : '')}
                        href={'#tab-' + t.key}
                        role="tab"
                        aria-selected={activeTab === t.key}
                        onClick={(e) => { e.preventDefault(); selectTab(t.key); }}
                      >
                        {t.label}
                      </a>
                    </li>
                  ))}
                </ul>

                <div className="tab-content pt-4">
                  <div className="tab-pane fade show active" role="tabpanel">
                    {activeTab === 'overview' && <Overview data={sections.overview} />}
                    {activeTab === 'tax' && <Tax data={sections.tax} />}
                    {activeTab === 'bank' && <Bank data={sections.bank} />}
                    {activeTab === 'invoices' && (
                      <Invoices summary={sections.invoices} openList={sections.openList} />
                    )}
                    {activeTab === 'reports' && <Reports data={sections.reports} />}
                    {activeTab === 'billing' && (
                      <Billing
                        api={api}
                        clients={clients}
                        openInvoices={openInvoices}
                        meta={meta}
                        onWrote={handleWrote}
                      />
                    )}
                  </div>
                </div>

                <hr />
                <p className="text-muted small">
                  Data from the Nextmorse unified API &middot; verified at{' '}
                  <span>{verifiedAt}</span> &middot; <span>{dashSource}</span>
                </p>
              </div>
            </div>
          </div>
      </section>
      <Footer />
      <div
        id="back-to-top"
        className="back-to-top"
        role="button"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        up
      </div>
    </>
  );
}
