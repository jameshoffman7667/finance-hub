# Pending changes

Requests are logged here, not built. Nothing is built until James sends a build message. IDs are never reused.

## Pending

### P-1 - Link receipts from paperless-ngx to card transactions
Requested: 2026-10-31 (James: "is there a way to connect finance hub to paperless-ngx and cross reference credit card statement items with receipts to get a fuller picture of spending?")
Type: minor (new feature, new settings)        Status: Pending
Plan (first version):
- Settings `PAPERLESS_URL` (LAN, http://192.168.4.11:8073) and `PAPERLESS_TOKEN` (read-only API token, never in the repo or the browser). The server calls Paperless; receipt text is never sent to the browser, only matches and a link.
- Read documents from `/api/documents/`: date, correspondent, title, notes, and the total.
- Match each card transaction to a receipt by exact amount, date within a few days, and merchant similarity. Confident matches are linked; weaker ones go to a review list to accept or reject. Manual decisions are never overwritten (same rule as categories).
- Show a receipt link on matched transactions, a "no receipt" filter above an amount, and lists of unmatched receipts and unmatched charges.
- PayPal receipts are all under one "PayPal" correspondent, so the merchant must be read from the title or notes.
Later (separate release): split one charge across categories from receipt line items.
Notes / questions:
- Where does the receipt total come from? Best: the Outlook import writes it into a Paperless custom field. Otherwise it is read from the OCR text, which is less reliable (about 3,700 emails in "Purchases", some will have no clear total).
- Finance Hub is reachable through Cloudflare Access but the Paperless API is LAN-only: the container must reach 192.168.4.11:8073 directly (compose network or host route). Needs a check on the server.
- Currency handling for foreign receipts: match on the card-posted amount, or the receipt currency?

### P-2 - Import card, bank and investment history from the workbook
Requested: 2026-11-02 (James: "All these items should be trackable in the app", with the filled workbook finance-hub-card-bank-investment-history.xlsx)
Type: minor (new feature, new data model)        Status: Pending
Plan: import the workbook sheets (Cards, Bank accounts, Bank account bonuses, Investment accounts, Investment bonuses, Recurring payments, Issuer rules) and keep them editable in the app.
- Card = one record with up to 4 bonuses on it (no separate bonus table in the UI); fields include status Open / Frozen (zero balance and locked) / Closed (plus Downgraded, Pending, Declined), card locked, final balance settled date, minimum spend progress, sign-up cashback, bonus consumed, bonus clawback months, statement and payment due days, credit balance to spend.
- Last 4 digits only. Never store full card or account numbers.
Notes / questions: keep the workbook as a re-importable format? Treat red-text cells as unconfirmed until accepted?

### P-3 - Reapplication rules and dates
Requested: 2026-11-02 (James: "track reapplication rules and dates ... same card or any card from the same issuer ... read welcome bonus terms")
Type: minor (new feature)        Status: Pending
Plan: a rule per issuer / product with scope (same card, same family, any card from the issuer), once per lifetime, wait months, counted from (application, approval, bonus received, closed or downgraded date), blocked while a matching card is still held, and minimum days between applications. Eligible-again date is worked out across all matching cards. Store the offer terms (text, link, offer period) with each bonus, because terms change per offer.
Notes / questions: official terms read so far for TD First Class Travel, BMO Ascend and RBC Avion; Amex pages are behind a cookie wall; others not found. Rules from forums are labelled unverified.

### P-4 - Bank account bonuses and investment accounts / transfer bonuses
Requested: 2026-11-02 (James: "add tabs for investment accounts, investment account transfer/deposit bonuses and bank account bonuses")
Type: minor (new feature)        Status: Pending
Plan: bank accounts with one row per offer; investment accounts with transfer / deposit / referral bonuses, fee reimbursement and clawback period (keep funds until). Same reapplication logic as P-3.

### P-5 - Recurring payments tracker
Requested: 2026-11-02 (James: "tab to track recurring payments - names, price, frequency, date and payment method")
Type: minor (new feature)        Status: Pending
Plan: name, price, frequency, a known charge date, card or bank account, auto-pay, status; next charge, monthly and yearly cost calculated. Detected recurring charges from statements (P-6) are proposed here, not added silently.

### P-6 - Statement upload: spend progress, bonus awards, recurring charges
Requested: 2026-11-02 (James: "When I upload statements look for the spend progress, bonus point awards or consumption, recurring spends")
Type: minor (new feature, per-issuer parsing)        Status: Pending
Plan: CSV first, then PDF parsers per issuer. Spend progress = eligible purchases since approval (net of refunds; excluding cash advances, fees and interest, as in typical terms), shown as an estimate with manual override. Bonus point lines on a statement mark an award; rewards-program redemptions are usually not on statements, so "consumed" may stay manual.
Notes / questions: which statement formats do you have (PDF, CSV from online banking)? How should manual edits and automatic values be reconciled?

### P-7 - Notifications
Requested: 2026-11-02 (James: "provision for notifications of recurring payments, credit card payment dates, bonus award dates, reapplication dates")
Type: minor (new feature, new settings)        Status: Pending
Plan: events from P-2 to P-6 (recurring charge due, card payment due, bonus qualify-by and award dates, clawback window ending, eligible-again dates, next application allowed). Channels: in-app, web push (the app is a PWA; iPhone needs it installed on the home screen), email through the existing SMTP2GO settings. Per-event lead days.

### P-8 - Calendar in the app, with Google Calendar
Requested: 2026-11-02 (James: "put this all on a calendar within the app with ability to link to a google calendar (or use a google calendar in the app?)")
Type: minor (new feature)        Status: Pending
Options: (a) in-app calendar as the source of truth plus a private subscribe-by-URL calendar feed (iCal) that Google Calendar can subscribe to: simple, read-only, but Google refreshes subscribed feeds slowly (hours); (b) two-way or push sync with the Google Calendar API: events appear quickly, needs a Google Cloud OAuth setup and stored tokens, adds a secret to protect. Recommended order: (a) first, (b) later if the delay is a problem.
Notes / questions: which Google calendar (the existing reminders go to the personal calendar)?

### P-9 - Offer watchlist: compare sign-up bonuses and cashback from comparison sites, and RedFlagDeals
Requested: 2026-11-02 (James: "compare sign up cash back bonuses per card from sites like Finly Wealth, Great Canadian Rebates, Frugal Flyer, Borrowell ... track posts about credit card offers on RedFlagDeals")
Type: minor (new feature, outside data)        Status: Pending
Plan: a watchlist of cards you hold or want, with offer value, rebate, expiry, source link and date seen. Pages are fetched only on request or on a slow schedule, cached, and only facts are stored with a link back. Compare against the issuer's own terms and your eligibility from P-3. RedFlagDeals: use whatever feed or email alert the forum offers and filter by card names.
Notes / questions: the pages read so far have no structured data or API (offer text is prose), so extraction needs review before saving. Terms of use of each site and robots rules must be checked before any scheduled fetch. Rebate-site cashback is separate from the issuer bonus and usually has its own conditions (new cardholder, income, credit score).

### P-10 - Offer planner: link offer terms, evaluate the best strategy, build a plan with reminders
Requested: 2026-11-04 (James: "link current and potential offer terms, evaluate the optimal strategy and make a plan and associated calendar reminders", after a worked comparison of the Scotia iTRADE WIN27 transfer offer against the TD Spring 2026 and Questrade 2%/4% offers)
Type: minor (new feature, new data model)        Status: Pending
Plan (first version):
- Offer record, for offers you hold and ones you are considering: issuer, product, offer window, source link, saved terms text and date seen, plus structured terms: what qualifies (transfer-in, deposit, spend), rate by account type (registered / non-registered), cap, minimum, enrol-by and fund-by dates, hold-from and hold-until dates, measuring dates, payout schedule (lump sum or installments), and what a withdrawal or transfer-out does (reduces the qualifying amount, forfeits everything remaining, or is allowed up to a percentage), whether the effect is pooled across accounts or per account, offers that cannot be combined, fee reimbursements, tax note. Status: Potential / Enrolled / Earning / Paid / Forfeited. Reapplication limits come from P-3 and P-4.
- Holdings: accounts with institution, type, current value and the offer each one is earning under, so in-flight bonuses at risk are known.
- Evaluator (fixed rules in code, not AI): for each option on a set of holdings it reports total cash, when the cash arrives, how long the capital is locked, the equivalent annual return (bonus divided by years locked, and an IRR using the payout dates), bonuses forfeited by leaving, and the net of moving versus staying. It also reports the break-even: the annual return the freed capital would have to earn elsewhere for staying to win. Results are ranked by annual return, with total cash shown but not used to rank.
- Terms that are unclear (pooled versus per account, whether a transfer-out counts as a withdrawal) are shown as assumptions to confirm, never silently chosen.
- Plan: the chosen strategy saved as ordered dated steps (enrol, open account, start transfer, fund-by, do-not-withdraw-before, payout dates), each step creating reminders through P-7 and showing on the P-8 calendar. Until those exist, steps are listed with dates only.
- Terms entry: paste text or a URL, the app proposes the structured fields, and you review before saving. Pages are fetched only on request and facts are stored with a link back (same rules as P-9).
Notes / questions:
- First test case to build against: Scotia iTRADE WIN27 (3% registered / 1% non-registered, hold Nov 3 2026 to Feb 28 2029, enrol by Apr 1 2027, fund by May 31 2027) versus TD Spring 2026 (hold to Jul 31 2027) and Questrade 2%/4% (24 payments, 5% withdrawal limit).
- Rate for freed capital: a default benchmark in settings (editable), or a per-plan value?
- Should the evaluator also cover credit-card and bank-account offers (minimum spend, fee, clawback period), or investment offers only at first?

### P-11 - Bonus earnings ledger and effort / return report
Requested: 2026-11-04 (James: "track the bonuses earned from this and other offers (credit cards and bank accounts) to understand total gains and if the effort is worthwhile")
Type: minor (new feature)        Status: Pending
Plan (first version):
- Every bonus gets expected and received amounts with dates and a status (Pending / Partly paid / Paid / Clawed back / Forfeited). Installment offers record each payment as it arrives. Fed automatically from P-2, P-4 and P-6 where an award is detected, manual otherwise. Card points are valued at a cents-per-point setting.
- Costs against each bonus: annual fees, interest paid, transfer fees net of reimbursement, foreign exchange, and the return given up on locked capital (a benchmark rate setting, applied to the capital and the days it was locked).
- Effort: optional hours per offer, with a default estimate per offer type, so a dollars-per-hour figure can be shown.
- Reports: gross and net gains by year, by type (card, bank, investment transfer) and by issuer; annualized return on locked capital for investment offers; dollars per hour; a "worth it" flag against a minimum dollars-per-hour you set; a tile on the dashboard. Totals are labelled as estimates when any part is estimated.
- Taxes are a flag only (a reminder that cash bonuses may be taxable and some issuers send no slip), not a calculation.
Notes / questions:
- What minimum dollars per hour counts as worth it, what cents per point should be used, and what benchmark rate (for example a high-interest savings rate) for the cost of locked capital?
- Import the history already in the workbook (P-2) as past bonuses, including ones now closed or clawed back?

## Done
(none yet)
