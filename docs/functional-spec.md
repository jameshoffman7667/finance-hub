# Finance Hub: functional specification (current state, v0.1.1)

Personal finance manager for one household on James's home server. This file describes what the app does now; later features (bonuses, investments, forecast, tax) are listed under Not yet built. The full product plan lives in the Project "Financial Management".

## Purpose and scope in this release

Foundation release: sign in securely, record accounts and balances, import bank statements from CSV, categorise transactions, and see net worth and spending by category. Used by one login (James); a second person can be added in a later release.

## Areas of the app

Seven areas, shown in the desktop sidebar. Phone bottom navigation shows Overview, Budget, Cards, Invest and More (More lists Tax, Accounts and imports, Settings).

| Area | State in v0.1.0 |
| --- | --- |
| Overview | Built. Net worth, trend chart, this month's spending, "uncategorised" reminder |
| Budget and forecast | Spending by category by month, transactions with categorise, categories and rules. Forecast tab is a placeholder |
| Cards and bonuses | Placeholder page |
| Investments | Placeholder page |
| Tax | Placeholder page |
| Accounts and imports | Built. Accounts, balances, CSV import with preview, import history with rollback |
| Settings | Built. Install, change password, export, security log, sign out |

## Sign-in and security

- First run (no users): the screen asks for a username and a password of at least 12 characters, then shows an authenticator key to enrol. There is no default password. Alternatively `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` (argon2id) create the first user; that user enrols the authenticator at first sign-in.
- Two-step sign-in (TOTP, 6 digits, 30 s) is mandatory. A code cannot be reused. The authenticator key is stored encrypted (AES-256-GCM) with `APP_SECRET_KEY`.
- Sessions: random token in an HttpOnly, SameSite=Strict cookie (`Secure` when `COOKIE_SECURE=true`), stored hashed server-side, ended after `SESSION_IDLE_MINUTES` (30) idle and after 12 hours. Every change request needs a CSRF token header and a same-origin `Origin`.
- Rate limits (per process memory): 5 failed sign-ins per 15 minutes per address and username, 20 per address; password and code re-checks are limited too.
- Step-up: exporting data and changing the password ask for the password again; the confirmation lasts 5 minutes.
- Cloudflare Access: if `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set, every `/api` request must carry a valid `Cf-Access-Jwt-Assertion`. `/healthz`, the manifest, icons and the service worker are not gated so the app can install.
- Forwarded headers are trusted only from private (Docker) networks (`TRUST_PROXY`).
- Response headers: strict Content-Security-Policy (no inline script or style), frame denial, no-referrer, nosniff.
- Audit log of sign-ins, failures, imports, rollbacks, exports and password changes; the latest are shown in Settings.

## Accounts and balances

- Account fields: name, institution, type, owner (free text), open/closed. Types: chequing, savings, investment (non-registered), registered, property, other asset (assets); credit card, loan, mortgage, line of credit, other debt (debts).
- Balances ("valuations") are entered per account per date as positive amounts; debts are subtracted in net worth. One balance per account per date (re-entering a date replaces it). Currency is CAD.
- Net worth at a date uses each account's latest balance on or before that date. The chart shows month-ends for up to 24 months from the first balance.

## Statement import (generic CSV)

1. Choose the account and a CSV file (comma, semicolon or tab separated; quotes and BOM handled).
2. The app guesses the date, description and amount columns (or separate money-out and money-in columns) and the date order. All can be changed in the preview; "flip signs" is available for statements that show spending as positive.
3. The preview shows counts of new, already imported, auto-categorised and unreadable rows, plus the first 25 rows. Nothing is saved yet.
4. Import writes a batch. Rows already imported (same account, date, description, amount, and repeat position within the file) are skipped, so overlapping statements are safe; genuine identical repeats within one file are kept.
5. Import history lists batches; "Roll back" deletes exactly the rows of that batch.

Amounts are stored as integer cents. Negative means money out. Upload limit `MAX_UPLOAD_MB` (default 50).

## Budgeting

- Fifteen starter categories (expense, income, transfer). Categories can be added, renamed through archive and restore; each has a kind.
- Rules: "description contains text" assigns a category (case-insensitive; lowest priority number first, then longer text). Rules run at import and when a rule is added. A category set by hand is never overwritten by rules.
- Transactions tab: search, "uncategorised only", tap a transaction to set its category, optionally creating a rule from text in its description (also categorises matching uncategorised rows).
- Spending by month: spent = money out net of refunds in expense categories plus uncategorised; income = income categories; transfers are ignored. Month picker, bars per category, detail table.

## Settings

Install app (Chrome/Edge button; iOS instructions), change password, export everything as JSON or transactions as CSV (password re-entry), security log, version, sign out.

## Mobile layout

Under 768 px: single column, bottom navigation (Overview, Budget, Cards, Invest, More), compact sticky header, 44 px minimum touch targets, safe-area padding, tab strips scroll sideways, tables scroll inside their card, no horizontal page scroll down to 320 px. Dialogs fill the width.

## Desktop layout

From 1024 px: left sidebar with all seven areas and the version, content up to 1180 px wide, two-column grids (Overview: net worth and spending side by side; Budget: categories beside details; Settings: two columns), visible keyboard focus. 768 to 1023 px uses the phone navigation with two-column grids and a centred content column. Feature parity between layouts.

Light and dark follow the device setting (`prefers-color-scheme`) with matching `theme-color`.

## PWA

- `manifest.webmanifest`: name and short name "Finance Hub", `id` and `start_url` "/", scope "/", standalone, theme `#0f6b63`, icons 192, 512 and 512 maskable, wide (1280x720) and narrow (540x960) screenshots in `public/screenshots/`. Apple touch icon 180 px.
- Service worker `/sw.js` (scope "/"): precaches the app shell only (page, script, stylesheet, manifest, icons, offline page) in cache `finance-hub-v<version>`; old caches are deleted on activate. Navigations are network-first with the offline page as fallback. `/api/*` and `/healthz` are never cached or intercepted.
- Update: when a new worker is waiting, a banner offers "Reload"; nothing is swapped silently.
- Install requires the https hostname (Cloudflare); a LAN `http://` address cannot install.
- The app needs the server for data; offline shows an offline page only.

