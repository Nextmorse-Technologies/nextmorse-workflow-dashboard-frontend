# Nextmorse Dashboard — React app

React client for the Nextmorse unified API (`/api/v1`). Same features as
the plain `dashboard.html` / `js/dashboard.js` at the repo root, rebuilt in
React so the static build can be published on nextmorse.com.

- Source: this folder (`dashboard-app/`). Build output: `dashboard-app/dist/`
  (committed to the repo; `node_modules/` is not).
- The plain version (`dashboard.html` + `js/dashboard.js`) is kept until
  this React build is verified and Bijaya chooses.

## Develop

```sh
cd dashboard-app
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
```

## Publish (Bijaya)

Upload the **contents of `dashboard-app/dist/`** to a folder on
nextmorse.com hosting, e.g. `/dashboard/` — so the page is at
`https://nextmorse.com/dashboard/`. The build uses relative asset paths
(Vite `base: './'`), so it works from any subfolder. The page itself is
unlinked (no link from the rest of the site yet).

The page reuses the site's own shell: `/css/style.css`, Bootstrap and
`/images/logo.svg` are loaded from the site root on nextmorse.com, so
they resolve from any subfolder. The API still runs on the Render
dashboard for now (it will move to poudelbijaya.com.np) — type the API
base URL and your token into the page; nothing is hardcoded, and both
live in `sessionStorage` (this tab only).

## Notes

- Vite + React 18, plain JavaScript, no extra UI framework.
- Billing (create invoice, record payment) is the only write surface.
  No credit note in this first version.
- No live API call is made at build time; the page calls the API only
  after sign-in in the browser.
