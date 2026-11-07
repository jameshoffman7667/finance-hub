// Wealth overview maths: balance sheet, cash flow and projection. Information only.
import { addMonths } from './dates.js';

export const GROUPS = {
  income_employment: { label: 'Employment', side: 'income' }, income_investment: { label: 'Investment', side: 'income' }, income_strategic: { label: 'Strategic', side: 'income' },
  spend_run: { label: 'Run rate', side: 'spend' }, spend_annual: { label: 'Annual special', side: 'spend' }, spend_extra: { label: 'Extraordinary', side: 'spend' }, debt_service: { label: 'Debt service', side: 'spend' },
};
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const ym = (d) => d.slice(0, 7);
const monthsFrom = (a, b) => { const out = []; let [y, m] = a.split('-').map(Number); const [ty, tm] = b.split('-').map(Number); while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } } return out; };
const addMonthKey = (k, n) => addMonths(`${k}-01`, n).slice(0, 7);
export const defaultGroup = (cat) => cat.flow_group || (cat.kind === 'income' ? 'income_employment' : 'spend_run');

// ---- balance sheet as of a date
export function balanceSheet({ accounts, valuations, debts = [], holdings = [], date, includeDebts = true }) {
  const latest = (id) => { let last = null; for (const v of valuations.filter((x) => x.account_id === id).sort((a, b) => (a.as_of < b.as_of ? -1 : 1))) { if (v.as_of <= date) last = v; else break; } return last; };
  const assets = { cash: [], registered: [], investment: [], property: [], other: [] }, liabilities = { mortgage: [], credit_card: [], loan: [], other: [] };
  for (const a of accounts.filter((x) => x.active !== 0)) {
    const v = latest(a.id); if (!v) continue; const row = { id: a.id, name: `${a.institution ? `${a.institution} ` : ''}${a.name}`.trim(), as_of: v.as_of, cents: v.value_cents };
    if (a.kind === 'asset') (assets[['chequing', 'savings'].includes(a.type) ? 'cash' : a.type === 'registered' ? 'registered' : a.type === 'investment' ? 'investment' : a.type === 'property' ? 'property' : 'other']).push(row);
    else (liabilities[['mortgage', 'credit_card', 'loan'].includes(a.type) ? a.type : 'other']).push(row);
  }
  const smithDebts = includeDebts ? debts.filter((d) => d.smith) : [], otherDebts = includeDebts ? debts.filter((d) => !d.smith) : [];
  const tot = (o) => Object.fromEntries(Object.entries(o).map(([k, l]) => [k, sum(l, (r) => r.cents)]));
  const at = tot(assets), lt = tot(liabilities);
  const totalAssets = sum(Object.values(at), (x) => x), accountLiab = sum(Object.values(lt), (x) => x);
  const smith = sum(smithDebts, (d) => d.balance_cents), other = sum(otherDebts, (d) => d.balance_cents);
  const tied = holdings.filter((h) => h.offer_id);
  return { date, assets, liabilities, asset_totals: at, liability_totals: lt, total_assets_cents: totalAssets, planner_loans: { smith_cents: smith, other_cents: other, smith: smithDebts.map((d) => ({ name: d.name, cents: d.balance_cents })), other: otherDebts.map((d) => ({ name: d.name, cents: d.balance_cents })) },
    total_liabilities_cents: accountLiab + smith + other, net_worth_cents: totalAssets - accountLiab - smith - other,
    smith_investments_cents: sum(holdings.filter((h) => h.smith), (h) => h.value_cents), tied_up_in_offers_cents: sum(tied, (h) => h.value_cents), tied_up: tied.map((h) => ({ name: h.name, cents: h.value_cents })),
    note: 'Loans entered as accounts and loans entered in the planner are both counted. Keep each loan in one place only.' };
}

