import test from 'node:test';
import assert from 'node:assert/strict';
import { acbReport, gainsByYear, medical, expectedSlips, review, toCsv, csvEscape } from '../src/tax.js';
import { summary, capitalizationReminders, taxValue } from '../src/smith.js';
import { startApp, client, signUp } from './helpers.js';

const $ = (n) => Math.round(n * 100);
let id = 0;
const T = (o) => ({ id: ++id, fees_cents: 0, fx_rate: 1, registered: 0, ...o });

test('ACB: pooled average cost, gain on a sale, return of capital, split', () => {
  const r = acbReport([
    T({ security: 'ABC', trade_date: '2025-01-10', kind: 'buy', qty: 100, amount_cents: $(1000), fees_cents: $(10) }),
    T({ security: 'ABC', trade_date: '2025-02-10', kind: 'buy', qty: 100, amount_cents: $(1200) }),
    T({ security: 'ABC', trade_date: '2025-03-10', kind: 'sell', qty: 50, amount_cents: $(750), fees_cents: $(10) }),
  ]);
  assert.equal(r.positions[0].qty, 150); assert.equal(r.positions[0].acb_cents, $(2210 - 552.5));
  assert.equal(r.sales[0].proceeds_cents, $(740)); assert.equal(r.sales[0].cost_cents, $(552.5)); assert.equal(r.sales[0].gain_cents, $(187.5));
  const s = acbReport([T({ security: 'X', trade_date: '2025-01-01', kind: 'buy', qty: 10, amount_cents: $(100) }), T({ security: 'X', trade_date: '2025-02-01', kind: 'split', qty: 2, amount_cents: 0 }), T({ security: 'X', trade_date: '2025-03-01', kind: 'return_of_capital', amount_cents: $(20) })]);
  assert.equal(s.positions[0].qty, 20); assert.equal(s.positions[0].acb_cents, $(80));
  const big = acbReport([T({ security: 'Y', trade_date: '2025-01-01', kind: 'buy', qty: 1, amount_cents: $(10) }), T({ security: 'Y', trade_date: '2025-02-01', kind: 'return_of_capital', amount_cents: $(15) })]);
  assert.equal(big.sales[0].gain_cents, $(5)); assert.equal(big.positions[0].acb_cents, 0);
});
test('ACB: registered accounts are left out, foreign amounts use the entered rate, overselling warns', () => {
  const r = acbReport([T({ security: 'US1', trade_date: '2025-01-01', kind: 'buy', qty: 10, amount_cents: $(100), fx_rate: 1.4 }), T({ security: 'R', trade_date: '2025-01-01', kind: 'buy', qty: 1, amount_cents: $(5), registered: 1 }), T({ security: 'US1', trade_date: '2025-02-01', kind: 'sell', qty: 20, amount_cents: $(300), fx_rate: 1.4 })]);
  assert.equal(r.positions.length, 1); assert.ok(r.warnings[0].includes('only 10'));
});
test('superficial loss is flagged only when the same security is bought back and still held', () => {
  const base = [T({ security: 'L', trade_date: '2025-01-01', kind: 'buy', qty: 100, amount_cents: $(1000) })];
  const loss = T({ security: 'L', trade_date: '2025-06-01', kind: 'sell', qty: 100, amount_cents: $(600) });
  assert.equal(acbReport([...base, loss]).sales[0].superficial_warning, false);
  assert.equal(acbReport([...base, loss, T({ security: 'L', trade_date: '2025-06-20', kind: 'buy', qty: 100, amount_cents: $(610) })]).sales[0].superficial_warning, true);
  assert.equal(acbReport([...base, loss, T({ security: 'L', trade_date: '2025-08-20', kind: 'buy', qty: 100, amount_cents: $(610) })]).sales[0].superficial_warning, false);
});
test('capital gains by year apply earlier net capital losses and show an estimated taxable half', () => {
  const y = gainsByYear([{ security: 'A', date: '2025-05-01', proceeds_cents: $(5000), cost_cents: $(1000), gain_cents: $(4000) }, { security: 'B', date: '2025-06-01', proceeds_cents: $(500), cost_cents: $(1000), gain_cents: -$(500) }],
    [{ kind: 'net_capital_loss', from_year: 2023, amount_cents: $(1000), used_cents: 0 }]);
  assert.equal(y[0].net_cents, $(3500)); assert.equal(y[0].carry_applied_cents, $(1000)); assert.equal(y[0].taxable_estimate_cents, $(1250));
});
test('medical: best 12-month window ending in the year, reimbursements, threshold', () => {
  const rc = [{ category: 'medical', spent_on: '2024-09-15', amount_cents: $(900), person: 'A' }, { category: 'medical', spent_on: '2025-03-01', amount_cents: $(500), reimbursed_cents: $(100), person: 'B' }, { category: 'medical', spent_on: '2025-11-30', amount_cents: $(700), person: 'A' }, { category: 'donation', spent_on: '2025-01-01', amount_cents: $(999) }];
  const m = medical(rc, 2025, { income_cents: $(50000), medical_threshold_cents: $(1200) });
  assert.equal(m.best_window.end, '2025-03-31'); assert.equal(m.best_window.total_cents, $(1300)); assert.equal(m.threshold_cents, $(1200)); assert.equal(m.claim_estimate_cents, $(100));
  assert.equal(medical(rc, 2025, null).claim_estimate_cents, null);
});
test('expected slips: from recorded income, registered accounts skipped, differences shown', () => {
  const hs = [{ id: 1, institution: 'Broker', name: 'Cash', account_type: 'nonreg' }, { id: 2, institution: 'Broker', name: 'TFSA', account_type: 'tfsa' }];
  const inc = [{ holding_id: 1, event_date: '2025-04-01', kind: 'dividend', amount_cents: $(120) }, { holding_id: 1, event_date: '2025-05-01', kind: 'dividend', amount_cents: $(30) }, { holding_id: 2, event_date: '2025-05-01', kind: 'dividend', amount_cents: $(999) }];
  const a = expectedSlips(inc, hs, [], 2025); assert.equal(a.length, 1); assert.equal(a[0].expected_cents, $(150)); assert.equal(a[0].actual_cents, null);
  const b = expectedSlips(inc, hs, [{ tax_year: 2025, institution: 'Broker', kind: 't5_dividends', amount_cents: $(148) }], 2025); assert.equal(b[0].difference_cents, -$(2));
});
test('CSV: quotes and spreadsheet formulas are neutralised', () => { assert.equal(csvEscape('a,b'), '"a,b"'); assert.equal(csvEscape('=1+1'), "'=1+1"); assert.equal(toCsv([['x', 'y']]), 'x,y\r\n'); });

