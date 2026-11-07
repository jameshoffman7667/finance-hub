// Tax support maths. Information only: you still calculate and file in accredited software.
import { addDays, daysBetween } from './dates.js';

const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const REG = ['rrsp', 'tfsa', 'fhsa', 'resp'];

// ----- adjusted cost base: pooled average cost per security -----
// trades: { security, trade_date, kind, qty, amount_cents, fees_cents, fx_rate, registered }
export function acbReport(trades) {
  const by = new Map();
  for (const t of [...trades].filter((x) => !x.registered).sort((a, b) => (a.trade_date === b.trade_date ? a.id - b.id : a.trade_date < b.trade_date ? -1 : 1))) {
    (by.get(t.security) || by.set(t.security, []).get(t.security)).push(t);
  }
  const positions = [], sales = [], warnings = [];
  for (const [security, list] of by) {
    let qty = 0, cost = 0; // cost in cents (CAD)
    for (const t of list) {
      const fx = t.fx_rate || 1, amt = t.amount_cents * fx, fee = (t.fees_cents || 0) * fx;
      if (t.kind === 'buy' || t.kind === 'reinvest') { qty += t.qty || 0; cost += amt + fee; }
      else if (t.kind === 'split') { if (t.qty > 0) qty *= t.qty; }
      else if (t.kind === 'return_of_capital') { cost -= amt; if (cost < 0) { sales.push({ security, date: t.trade_date, qty: 0, proceeds_cents: 0, cost_cents: 0, gain_cents: Math.round(-cost), note: 'Return of capital above the cost base is a capital gain' }); cost = 0; } }
      else if (t.kind === 'sell') {
        const q = t.qty || 0;
        if (q > qty + 1e-9) warnings.push(`${security}: sold ${q} on ${t.trade_date} but only ${qty} were recorded as held. Check for a missing purchase or transfer-in.`);
        const per = qty ? cost / qty : 0, removed = Math.min(q, qty) * per, proceeds = amt - fee;
        const gain = Math.round(proceeds - removed);
        // Superficial loss: a loss, and the same security bought within 30 days either side while still held 30 days after the sale.
        let superficial = false;
        if (gain < 0) {
          const near = list.filter((x) => (x.kind === 'buy' || x.kind === 'reinvest') && Math.abs(daysBetween(t.trade_date, x.trade_date)) <= 30 && x !== t);
          const after = qty - q + sum(list.filter((x) => (x.kind === 'buy' || x.kind === 'reinvest') && daysBetween(t.trade_date, x.trade_date) > 0 && daysBetween(t.trade_date, x.trade_date) <= 30), (x) => x.qty || 0);
          superficial = near.length > 0 && after > 1e-9;
        }
        sales.push({ security, date: t.trade_date, qty: q, proceeds_cents: Math.round(proceeds), cost_cents: Math.round(removed), gain_cents: gain, superficial_warning: superficial });
        qty -= Math.min(q, qty); cost -= removed; if (qty < 1e-9) { qty = 0; cost = 0; }
      }
    }
    positions.push({ security, qty: Math.round(qty * 1e6) / 1e6, acb_cents: Math.round(cost), acb_per_unit_cents: qty ? Math.round(cost / qty * 100) / 100 : 0 });
  }
  // Transfers: other-currency amounts are converted by the fx_rate entered on each trade (Bank of Canada rate for that day).
  return { positions, sales: sales.sort((a, b) => (a.date < b.date ? -1 : 1)), warnings };
}

export function gainsByYear(sales, carry = []) {
  const years = [...new Set(sales.map((s) => +s.date.slice(0, 4)))].sort((a, b) => a - b);
  return years.map((y) => {
    const list = sales.filter((s) => +s.date.slice(0, 4) === y);
    const gains = sum(list.filter((s) => s.gain_cents > 0), (s) => s.gain_cents), losses = sum(list.filter((s) => s.gain_cents < 0), (s) => -s.gain_cents);
    const net = gains - losses;
    const avail = sum(carry.filter((c) => c.kind === 'net_capital_loss' && c.from_year < y), (c) => c.amount_cents - (c.used_cents || 0));
    const applied = net > 0 ? Math.min(net, avail) : 0;
    return { year: y, proceeds_cents: sum(list, (s) => s.proceeds_cents), cost_cents: sum(list, (s) => s.cost_cents), gains_cents: gains, losses_cents: losses, net_cents: net, carry_applied_cents: applied,
      taxable_estimate_cents: Math.round(Math.max(0, net - applied) / 2), superficial: list.filter((s) => s.superficial_warning).length };
  });
}

