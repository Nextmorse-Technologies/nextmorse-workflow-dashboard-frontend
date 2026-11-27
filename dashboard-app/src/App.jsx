import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SS_BASE,
  SS_TOKEN,
  createApiClient,
  friendlyError,
} from './api.js';
import { fyString, parseBs } from './dates.js';
import Overview from './components/Overview.jsx';
import Tax from './components/Tax.jsx';
import Bank from './components/Bank.jsx';
import Invoices from './components/Invoices.jsx';
import InvoicePrint from './components/InvoicePrint.jsx';
import Receipts from './components/Receipts.jsx';
import ReceiptPrint from './components/ReceiptPrint.jsx';
import PettyCash from './components/PettyCash.jsx';
import Billing from './components/Billing.jsx';
import BillingRules from './components/BillingRules.jsx';
import VendorBills from './components/VendorBills.jsx';
import VendorServices from './components/VendorServices.jsx';
import RentUtilities from './components/RentUtilities.jsx';
import Salary from './components/Salary.jsx';
import MenuPicker from './components/MenuPicker.jsx';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'tax', label: 'Tax' },
  { key: 'bank', label: 'Bank' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'receipts', label: 'Receipts' },
  { key: 'petty', label: 'Petty cash' },
  { key: 'vendor', label: 'Vendor bills' },
  { key: 'vendor-services', label: 'Vendor services' },
  { key: 'rules', label: 'Billing rules' },
  { key: 'billing', label: 'Billing' },
  { key: 'rent-utilities', label: 'Rent and utilities' },
  { key: 'salary', label: 'Salary' },
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
  /* The saved vendor services (rent, utilities, …) — loaded once
     at sign-in, like the clients, so the Billing tab's vendor bill
     picker and the Vendor services tab both read the same list. */
  const [vendorServices, setVendorServices] = useState([]);
  const [sections, setSections] = useState({});
  const [invoicesRefresh, setInvoicesRefresh] = useState(0);
  const [pettyRefresh, setPettyRefresh] = useState(0);
  const [ledgerRefresh, setLedgerRefresh] = useState(0);
  const [rulesRefresh, setRulesRefresh] = useState(0);
  const [vendorRefresh, setVendorRefresh] = useState(0);
  /* A billing rule picked for "Issue invoice" — the Billing form
     opens with the rule's client, service, amount, treatment, due
     date and domain filled in, all editable. */
  const [billingPrefill, setBillingPrefill] = useState(null);
  /* The in-app print view: { kind: 'invoice' | 'receipt', id, from }
     — Print opens the sheet/slip here, in the dashboard, instead of
     redirecting to the Laravel app. Close goes back to `from`. */
  const [printView, setPrintView] = useState(null);
  const [fy, setFy] = useState('');
  /* The Fiscal year picker's open state — it is a MenuPicker, not a
     native <select>, like every other picker in the dashboard. */
  const [fyOpen, setFyOpen] = useState(false);

  /* The one fiscal-year picker, like Laravel's top-bar picker: it
     sits at the right end of the tab bar, after Billing, on every
     page, and every tab follows it — the Tax, Bank, Invoices,
     Receipts, Petty cash, Vendor bills, Vendor services, Billing
     rules, Billing forms, Rent and utilities and Salary tabs all
     filter to the picked year (all years when 'all'). */
  const currentFy = (() => {
    if (meta && meta.current_fiscal_year) return meta.current_fiscal_year;
    const p = parseBs(meta && meta.today && meta.today.bs);
    if (!p) return '';
    return fyString(p.mo >= 4 ? p.y : p.y - 1);
  })();
  const fyOptions = meta && meta.fiscal_years ? Object.keys(meta.fiscal_years) : [];
  if (currentFy && !fyOptions.includes(currentFy)) fyOptions.unshift(currentFy);
  const effectiveFy = fy === 'all' ? 'all' : (fy !== '' ? fy : (currentFy || 'all'));
  const [verifiedAt, setVerifiedAt] = useState('');
  const [dashSource, setDashSource] = useState('');

  const authRef = useRef({ base: '', token: '' });
  /* The fiscal year the Overview section was loaded for; when the
     picker changes to another year, the section reloads for it. */
  const overviewFyRef = useRef(null);
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
        /* The headline figures follow the Fiscal year picker: the
           API scopes them to the year (all years when 'all'). */
        const d = await api('/dashboard' + (effectiveFy !== 'all' ? '?fiscal_year=' + encodeURIComponent(effectiveFy) : ''));
        setSections((s) => ({ ...s, overview: d }));
        overviewFyRef.current = effectiveFy;
        setLedgerRefresh((n) => n + 1);
        if (d && d.verified_at) setVerifiedAt(d.verified_at);
        if (d && d.source) setDashSource('Source: ' + d.source);
      } else if (key === 'tax') {
        const d = await api('/tax');
        setSections((s) => ({ ...s, tax: d }));
      } else if (key === 'bank') {
        const d = await api('/bank');
        setSections((s) => ({ ...s, bank: d }));
      } else if (key === 'invoices') {
        /* The Invoices tab loads its own list; a refresh just tells
           it to fetch again (Reload button, or after a write). */
        setInvoicesRefresh((n) => n + 1);
      } else if (key === 'petty') {
        /* Same pattern as Invoices — the Petty cash tab loads its
           own lists; a refresh tells it to fetch again. */
        setPettyRefresh((n) => n + 1);
      } else if (key === 'vendor') {
        /* Same pattern — the Vendor bills tab loads its own lists;
           it shares the ledger refresh counter. */
        setLedgerRefresh((n) => n + 1);
      } else if (key === 'rules') {
        /* Same pattern — the Billing rules tab loads its own list. */
        setRulesRefresh((n) => n + 1);
      } else if (key === 'receipts') {
        const d = await api('/receipts?per_page=50');
        setSections((s) => ({ ...s, receipts: d }));
      } else if (key === 'billing') {
        await Promise.all([loadClients(), loadOpenInvoices()]);
        /* The Billing tab's vendor receipt form loads its own open
           vendor bills; a refresh tells it to fetch again. */
        setVendorRefresh((n) => n + 1);
      }
      setDashStatus('Loaded ' + key + ' · ' + new Date().toLocaleTimeString());
    } catch (err) {
      setDashError(friendlyError(err));
      setDashStatus('Could not load ' + key + '.');
    }
  }

  async function loadClients() {
    try {
      /* Active clients only — the invoice form lists no leads or
         former clients, and 15 rows fit in one page. */
      const resp = await api('/clients?status=Active&per_page=200');
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

  async function loadVendorServices() {
    try {
      const resp = await api('/vendor-services?per_page=200');
      setVendorServices((resp && resp.data) || []);
    } catch (err) {
      setDashError(friendlyError(err));
    }
  }

  /* A write happened: the open-invoice pickers and the invoice,
     receipt, petty cash and vendor sections are stale — refresh the
     pickers and tell the Invoices, Receipts, Petty cash and Vendor
     bills tabs (and the Billing tab's vendor receipt form) to fetch
     again. */
  function handleWrote() {
    setSections((s) => {
      const next = { ...s };
      delete next.receipts;
      return next;
    });
    setInvoicesRefresh((n) => n + 1);
    setPettyRefresh((n) => n + 1);
    setLedgerRefresh((n) => n + 1);
    setVendorRefresh((n) => n + 1);
    loadOpenInvoices();
    loadVendorServices();
  }

  /* "Issue invoice" from a billing rule: open the Billing tab with
     the rule's client, service, amount, treatment, due date and
     domain filled in. */
  function issueInvoiceFromRule(rule, clientName, clientDomain) {
    setBillingPrefill({ clientId: rule.client_id, clientName, clientDomain, rule });
    selectTab('billing');
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
    setVendorServices([]);
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
        const metaData = (resp && resp.data) || null;
        setMeta(metaData);
        /* The overview loads straight for the current year, so the
           picker and the figures agree from the first paint. */
        const fyNow = (metaData && metaData.current_fiscal_year) || 'all';
        overviewFyRef.current = fyNow;
        return api('/dashboard' + (fyNow !== 'all' ? '?fiscal_year=' + encodeURIComponent(fyNow) : ''));
      })
      .then((d) => {
        setSections((s) => ({ ...s, overview: d }));
        if (d && d.verified_at) setVerifiedAt(d.verified_at);
        if (d && d.source) setDashSource('Source: ' + d.source);
        setSignedIn(true);
        setAuthChecked(true);
        loadClients();
        loadOpenInvoices();
        loadVendorServices();
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

  /* The Overview tab follows the Fiscal year picker: when the year
     changes after the section loaded, reload it for that year. */
  useEffect(() => {
    if (sections.overview && overviewFyRef.current !== null && overviewFyRef.current !== effectiveFy) {
      loadSection('overview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveFy]);

  function closePrintView() {
    if (printView) setActiveTab(printView.from);
    setPrintView(null);
  }

  function selectTab(key) {
    setActiveTab(key);
    if (!signedIn) return;
    if (key === 'billing') { loadSection('billing'); return; }
    if (key === 'invoices') return; /* the tab loads its own list */
    if (key === 'petty') return; /* the tab loads its own lists */
    if (key === 'vendor') return; /* the tab loads its own lists */
    if (key === 'vendor-services') return; /* the list loads at sign-in */
    if (key === 'rent-utilities') return; /* the tab loads its own list */
    if (key === 'salary') return; /* the tab loads its own list */
    if (key === 'rules') return; /* the tab loads its own list */
    if (!sections[key]) loadSection(key);
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
      <section className="pt-4 pb-5">
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
                  {meta && (
                    <li className="nav-item ml-auto d-flex align-items-center pl-3">
                      <label className="mb-0 mr-2 small text-muted">Fiscal year</label>
                      <MenuPicker
                        buttonLabel={effectiveFy === 'all' ? 'All years' : ((meta.fiscal_years && meta.fiscal_years[effectiveFy]) || ('FY ' + effectiveFy))}
                        options={[{ value: 'all', label: 'All years' }].concat(fyOptions.map((f) => ({
                          value: f,
                          label: (meta.fiscal_years && meta.fiscal_years[f]) || ('FY ' + f),
                        })))}
                        open={fyOpen}
                        onToggle={() => setFyOpen(!fyOpen)}
                        onPick={(v) => { setFy(v); setFyOpen(false); }}
                        buttonClassName="form-control form-control-sm"
                        wrapStyle={{ width: 'auto', minWidth: 140 }}
                        ariaLabel="Fiscal year"
                      />
                    </li>
                  )}
                </ul>

                <div className="tab-content pt-4">
                  <div className="tab-pane fade show active" role="tabpanel">
                    {printView ? (
                      printView.kind === 'invoice' ? (
                        <InvoicePrint api={api} id={printView.id} onClose={closePrintView} />
                      ) : (
                        <ReceiptPrint api={api} id={printView.id} onClose={closePrintView} />
                      )
                    ) : (
                      <>
                    {activeTab === 'overview' && <Overview data={sections.overview} api={api} fy={effectiveFy} refreshKey={ledgerRefresh} />}
                    {activeTab === 'tax' && <Tax data={sections.tax} fy={effectiveFy} api={api} />}
                    {activeTab === 'bank' && <Bank data={sections.bank} fy={effectiveFy} />}
                    {activeTab === 'invoices' && (
                      <Invoices
                        api={api}
                        refreshKey={invoicesRefresh}
                        fy={effectiveFy}
                        onPrintInvoice={(id) => setPrintView({ kind: 'invoice', id, from: 'invoices' })}
                      />
                    )}
                    {activeTab === 'receipts' && (
                      <Receipts
                        data={sections.receipts}
                        fy={effectiveFy}
                        onPrintReceipt={(id) => setPrintView({ kind: 'receipt', id, from: 'receipts' })}
                      />
                    )}
                    {activeTab === 'petty' && (
                      <PettyCash
                        api={api}
                        refreshKey={pettyRefresh}
                        fy={effectiveFy}
                        onPrintInvoice={(id) => setPrintView({ kind: 'invoice', id, from: 'petty' })}
                        onPrintReceipt={(id) => setPrintView({ kind: 'receipt', id, from: 'petty' })}
                      />
                    )}
                    {activeTab === 'vendor' && (
                      <VendorBills api={api} refreshKey={ledgerRefresh} fy={effectiveFy} />
                    )}
                    {activeTab === 'vendor-services' && (
                      <VendorServices api={api} services={vendorServices} onWrote={handleWrote} fy={effectiveFy} refreshKey={ledgerRefresh} />
                    )}
                    {activeTab === 'rules' && (
                      <BillingRules
                        api={api}
                        clients={clients}
                        refreshKey={rulesRefresh}
                        fy={effectiveFy}
                        onIssueInvoice={issueInvoiceFromRule}
                      />
                    )}
                    {activeTab === 'billing' && (
                      <Billing
                        api={api}
                        clients={clients}
                        openInvoices={openInvoices}
                        meta={meta}
                        onWrote={handleWrote}
                        prefill={billingPrefill}
                        onPrefillApplied={() => setBillingPrefill(null)}
                        vendorRefresh={vendorRefresh}
                        vendorServices={vendorServices}
                        fy={effectiveFy}
                      />
                    )}
                    {activeTab === 'rent-utilities' && (
                      <RentUtilities
                        api={api}
                        services={vendorServices}
                        meta={meta}
                        fy={effectiveFy}
                        refreshKey={ledgerRefresh}
                      />
                    )}
                    {activeTab === 'salary' && (
                      <Salary
                        api={api}
                        fy={effectiveFy}
                        refreshKey={ledgerRefresh}
                      />
                    )}
                      </>
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
