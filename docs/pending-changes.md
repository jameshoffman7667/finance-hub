# Pending changes

Requests are logged here, not built. Nothing is built until James sends a build message. IDs are never reused.

## Pending

### P-16 - Gift card tracker with "you are near a store" alert
Requested: 2026-11-08 (James: "add a gift card tracker. The user can enter gift card stores and totals to track. If they grant location to the app it would notify them that there is an unused gift card available when they are near that store.")
Type: minor (new feature, new screen, new table, new API)        Status: Pending
Decisions (2026-11-08, James): (1) background location alerts belong to the native app, which he will build soon; (2) alerts cover all branches of a store, not only saved ones; (3) location is never sent to the server: the check runs on the device.
Plan (first version):
- Gift cards screen: add a card with store (chain name), balance, optional last 4 digits or label, expiry date, notes, status (unused, partly used, used up). Record spending to reduce the balance, with a history. Show total unused value and cards expiring soon. Card numbers and PINs are not stored.
- API for the native app: list of cards with an unused balance (store name, balance, expiry) so the app can decide when you are near any branch of that store. Branch lookup and the location check happen on the device; Finance Hub never receives your position.
- Expiry reminders reuse the existing reminder settings (e-mail, push, calendar).
Notes / questions:
- Is the web app to have no location feature at all in this release (alerts only in the native app)? Assumed yes.
- The native app needs a way to sign in to this API without the browser session (a token you create and can revoke). Assumed: a per-device token, created in Settings. Confirm when the native app is designed.
- Matching "all branches" needs a places service on the device side (outside requests, possibly an API key). Decide that when the native app is built.
- Gift card balances are not verified with the store; you enter and update them.

### P-17 - Institution and owner drop-downs when adding an account
Requested: 2026-11-08 (James: "When adding accounts make the institution and owner drop downs populated by previous entires in those fields.")
Type: minor (small UI change)        Status: Pending (confirmed 2026-11-08)
Plan: both fields become a choice list built from values already used on existing accounts (distinct, sorted), with a way to type a new value. No new table. The same lists are used on the edit screen (P-18).
Notes / questions: none.

### P-18 - Edit and delete accounts
Requested: 2026-11-08 (James: "Allow editing accounts including delete")
Type: minor (new screen action, new endpoint)        Status: Pending
Decision (2026-11-08, James): ask each time. Plan: each account opens an edit form (name, institution, owner, type, closed or open). Delete on an account with data asks which: close it instead, or delete it and everything attached (transactions, valuations, statements, balances, receipt links) after a confirmation that shows the counts. Deleted data cannot be recovered except from a backup. An account with no data is deleted after a simple confirmation.
Notes / questions: none.

### P-19 - Show institution, type and owner with the account name everywhere accounts are picked
Requested: 2026-11-08 (James: "in the import statement screen refer to accounts by not just their name but their institution, type and owner as well.")
Type: minor (small UI change)        Status: Pending
Decision (2026-11-08, James): everywhere. Plan: one shared account label "Name, Institution, Type, Owner" (empty parts left out) on the statement import screen and every other account picker or list (Budget, transactions, valuations, receipts, reports).
Notes / questions: none.

### P-20 - Description, Comment and Reference fields on imported statements
Requested: 2026-11-08 (James: "when importing statements add a description level 1, description level 2 and description level 3"; changed the same day to "description, comment and reference")
Type: minor (new fields, import change)        Status: Pending (confirmed 2026-11-08)
Decisions (James): Description is the main text of each line, Comment the extra memo column, Reference a reference or confirmation number. The import screen lets you map statement columns to the three fields, saved per account or format, because banks differ. The fields are not editable on a transaction afterwards, but they are searchable and exported. Category rules can match on Comment and Reference as well as Description. Existing transactions keep their one text as Description and leave Comment and Reference empty unless re-imported.
Notes / questions: none.

### P-21 - Fill an account's balance automatically from statement imports
Requested: 2026-11-08 (James: "auto populate the balance for an account from the statement imports.")
Type: minor (import change, uses existing balance history)        Status: Pending (confirmed 2026-11-08)
Plan (first version): today balances are entered by hand as dated values per account and imports do not touch them. On import, the app finds a balance in the statement and saves it as that account's balance on the statement date (source "import"), so Wealth, the balance sheet and the debt views stay current. Two ways, in this order: (1) a balance column in the file (running balance after each line; the last line gives the closing balance), mapped on the import screen like the P-20 fields; (2) if there is no balance column, ask for the closing balance on the import screen and show the app's suggestion (the previous balance plus the imported lines) to confirm. Never overwrite a balance you typed by hand for the same date without asking.
Notes / questions:
- Credit cards and loans: statements show the amount owed; it is saved as a positive balance on a liability account, as the app already does.
- Decision (James, 2026-11-08): the balance is always shown with a quick OK before it is saved, including when the file has a balance column.
- Overlaps with P-20 (column mapping), so building them together is natural.