// ---- cash flow for a range
// data: { transactions(with category_id, account_id), categories, ledger, loanEvents, smithLoanIds, incomeEvents, sales, valuations, accounts, taxYears }
export function cashFlow(data, from, to, opts = {}) {
  const cats = new Map(data.categories.map((c) => [c.id, c]));
  const lines = new Map(); // group -> Map(label -> cents)
  const add = (group, label, cents) => { if (!cents) return; const g = lines.get(group) || lines.set(group, new Map()).get(group); g.set(label, (g.get(label) || 0) + cents); };
  const warnings = [];
  for (const t of data.transactions.filter((x) => x.posted_on >= from && x.posted_on <= to)) {
    const c = cats.get(t.category_id); if (!c) { add(t.amount_cents < 0 ? 'spend_run' : 'income_employment', 'Uncategorised', Math.abs(t.amount_cents)); continue; }
    if (c.kind === 'transfer') continue;
    const g = defaultGroup(c);
    if (GROUPS[g].side === 'income') add(g, c.name, t.amount_cents); else add(g, c.name, -t.amount_cents);
  }
  for (const e of data.ledger.filter((x) => x.received_on && x.received_on >= from && x.received_on <= to && x.received_cents)) add('income_strategic', `${e.issuer} ${e.title}`, e.received_cents);
  const taxRate = (y) => data.taxYears.find((t) => t.year === y && t.marginal_pct != null)?.marginal_pct;
  const smithEv = data.loanEvents.filter((e) => data.smithLoanIds.includes(e.debt_id) && e.event_date >= from && e.event_date <= to);
  for (const e of smithEv.filter((x) => x.kind === 'capitalized_interest' || x.kind === 'interest_paid')) { add('debt_service', 'Smith Manoeuvre loan interest', e.amount_cents); const r = taxRate(+e.event_date.slice(0, 4)); if (r != null) add('income_strategic', 'Smith Manoeuvre tax value (estimate)', Math.round(e.amount_cents * r / 100)); }
  for (const i of data.incomeEvents.filter((x) => x.event_date >= from && x.event_date <= to && x.kind !== 'return_of_capital')) add('income_investment', i.kind === 'interest' ? 'Interest' : 'Dividends and distributions', i.amount_cents);
  for (const s of data.sales.filter((x) => x.date >= from && x.date <= to && x.gain_cents)) add('income_investment', 'Realised capital gains and losses', s.gain_cents);
  const principal = sum(data.loanEvents.filter((e) => e.kind === 'principal_paid' && e.event_date >= from && e.event_date <= to), (e) => e.amount_cents);
  const groups = Object.entries(GROUPS).map(([key, g]) => { const m = lines.get(key) || new Map(); return { key, label: g.label, side: g.side, total_cents: sum([...m.values()], (x) => x), lines: [...m].map(([label, cents]) => ({ label, cents })).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents)) }; });
  // Investment growth from actuals: change in value not explained by recorded transactions in the same accounts (non-cash, unrealised).
  const invAccts = data.accounts.filter((a) => a.kind === 'asset' && ['investment', 'registered'].includes(a.type));
  const valAt = (id, d, strict) => { let last = null; for (const v of data.valuations.filter((x) => x.account_id === id).sort((a, b) => (a.as_of < b.as_of ? -1 : 1))) { if (strict ? v.as_of < d : v.as_of <= d) last = v; else break; } return last; };
  let growth = 0, growthAccounts = 0;
  for (const a of invAccts) {
    const v1 = valAt(a.id, to, false), v0 = valAt(a.id, from, true); if (!v1 || !v0 || v0.as_of === v1.as_of) continue;
    const flows = sum(data.transactions.filter((t) => t.account_id === a.id && t.posted_on > v0.as_of && t.posted_on <= v1.as_of), (t) => t.amount_cents);
    growth += v1.value_cents - v0.value_cents - flows; growthAccounts++;
  }
  const income = sum(groups.filter((g) => g.side === 'income'), (g) => g.total_cents), spend = sum(groups.filter((g) => g.side === 'spend'), (g) => g.total_cents);
  if (!growthAccounts && invAccts.length) warnings.push('Investment growth needs two recorded values for an investment account around the range.');
  return { from, to, groups, income_cents: income, spend_cents: spend, net_cash_flow_cents: income - spend, principal_repaid_cents: principal, growth: { cents: growth, accounts: growthAccounts, unrealised: true, non_cash: true },
    net_with_growth_cents: income - spend + growth, warnings, notes: ['Transfers between your own accounts are left out.', 'Loan principal repayments are shown on their own line and are not counted as spending, so net worth stays consistent (assumption: confirm this suits you).', 'Investment growth is estimated from account values and recorded transactions, is unrealised and is not cash.'] };
}

