import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceSheet, cashFlow, project, averages } from '../src/wealth.js';
import { startApp, client, signUp } from './helpers.js';

const $ = (n) => Math.round(n * 100);

test('balance sheet: latest value on or before the date, groups, planner loans, offers tied up', () => {
  const accounts = [{ id: 1, name: 'Chequing', institution: 'Bank', type: 'chequing', kind: 'asset', active: 1 }, { id: 2, name: 'RRSP', institution: '', type: 'registered', kind: 'asset', active: 1 }, { id: 3, name: 'Home', type: 'property', kind: 'asset', active: 1 }, { id: 4, name: 'Mortgage', type: 'mortgage', kind: 'liability', active: 1 }];
  const valuations = [{ account_id: 1, as_of: '2026-01-01', value_cents: $(1000) }, { account_id: 1, as_of: '2026-06-01', value_cents: $(2000) }, { account_id: 2, as_of: '2026-05-01', value_cents: $(50000) }, { account_id: 3, as_of: '2025-01-01', value_cents: $(500000) }, { account_id: 4, as_of: '2026-05-01', value_cents: $(300000) }];
  const b = balanceSheet({ accounts, valuations, debts: [{ name: 'HELOC', smith: 1, balance_cents: $(100000) }, { name: 'Car', smith: 0, balance_cents: $(5000) }], holdings: [{ name: 'X', smith: 1, value_cents: $(110000) }, { name: 'Y', offer_id: 1, value_cents: $(20000) }], date: '2026-05-15' });
  assert.equal(b.asset_totals.cash, $(1000)); assert.equal(b.total_assets_cents, $(551000)); assert.equal(b.total_liabilities_cents, $(405000)); assert.equal(b.net_worth_cents, $(146000));
  assert.equal(b.planner_loans.smith_cents, $(100000)); assert.equal(b.smith_investments_cents, $(110000)); assert.equal(b.tied_up_in_offers_cents, $(20000));
  assert.equal(balanceSheet({ accounts, valuations, debts: [{ name: 'H', balance_cents: 1 }], holdings: [], date: '2026-05-15', includeDebts: false }).planner_loans.other_cents, 0);
});