### P-22 - Group accounts by institution, then by owner
Requested: 2026-11-08 (James: "group accounts by institution, then by owner")
Type: minor (UI change)        Status: Pending (confirmed 2026-11-08)
Decisions (James): the Accounts screen only for now (not the account pickers or the Wealth balance sheet). Group totals show balances, with liabilities subtracted.
Plan: the Accounts list shows a heading per institution, and inside each a heading per owner (accounts with no owner under "No owner"), sorted by name, with a balance total on each group. Groups can be collapsed. Closed accounts sit at the bottom of their group.
Notes / questions: none. Shares its institution and owner values with P-17 and P-19, so building together is natural.

### P-23 - Type in a new value beside any drop-down, manage the lists in Settings, add shipped categories
Requested: 2026-11-08 (James: "Add the ability to enter categorizations manually in addition to the drop down. These are then added to the drop down after. Manage these through settings to remove if required.")
Type: minor (UI change, new settings screen, new categories)        Status: Pending (confirmed 2026-11-08)
CHANGED 2026-11-08 (James: "change so that the user cannot add categories but can add sub categories"): categories can no longer be added by the user; only sub-categories can (P-25). In this entry, "type a new value" now covers institution, owner and sub-categories, not categories. The shipped category list still grows only through releases.
Decisions (James): applies to the free-choice drop-downs (transaction and rule categories, institution, owner and the like). Account type is excluded (2026-11-08): it stays a fixed list because the app's behavior depends on it. Removing a value that is still in use asks each time (move it to another value, or leave it empty). Shipped categories are removable too, with the same ask.
Plan: wherever you choose from a list (except the category list itself) you can also type a new value; it is saved and appears in the list from then on. Settings gets a "Lists" screen: each list with its values, usage counts, rename and remove.
Add to the shipped category list: Credit card payment, Loan payment. (The four "Bill - ..." categories were dropped 2026-11-08: Utilities and Housing already cover them; sub-categories may come later.)
Notes / questions:
- Credit card payment and loan payment are transfers of money you already spent (card payment) or debt payments (loan). I'd mark Credit card payment as a transfer so it is not counted as spending twice, and Loan payment as debt service (principal and interest, as the Wealth cash flow already groups it). Confirmed 2026-11-08.
- Existing databases get the new shipped categories added on upgrade; any you already created with the same name are kept as they are.

### P-24 - Shipped categories: Cash withdrawal, Cash deposit and Cash returned to account
Requested: 2026-11-08 (James: "Add cash withdrawl as a category. Not sure whether to call it a transfer or expense as the actual spending will likely never make it back on a transaction. Thining expense and Cash deposit would be income")
Type: minor (new shipped categories; builds with P-23)        Status: Pending (confirmed 2026-11-08)
Decision (James): option (c). Three shipped categories: Cash withdrawal (expense: the cash you spend never appears as a transaction, so the withdrawal is what counts as spending), Cash deposit (income: cash you earned, such as tips or sales), and Cash returned to account (reduces spending: leftover cash put back, so a withdrawal of 100 and 40 returned counts as 60 spent and does not inflate income or the savings rate).
Plan: added on upgrade as for the P-23 categories (an existing category with the same name is kept as it is). Budget and Wealth cash flow net "Cash returned to account" against spending in the same month.
Notes / questions: none.

