# Finance Hub: functional specification (current state, v0.3.0)

Personal finance manager for one household on James's home server. This file describes what the app does now; later features (statement analysis, notifications, calendar, investments, forecast, tax) are listed under Not yet built. The full product plan lives in the Project "Financial Management".

## Purpose and scope in this release

Sign in securely, record accounts and balances, import bank statements from CSV, categorise transactions, and see net worth and spending by category. From v0.2.0 also: track credit cards, bank and investment accounts and their sign-up bonuses, re-application rules with eligible-again dates, and recurring payments, optionally loaded from the history workbook. Used by one login (James); a second person can be added in a later release.

## Areas of the app

Seven areas, shown in the desktop sidebar. Phone bottom navigation shows Overview, Budget, Cards, Invest and More (More lists Tax, Accounts and imports, Settings).

| Area | State |
| --- | --- |
| Overview | Built. Net worth, trend chart, this month's spending, "uncategorised" reminder |
| Budget and forecast | Spending by category by month, transactions with categorise, categories and rules. Forecast tab is a placeholder |
| Cards and bonuses | Built in v0.2.0: cards, bank accounts, investment accounts, recurring payments, re-apply rules, workbook import (see Cards and bonuses below) |
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

## Cards and bonuses (v0.2.0)

One page, six tabs: Credit cards, Bank accounts, Investment accounts, Recurring payments, Re-apply rules, Import workbook. Every list opens an edit form; Add buttons create records. Only the last 4 digits of a card or account number are stored (the database and the form refuse anything longer).

- **Credit cards.** One record per card with up to 4 bonuses on it. Status: Open, Frozen (zero balance, locked), Closed, Downgraded, Pending, Declined. Fields: owner, issuer, product, family, network, personal or business, last 4, locked, application and approval dates with date confidence, credit limit, annual fee, first-year fee waived, hard check, referral, rewards program, point value in cents per point (cash and best use), statement and payment due days, downgrade date and target, closed date, final balance settled date, why closed, credit balance to spend, minimum spend progress with as-of date, sign-up cashback received, bonus consumed (No / Partly / Yes) and date, clawback months, rule, notes. Each bonus: type, offer text, points or cash, spend required, months to qualify, outcome (In progress, Earned, Missed, Forfeited), date received, offer link, offer start and end, saved terms text.
- **Worked out for each card:** qualify-by date (approval date plus months), next deadline, spend still needed, an alert within 30 days of the deadline or after it, points earned, bonus value at the cash and best-use point values, keep-the-card-until date (latest earned bonus plus clawback months), next payment due date, and the re-application result.
- **Bank and investment accounts.** Institution, type, name, last 4, status (Open, Closed by me, Closed by institution, Converted, Transferred out, Dormant), opened and closed dates, fees, and any number of bonuses each: type, offer, amount offered, requirement, minimum deposit or transfer, amount deposited, fee reimbursed, months to qualify, months funds must stay, outcome, date received, amount received, referral, offer link and terms. Worked out: qualify-by, keep-funds-until with a clawback status, bonuses received, re-application result.
- **Re-apply rules.** A rule has an issuer or institution, optional product names (comma separated), a scope (same card, same card family, any card from the issuer, any account from the institution), once per lifetime, wait months, which date the wait counts from (application, approval, bonus received, closed or downgraded, downgrade), blocked while a matching card or account is still held, minimum days between applications, source and last-checked date, and a Confirmed flag. A card or account uses the rule it names, otherwise the most specific rule for its issuer (one naming the product beats a blanket rule). Result per card or account, checked in this order: no rule on file; once per lifetime and already used; blocked because a matching one is still held; wait period not set; date missing; "Eligible from DATE" or "Eligible now". The wait counts from the latest matching date across every card or account the rule covers; a downgrade counts as closing the old product. Next application allowed = latest application date plus the minimum days.
- **Recurring payments.** Name, category, price, frequency (weekly, every 2 weeks, monthly, every 2 months, quarterly, every 6 months, yearly), any known charge date, paid by (card, account or other text), auto-pay, status (Active, Paused, Cancelled), end date, remind-me days. Worked out: next charge, monthly and yearly cost, payment method. Month steps keep the day where possible and use the last day of shorter months.
- **Summary** at the top of the Credit cards tab: counts of open, frozen and closed cards and a list of alerts (bonus deadlines, clawback periods still running, recurring charges due within their reminder window). Reminders are shown in the app only; sending them is not built yet.
- **Import workbook.** Upload the history workbook (.xlsx; sheets Cards, Bank accounts, Bank account bonuses, Investment accounts, Investment bonuses, Recurring payments, Issuer rules; header row 4; example rows skipped). The file is read on the server and not kept. A preview shows counts, existing matches and problems (an unreadable optional value is left blank with a warning; a bonus pointing at an unknown account is skipped). Mode "add new only" skips records whose ID or name already exists so edits made in the app are safe; "replace" overwrites them. Cells with red text are stored as "to check" (shown in red with a To check label) until the field is edited or "Mark all as checked" is pressed. Rules that were red are marked Unverified.
- **Not built yet:** statement upload analysis (spend progress, awards, detected recurring charges), notifications and e-mail, calendar and Google Calendar, offer watchlist, exporting back to the workbook.

