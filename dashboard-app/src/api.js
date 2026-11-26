/* ==========================================================================
   Nextmorse Dashboard — API layer
   --------------------------------------------------------------------------
   Consumes the unified API (/api/v1): one base URL, one bearer token.

   - The base URL and token are typed in on the page. They are kept in
     sessionStorage (this tab only) and are sent ONLY to the base URL
     typed in, as an Authorization header. Nothing is written into this
     file: no token, no base URL, no password.
   - Reads: Overview (GET /v1/dashboard), Tax (/v1/tax), Bank (/v1/bank),
     Invoices (/v1/invoices/summary + /v1/invoices?open_only=1),
     Reports (/v1/reports). Meta (/v1/meta) supplies today and the
     treatment list.
   - Writes (Billing only): create invoice (POST /v1/invoices) and
     record a payment (POST /v1/receipts). Credit notes are not in
     this first version.
   - Error states: 401 = token not accepted; unreachable API =
     a distinct message; 422 = field errors shown under the field.
   ========================================================================== */

export const SS_BASE = 'nextmorse_dash_base';
export const SS_TOKEN = 'nextmorse_dash_token';

export const TREATMENTS_FALLBACK = ['vat_tds', 'vat_only', 'no_vat', 'no_vat_no_tds'];
export const TREATMENT_LABELS = {
  vat_tds: 'VAT + TDS',
  vat_only: 'VAT only',
  no_vat: 'No VAT',
  no_vat_no_tds: 'No VAT, no TDS (petty cash)',
};

export function money(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (Number.isNaN(num)) return '—';
  return 'NPR ' + num.toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || ('The API answered with status ' + status + '.'));
    this.name = 'ApiError';
    this.status = status;
    this.body = body || {};
  }
}

/* One client per sign-in; created in App and passed down. */
export function createApiClient(getAuth) {
  async function api(path, opts = {}) {
    const { base, token } = getAuth();
    const headers = {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token,
    };
    let body;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(base.replace(/\/+$/, '') + '/api/v1' + path, {
        method: opts.method || 'GET',
        headers,
        body,
      });
    } catch (e) {
      // Network failure (incl. CORS): fetch throws a TypeError.
      throw e;
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }
  return { api };
}

export function friendlyError(err) {
  /* Network failures surface as a TypeError from fetch. Match on the
     name (not instanceof) so the check also holds across realms. */
  if (err && err.name === 'TypeError') {
    return 'Could not reach the API. Check the API base URL, and that the API is running.';
  }
  if (err instanceof ApiError) {
    if (err.status === 401) {
      return 'That token was not accepted (401). Check the token and try again.';
    }
    if (err.status === 403) {
      return 'The API refused this (403): ' + err.message;
    }
    if (err.status === 404) {
      return 'The API has no such record (404): ' + err.message;
    }
    if (err.status === 422) {
      return 'The API rejected the data (422). See the field messages below.';
    }
    if (err.status === 503) {
      return 'The API has no token configured (503). Ask whoever runs the API to set one.';
    }
    return err.message;
  }
  return (err && err.message) || 'Something went wrong.';
}

export function fieldErrors(err) {
  if (err instanceof ApiError && err.status === 422 &&
      err.body && err.body.errors && typeof err.body.errors === 'object') {
    return err.body.errors;
  }
  return {};
}