### P-25 - Optional sub-categories
Requested: 2026-11-08 (James: "Lets add sub categories. Make suggestions for all the categories we already have. They should be optional in the app.")
Type: minor (new feature, new column, new Settings screen)        Status: Pending (confirmed 2026-11-08)
CHANGED 2026-11-08 (James: "change so that the user cannot add categories but can add sub categories"): you cannot add top-level categories; you can add (and rename, remove) sub-categories under any category. The category list is the shipped list, extended only by releases.
Plan (first version): a category can have sub-categories, one level deep (a sub-category belongs to one category). Choosing a sub-category is optional everywhere: a transaction can stay on the category alone and nothing breaks. Reports and the Budget screen roll sub-categories up into their category by default, with a way to expand a category to see its parts. Category rules can pick a sub-category. The P-23 "type a new value" and "Lists" Settings screen cover sub-categories too (including the ask-before-removal rule). Sub-categories are off until you add one: with none defined the app looks and works exactly as it does now. Existing transactions stay on their category.
Suggested shipped sub-categories (all optional, all removable, none applied to existing transactions):
- Groceries: Supermarket, Bulk and warehouse, Specialty and bakery, Household supplies
- Dining: Restaurants, Fast food, Coffee and snacks, Takeout and delivery, Alcohol and bars
- Transport: Fuel, Parking and tolls, Public transit, Taxi and rideshare, Car maintenance and repairs, Car insurance, Licence and registration
- Housing: Mortgage or rent, Property tax, Home insurance, Maintenance and repairs, Improvement, Furnishings, Condo or strata fees
- Utilities: Electricity, Heating fuel and gas, Water and sewer, Internet, Phone and mobile, Waste and recycling
- Subscriptions: Streaming and media, Software and apps, Memberships, News and magazines
- Health: Pharmacy, Doctor and dental, Vision, Therapy and wellness, Health insurance
- Shopping: Clothing, Electronics, Home and garden, Gifts, Personal care, Other
- Entertainment: Events and tickets, Hobbies, Games, Books and music
- Travel: Flights, Lodging, Car rental, Activities, Travel insurance
- Fees and interest: Account fees, Card annual fees, Interest charges, Foreign exchange fees
- Other: Donations, Government and licences, Miscellaneous
- Salary: Base pay, Bonus, Overtime and commission
- Other income: Interest and dividends, Refunds and rebates, Gifts received, Side income, Cash deposit
- Transfer: Between my accounts (Credit card payment and Loan payment stay top-level categories, James 2026-11-08)
Decisions (James, 2026-11-08): the suggested lists are right (with Improvement added to Housing and Other added to Shopping); Credit card payment and Loan payment stay top-level only; a sub-category always inherits its category's income, expense or transfer kind; the Wealth cash-flow group (run-rate, annual, extra, debt service) can be set per sub-category and falls back to the category's group.
Notes / questions:
- Can you still rename, remove or hide shipped categories (P-23 said removable with an ask)? Assumed yes, and categories you created before this change stay editable. Or lock the shipped list entirely? Recommended: keep removable with the ask, since some may never apply to you.
- The existing "add category" button goes away. Any transaction currently needing a new category would use a sub-category under the closest one; if a top-level category is missing, you ask me and it ships in a release. Fine?