## Statements, reminders and calendar (v0.3.0)

Three more tabs on the Cards and bonuses page.

- **Statements.** Choose a card and a statement CSV (header row with a date, a description and an amount, or separate debit and credit columns; date format and the sign of charges can be set). The app shows the eligible spend since the card's approval date (charges minus refunds; lines mentioning fees, interest, cash advances or balance transfers are left out; payments are ignored), any bonus lines (description with "bonus", "welcome", "sign-up" or "award", points read from the text), and charges that repeat about monthly with a similar amount (three times, or twice with the same amount). Nothing is saved until you press Save: it can add the spend to the card's progress (the covered dates and amount are kept so the same period is refused a second time unless you force it), mark the first in-progress bonus as earned on the bonus line's date, and add repeating charges as recurring payments marked to check. The CSV itself is not stored. Spend is an estimate; the card's terms decide what counts.
- **Reminders.** Events: recurring payment due, card payment due (from the due day), bonus qualify-by, clawback period ends, eligible for a new bonus again, next application allowed. Each can be switched off and has its own lead days (defaults 3, 3, 14, 14, 14, 7) and its own e-mail and push switches. A check runs 30 seconds after start and then hourly (and on "Check now"); each event creates one inbox entry the first time it is inside its lead time. E-mail goes to the address on this tab through the server's SMTP settings (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM; without SMTP_HOST and SMTP_FROM e-mail is held back). Web push uses keys the app makes itself and keeps in its database; each device turns it on from this tab (on iPhone the app must be added to the Home Screen first).
- **Calendar.** Month grid with colored dots and a list for the picked day, built from the same events plus bonuses received. A private feed address (/cal/<long random code>.ics, covering 30 days back to 18 months ahead, event names only, no amounts) can be added to Google Calendar with Other calendars > From URL; Google refreshes such feeds every few hours. The address can be replaced, which stops the old one. The feed needs no sign-in, so the Cloudflare Access rule must allow the /cal/ path.
- **API:** `GET /api/calendar?from&to`, `GET /api/calendar/feed`, `POST /api/calendar/feed/rotate`, `GET /cal/<code>.ics` (public), `GET /api/notifications`, `POST /api/notifications/run|read-all|:id/read|test-email`, `GET|PUT /api/notifications/settings`, `GET /api/push/key`, `POST /api/push/subscribe|unsubscribe`, `POST /api/offers/cards/:id/statement/analyze|apply`.
- **Data:** schema 3 adds notify_prefs, notifications, push_subs, statement_runs. Settings table keys: notify_email, ical_token, vapid (push keys).
- **Not built yet:** PDF statements, bank-account statements, two-way Google Calendar sync.

## Offer planner and bonus ledger (v0.4.0)

Six more tabs on the Cards and bonuses page: Offers, Holdings and debts, Compare, Plans, Bonus ledger, Planner settings.