const debts = [{ id: 1, name: 'HELOC', smith: 1, loan_type: 'heloc', balance_cents: $(100000), rate: 6, limit_cents: $(150000), cap_day: 25, opened_on: '2025-01-01' }, { id: 2, name: 'Car loan', smith: 0, balance_cents: $(5000), rate: 7 }];
const holds = [{ id: 1, name: 'Non-reg', account_type: 'nonreg', smith: 1, value_cents: $(110000), acb_cents: $(100000) }, { id: 2, name: 'TFSA', account_type: 'tfsa', smith: 1, value_cents: $(1000) }];
test('Smith: totals, interest per year with estimated tax value, warnings, stress test, room', () => {
  const ev = [{ debt_id: 1, event_date: '2025-02-25', kind: 'capitalized_interest', amount_cents: $(500) }, { debt_id: 1, event_date: '2025-03-25', kind: 'capitalized_interest', amount_cents: $(500) }, { debt_id: 1, event_date: '2025-03-01', kind: 'advance_invest', amount_cents: $(2000) },
    { debt_id: 1, event_date: '2025-04-01', kind: 'advance_other', amount_cents: $(300) }, { debt_id: 2, event_date: '2025-04-01', kind: 'interest_paid', amount_cents: $(99) }];
  const inc = [{ holding_id: 1, event_date: '2025-06-01', kind: 'return_of_capital', amount_cents: $(50), reinvested: 0 }, { holding_id: 1, event_date: '2025-06-02', kind: 'dividend', amount_cents: $(200) }];
  const s = summary({ debts, holdings: holds, events: ev, income: inc, taxYears: [{ year: 2025, marginal_pct: 40 }], today: '2025-07-01' });
  assert.equal(s.totals.debt_cents, $(100000)); assert.equal(s.totals.net_position_cents, $(11000)); assert.equal(s.totals.borrowing_room_cents, $(50000)); assert.equal(s.totals.unrealised_cents, $(11000));
  const y = s.per_year.find((p) => p.year === 2025); assert.equal(y.interest_cents, $(1000)); assert.equal(y.tax_value_cents, $(400)); assert.equal(y.tax_value_is_estimate, true); assert.equal(y.dividends_cents, $(200));
  assert.equal(s.totals.net_after_tax_value_cents, $(11000) + $(400));
  const texts = s.warnings.map((w) => w.text).join('|');
  assert.match(texts, /registered account/); assert.match(texts, /other than investing/); assert.match(texts, /not matched to a purchase/); assert.match(texts, /not reinvested/);
  assert.equal(s.stress[0].extra_per_year_cents, $(1000)); assert.equal(s.stress[0].after_tax_extra_cents, $(600));
  assert.equal(taxValue(2024, 100, [{ year: 2025, marginal_pct: 40 }]), null);
});
test('Smith reminders: open and overdue until the month has a capitalizing record', () => {
  const r = capitalizationReminders([debts[0]], [{ debt_id: 1, kind: 'capitalized_interest', event_date: '2025-05-25' }], '2025-07-10', 3);
  assert.deepEqual(r.filter((x) => x.overdue).map((x) => x.month), ['2025-04', '2025-06']);
  assert.equal(r.find((x) => x.month === '2025-07').overdue, false);
});
test('review: findings from the data, no advice to trade', () => {
  const f = review({ year: 2025, holdings: [{ id: 1, name: 'Fund', account_type: 'nonreg', value_cents: $(900), acb_cents: $(1000), invested: 1, foreign_prop: 1 }, { id: 2, name: 'R', account_type: 'resp', value_cents: 1 }],
    room: [{ tax_year: 2025, account: 'tfsa', room_cents: $(7000), contributed_cents: $(2000) }], receipts: [{ tax_year: 2025, amount_cents: $(80), claimed: 0 }], ledger: [{ issuer: 'Bank', title: 'Bonus', received_on: '2025-03-01', received_cents: $(300), tax_flag: null }],
    taxYears: [{ year: 2025, person: 'A', marginal_pct: 43 }, { year: 2025, person: 'B', marginal_pct: 26 }], trades: [], smithSummary: summary({ debts, holdings: holds, events: [{ debt_id: 1, event_date: '2025-02-25', kind: 'capitalized_interest', amount_cents: $(500) }], income: [], taxYears: [], today: '2025-07-01' }), checklist: [], today: '2025-07-01' });
  const ids = f.map((x) => x.id);
  for (const k of ['room', 'resp', 'loss_candidates', 'smith_interest', 'receipts', 'bonuses', 'foreign', 'splitting']) assert.ok(ids.includes(k), k);
  assert.ok(f.every((x) => /accountant/.test(x.accountant)));
});