// ---- projection
// base: { start_net_cents, invest_cents, loan_cents }, avg: monthly figures from the look-back window
export function project({ start, startMonth, avg, items = [], payouts = [], settings, horizonMonths }) {
  const g = (settings.growth_pct ?? 7) / 100, mg = Math.pow(1 + g, 1 / 12) - 1, invest = settings.invest_surplus ? 1 : 0;
  const rise = (settings.rate_rise_pct || 0) / 100;
  const active = (it) => it.status !== 'dropped';
  const itemsFor = (m, filter) => sum(items.filter((it) => active(it) && filter(it)), (it) => {
    const s = ym(it.start_date), e = it.end_date ? ym(it.end_date) : null;
    if (m < s || (e && m > e)) return 0;
    if (it.recurrence === 'once') return m === s ? it.amount_cents : 0;
    if (it.recurrence === 'monthly') return it.amount_cents;
    return m.slice(5) === s.slice(5) ? it.amount_cents : 0;
  });
  const run = (include) => {
    let wealth = start.net_cents, inv = start.invest_cents; const rows = [];
    for (let k = 1; k <= horizonMonths; k++) {
      const m = addMonthKey(startMonth, k);
      const special = itemsFor(m, (it) => it.kind === 'annual_special' || (it.kind === 'extraordinary' && it.status === 'approved') || (it.kind === 'potential' && include(it)));
      const payout = sum(payouts.filter((p) => ym(p.date) === m), (p) => p.cents);
      const interestExtra = Math.round(start.loan_cents * rise / 12);
      const income = avg.income_cents + payout, spend = avg.spend_cents + special + interestExtra;
      const cash = income - spend; const growth = Math.round(inv * mg);
      wealth += cash + growth; inv += growth + (invest ? Math.max(0, cash) : 0);
      rows.push({ month: m, income_cents: income, spend_cents: spend, special_cents: special, payout_cents: payout, net_cash_flow_cents: cash, growth_cents: growth, wealth_cents: wealth, investments_cents: inv });
    }
    return rows;
  };
  const base = run((it) => it.status === 'approved'), withAll = run((it) => it.status === 'approved' || it.status === 'considering');
  return { months: base, with_considering: withAll, negative_months: withAll.filter((r) => r.net_cash_flow_cents < 0).map((r) => r.month), negative_months_base: base.filter((r) => r.net_cash_flow_cents < 0).map((r) => r.month),
    end_wealth_cents: base.at(-1)?.wealth_cents ?? start.net_cents, end_wealth_with_cents: withAll.at(-1)?.wealth_cents ?? start.net_cents };
}

// Monthly averages over the look-back window, from the cash-flow lines (growth excluded: projected separately).
export function averages(flow, months) {
  const m = Math.max(1, months);
  const g = (k) => flow.groups.find((x) => x.key === k)?.total_cents || 0;
  return { income_cents: Math.round(sum(flow.groups.filter((x) => x.side === 'income'), (x) => x.total_cents) / m),
    spend_cents: Math.round((g('spend_run') + g('debt_service')) / m), annual_cents: g('spend_annual'), extra_cents: g('spend_extra'), principal_cents: Math.round(flow.principal_repaid_cents / m) };
}
export { monthsFrom, addMonthKey, ym };