// ----- medical: best 12-month window ending in the tax year -----
export function medical(receipts, year, taxYear) {
  const items = receipts.filter((r) => r.category === 'medical');
  const net = (r) => Math.max(0, r.amount_cents - (r.reimbursed_cents || 0));
  let best = null;
  for (let m = 1; m <= 12; m++) {
    const end = `${year}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const startMonth = new Date(Date.UTC(year, m - 12, 1)); const start = `${startMonth.getUTCFullYear()}-${String(startMonth.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const total = sum(items.filter((r) => r.spent_on >= start && r.spent_on <= end), net);
    if (!best || total > best.total_cents) best = { start, end, total_cents: total };
  }
  const income = taxYear?.income_cents, fixed = taxYear?.medical_threshold_cents;
  const threshold = income != null && fixed != null ? Math.min(Math.round(income * 0.03), fixed) : null;
  const byPerson = {}; for (const r of items) byPerson[r.person || 'Unassigned'] = (byPerson[r.person || 'Unassigned'] || 0) + net(r);
  return { best_window: best, by_person: byPerson, threshold_cents: threshold, claim_estimate_cents: threshold != null && best ? Math.max(0, best.total_cents - threshold) : null,
    note: threshold == null ? 'Enter net income and the fixed threshold for the year in Tax settings to see the claim estimate (the lesser of 3% of net income and the fixed amount).' : 'Family pooling and who claims are for you and your accountant to decide.' };
}

// ----- expected slips from recorded income, against slips entered -----
export function expectedSlips(income, holdings, slips, year) {
  const by = new Map();
  for (const i of income.filter((x) => +x.event_date.slice(0, 4) === year)) {
    const h = holdings.find((x) => x.id === i.holding_id); if (!h || REG.includes(h.account_type)) continue;
    const kind = i.kind === 'interest' ? 't5_interest' : i.kind === 'dividend' ? 't5_dividends' : i.kind === 'distribution' ? 't3' : null; if (!kind) continue;
    const k = `${h.institution || h.name}|${kind}`; by.set(k, (by.get(k) || 0) + i.amount_cents);
  }
  const keys = new Set([...by.keys(), ...slips.filter((s) => s.tax_year === year).map((s) => `${s.institution}|${s.kind}`)]);
  return [...keys].map((k) => { const [institution, kind] = k.split('|'); const expected = by.get(k) || 0; const actual = sum(slips.filter((s) => s.tax_year === year && s.institution === institution && s.kind === kind), (s) => s.amount_cents);
    const has = slips.some((s) => s.tax_year === year && s.institution === institution && s.kind === kind);
    return { institution, kind, expected_cents: expected, actual_cents: has ? actual : null, difference_cents: has ? actual - expected : null }; }).sort((a, b) => (a.institution + a.kind < b.institution + b.kind ? -1 : 1));
}

export const CHECKLIST = [
  ['slips', 'Collect tax slips (T4, T5, T3, T5008, T4A, RRSP and FHSA receipts)'], ['medical', 'Gather medical receipts and insurance statements'], ['fees', 'Investment counsel and safekeeping fee statements'],
  ['carry_interest', 'Interest on borrowed investment money (line 22100): lender statements and the trail from loan to investment'], ['donations', 'Donation receipts'], ['room', 'Check RRSP, TFSA, FHSA and RESP room against the CRA My Account figures'],
  ['bonuses', 'Bonus income recorded and flagged (bank, brokerage, card)'], ['acb', 'Cost base and sales checked against broker statements (Schedule 3)'], ['foreign', 'Foreign property reporting threshold checked (cost over $100,000 CAD)'], ['carryforwards', 'Loss, donation and credit carry-forwards updated'],
];

export function registeredRoom(rows, year) { return rows.filter((r) => r.tax_year === year).map((r) => ({ ...r, remaining_cents: r.room_cents - (r.contributed_cents || 0) })); }

export function csvEscape(v) { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s.replace(/^([=+@-])/, "'$1"); }
export const toCsv = (rows) => rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';

// ----- P-14: opportunity review. Findings only, never advice to buy or sell. -----
export function review({ year, holdings, room, receipts, ledger, taxYears, trades, smithSummary, checklist, today }) {
  const out = []; const add = (id, title, level, numbers, note) => out.push({ id, title, level, numbers, note, accountant: 'Talk to your accountant before acting on this.' });
  const dollars = (c) => `$${(c / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const r = registeredRoom(room, year).filter((x) => x.account !== 'resp' && x.remaining_cents > 0);
  if (r.length) add('room', 'Unused registered room', 'check', r.map((x) => `${x.account.toUpperCase()}${x.person ? ` (${x.person})` : ''}: ${dollars(x.remaining_cents)} left`), 'Figures come from the room you entered. Check them against your CRA My Account.');
  if (!room.some((x) => x.tax_year === year)) add('room_missing', 'No registered room entered for ' + year, 'info', [], 'Enter room from CRA My Account so unused room can be checked.');
  const resp = registeredRoom(room, year).filter((x) => x.account === 'resp');
  if (holdings.some((h) => h.account_type === 'resp')) add('resp', 'RESP grant room', resp.length ? 'info' : 'check', resp.map((x) => `Contribution room left: ${dollars(x.remaining_cents)}`), resp.length ? 'The grant depends on contributions made in the year and on past unused grant room.' : 'You hold an RESP but no room is entered. Enter the contributions made so far to see what is left.');
  const unreal = holdings.filter((h) => !REG.includes(h.account_type) && h.acb_cents != null && h.acb_cents > h.value_cents && h.invested !== 0);
  if (unreal.length) {
    const recentBuy = (h) => trades.some((t) => t.holding_id === h.id && (t.kind === 'buy' || t.kind === 'reinvest') && Math.abs(daysBetween(today, t.trade_date)) <= 30);
    add('loss_candidates', 'Non-registered holdings below their cost', 'info', unreal.map((h) => `${h.name}: value ${dollars(h.value_cents)}, cost ${dollars(h.acb_cents)}${recentBuy(h) ? ' (bought in the last 30 days: superficial-loss trap)' : ''}`),
      'Selling at a loss and buying the same thing back within 30 days (or in a spouse or registered account) can deny the loss. These are findings, not suggestions to sell.');
  }
  if (smithSummary) {
    const y = smithSummary.per_year.find((p) => p.year === year);
    if (y && y.interest_cents > 0 && !checklist.some((c) => c.tax_year === year && c.item === 'carry_interest' && c.done)) add('smith_interest', 'Investment loan interest not yet marked as claimed', 'check', [`Interest paid in ${year}: ${dollars(y.interest_cents)}`, y.tax_value_cents != null ? `Estimated tax value: ${dollars(y.tax_value_cents)}` : 'Marginal rate not saved for this year'], 'Tick "interest on borrowed investment money" in the checklist when it is claimed.');
  }
  const un = receipts.filter((x) => x.tax_year === year && !x.claimed);
  if (un.length) add('receipts', 'Receipts not marked as claimed', 'info', [`${un.length} receipts, ${dollars(sum(un, (x) => x.amount_cents - (x.reimbursed_cents || 0)))} net of reimbursements`], 'Medical and fee receipts you have not marked as claimed. Medical receipts can be claimed over the best 12-month window.');
  const bon = ledger.filter((e) => e.received_on && e.received_on.startsWith(String(year)) && (!e.tax_flag || e.tax_flag === 'unsure'));
  if (bon.length) add('bonuses', 'Bonus income without a tax flag', 'check', bon.map((e) => `${e.issuer} ${e.title}: ${dollars(e.received_cents || 0)}`), 'Cash bonuses may be taxable and some issuers send no slip. Mark each as taxable, not taxable or unsure after checking.');
  const foreign = sum(holdings.filter((h) => h.foreign_prop), (h) => h.acb_cents ?? h.value_cents);
  if (foreign > 0) add('foreign', 'Foreign property reporting', foreign > 10000000 ? 'check' : 'info', [`Foreign property cost recorded: ${dollars(foreign)}`], 'Reporting is required when the total cost of specified foreign property is over $100,000 CAD at any time in the year. Securities held at Canadian brokers can count.');
  const rates = taxYears.filter((t) => t.year === year && t.marginal_pct != null);
  if (rates.length > 1) { const hi = Math.max(...rates.map((x) => x.marginal_pct)), lo = Math.min(...rates.map((x) => x.marginal_pct)); if (hi - lo >= 5) add('splitting', 'Different marginal rates in the household', 'info', rates.map((x) => `${x.person || 'Taxpayer'}: ${x.marginal_pct}%`), 'When two people are taxed at different rates, ways of shifting income exist (a spousal RRSP, for example) and have rules. This is a pointer only.'); }
  return out;
}
export { addDays };