## Environment variables

See `deploy/.env.example`. Required: `APP_SECRET_KEY` (32+ characters; the app refuses to start without it). `PORT` (listening port; default 8070, set by compose from `PORT_HOST`). Others: `APP_URL`, `COOKIE_SECURE`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_IDLE_MINUTES`, `MAX_UPLOAD_MB`, `TRUST_PROXY`, `LOG_LEVEL`, `TZ`.

## Data and storage

- `/data/finance-hub.db` (SQLite, WAL: copy `.db`, `-wal` and `-shm` together, or stop the container first). `/data/backups/` receives a copy before any data-changing migration. `/files` is reserved for statements (not used yet).
- Schema version 1. Migrations are forward-only and run at start-up inside a transaction.
- Time stored in UTC; dates are plain calendar dates; display uses America/Toronto.

## API (JSON, all under /api, signed-in unless noted)

`GET /healthz` (no auth, `{status, version}`); `GET /api/state`; `POST /api/setup`, `/api/login`, `/api/totp/enable`, `/api/logout`, `/api/stepup`, `/api/password`; accounts (`GET/POST /api/accounts`, `PATCH /api/accounts/:id`, valuations); categories and rules; `POST /api/imports/preview`, `POST /api/imports`, `GET /api/imports`, `DELETE /api/imports/:id`; `GET /api/transactions`, `PATCH /api/transactions/:id`; `GET /api/reports/spending`, `/api/reports/networth`, `/api/overview`; `GET /api/export.json`, `/api/export/transactions.csv` (step-up); `GET /api/audit`.

## Operations

Logs go to stdout, one line per event. SIGTERM stops accepting requests, closes SQLite and exits (well under 10 s). Idle memory about 80-120 MB.

## Known limits

- The authenticator key is shown as text and an `otpauth://` link; there is no QR code yet.
- Rate limiting is per running process (resets on restart); no email alerts yet.
- CSV only; no PDF or institution-specific importers yet. Single user. CAD only.
- A statement's date order cannot be known when every date is 12 or less; the preview shows the parsed dates so it can be corrected.
- Real Docker build and Lighthouse were not run in the authoring environment (see the release notes).

## Not yet built (planned)

Bonus tracker and reminders with Google Calendar, AI plan builder, Questrade import and ACB tracking, further institutions, forecast and wealth projection, tax tools, weekly offer research, live data connections.
