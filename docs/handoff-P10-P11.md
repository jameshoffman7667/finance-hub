# Finance Hub handoff: P-10 Offer planner and P-11 Bonus ledger

Date: 2026-11-04. For the finance-hub app development chat. Both items are logged in `docs/pending-changes.md` (P-10, P-11); this document is the detail behind them. Nothing here is built. Build only on a build message, as one minor release (spec v1.9), following the checklist in section 4 of the app spec.

Depends on / overlaps: P-2 (workbook import and data model), P-3 and P-4 (reapplication rules, bank and investment bonuses), P-6 (statement awards), P-7 (notifications), P-8 (calendar and iCal feed), P-9 (offer watchlist, fetch rules). Where those are not built yet, P-10 and P-11 use their own minimal tables and link later.

## 1. Goal

Decide, with numbers, which offers to take, keep or leave, and then follow through:

1. Link the terms of current and potential offers (investment transfer, bank account, credit card).
2. Evaluate the best strategy on **equivalent annual return**, not total cash.
3. Turn the chosen strategy into a dated plan with reminders and calendar entries.
4. Track every bonus actually earned, with costs and effort, to show total gain and whether the effort is worth it ($50/hour threshold).

## 2. Decisions (2026-11-04)

| Topic | Decision |
|---|---|
| Worth-it threshold | **$50 per hour** of effort (setting, editable). |
| Points valuation | Pull cents-per-point from an online source (Credit Card Genius first, Prince of Travel as cross-check). **Refresh quarterly.** Stored per program with source URL and date; a refresh proposes new values and the owner confirms before saving. Seed values in section 7. |
| Benchmark return | **7%** (setting). It is also the expected return of any market-invested account. |
| When opportunity cost applies | Only when the capital is **not still earning**. Capital that stays market-invested at the new broker keeps earning the benchmark either way, so locking it costs nothing and only the bonus counts. Chequing / savings money that cannot be market-invested is compared at its actual interest rate (+ the bonus yield) against the 7% benchmark. |
| Scope | All offer types. Credit cards have almost no opportunity cost (the credit score effect only); bank accounts are evaluated like investments, including whether leaving an offer early makes sense. |
| Debt | Evaluate against the cost of any debt held. An offer may not make sense while carrying debt. |

## 3. P-10 Offer planner

### 3.1 Data

**Offer** (one per offer, saved terms kept with it): issuer, product, kind (investment_transfer, bank_account, credit_card), offer window, source URL, date seen, saved terms text, status (Potential, Enrolled, Earning, Paid, Forfeited), and structured terms:
- qualifying action (transfer-in, deposit, spend), minimum, cap
- rate by account type (registered / non-registered), as a percentage of the qualifying amount, or a fixed cash amount
- enrol-by and fund-by dates, hold-from and hold-until dates, measuring dates
- payout schedule: lump sum, or installments (count, start date, or explicit dated amounts)
- effect of a withdrawal or transfer-out: `reduces_qualifying_amount` | `forfeits_all_remaining` | `allowed_up_to_percent` (with the percent and its base) | `none`
- scope of that effect: `pooled` across accounts or `per_account` (**may be unknown: store `unknown` and show it as an assumption**)
- exemptions (for example RESP, HBP/LLP, minimum RRIF payments), exclusions (market growth, grants, fees, interest), combinability with other offers, fee reimbursement, payout account rule, tax note

**Holding**: account, institution, kind (registered, non-registered, tfsa, rrsp, resp, chequing, savings, card), current value, invested (yes / no), interest rate if cash, the offer it is earning under, and for that offer the amount counted as transferred in (fixed at transfer value, not market value).

**Debt**: name, balance, interest rate, type. Used by the evaluator (3.2).

**Plan**: chosen strategy as ordered dated steps (enrol, open account, start transfer, fund-by, do-not-withdraw-before, payout dates, hold-until). Each step can create reminders through P-7 and shows on the P-8 calendar; until those exist, steps are listed with dates only.

### 3.2 Evaluator (fixed rules in code, deterministic, not AI)

For every option on a set of holdings (stay, move, or partly move), compute:

- **Total cash** and **when it arrives** (installment dates)
- **Lock-up period**: from when the capital enters the offer until the last hold date
- **Equivalent annual return** = bonus / capital / years locked; also an **IRR** that uses the payout dates. Options are ranked by annual return. Total cash is displayed but not used to rank.
- **Forfeited in-flight bonuses** when leaving an existing offer (remaining installments, or the lump sum not yet paid), using the offer's withdrawal rule and scope
- **Net of moving versus staying**, and the **break-even**: the annualized bonus the freed capital would need to earn in another offer for staying to win
- **Opportunity cost** per section 2: zero for capital that stays market-invested; for cash that is not invested, `benchmark - account interest` (annualized) charged for the lock-up period
- **Debt check**: for capital that is not locked inside an invested account (cash-like), compare the offer's yield with the highest debt interest rate and flag when the debt rate is higher. Also flag offers that require borrowing or new spend. **Open question for the owner: should invested capital also be flagged against debt rates (selling investments to repay debt), or only cash-like capital?**
- **Credit cards**: net value = bonus (cash or points x valuation) - annual fee (first year, per offer) - interest - cost of the required spend if it is not otherwise spent; a credit-score flag (hard inquiry, average age of accounts) with an optional per-application dollar cost, default $0.
- **Bank accounts**: like investments: bonus plus interest earned on the required balance, annualized over the required hold, compared with the benchmark, and an "is leaving early worth it" view (bonus forfeited versus return on the freed money).

Assumptions that cannot be read from the terms (pooled versus per-account, whether a transfer-out is a withdrawal, actual transfer dates and amounts) are shown as **assumptions to confirm**, never silently chosen.

### 3.3 Entering terms