- **Offers.** One record per offer (investment transfer, bank account or credit card) with status (Potential, Enrolled, Earning, Paid, Forfeited), window, source link, saved terms text and the structured terms: minimum, largest bonus, rate for registered and non-registered money, fixed cash or points (with the program), spend required, annual fee, enrol-by, fund-by, hold start and end, dated payouts (one per line: a date then 40% or $500), and what a withdrawal does (reduces the qualifying amount, forfeits everything unpaid, allowed up to a percent, none, unknown) and whether that is pooled or per account. Terms are typed in by hand in this release.
- **Holdings and debts.** A holding is an account that could move: type (RRSP, TFSA, RESP, FHSA, non-registered, chequing, savings), value, whether it is invested, interest rate, the offer it counts toward and the amount counted, and whether it was bought with borrowed money. Debts have a balance and a rate.
- **Evaluator (fixed rules in code).** For an amount and a start date: bonus, payout dates, lock-up years, simple annual return and IRR (money out at the start, back at the hold end, bonus at the payout dates), opportunity cost, debt flag. Opportunity cost applies only to money that is not invested (the benchmark minus its interest, for the lock-up); invested money keeps earning either way, so it costs nothing. The debt flag appears only for cash-like money and only when a debt rate is higher than the offer's return; holdings marked as bought with borrowed money are skipped. Credit cards: bonus (cash plus points at the cash value, best-use value shown beside it) minus first-year fee, interest, extra spend and an optional cost per credit check. Moving a non-registered holding or a borrowed-money holding shows information-only tax warnings.
- **Compare.** Pick a holding and offers; for each option: bonus, return per year, locked years, what leaving the current offer gives up (by its withdrawal rule, pooled across holdings counted under it), net versus staying, and the break-even (the yearly return the freed money must earn elsewhere for staying to win, over the extra lock-up). Ranked by return per year, not total cash. Anything not known (pooled or per account, real transfer amounts and dates, unconfirmed terms) is listed as an assumption.
- **Plans.** A plan is a list of dated steps, made from an offer (enrol, fund, hold start, each payout, hold end, window close) or by hand. Steps with Remind on appear in Reminders (event Offer plan step, 7 days before by default), on the Calendar and in the private feed.
- **Bonus ledger.** Records of bonuses (card, bank, investment) with expected and received amounts, dates, status (Pending, Partly paid, Paid, Clawed back, Forfeited), money locked and its dates, whether it kept earning, and costs (fees, interest, transfer fees net of reimbursement, foreign exchange). Time is logged per record in hours; expected hours start at 2 per card, 4 per bank account and 4 per investment transfer, and the settings tab proposes the average of finished records for you to accept. Reports: received and net by type, year and issuer, return per year on locked money, dollars per hour and a worth-it flag against the line you set ($50 an hour by default). Totals that include an estimate are labelled. A tile on Overview shows the net. Taxes: a note only (cash bonuses may be taxable; some issuers send no slip).
- **Planner settings.** Benchmark return (7%), worth-it line ($50 per hour), cost of a credit check ($0), expected hours, and the table of points values (cents per point: cash and best use, with source and date; edited by hand and checked quarterly).
- **API:** `/api/offers/offers|holdings|debts|ledger` (list, add, change, delete like the other record types), `POST /api/planner/evaluate|compare`, `GET|POST /api/planner/plans`, `POST /api/planner/plans/:id/steps`, `PATCH|DELETE /api/planner/steps/:id`, `DELETE /api/planner/plans/:id`, `GET|POST /api/planner/effort`, `DELETE /api/planner/effort/:id`, `GET /api/planner/report`, `POST /api/planner/ledger/from-offer/:id`, `GET|PUT /api/planner/settings`.
- **Data:** schema 4 adds offer_terms, holdings, debts, ledger_entries, plans, plan_steps, effort_logs. Settings key: planner.
- **Not built yet:** fetching offer pages or proposing terms from pasted text, automatic points-value refresh, automatic ledger entries from statement awards.

## Smith Manoeuvre and tax support (v0.5.0)