### P-26 - Shipped category: Children and Pets, with sub-categories
Requested: 2026-11-08 (James: "Add a category for Children and Pets, and suggest sub categories including child care")
Type: minor (new shipped category; builds with P-23 and P-25)        Status: Pending (confirmed 2026-11-08)
Plan: add an expense category "Children and Pets" on upgrade (an existing category with the same name is kept as it is), with optional sub-categories from P-25.
Suggested sub-categories:
- Child care (daycare, nanny, babysitting, before and after school care)
- Education and activities (tuition, school fees and supplies, lessons, camps, sports)
- Children's clothing and gear
- Children's health (doctor, dental, vision, prescriptions)
- Toys and entertainment
- Allowance and gifts
- Pet food and supplies
- Veterinary and pet health
- Pet insurance
- Grooming, boarding and walking
- Pet licences and other
Decisions (James, 2026-11-08): one combined category, Children and Pets. Pets is removed from Other's suggested sub-categories and Kids from Shopping's (P-25); both live only here.
Notes / questions: none. (Child care may later feed the Tax screen's child care expense deduction; not part of this entry, log it if wanted.)

### P-27 - Tick "Always use this category" by default when categorising a transaction
Requested: 2026-11-08 (James: "default the \"Always use this category when the description contains\" to checked")
Type: patch (small UI default change)        Status: Pending
Plan: on the transaction category dialog, the checkbox "Always use this category when the description contains:" starts ticked, with the description text filled in as the pattern as it is now, so choosing a category also saves a rule. You can untick it for a one-off. The rule is only saved when a category is chosen (as today).
Notes / questions:
- A rule made from a whole bank description can be too narrow (store numbers, dates) or too wide (a short word). Should the pattern be tidied automatically (for example drop trailing store numbers and dates) or left as the text of the line? Recommended: tidy it, and show it so you can edit.
- Should saving a rule also re-categorise other uncategorised transactions that match? Today's behavior is kept unless you say so; say if you want that.

## Done

### P-1 - Link receipts from paperless-ngx to card transactions
Requested: 2026-10-31 (James: "is there a way to connect finance hub to paperless-ngx and cross reference credit card statement items with receipts to get a fuller picture of spending?")
Type: minor (new feature, new settings)        Status: Built in v0.7.0 (matches use the amount the card posted; receipts need a readable total; set PAPERLESS_* on the server and confirm the container can reach paperless)
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

### P-9 - Offer watchlist: compare sign-up bonuses and cashback from comparison sites, and RedFlagDeals
Requested: 2026-11-02 (James: "compare sign up cash back bonuses per card from sites like Finly Wealth, Great Canadian Rebates, Frugal Flyer, Borrowell ... track posts about credit card offers on RedFlagDeals")
Type: minor (new feature, outside data)        Status: Built in v0.7.0 (pages and feeds fetched only when you press a button; nothing scheduled; nothing saved automatically from a fetched page)
Plan: a watchlist of cards you hold or want, with offer value, rebate, expiry, source link and date seen. Pages are fetched only on request or on a slow schedule, cached, and only facts are stored with a link back. Compare against the issuer's own terms and your eligibility from P-3. RedFlagDeals: use whatever feed or email alert the forum offers and filter by card names.
Notes / questions: the pages read so far have no structured data or API (offer text is prose), so extraction needs review before saving. Terms of use of each site and robots rules must be checked before any scheduled fetch. Rebate-site cashback is separate from the issuer bonus and usually has its own conditions (new cardholder, income, credit score).

### P-2 - Import card, bank and investment history from the workbook
Requested: 2026-11-02 (James: "All these items should be trackable in the app", with the filled workbook finance-hub-card-bank-investment-history.xlsx)
Type: minor (new feature, new data model)        Status: Built in v0.2.0
Plan: import the workbook sheets (Cards, Bank accounts, Bank account bonuses, Investment accounts, Investment bonuses, Recurring payments, Issuer rules) and keep them editable in the app.
- Card = one record with up to 4 bonuses on it (no separate bonus table in the UI); fields include status Open / Frozen (zero balance and locked) / Closed (plus Downgraded, Pending, Declined), card locked, final balance settled date, minimum spend progress, sign-up cashback, bonus consumed, bonus clawback months, statement and payment due days, credit balance to spend.
- Last 4 digits only. Never store full card or account numbers.
Notes / questions: keep the workbook as a re-importable format? Treat red-text cells as unconfirmed until accepted?

Built: workbook (.xlsx) upload on the Cards page > Import workbook, with preview, add-only or overwrite, and red-text cells kept as "to check" until confirmed or edited. Not built: exporting back to the workbook; the workbook's Review notes sheet is not imported.

### P-3 - Reapplication rules and dates
Requested: 2026-11-02 (James: "track reapplication rules and dates ... same card or any card from the same issuer ... read welcome bonus terms")
Type: minor (new feature)        Status: Built in v0.2.0
Plan: a rule per issuer / product with scope (same card, same family, any card from the issuer), once per lifetime, wait months, counted from (application, approval, bonus received, closed or downgraded date), blocked while a matching card is still held, and minimum days between applications. Eligible-again date is worked out across all matching cards. Store the offer terms (text, link, offer period) with each bonus, because terms change per offer.
Notes / questions: official terms read so far for TD First Class Travel, BMO Ascend and RBC Avion; Amex pages are behind a cookie wall; others not found. Rules from forums are labelled unverified.

Built: rules with scope, once per lifetime, wait months, counted from, blocked while held and days between applications; eligible-again date worked out across every matching card; each bonus stores offer link, offer dates and saved terms text. Rules not confirmed against official terms show as Unverified.

### P-4 - Bank account bonuses and investment accounts / transfer bonuses
Requested: 2026-11-02 (James: "add tabs for investment accounts, investment account transfer/deposit bonuses and bank account bonuses")
Type: minor (new feature)        Status: Built in v0.2.0
Plan: bank accounts with one row per offer; investment accounts with transfer / deposit / referral bonuses, fee reimbursement and clawback period (keep funds until). Same reapplication logic as P-3.

Built: bank and investment accounts with any number of bonuses each (requirement, deposit, fee reimbursement, qualify-by, keep-funds-until clawback date) and the same re-application check.

### P-5 - Recurring payments tracker
Requested: 2026-11-02 (James: "tab to track recurring payments - names, price, frequency, date and payment method")
Type: minor (new feature)        Status: Built in v0.2.0
Plan: name, price, frequency, a known charge date, card or bank account, auto-pay, status; next charge, monthly and yearly cost calculated. Detected recurring charges from statements (P-6) are proposed here, not added silently.

Built: add and edit by hand or import; next charge, monthly and yearly cost, payment method (card, account or other); reminders are listed on the Cards page summary. Proposals from statements wait for P-6, notifications for P-7.

### P-6 - Statement upload: spend progress, bonus awards, recurring charges
Requested: 2026-11-02 (James: "When I upload statements look for the spend progress, bonus point awards or consumption, recurring spends")
Type: minor (new feature, per-issuer parsing)        Status: Built in v0.3.0
Plan: CSV first, then PDF parsers per issuer. Spend progress = eligible purchases since approval (net of refunds; excluding cash advances, fees and interest, as in typical terms), shown as an estimate with manual override. Bonus point lines on a statement mark an award; rewards-program redemptions are usually not on statements, so "consumed" may stay manual.
Notes / questions: which statement formats do you have (PDF, CSV from online banking)? How should manual edits and automatic values be reconciled?

Built: Statements tab. Upload a card statement CSV (date, description and amount or debit/credit columns); the app proposes eligible spend since approval (refunds netted, fees, interest and cash advances left out), bonus point lines and monthly repeating charges. You choose what to save. The covered dates are remembered so a statement is not counted twice. Not built: PDF statements, per-issuer parsing, redemptions (consumed stays manual).

### P-7 - Notifications
Requested: 2026-11-02 (James: "provision for notifications of recurring payments, credit card payment dates, bonus award dates, reapplication dates")
Type: minor (new feature, new settings)        Status: Built in v0.3.0
Plan: events from P-2 to P-6 (recurring charge due, card payment due, bonus qualify-by and award dates, clawback window ending, eligible-again dates, next application allowed). Channels: in-app, web push (the app is a PWA; iPhone needs it installed on the home screen), email through the existing SMTP2GO settings. Per-event lead days.

Built: Reminders tab. Events: recurring charge due, card payment due, bonus qualify-by, clawback end, eligible-again, next application allowed. Per-event on/off and lead days. Inbox always; e-mail through the server's SMTP settings; web push to devices you turn it on for. Checked every hour. Not built: reminders for statements not yet uploaded.

### P-8 - Calendar in the app, with Google Calendar
Requested: 2026-11-02 (James: "put this all on a calendar within the app with ability to link to a google calendar (or use a google calendar in the app?)")
Type: minor (new feature)        Status: Built in v0.3.0
Options: (a) in-app calendar as the source of truth plus a private subscribe-by-URL calendar feed (iCal) that Google Calendar can subscribe to: simple, read-only, but Google refreshes subscribed feeds slowly (hours); (b) two-way or push sync with the Google Calendar API: events appear quickly, needs a Google Cloud OAuth setup and stored tokens, adds a secret to protect. Recommended order: (a) first, (b) later if the delay is a problem.
Notes / questions: which Google calendar (the existing reminders go to the personal calendar)?

Built: in-app Calendar tab (month grid, day list) and a private .ics feed address for Google Calendar (option a). Needs a Cloudflare Access bypass for /cal/*. Not built: two-way Google Calendar API sync (option b).

### P-10 - Offer planner: link offer terms, evaluate the best strategy, build a plan with reminders
Requested: 2026-11-04 (James: "link current and potential offer terms, evaluate the optimal strategy and make a plan and associated calendar reminders", after a worked comparison of the Scotia iTRADE WIN27 transfer offer against the TD Spring 2026 and Questrade 2%/4% offers)
Type: minor (new feature, new data model)        Status: Built in v0.4.0 (terms are typed in; proposing terms from pasted text or a link is not built and moves to P-9; debt check skips borrowed-money holdings and compares only cash-like money)
Plan (first version):
- Offer record, for offers you hold and ones you are considering: issuer, product, offer window, source link, saved terms text and date seen, plus structured terms: what qualifies (transfer-in, deposit, spend), rate by account type (registered / non-registered), cap, minimum, enrol-by and fund-by dates, hold-from and hold-until dates, measuring dates, payout schedule (lump sum or installments), and what a withdrawal or transfer-out does (reduces the qualifying amount, forfeits everything remaining, or is allowed up to a percentage), whether the effect is pooled across accounts or per account, offers that cannot be combined, fee reimbursements, tax note. Status: Potential / Enrolled / Earning / Paid / Forfeited. Reapplication limits come from P-3 and P-4.
- Holdings: accounts with institution, type, current value and the offer each one is earning under, so in-flight bonuses at risk are known.
- Evaluator (fixed rules in code, not AI): for each option on a set of holdings it reports total cash, when the cash arrives, how long the capital is locked, the equivalent annual return (bonus divided by years locked, and an IRR using the payout dates), bonuses forfeited by leaving, and the net of moving versus staying. It also reports the break-even: the annual return the freed capital would have to earn elsewhere for staying to win. Results are ranked by annual return, with total cash shown but not used to rank.
- Terms that are unclear (pooled versus per account, whether a transfer-out counts as a withdrawal) are shown as assumptions to confirm, never silently chosen.
- Plan: the chosen strategy saved as ordered dated steps (enrol, open account, start transfer, fund-by, do-not-withdraw-before, payout dates), each step creating reminders through P-7 and showing on the P-8 calendar. Until those exist, steps are listed with dates only.
- Terms entry: paste text or a URL, the app proposes the structured fields, and you review before saving. Pages are fetched only on request and facts are stored with a link back (same rules as P-9).
Decisions (James, 2026-11-04):
- Benchmark return 7% (setting), also the expected return of any market-invested account. Opportunity cost applies only when capital is not still earning: invested capital that stays invested costs nothing; chequing / savings money is compared at its interest rate against the 7%.
- Scope covers investment, bank account and credit card offers. Cards have almost no opportunity cost beyond the credit score effect; bank accounts are evaluated like investments, including whether leaving early makes sense.
- Evaluate against the cost of any debt held; an offer may not make sense while holding debt.
Notes / questions:
- First test case to build against: Scotia iTRADE WIN27 (3% registered / 1% non-registered, hold Nov 3 2026 to Feb 28 2029, enrol by Apr 1 2027, fund by May 31 2027) versus TD Spring 2026 (hold to Jul 31 2027) and Questrade 2%/4% (24 payments from Sept 2026, 5% withdrawal limit). Full detail and expected figures (hypothetical fixture amounts) are in docs/handoff-P10-P11.md.
- Should invested capital also be checked against debt rates, or only cash-like capital?
Decisions (James, 2026-11-04, second round):
- Points valuation default is cash value, with the best-use value shown beside it (seed best-use values in the handoff). The workbook now has a best-use column.
- Debt check: skip holdings tagged Smith Manoeuvre (P-12), because investing borrowed money is the strategy. Debts and loans share one table with P-12 so the HELOC rate feeds both.
- If an option needs a sale in a non-registered account, warn about the taxable gain and the superficial-loss rule (P-13); for a Smith Manoeuvre account also warn that moving the money could break the interest tracing.
- Total return rule (James, 2026-11-04): wherever a total or annual return is shown (P-10 evaluator, P-11 report, P-12 net position, P-15 projection) it includes the estimated tax value of deductible carrying costs. The estimate uses interest paid from the statements and your income (P-13) at the marginal rate for the tax year, labelled as an estimate and informational only.

### P-11 - Bonus earnings ledger and effort / return report
Requested: 2026-11-04 (James: "track the bonuses earned from this and other offers (credit cards and bank accounts) to understand total gains and if the effort is worthwhile")
Type: minor (new feature)        Status: Built in v0.4.0 (time is entered as hours, no timer yet; point values are edited by hand each quarter; automatic entries from statement awards not yet)
Plan (first version):
- Every bonus gets expected and received amounts with dates and a status (Pending / Partly paid / Paid / Clawed back / Forfeited). Installment offers record each payment as it arrives. Fed automatically from P-2, P-4 and P-6 where an award is detected, manual otherwise. Card points are valued at a cents-per-point setting.
- Costs against each bonus: annual fees, interest paid, transfer fees net of reimbursement, foreign exchange, and the return given up on locked capital (a benchmark rate setting, applied to the capital and the days it was locked).
- Effort: actual time is tracked per offer (enter hours or use a start / stop timer). Expected time per offer type starts at 2 hours per credit card, 4 hours per bank account and 4 hours per investment account; once a few offers of a type are finished the app proposes the average actual time as the new expectation and you confirm. Dollars per hour uses actual time, or the expectation when no time is logged yet.
- Reports: gross and net gains by year, by type (card, bank, investment transfer) and by issuer; annualized return on locked capital for investment offers; dollars per hour; a "worth it" flag against a minimum dollars-per-hour you set; a tile on the dashboard. Totals are labelled as estimates when any part is estimated.
- Taxes are a flag only (a reminder that cash bonuses may be taxable and some issuers send no slip), not a calculation.
Decisions (James, 2026-11-04):
- Worth-it threshold $50 per hour (setting).
- Points valuations come from an online source (Credit Card Genius, cross-checked with Prince of Travel), stored with source and date, refreshed quarterly and confirmed before saving.
- Cost of locked capital follows the P-10 rule: 7% benchmark, applied only when the capital is not still earning.
Notes / questions:
- Import the history already in the workbook (P-2) as past bonuses, including ones now closed or clawed back?
Decisions (James, 2026-11-04, second round):
- P-11 is the single source of bonus amounts; P-13's bonus register reads from it and adds the taxable / not taxable / unsure flag.
- Total return rule (James, 2026-11-04): wherever a total or annual return is shown (P-10 evaluator, P-11 report, P-12 net position, P-15 projection) it includes the estimated tax value of deductible carrying costs. The estimate uses interest paid from the statements and your income (P-13) at the marginal rate for the tax year, labelled as an estimate and informational only.

### P-12 - Smith Manoeuvre tracker
Requested: 2026-11-04 (James: "track my smith maneuver progress - the outstanding debt, the investment value, total interest for tax purposes, etc. I can mark the loan and investment accounts associated with the smith maneuver manually")
Type: minor (new feature, new account tags)        Status: Built in v0.5.0 (the estimated tax value is shown in the Smith summary only; the P-10 evaluator and P-11 report have no carrying costs to add yet)
Plan: tag loan accounts (mortgage and HELOC segments) and non-registered investment accounts as "Smith Manoeuvre" by hand. Track: mortgage balance and principal repaid, HELOC balance split into investment-loan, capitalized interest and anything else, borrowing room, investment value and ACB, income received (dividends, interest, return of capital), interest paid per year (deductible carrying charge, claimed on line 22100), cumulative interest, estimated tax refund at a marginal rate you enter, and net position (investments minus debt). Warnings: HELOC withdrawals that do not match an investment purchase (tracing gap, personal use of the investment loan), registered accounts tagged by mistake (RRSP, TFSA, FHSA, RESP interest is not deductible), return of capital kept instead of reinvested, rate-rise stress test. Yearly export: interest by loan with borrowed amounts and dates, for your tax software and accountant.
Notes / questions: lender and product? Is interest paid from cash or capitalized? Do you re-advance monthly? Are the loan accounts on a statement the app can read?
Decisions (James, 2026-11-04, second round):
- Interest is capitalized by hand each month. The app creates a monthly reminder per Smith Manoeuvre loan (through P-7, shown on the P-8 calendar). A reminder is not cleared until the statement shows the interest-capitalizing advance, or you confirm with the amount; until then it stays open and overdue, and overdue ones show at login.
- Estimated tax value of the carrying costs = interest paid (from loan statements) at the marginal rate from your income (P-13), per tax year, labelled as an estimate. wherever a total or annual return is shown (P-10 evaluator, P-11 report, P-12 net position, P-15 projection) it includes the estimated tax value of deductible carrying costs. The estimate uses interest paid from the statements and your income (P-13) at the marginal rate for the tax year, labelled as an estimate and informational only.
- Loans share one debt table with P-10. Moving or selling in a Smith Manoeuvre account triggers the tracing and capital gain warnings in P-10.

### P-13 - Tax support center (information only)
Requested: 2026-11-04 (James: "Add a tax support center if not already included ... investment carrying costs, medical costs, capital gains and losses with ACB, tracking, expected T5 values for interest and dividends, etc. Benchmark other tax software for suggestions")
Type: minor (new feature area; the ACB part was already on the roadmap)        Status: Built in v0.5.0 (information only; receipts have no paperless links until P-1; single taxpayer rows with an optional person name)
Plan: one place per tax year, clearly labelled information only (you still calculate and file in accredited software). Sections:
- Investment carrying charges: interest on investment loans (from P-12), investment counsel / safekeeping fees on non-registered accounts, with receipts linked from paperless-ngx (P-1).
- Medical expenses: receipts by person, any 12-month period ending in the tax year (finds the best window), family pooling, insurance reimbursements subtracted, running total against the claim threshold.
- Capital gains and losses with ACB: pooled across brokers per taxpayer, reinvested distributions, return of capital, foreign currency at Bank of Canada rates, stock splits, superficial-loss warnings (30 days either side, including purchases in spouse or registered accounts), transfers between institutions keeping the ACB, net capital loss carry-forwards, a Schedule 3 style summary.
- Expected slips: expected T5 (interest, dividends), T3, T5008 and T4 amounts per institution from statements; upload the real slips when they arrive and the app shows the differences.
- Bonus register: bank, brokerage, referral and credit card bonuses with a taxable / not taxable / unsure flag and the amount, so nothing is forgotten.
- Registered accounts: RRSP, TFSA, FHSA and RESP (CESG) contributions and room, entered from your CRA My Account figures.
- Document checklist, carry-forwards (losses, donations, unused credits), and CSV / PDF export for tax software.
Notes / questions: overlaps P-11 only on bonus income (P-11 flags tax, P-13 keeps the register of amounts and taxable status); keep one source of bonus amounts. Single taxpayer or James and Vanessa separately? Do you want the tax year to follow the calendar year only? Which accredited software do you use?
Decisions (James, 2026-11-04, second round):
- Bonus amounts come from P-11; this register only adds the tax flag and the record for the return.
- Holds the income figures and the tax-year rate tables used by the carrying-cost tax value estimate (P-12, P-10, P-11, P-15). Rate tables are updated each year and shown with their date.

### P-14 - Tax opportunity review
Requested: 2026-11-04 (James: "Evaluate my total financial picture for tax opportunities")
Type: minor (new feature, depends on P-2, P-12, P-13)        Status: Built in v0.5.0 (findings only)
Plan: a list of informational checks run over your data, each with the numbers behind it and a "talk to your accountant" note: unused registered room, RESP grant room, loss harvesting candidates in non-registered accounts (and superficial-loss traps), investment interest not yet claimed, unclaimed medical or fee receipts, bonus income not yet recorded, foreign property reporting thresholds, income splitting opportunities. No advice to buy or sell; findings only.
Notes / questions: needs enough data first (P-2 import, P-12, P-13). Until then the review is limited to what you tell me.

### P-15 - Wealth overview: balance sheet, cash flow and projection
Requested: 2026-11-04 (James: "an overall wealth view with two components, balance sheet and cash flow ... feed a projection view")
Type: minor (builds on the existing net worth and budget pages; the forecast tab is a placeholder today)        Status: Built in v0.6.0 (planned yearly items from your notes are not seeded because the notes are not available here: enter them in the app; the principal-repayment assumption is shown in the app for you to confirm)
Plan (first version):
- Balance sheet: a snapshot as of a chosen date of what you own against what you owe. Assets: cash, chequing and savings, registered accounts (RRSP, TFSA, FHSA, RESP), non-registered investments, home value (entered by hand), other. Debts: mortgage, HELOC (split into Smith Manoeuvre and other), credit cards, loans. Net worth, Smith Manoeuvre subtotals (P-12) and money tied up in offers (P-10) shown separately.
- Cash flow: the regular ins and outs that change the account values, for a month, a year or a custom range. Categories expand into subcategories, and the tree is editable.
  - Income: Employment (paycheque, bonuses), Investment (capital gains, dividends, interest), Strategic (credit card, bank and investment offers, Smith Manoeuvre tax value, others).
  - Expenditures: Spending (Run rate: bills, subscriptions, groceries, entertainment, home maintenance, others; Annual special: insurance, fuel, business costs; Extraordinary: vacations and other large purchases) and Debt service (interest, penalties).
  - Fed by statement categories (P-6), recurring payments (P-5), bonus earnings (P-11) and Smith Manoeuvre interest (P-12). Transfers between your own accounts are neutral. Mortgage and loan principal repayments are shown as a separate line, not as spending, so net worth stays consistent (assumption to confirm). Investment growth is a line under Income > Investment based on actuals: the change in account value from statements, net of deposits, withdrawals and income already counted. It is shown separately from realized gains and flagged as unrealized (non-cash), and totals can be shown with or without it.
- Projection: averages the cash flow values (run rate from a look-back window you choose, annual special items placed in their usual months, extraordinary items only when planned, offer payouts on their scheduled dates from P-10 plans) and projects the change in total wealth forward month by month. Everything is projected from averaged actuals except investment growth, which is projected at an assumed return (setting, default the 7% benchmark, can be set to 0) because averaged actual growth is too volatile. Includes a HELOC rate-rise test. Defaults: 12-month look-back for the run rate and a 10-year horizon, both editable.
- Potential spends: enter spends you are considering (amount, month or date, one-time or recurring, category, optional card) and see how they fit into the projected monthly spending: a month-by-month view with and without them, months where cash flow turns negative, and the effect on the wealth projection. Each can be marked considering, approved or dropped; approved ones become planned items in the projection. A potential spend can also be matched against a card's remaining minimum spend (P-3, P-6).
- Planned annual special and extraordinary items are seeded from the owner's notes and stored in the app's database, not in this repository.
- Phone and desktop layouts are separate designs; information only.
Decisions (James, 2026-11-05): investment growth is a cash-flow line from actuals and the 7% assumption is only for projecting forward; defaults 12 months and 10 years; seed the planned items; add potential spends; track time per offer (see P-11).
Notes / questions: none open.
