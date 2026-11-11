// Wealth overview: balance sheet, cash flow, projection, potential spends.
import { balanceSheet, cashFlow, project, averages, GROUPS, addMonthKey, ym } from './wealth.js';
import { acbReport } from './tax.js';
import { addDays } from './dates.js';

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const DEFAULT = { lookback_months: 12, horizon_years: 10, growth_pct: 7, invest_surplus: false, rate_rise_pct: 0, include_growth: true };

export function mountWealth({ api, db, requireAuth, route, bad, HttpError, today, notifier, view }) {
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const settings = () => { let s = {}; try { s = JSON.parse(notifier.getSetting('wealth') || '{}'); } catch { s = {}; } return { ...DEFAULT, ...s }; };
  const num = (v, n, lo, hi) => { const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) throw bad(`${n}: a number from ${lo} to ${hi}`); return x; };

  api.get('/wealth/settings', requireAuth, route((req, res) => res.json({ ...settings(), groups: Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, g.label])) })));
  api.put('/wealth/settings', requireAuth, route((req, res) => {
    const b = req.body || {}; const s = settings();
    if (b.lookback_months != null) s.lookback_months = Math.round(num(b.lookback_months, 'look-back months', 1, 60));
    if (b.horizon_years != null) s.horizon_years = Math.round(num(b.horizon_years, 'horizon years', 1, 40));
    if (b.growth_pct != null) s.growth_pct = num(b.growth_pct, 'growth', 0, 30);
    if (b.rate_rise_pct != null) s.rate_rise_pct = num(b.rate_rise_pct, 'rate rise', 0, 10);
    if (b.invest_surplus != null) s.invest_surplus = !!b.invest_surplus;
    if (b.include_growth != null) s.include_growth = !!b.include_growth;
    notifier.setSetting('wealth', JSON.stringify(s));
    res.json({ ok: true });
  }));

  api.get('/wealth/categories', requireAuth, route((req, res) => res.json({ items: all('SELECT id, name, kind, flow_group, archived FROM categories ORDER BY kind, name'), groups: Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, g.label])) })));
  api.patch('/wealth/categories/:id', requireAuth, route((req, res) => {
    const g = req.body?.flow_group; if (g !== null && !(g in GROUPS)) throw bad('Unknown group');
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(+req.params.id); if (!cat) throw new HttpError(404, 'Not found');
    if (g && cat.kind === 'transfer') throw bad('Transfers are left out of cash flow');
    if (g && (GROUPS[g].side === 'income') !== (cat.kind === 'income')) throw bad('An income category goes under an income group and an expense category under a spending group');
    db.prepare('UPDATE categories SET flow_group = ? WHERE id = ?').run(g, cat.id); res.json({ ok: true });
  }));

  api.get('/wealth/balance', requireAuth, route((req, res) => {
    const date = req.query.date === undefined ? today() : req.query.date; if (!isDate(date)) throw bad('date: YYYY-MM-DD');
    res.json(balanceSheet({ accounts: all('SELECT * FROM accounts'), valuations: all('SELECT * FROM valuations'), debts: all('SELECT * FROM debts'), holdings: all('SELECT * FROM holdings'), date, includeDebts: req.query.debts !== '0' }));
  }));

  const loadFlow = (from, to) => {
    const sales = acbReport(all('SELECT * FROM acb_trades')).sales;
    const loans = all('SELECT id FROM debts WHERE smith = 1').map((d) => d.id);
    return cashFlow({ transactions: all('SELECT t.id, t.account_id, t.posted_on, t.amount_cents, t.category_id, s.flow_group AS sub_flow_group FROM transactions t LEFT JOIN subcategories s ON s.id = t.subcategory_id WHERE t.posted_on >= ? AND t.posted_on <= ?', addDays(from, -400), to), categories: all('SELECT * FROM categories'), ledger: all('SELECT * FROM ledger_entries'),
      loanEvents: all('SELECT * FROM loan_events'), smithLoanIds: loans, incomeEvents: all('SELECT * FROM income_events'), sales, valuations: all('SELECT * FROM valuations'), accounts: all('SELECT * FROM accounts'), taxYears: all('SELECT * FROM tax_years') }, from, to);
  };
  api.get('/wealth/cashflow', requireAuth, route((req, res) => {
    const to = req.query.to || today(); const from = req.query.from || `${to.slice(0, 7)}-01`;
    if (!isDate(from) || !isDate(to) || to < from) throw bad('from and to must be dates');
    const f = loadFlow(from, to);
    // The extra 400 days of transactions are only for the growth estimate; the sums use the range.
    res.json({ ...f, include_growth: settings().include_growth });
  }));

  const payoutsFromLedger = (t) => {
    const out = [];
    for (const e of all("SELECT * FROM ledger_entries WHERE status IN ('pending','partly_paid')")) {
      const remaining = (e.expected_cents || 0) - (e.received_cents || 0); if (remaining <= 0) continue;
      const o = e.offer_id ? db.prepare('SELECT * FROM offer_terms WHERE id = ?').get(e.offer_id) : null;
      let p = []; try { p = o?.payouts ? JSON.parse(o.payouts) : []; } catch { p = []; }
      const future = p.filter((x) => x.date > t);
      if (future.length) for (const x of future) out.push({ date: x.date, cents: x.cents != null ? x.cents : Math.round(remaining * x.pct / 100), label: `${e.issuer} ${e.title}` });
      else if (e.locked_to && e.locked_to > t) out.push({ date: e.locked_to, cents: remaining, label: `${e.issuer} ${e.title}` });
    }
    return out;
  };

  const items = () => {
    const cards = new Map(view('cards').map((c) => [c.id, c]));
    return all('SELECT * FROM plan_items ORDER BY start_date, name').map((it) => ({ ...it, unconfirmed: JSON.parse(it.unconfirmed || '[]'), card: it.card_id && cards.get(it.card_id) ? { label: `${cards.get(it.card_id).label} ${cards.get(it.card_id).product}`, still_needed_cents: cards.get(it.card_id).spend_still_needed_cents } : null }));
  };
  api.get('/wealth/items', requireAuth, route((req, res) => res.json({ items: items() })));

  api.get('/wealth/projection', requireAuth, route((req, res) => {
    const s = settings(); const t = today();
    const to = addDays(`${t.slice(0, 7)}-01`, -1); // last full month
    const startKey = `${to.slice(0, 7)}`; const months = s.lookback_months;
    const from = `${addMonthKey(startKey, -(months - 1))}-01`;
    const flow = loadFlow(from, to);
    const hasHistory = all('SELECT COUNT(*) AS n FROM transactions WHERE posted_on >= ? AND posted_on <= ?', from, to)[0].n > 0;
    const avg = averages(flow, months);
    const rec = view('recurring').filter((r) => r.status === 'active');
    let note = null;
    if (!hasHistory && rec.length) { avg.spend_cents = rec.reduce((a, r) => a + r.monthly_cents, 0); note = 'There are no transactions in the look-back window, so spending uses your recurring payments only.'; }
    const bs = balanceSheet({ accounts: all('SELECT * FROM accounts'), valuations: all('SELECT * FROM valuations'), debts: all('SELECT * FROM debts'), holdings: all('SELECT * FROM holdings'), date: t });
    const invest = (bs.asset_totals.investment || 0) + (bs.asset_totals.registered || 0);
    const loans = all('SELECT balance_cents, loan_type FROM debts WHERE smith = 1 AND loan_type = \'heloc\'').reduce((a, d) => a + d.balance_cents, 0);
    const payouts = payoutsFromLedger(t);
    const p = project({ start: { net_cents: bs.net_worth_cents, invest_cents: invest, loan_cents: loans }, startMonth: t.slice(0, 7), avg, items: items(), payouts, settings: s, horizonMonths: s.horizon_years * 12 });
    const stress = project({ start: { net_cents: bs.net_worth_cents, invest_cents: invest, loan_cents: loans }, startMonth: t.slice(0, 7), avg, items: items(), payouts, settings: { ...s, rate_rise_pct: (s.rate_rise_pct || 0) + 1 }, horizonMonths: s.horizon_years * 12 });
    res.json({ settings: s, start: { date: t, net_worth_cents: bs.net_worth_cents, investments_cents: invest, heloc_cents: loans }, lookback: { from, to, months }, averages: avg, note, ...p, rate_rise_test: { extra_pct: 1, end_wealth_cents: stress.end_wealth_cents, difference_cents: stress.end_wealth_cents - p.end_wealth_cents }, payouts,
      assumptions: [`Income, run-rate spending and debt service are averages of the last ${months} months.`, `Investments grow at ${s.growth_pct}% a year (setting); only this line is assumed, the rest comes from your actuals.`, s.invest_surplus ? 'Cash left over each month is added to investments.' : 'Cash left over each month stays in cash and does not grow.',
        'Annual special and approved extraordinary items come from Potential and planned spends; considering items appear only in the "with" line.', 'Loan principal repayments do not change net worth, so they are not projected.', 'Information only, not a forecast or advice.'] });
  }));
}