- **Investments page (Smith Manoeuvre).** Loans (debts tagged Smith Manoeuvre: mortgage, HELOC, other) with limit, interest day and opened date; holdings tagged the same way with value and cost base; loan records (advance used to invest, advance for something else, interest capitalized, interest paid, principal paid) and income records (dividend, interest, return of capital, distribution). Shows loan balance, investments, net position, cost base and unrealised amount, borrowing room, interest by year with an estimated tax value (interest x the marginal rate saved for that year; labelled estimate), cumulative figures, a rate-rise stress test and warnings (registered account tagged by mistake, personal-use advance, investing advance not matched to a purchase, return of capital not reinvested, missing tax rate). A monthly reminder per loan with an interest day stays open and overdue until the capitalizing advance is recorded with its amount; overdue ones show on Overview and in reminders and the calendar. CSV of loan records per year.
- **Tax (information only).** Per tax year: overview (net capital gain and taxable half estimate, fees, donations, loan interest and its estimated tax value, best 12-month medical window and claim estimate, superficial-loss flags, bonus register with tax flag, checklist, carry-forwards, CSV download); capital gains with pooled average cost per security across brokers (buys, reinvested distributions, return of capital, splits, sales; registered accounts left out; foreign amounts converted with the rate typed on each trade; oversell warnings; superficial-loss flag when the same security is bought within 30 days either side and still held; net capital losses applied from carry-forwards); receipts and medical (net of reimbursements, best window, threshold the lesser of 3% of net income and the fixed amount you enter); slips and income (expected T5 and T3 amounts from recorded income against slips entered, with differences); registered room (entered from CRA My Account); years (net income, marginal rate, medical threshold per year and person) and carry-forwards; review (findings only: unused room, RESP, holdings below cost with superficial-loss trap, loan interest not marked claimed, unclaimed receipts, bonuses without a tax flag, foreign property, different household rates).
- **API:** `GET /api/smith/summary`, `POST /api/smith/loans/:id/capitalized`, `GET /api/smith/export.csv?year`, `GET /api/tax/overview|review|acb|export.csv`, `POST /api/tax/checklist`, and record routes `/api/offers/loan_events|income_events|tax_years|receipts|trades|slips|room|carry`.
- **Data:** schema 5 adds loan_events, income_events, tax_years, tax_receipts, acb_trades, tax_slips, registered_room, carryforwards, tax_checklist; columns on debts (loan_type, limit_cents, cap_day, opened_on), holdings (acb_cents, foreign_prop), ledger_entries (tax_flag).
- **Not built yet:** receipt scans from paperless-ngx (P-1), Questrade statement import, automatic exchange rates, a tax calculation.

## Wealth overview (v0.6.0)

A Wealth page (also under More on phones) with five tabs.