Paste text or a URL; the app proposes the structured fields; the owner reviews before saving. Fetch only on request, store facts with a link back (P-9 rules, check each site's terms and robots first). Anything not from the issuer's own page is labelled unverified.

### 3.4 Screens

- Offers list and detail (terms, source, status, dates)
- Compare view: options side by side with annual return, total cash, lock-up, forfeited, net, break-even, assumptions
- Plan view: dated steps with reminder toggles
- Settings: benchmark (7%), worth-it threshold ($50/hour), points valuations, debts

Phone and desktop layouts are separate designs (spec section 7): phone is a single-column stack with the compare view as cards; desktop uses a side-by-side table with the detail pane.

## 4. P-11 Bonus ledger and effort / return

- **Bonus record**: kind, issuer, offer (link to P-10), expected amount, received amount, dates, status (Pending, Partly paid, Paid, Clawed back, Forfeited). Installments are recorded one by one. Cash or points; points are valued with the section 7 table (cents per point, date, source). Fed from P-2, P-4 and P-6 where an award is detected, manual otherwise.
- **Costs**: annual fees, interest paid, transfer fees net of reimbursement, foreign exchange, opportunity cost (only per section 2), and optional credit-score cost.
- **Effort**: optional hours per offer; defaults per offer type, editable.
- **Reports**: gross and net gain by year, by type (card, bank, investment) and by issuer; annualized return on locked capital for investment and bank offers; dollars per hour; a **worth it** flag when net gain per hour is at least the threshold ($50); a dashboard tile. Any total that includes an estimate is labelled as an estimate.
- Taxes: a flag only (cash bonuses may be taxable, some issuers send no slip). No tax calculation.

## 5. Golden test cases (hypothetical fixtures)

Use these as test fixtures. The holdings are made-up round numbers, not real balances; all amounts CAD. Offer terms are as read on 2026-11-04 and must be re-checked before use.

**Scotia iTRADE WIN27** (assumed terms): 3% registered, 1% non-registered, cap $15,000 per client; enrol by Apr 1 2027, fund by May 31 2027, hold Nov 3 2026 to Feb 28 2029; paid 40% by Apr 28 2028 and 60% by Mar 30 2029; any withdrawal or transfer-out subtracts from the qualifying amount, pooled by account type, excess spills to the other type; RESP grants, interest, dividends, market moves and fees excluded.
- Fixture registered transfers of $100,000 (RRSP-type) + $200,000 (TFSA-type) + $20,000 (RESP-type) = $320,000 give **$9,600** (installments $3,840 and $5,760).
- $100,000 alone gives $3,000 (installments $1,200 and $1,800). Locked about 22.5 months from Apr 2027, annualized about **1.5%** (IRR using the dates).

**Questrade 2%/4% transfer offer** (assumed): fixture payout $500/month for 24 months from Sept 2026 (total $12,000); the Multiplier was tested once on May 29 2026; withdrawals and transfers out above **5%** of the net qualifying transfer amount forfeit all remaining payments; at least one non-registered account must stay in good standing; hold period ends about mid-2028. **Scope (pooled versus per account) not confirmed: treat as pooled, show as an assumption.**
- Moving the $200,000 TFSA-type holding on fixture date 2027-04-05 leaves 16 payments: forfeits 16 x $500 = **$8,000** against Scotia's $6,000 on that holding: net **-$2,000** before anything else.

**TD Spring 2026 offer** (terms read from the offer page): 2% registered, 1% non-registered, max $10,000; hold to **Jul 31 2027**; reward calculated on the qualifying amount at that date; paid by Aug 31 2027; withdrawals subtract; if the qualifying amount is under $10,000 at Jul 31 2027, no reward; RESP is not an eligible account.
- RRSP-type fixture $100,000: reward up to $2,000 (on value at deposit; actual transfer amount and date unknown, **assumption**). Transferring in on the fixture date forfeits it.
- Staying versus moving: Scotia adds $1,000 over staying, over about 18 months on $100,000, so the break-even is about **0.7% per year**. Under the 7% rule the freed capital stays invested either way, so the real hurdle is the best alternative promo's annualized bonus, not 7%.

Expected evaluator outcome for this set: move the RESP-type holding ($20,000, +$600, about 1.5%/year) and fresh cash; do not move the TFSA-type holding; do not move the RRSP-type holding unless TD's hold date or amount differs from the assumption.

## 6. Acceptance checks

- Equivalent annual return, IRR, forfeited amount, net and break-even match section 5 for the three fixtures (tests with fixed dates)
- A withdrawal rule marked `unknown` scope produces an assumption warning and does not change the result silently
- Opportunity cost is zero for invested capital and `7% - interest` for cash-like capital; the debt flag appears when a debt rate exceeds the offer's yield
- Plan steps produce reminders / calendar entries (when P-7 / P-8 exist) and list with dates otherwise
- Valuations refresh proposes values and does not save without confirmation; each value shows source and date
- Ledger totals: gross, net, annualized, dollars per hour, worth-it flag at the $50 threshold
- No full card or account numbers are stored (last 4 only); amounts as integer cents; all dates stored UTC, shown in America/Toronto
- Phone (390 x 844), tablet and desktop (1440 x 900) layouts checked; PWA unchanged; service worker still skips API traffic

## 7. Points valuations (seed, to be refreshed quarterly)

Sources: Credit Card Genius (creditcardgenius.ca, rewards program valuations; its page on loyalty programs was last updated Apr 9 2025, which is why the quarterly refresh matters) and Prince of Travel (princeoftravel.com points valuations). These are best-use travel values; add a conservative alternative (cash or statement-credit value) as a setting.

| Program | Cents per point | Source |
|---|---|---|
| Aeroplan | 2.0 | Credit Card Genius (Prince of Travel 2.1) |
| Amex Membership Rewards | 2.0 | Credit Card Genius (Prince of Travel 2.2) |
| RBC Avion | 2.0 (up to 2.33 on the redemption schedule) | Prince of Travel |
| Scene+ | 1.0 | Credit Card Genius |
| BMO Rewards | 0.67 | Credit Card Genius, Prince of Travel |
| Marriott Bonvoy | 0.97 | Credit Card Genius |
| TD Rewards | 0.5 via the Expedia for TD portal (0.4 otherwise) | Prince of Travel |

## 8. Questions settled after this handoff (2026-11-04/05)

1. Debt check: skip accounts tagged as funded by borrowed money (P-12), because investing borrowed money is the strategy; debts and loans share one table with P-12.
2. Effort: track actual time per offer, and start with expected time of 2 hours per credit card, 4 hours per bank account and 4 hours per investment account; the app proposes updated expectations from the averages of finished offers and the owner confirms.
3. Points valuations: cash value is the default, with the best-use value shown beside it.
4. Total return everywhere includes the estimated tax value of deductible carrying costs (labelled as an estimate, information only).
5. Moving or selling in a non-registered account shows warnings about the taxable gain and the superficial-loss rule.
