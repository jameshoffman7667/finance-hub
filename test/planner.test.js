import test from 'node:test';
import assert from 'node:assert/strict';
import { bonusFor, schedule, evaluateOffer, forfeited, compare, entryTotals, report, proposeEffort, planFromOffer, pointsValue, DEFAULTS, irr } from '../src/planner.js';

const $ = (n) => Math.round(n * 100);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} got ${a}, wanted ${b} ± ${tol}`);
const scotia = { id: 1, kind: 'investment_transfer', issuer: 'Scotia', product: 'iTRADE', rate_registered: 3, rate_nonreg: 1, cap_cents: $(15000), hold_from: '2026-11-03', hold_until: '2029-02-28',
  payouts: JSON.stringify([{ date: '2028-04-28', pct: 40 }, { date: '2029-03-30', pct: 60 }]), withdrawal_effect: 'reduces_qualifying_amount', withdrawal_scope: 'pooled', verified: 1 };
const questrade = { id: 2, kind: 'investment_transfer', issuer: 'Questrade', product: 'Transfer', fixed_cents: $(12000), hold_until: '2028-06-30', withdrawal_effect: 'allowed_up_to_percent', withdrawal_percent: 5, withdrawal_scope: 'unknown',
  payouts: JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ date: `${2026 + Math.floor((8 + i) / 12)}-${String(((8 + i) % 12) + 1).padStart(2, '0')}-01`, cents: $(500) }))) };
const td = { id: 3, kind: 'investment_transfer', issuer: 'TD', product: 'Spring', rate_registered: 2, rate_nonreg: 1, cap_cents: $(10000), min_cents: $(10000), hold_until: '2027-07-31',
  payouts: JSON.stringify([{ date: '2027-08-31', pct: 100 }]), withdrawal_effect: 'reduces_qualifying_amount', withdrawal_scope: 'pooled', verified: 1 };

test('Scotia: $320,000 registered gives $9,600 in two installments', () => {
  const b = bonusFor(scotia, { registered: $(320000) });
  assert.equal(b, $(9600));
  assert.deepEqual(schedule(scotia, b).map((x) => x.cents), [$(3840), $(5760)]);
});
test('Scotia: $100,000 gives $3,000 and about 1.5% a year', () => {
  const r = evaluateOffer({ offer: scotia, amounts: { registered: $(100000) }, start: '2027-04-05', invested: true });
  assert.equal(r.bonus_cents, $(3000));
  assert.deepEqual(r.schedule.map((x) => x.cents), [$(1200), $(1800)]);
  near(r.annual_return_pct, 1.5, 0.2, 'simple'); near(r.irr_pct, 1.5, 0.25, 'irr');
  assert.equal(r.opportunity_cost_cents, 0);
});
test('Scotia: cap applies and non-registered earns 1%', () => {
  assert.equal(bonusFor(scotia, { registered: $(1000000) }), $(15000));
  assert.equal(bonusFor(scotia, { nonreg: $(100000) }), $(1000));
});
test('Questrade: moving $200,000 forfeits 16 payments ($8,000), net -$2,000 versus Scotia', () => {
  const f = forfeited({ offer: questrade, counted: { registered: $(300000) }, move: { registered: $(200000) }, asOf: '2027-04-05' });
  assert.equal(f.remaining_payments, 16); assert.equal(f.forfeited_cents, $(8000));
  assert.ok(f.assumptions.some((a) => /pooled/.test(a)), 'unknown scope is shown as an assumption');
  const c = compare({ holding: { value_cents: $(200000), account_type: 'tfsa', invested: 1 }, current: questrade, countedAmounts: { registered: $(300000) }, targets: [scotia], today: '2027-04-05', debts: [] });
  assert.equal(c.options[0].bonus_cents, $(6000)); assert.equal(c.options[0].forfeited_cents, $(8000)); assert.equal(c.options[0].net_vs_stay_cents, -$(2000));
});
test('Questrade: moving 5% or less forfeits nothing', () => {
  const f = forfeited({ offer: questrade, counted: { registered: $(300000) }, move: { registered: $(15000) }, asOf: '2027-04-05' });
  assert.equal(f.forfeited_cents, 0);
});
test('TD versus Scotia on $100,000: +$1,000, break-even about 0.7% a year', () => {
  const c = compare({ holding: { value_cents: $(100000), account_type: 'rrsp', invested: 1, counted_cents: $(100000) }, current: td, targets: [scotia], today: '2027-04-05', debts: [] });
  const o = c.options[0];
  assert.equal(o.forfeited_cents, $(2000)); assert.equal(o.net_vs_stay_cents, $(1000));
  near(o.breakeven_pct, 0.7, 0.2, 'break-even');
});
test('TD pays nothing under the $10,000 minimum', () => {
  assert.equal(bonusFor(td, { registered: $(9000) }), 0);
  assert.equal(bonusFor(td, { registered: $(100000) }), $(2000));
});
test('opportunity cost: zero when invested, benchmark minus interest for cash', () => {
  const o = { ...scotia, rate_registered: 3 };
  const inv = evaluateOffer({ offer: o, amounts: { registered: $(100000) }, start: '2027-04-05', invested: true });
  const cash = evaluateOffer({ offer: o, amounts: { registered: $(100000) }, start: '2027-04-05', invested: false, interest_rate: 2 });
  assert.equal(inv.opportunity_cost_cents, 0);
  const years = (Date.UTC(2029, 1, 28) - Date.UTC(2027, 3, 5)) / 864e5 / 365; near(cash.opportunity_cost_cents, $(100000) * 0.05 * years, 5);
  assert.equal(cash.net_cents, cash.bonus_cents - cash.opportunity_cost_cents);
});
test('debt flag: cash-like capital against a higher debt rate; skipped for Smith holdings and invested capital', () => {
  const args = { offer: scotia, amounts: { registered: $(100000) }, start: '2027-04-05', invested: false, debts: [{ name: 'Line of credit', rate: 8 }] };
  assert.ok(evaluateOffer(args).debt);
  assert.equal(evaluateOffer({ ...args, smith: 1 }).debt, null);
  assert.equal(evaluateOffer({ ...args, invested: true }).debt, null);
});
test('unknown withdrawal scope produces an assumption, not a silent choice', () => {
  const r = evaluateOffer({ offer: questrade, amounts: { registered: $(100000) }, start: '2026-09-01', invested: true });
  assert.ok(r.assumptions.some((a) => /pooled/.test(a)));
});
test('credit card: points at cash value, fee and score cost', () => {
  const card = { kind: 'credit_card', issuer: 'X', product: 'Y', points: 60000, program: 'Aeroplan', annual_fee_cents: $(139) };
  const r = evaluateOffer({ offer: card }, { ...DEFAULTS, score_cost_cents: $(50) });
  assert.equal(r.bonus_cents, $(600)); assert.equal(r.best_bonus_cents, $(1200)); assert.equal(r.net_cents, $(600) - $(139) - $(50));
  assert.equal(pointsValue(100, 'Nope').known, false);
});
test('irr of a simple one-year 5% loan', () => { near(irr([{ date: '2026-01-01', cents: -10000 }, { date: '2027-01-01', cents: 10500 }]), 5, 0.05); });
test('ledger: net, per hour and the $50 worth-it line', () => {
  const e = { id: 1, kind: 'investment', issuer: 'Scotia', status: 'paid', received_cents: $(1000), fees_cents: $(100), capital_cents: $(50000), locked_from: '2026-01-01', locked_to: '2027-01-01', capital_earning: 1 };
  const t = entryTotals(e, DEFAULTS, [{ hours: 4 }]);
  assert.equal(t.net_cents, $(900)); assert.equal(t.per_hour_cents, $(225)); assert.equal(t.worth_it, true); near(t.annual_return_pct, 1.8, 0.05);
  assert.equal(entryTotals({ ...e, received_cents: $(100), fees_cents: 0 }, DEFAULTS, [{ hours: 4 }]).worth_it, false);
  assert.equal(entryTotals({ ...e, capital_earning: 0 }, DEFAULTS, []).opportunity_cents, Math.round($(50000) * 0.07));
  const r = report([e, { ...e, id: 2, kind: 'card', issuer: 'Amex', received_on: '2026-05-01' }], new Map([[1, [{ hours: 4 }]]]));
  assert.equal(r.total.count, 2); assert.equal(r.by_kind.length, 2);
});
test('effort proposal uses the average of finished offers', () => {
  const entries = [{ id: 1, kind: 'card', status: 'paid' }, { id: 2, kind: 'card', status: 'paid' }];
  const logs = [{ ref_type: 'ledger', ref_id: 1, hours: 1 }, { ref_type: 'ledger', ref_id: 2, hours: 2 }];
  const p = proposeEffort(entries, logs, DEFAULTS.effort_hours);
  assert.equal(p.credit_card.average, 1.5); assert.equal(p.credit_card.differs, true);
});
test('plan steps come from the offer dates in order', () => {
  const s = planFromOffer({ ...scotia, enrol_by: '2027-04-01', fund_by: '2027-05-31', window_end: '2027-06-30' });
  assert.deepEqual(s.map((x) => x.step_date), [...s.map((x) => x.step_date)].sort());
  assert.ok(s.some((x) => /Enrol/.test(x.title)) && s.filter((x) => /Bonus due/.test(x.title)).length === 2);
});