- **Balance sheet.** As of a chosen date: assets by group (cash, registered, investments, property, other) and debts (mortgage, cards, loans, other) from your account values, plus loans from the planner split into Smith Manoeuvre and other; net worth; Smith Manoeuvre investments; money tied up in offers (holdings counted toward an offer). Loans should be entered in one place only.
- **Cash flow.** Any range (this month, last 12 months, a year, custom). Income: Employment, Investment (dividends, interest, realised capital gains and losses), Strategic (bonuses received, Smith Manoeuvre estimated tax value). Spending: Run rate, Annual special, Extraordinary, Debt service (including Smith loan interest). Each category goes under a group (default: income to Employment, expense to Run rate; editable in Settings and categories); transfers are left out; uncategorised items are listed as such. Loan principal repaid is its own line, not spending. Investment growth is a separate unrealised, non-cash line from the change in investment account values minus recorded transactions in those accounts.
- **Projection.** Month by month for the length you set (default 10 years) from averages over a look-back (default 12 months) of income, run-rate spending and debt service; annual special items in their month each year; approved extraordinary and potential items when planned; bonus payouts on their scheduled dates; investments at an assumed return (default 7%, 0 turns it off); cash left over stays in cash unless you choose to invest it; an extra HELOC rate test. A second line shows the plan with the spends you are only considering, and months where cash flow turns negative are listed. Falls back to recurring payments when there are no transactions in the look-back.
- **Planned and potential spends.** Name, amount, kind (annual special, extraordinary, potential), once, monthly or yearly, dates, status (considering, approved, dropped), optional category and card (shows the card's remaining minimum spend).
- **API:** `GET /api/wealth/balance?date`, `GET /api/wealth/cashflow?from&to`, `GET /api/wealth/projection`, `GET /api/wealth/items`, `GET|PUT /api/wealth/settings`, `GET /api/wealth/categories`, `PATCH /api/wealth/categories/:id`, record routes `/api/offers/plan_items`.
- **Data:** schema 6 adds plan_items and categories.flow_group. Settings key: wealth.
- **Not built yet:** seeding yearly items from notes, automatic ties between the projection and offer plans beyond ledger payouts, goals.

## Receipts and offer watchlist (v0.7.0)

- Receipts (Budget > Receipts): optional link to paperless-ngx (`PAPERLESS_URL`, `PAPERLESS_TOKEN`, `PAPERLESS_PUBLIC_URL`, `PAPERLESS_TOTAL_FIELD`). Sync reads documents (title, correspondent, date, notes, total from the custom field or the OCR text); text is not stored. Each credit-card charge is matched to at most one receipt with the same amount dated within 5 days; a similar merchant name (PayPal: title and notes) makes it linked, otherwise it goes to a review list (Yes/No). Your decisions are never overwritten by later syncs. Lists: charges with no receipt (minimum amount filter), receipts with no charge, manual link. Transactions show "receipt filed" and the API filter `no_receipt=1`.
- Watchlist (Cards and bonuses > Watchlist): offers you spot, with source, whether seen on the issuer's own site, date seen, end date, bonus, points and program, rebate, fee. Check page reads one address on request (https only, never private addresses, robots.txt respected, size and time limits) and shows amounts, points, dates and fees found; nothing is saved from it. Check a feed reads an RSS address and shows items naming something watched. Compared view groups by issuer and product, values points with the Planner settings, marks unverified figures and ended offers.
- API: `/api/receipts/{status,sync,review,linked,unmatched,link}`, `/api/receipts/links/:id[/accept|/reject]`; `/api/watch/{compare,feed}`, `/api/watch/:id/{fetch,pages}`; list/add/edit under `/api/offers/watch`.

## Accounts, lists and sub-categories (v0.8.0)

- Accounts screen groups accounts by institution, then owner ("No owner"), with balance totals (debts subtracted); groups collapse; closed accounts sit last. Everywhere accounts are picked or listed they show as "Name, Institution, Type, Owner" (empty parts left out).
- Add and edit account: institution and owner are pick lists of values already used, with "Add new…". Edit changes name, institution, owner, type (asset/debt kind follows type) and closed. Delete asks each time: no data, a simple confirm; with data, close instead or delete everything attached after a confirmation showing counts.
- Import: columns for Description, Comment and Reference (and Balance) are mapped in the preview and remembered per account. Comment and reference are searchable, exported and not editable after import; rules can match description, comment, reference or any. Balance: file balance column (last row by date) else last saved balance moved by new lines; shown with a Save checkbox before import; a balance typed by hand for the same date is kept unless you tick Replace. Debts are saved as positive amounts owed.
- Categories ship with the app and cannot be added by users; they can be renamed or removed (with a choice of where transactions go). New shipped: Credit card payment (transfer), Loan payment (expense, debt service), Cash withdrawal (expense), Cash deposit (income), Cash returned to account (reduces spending; nets into Cash withdrawal), Children and Pets.
- Sub-categories: optional, one level, added by the user (suggested names per category are offered in Settings > Lists), inherit the category kind, can have their own Wealth cash-flow group, can be chosen by rules and when categorising; spending report rolls them up with an expand toggle.
- Settings > Lists: institutions and owners (rename, remove with usage counts), categories and sub-categories.
- Categorising a transaction ticks "Always use this category" by default.
- API: `/api/accounts/:id/usage`, `DELETE /api/accounts/:id` (body `delete_data`), `/api/lists`, `/api/lists/:institution|owner/{rename,remove}`, `/api/subcategories`, `DELETE /api/categories/:id` (body `move_to`), `/api/categories/:id/suggested`. `POST /api/categories` is removed.

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

See `deploy/.env.example`. Optional paperless: `PAPERLESS_URL`, `PAPERLESS_TOKEN`, `PAPERLESS_PUBLIC_URL`, `PAPERLESS_TOTAL_FIELD`. Required: `APP_SECRET_KEY` (32+ characters; the app refuses to start without it). `PORT` (listening port; default 8070, set by compose from `PORT_HOST`). Others: `APP_URL`, `COOKIE_SECURE`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_IDLE_MINUTES`, `MAX_UPLOAD_MB`, `TRUST_PROXY`, `LOG_LEVEL`, `TZ`.

## Data and storage

- `/data/finance-hub.db` (SQLite, WAL: copy `.db`, `-wal` and `-shm` together, or stop the container first). `/data/backups/` receives a copy before any data-changing migration. `/files` is reserved for statements (not used yet).
- Schema version 7 (v0.7.0 adds paperless_docs, receipt_links, watch_offers, watch_pages; v0.6.0 adds plan_items and categories.flow_group; v0.5.0 adds loan_events, income_events, tax_years, tax_receipts, acb_trades, tax_slips, registered_room, carryforwards, tax_checklist; v0.4.0 adds offer_terms, holdings, debts, ledger_entries, plans, plan_steps, effort_logs; v0.3.0 adds notify_prefs, notifications, push_subs, statement_runs; v0.2.0 adds cards, card_bonuses, inst_accounts, acct_bonuses, recurring, issuer_rules; no data is changed, so no pre-migration copy is made). Migrations are forward-only and run at start-up inside a transaction.
- Time stored in UTC; dates are plain calendar dates; display uses America/Toronto.

## API (JSON, all under /api, signed-in unless noted)

`GET /healthz` (no auth, no private data, no outside services; exactly `{"status":"ok","version":"<image tag>"}`, 503 `status:"error"` if the local database cannot be read); `GET /api/state`; `POST /api/setup`, `/api/login`, `/api/totp/enable`, `/api/logout`, `/api/stepup`, `/api/password`; accounts (`GET/POST /api/accounts`, `PATCH /api/accounts/:id`, valuations); categories and rules; `POST /api/imports/preview`, `POST /api/imports`, `GET /api/imports`, `DELETE /api/imports/:id`; `GET /api/transactions`, `PATCH /api/transactions/:id`; `GET /api/reports/spending`, `/api/reports/networth`, `/api/overview`; `GET /api/export.json`, `/api/export/transactions.csv` (step-up); `GET /api/audit`. Offers (v0.2.0): `GET /api/offers/schema`, `GET /api/offers/summary`; for each of `cards`, `accounts`, `recurring`, `rules`: `GET /api/offers/<name>`, `POST /api/offers/<name>`, `PATCH /api/offers/<name>/:id` (bonuses sent with it replace the existing ones), `POST /api/offers/<name>/:id/confirm`, `DELETE /api/offers/<name>/:id`; `POST /api/workbook/preview` and `/api/workbook/import` (JSON with `file_base64`, optional `mode` add_only or overwrite). The JSON export includes the v0.2.0 tables.

## Operations

Logs go to stdout, one line per event. SIGTERM stops accepting requests, closes SQLite and exits (well under 10 s). Idle memory about 80-120 MB.

## Known limits

- The authenticator key is shown as text and an `otpauth://` link; there is no QR code yet.
- Rate limiting is per running process (resets on restart); no email alerts yet.
- CSV only; no PDF or institution-specific importers yet. Single user. CAD only.
- A statement's date order cannot be known when every date is 12 or less; the preview shows the parsed dates so it can be corrected.
- Real Docker build and Lighthouse were not run in the authoring environment (see the release notes).

## Not yet built (planned)

Questrade import and ACB tracking, further institutions, forecast and wealth projection, tax tools, weekly offer research, live data connections.

## Releases
A release is a push to `main` that changes the version in `package.json` (CHANGELOG entry required: Short up to 50 characters, Long up to 250). The `release` GitHub Actions workflow reads the version X.Y.Z, stops if the tag vX.Y.Z or a GitHub release for it already exists or the CHANGELOG entry is missing or invalid, builds and pushes the image tags X.Y.Z, X.Y and latest, then runs `gh release create vX.Y.Z --target $GITHUB_SHA`, which also creates the tag. A push to `main` that does not change the version does nothing. A manually pushed `vX.Y.Z` tag runs the same workflow as a fallback; both triggers share a concurrency group per version, so only one of them can release a version.