const cats = [{ id: 1, name: 'Pay', kind: 'income' }, { id: 2, name: 'Groceries', kind: 'expense' }, { id: 3, name: 'Insurance', kind: 'expense', flow_group: 'spend_annual' }, { id: 4, name: 'Move money', kind: 'transfer' }];
const base = { categories: cats, ledger: [], loanEvents: [], smithLoanIds: [], incomeEvents: [], sales: [], valuations: [], accounts: [], taxYears: [] };
test('cash flow: groups, transfers neutral, strategic and investment income, principal on its own line', () => {
  const f = cashFlow({ ...base, accounts: [{ id: 9, name: 'Brokerage', type: 'investment', kind: 'asset' }],
    transactions: [{ account_id: 1, posted_on: '2026-03-01', amount_cents: $(3000), category_id: 1 }, { account_id: 1, posted_on: '2026-03-05', amount_cents: -$(400), category_id: 2 }, { account_id: 1, posted_on: '2026-03-06', amount_cents: -$(600), category_id: 3 }, { account_id: 1, posted_on: '2026-03-07', amount_cents: -$(500), category_id: 4 }, { account_id: 1, posted_on: '2026-03-08', amount_cents: -$(50), category_id: null }, { account_id: 9, posted_on: '2026-03-15', amount_cents: $(1000), category_id: 4 }],
    ledger: [{ issuer: 'Bank', title: 'Bonus', received_on: '2026-03-10', received_cents: $(300) }], loanEvents: [{ debt_id: 1, kind: 'capitalized_interest', event_date: '2026-03-25', amount_cents: $(500) }, { debt_id: 1, kind: 'principal_paid', event_date: '2026-03-26', amount_cents: $(700) }], smithLoanIds: [1],
    incomeEvents: [{ event_date: '2026-03-12', kind: 'dividend', amount_cents: $(40) }, { event_date: '2026-03-12', kind: 'return_of_capital', amount_cents: $(99) }], sales: [{ date: '2026-03-20', gain_cents: $(200) }], taxYears: [{ year: 2026, marginal_pct: 40 }],
    valuations: [{ account_id: 9, as_of: '2026-02-28', value_cents: $(10000) }, { account_id: 9, as_of: '2026-03-31', value_cents: $(11500) }] }, '2026-03-01', '2026-03-31');
  const g = (k) => f.groups.find((x) => x.key === k).total_cents;
  assert.equal(g('income_employment'), $(3000)); assert.equal(g('spend_run'), $(450)); assert.equal(g('spend_annual'), $(600)); assert.equal(g('debt_service'), $(500));
  assert.equal(g('income_strategic'), $(300) + $(200)); assert.equal(g('income_investment'), $(240));
  assert.equal(f.principal_repaid_cents, $(700)); assert.equal(f.net_cash_flow_cents, $(3000 + 500 + 240 - 450 - 600 - 500));
  assert.equal(f.growth.cents, $(1500) - $(1000)); assert.equal(f.growth.unrealised, true); assert.equal(f.growth.non_cash, true);
  assert.equal(f.net_with_growth_cents, f.net_cash_flow_cents + $(500));
});
test('projection: averages, growth only on investments, annual items in their month, considering items only in the with-line, negative months, rate-rise', () => {
  const settings = { growth_pct: 12, invest_surplus: false, rate_rise_pct: 0 };
  const avg = { income_cents: $(5000), spend_cents: $(4000) };
  const items = [{ amount_cents: $(1200), kind: 'annual_special', recurrence: 'yearly', start_date: '2026-03-10', status: 'approved' }, { amount_cents: $(3000), kind: 'potential', recurrence: 'once', start_date: '2026-05-01', status: 'considering' },
    { amount_cents: $(100), kind: 'extraordinary', recurrence: 'once', start_date: '2026-04-01', status: 'considering' }, { amount_cents: $(999), kind: 'potential', recurrence: 'once', start_date: '2026-06-01', status: 'dropped' }];
  const p = project({ start: { net_cents: $(100000), invest_cents: $(50000), loan_cents: $(100000) }, startMonth: '2026-01', avg, items, payouts: [{ date: '2026-02-20', cents: $(500) }], settings, horizonMonths: 12 });
  assert.equal(p.months.length, 12); assert.equal(p.months[0].month, '2026-02'); assert.equal(p.months[0].payout_cents, $(500)); assert.equal(p.months[0].net_cash_flow_cents, $(1500));
  const mar = p.months.find((m) => m.month === '2026-03'); assert.equal(mar.special_cents, $(1200)); assert.equal(mar.net_cash_flow_cents, -$(200));
  assert.equal(p.months.find((m) => m.month === '2027-03'), undefined);
  assert.equal(p.months.find((m) => m.month === '2026-05').special_cents, 0); assert.equal(p.with_considering.find((m) => m.month === '2026-05').special_cents, $(3000));
  assert.equal(p.with_considering.find((m) => m.month === '2026-06').special_cents, 0);
  assert.deepEqual(p.negative_months, ['2026-03', '2026-05']); assert.deepEqual(p.negative_months_base, ['2026-03']);
  const mg = Math.pow(1.12, 1 / 12) - 1; assert.equal(p.months[0].growth_cents, Math.round($(50000) * mg));
  assert.ok(p.end_wealth_with_cents < p.end_wealth_cents);
  const zero = project({ start: { net_cents: 0, invest_cents: $(50000), loan_cents: 0 }, startMonth: '2026-01', avg: { income_cents: 0, spend_cents: 0 }, items: [], settings: { ...settings, growth_pct: 0 }, horizonMonths: 6 });
  assert.equal(zero.end_wealth_cents, 0);
  const rise = project({ start: { net_cents: 0, invest_cents: 0, loan_cents: $(120000) }, startMonth: '2026-01', avg: { income_cents: 0, spend_cents: 0 }, items: [], settings: { ...settings, growth_pct: 0, rate_rise_pct: 1 }, horizonMonths: 1 });
  assert.equal(rise.months[0].spend_cents, $(100));
  const inv = project({ start: { net_cents: 0, invest_cents: 0, loan_cents: 0 }, startMonth: '2026-01', avg: { income_cents: $(100), spend_cents: 0 }, items: [], settings: { growth_pct: 0, invest_surplus: true }, horizonMonths: 3 });
  assert.equal(inv.months[2].investments_cents, $(300));
});
test('averages divide by the look-back months and leave growth out', () => {
  const f = { groups: [{ key: 'income_employment', side: 'income', total_cents: $(12000) }, { key: 'spend_run', side: 'spend', total_cents: $(6000) }, { key: 'debt_service', side: 'spend', total_cents: $(600) }, { key: 'spend_annual', side: 'spend', total_cents: $(1200) }], principal_repaid_cents: $(2400) };
  const a = averages(f, 12); assert.equal(a.income_cents, $(1000)); assert.equal(a.spend_cents, $(550)); assert.equal(a.principal_cents, $(200));
});