test('tax and Smith API: reminders clear with a confirmed amount, overview, review, checklist, exports', async () => {
  const app = await startApp({}); const c = client(app.base);
  try {
    await signUp(c);
    const mk = async (path, body) => { const r = await c.post(path, body); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.id; };
    const loan = await mk('/api/offers/debts', { name: 'HELOC', loan_type: 'heloc', balance_cents: '100000', rate: 6, smith: true, cap_day: 25, opened_on: '2025-01-01', limit_cents: '150000' });
    const hold = await mk('/api/offers/holdings', { name: 'Non-reg', institution: 'Broker', account_type: 'nonreg', value_cents: '110000', invested: true, smith: true, acb_cents: '100000' });
    await mk('/api/offers/tax_years', { year: 2025, income_cents: '90000', marginal_pct: 43.41, medical_threshold_cents: '2834' });
    assert.equal((await c.post('/api/offers/tax_years', { year: 2025, marginal_pct: 30 })).status, 409);
    const s = (await c.get('/api/smith/summary')).json;
    assert.ok(s.overdue.length >= 1, 'overdue reminders show before any record'); const m = s.overdue[0].month;
    assert.equal((await c.post(`/api/smith/loans/${loan}/capitalized`, { month: m })).status, 400);
    assert.equal((await c.post(`/api/smith/loans/${loan}/capitalized`, { month: m, amount_cents: 50000 })).status, 201);
    assert.equal((await c.post(`/api/smith/loans/${loan}/capitalized`, { month: m, amount_cents: 50000 })).status, 409);
    assert.ok(!(await c.get('/api/smith/summary')).json.overdue.some((r) => r.month === m));
    assert.equal((await c.post('/api/smith/loans/999/capitalized', { month: m, amount_cents: 1 })).status, 404);
    const run = await c.post('/api/notifications/run'); assert.equal(run.status, 200);
    const inbox = (await c.get('/api/notifications')).json.items; assert.ok(inbox.some((n) => n.kind === 'smith_cap' && /Capitalize interest/.test(n.title)));

    await mk('/api/offers/trades', { security: 'ABC', trade_date: '2025-01-10', kind: 'buy', qty: 100, amount_cents: '1000' });
    await mk('/api/offers/trades', { security: 'ABC', trade_date: '2025-03-10', kind: 'sell', qty: 50, amount_cents: '800' });
    await mk('/api/offers/receipts', { tax_year: 2025, category: 'medical', person: 'A', spent_on: '2025-04-02', payee: '=cmd', amount_cents: '300' });
    await mk('/api/offers/room', { tax_year: 2025, account: 'tfsa', room_cents: '7000', contributed_cents: '2000' });
    await mk('/api/offers/slips', { tax_year: 2025, institution: 'Broker', kind: 't5_dividends', amount_cents: '50' });
    await mk('/api/offers/income_events', { holding_id: hold, event_date: '2025-05-01', kind: 'dividend', amount_cents: '52' });
    const ov = (await c.get('/api/tax/overview?year=2025')).json;
    assert.equal(ov.gains.net_cents, 30000); assert.equal(ov.medical.best_window.total_cents, 30000); assert.equal(ov.room[0].remaining_cents, 500000);
    assert.equal(ov.slips[0].difference_cents, -200);
    const yr = +m.slice(0, 4); const ovm = (await c.get(`/api/tax/overview?year=${yr}`)).json;
    assert.equal(ovm.carrying_interest.interest_cents, 50000); assert.equal(ovm.carrying_interest.estimate, true);
    assert.equal((await c.get('/api/tax/overview?year=abcd')).status, 400);
    const rv = (await c.get('/api/tax/review?year=2025')).json; assert.ok(rv.findings.some((f) => f.id === 'room'));
    assert.ok((await c.get(`/api/tax/review?year=${yr}`)).json.findings.some((f) => f.id === 'smith_interest'));
    assert.equal((await c.post('/api/tax/checklist', { year: yr, item: 'carry_interest', done: true })).status, 200);
    assert.ok(!(await c.get(`/api/tax/review?year=${yr}`)).json.findings.some((f) => f.id === 'smith_interest'));
    assert.equal((await c.post('/api/tax/checklist', { year: 2025, item: 'nope', done: true })).status, 400);
    const csv = await c.get('/api/tax/export.csv?year=2025'); assert.match(csv.text, /Capital gains,ABC/); assert.ok(csv.text.includes("'=cmd"));
    assert.match((await c.get(`/api/smith/export.csv?year=${yr}`)).text, new RegExp(`HELOC,${yr}-`));
    assert.equal((await client(app.base).get('/api/tax/review')).status, 401);
  } finally { await app.close(); }
});