test('wealth API: balance, cash flow, projection, settings, category groups, potential spends', async () => {
  const app = await startApp(); const c = client(app.base);
  try {
    await signUp(c);
    const db = app.db; const now = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const monthAgo = (n, day = 5) => iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, day)));
    const acct = db.prepare("INSERT INTO accounts (name, institution, type, kind, created_at) VALUES ('Chequing','Bank','chequing','asset','2026-01-01')").run().lastInsertRowid;
    const inv = db.prepare("INSERT INTO accounts (name, institution, type, kind, created_at) VALUES ('Brokerage','Q','investment','asset','2026-01-01')").run().lastInsertRowid;
    db.prepare("INSERT INTO valuations (account_id, as_of, value_cents, source, note) VALUES (?,?,?,'manual','')").run(acct, monthAgo(0, 1), $(10000));
    db.prepare("INSERT INTO valuations (account_id, as_of, value_cents, source, note) VALUES (?,?,?,'manual','')").run(inv, monthAgo(0, 1), $(100000));
    const pay = db.prepare("INSERT INTO categories (name, kind) VALUES ('Pay','income')").run().lastInsertRowid, food = db.prepare("INSERT INTO categories (name, kind) VALUES ('Food','expense')").run().lastInsertRowid;
    let n = 0; for (let k = 1; k <= 3; k++) { db.prepare("INSERT INTO transactions (account_id, posted_on, description, amount_cents, category_id, hash) VALUES (?,?,?,?,?,?)").run(acct, monthAgo(k, 5), 'Pay', $(3000), pay, `h${n++}`); db.prepare("INSERT INTO transactions (account_id, posted_on, description, amount_cents, category_id, hash) VALUES (?,?,?,?,?,?)").run(acct, monthAgo(k, 6), 'Food', -$(1000), food, `h${n++}`); }
    const bal = (await c.get('/api/wealth/balance')).json; assert.equal(bal.net_worth_cents, $(110000)); assert.equal((await c.get('/api/wealth/balance?date=nope')).status, 400);
    const cf = (await c.get(`/api/wealth/cashflow?from=${monthAgo(3, 1)}&to=${iso(now)}`)).json; assert.equal(cf.income_cents, $(9000)); assert.equal(cf.spend_cents, $(3000));
    assert.equal((await c.get('/api/wealth/cashflow?from=2026-05-01&to=2026-04-01')).status, 400);
    assert.equal((await c.put('/api/wealth/settings', { lookback_months: 3, horizon_years: 2, growth_pct: 0 })).status, 200);
    assert.equal((await c.put('/api/wealth/settings', { growth_pct: 99 })).status, 400);
    const pr = (await c.get('/api/wealth/projection')).json; assert.equal(pr.months.length, 24); assert.equal(pr.lookback.months, 3);
    assert.equal(pr.averages.income_cents, $(3000)); assert.equal(pr.averages.spend_cents, $(1000)); assert.equal(pr.months[0].net_cash_flow_cents, $(2000)); assert.equal(pr.months[0].growth_cents, 0);
    assert.equal(pr.end_wealth_cents, $(110000) + 24 * $(2000));
    const item = await c.post('/api/offers/plan_items', { name: 'Trip', amount_cents: '3000', kind: 'potential', recurrence: 'once', start_date: monthAgo(-2, 1), status: 'considering' }); assert.equal(item.status, 201);
    const pr2 = (await c.get('/api/wealth/projection')).json; assert.equal(pr2.end_wealth_cents, pr.end_wealth_cents); assert.equal(pr2.end_wealth_with_cents, pr.end_wealth_cents - $(3000));
    assert.equal((await c.patch(`/api/offers/plan_items/${item.json.id}`, { status: 'approved' })).status, 200);
    assert.equal((await c.get('/api/wealth/projection')).json.end_wealth_cents, pr.end_wealth_cents - $(3000));
    assert.equal((await c.patch(`/api/wealth/categories/${food}`, { flow_group: 'spend_extra' })).status, 200);
    assert.equal((await c.patch(`/api/wealth/categories/${food}`, { flow_group: 'income_strategic' })).status, 400);
    assert.equal((await c.patch(`/api/wealth/categories/${pay}`, { flow_group: 'income_strategic' })).status, 200);
    const cf2 = (await c.get(`/api/wealth/cashflow?from=${monthAgo(3, 1)}&to=${iso(now)}`)).json; assert.equal(cf2.groups.find((g) => g.key === 'spend_extra').total_cents, $(3000)); assert.equal(cf2.groups.find((g) => g.key === 'income_strategic').total_cents, $(9000));
    assert.equal((await client(app.base).get('/api/wealth/projection')).status, 401);
  } finally { await app.close(); }
});
