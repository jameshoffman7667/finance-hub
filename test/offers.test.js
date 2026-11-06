import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { addMonths, addDays } from '../src/dates.js';
import { evaluate, fromCard, fromAccount } from '../src/eligibility.js';
import { nextCharge, yearlyCents, monthlyCents } from '../src/recurring.js';
import { startApp, client, signUp } from './helpers.js';

test('addMonths clamps like Excel EDATE and addDays crosses months', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-11-15', 14), '2028-01-15');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

const rule = (o) => ({ id: 1, name: 'r', issuer: 'Bank A', applies_to: '', scope: 'any_card', once_per_lifetime: 0, wait_months: 24, counted_from: 'closed', blocked_while_held: 1, min_days_between: null, verified: 0, ...o });
const card = (o) => ({ id: 1, label: 'C-001', issuer: 'Bank A', product: 'Gold', family: '', status: 'closed', approved_on: '2024-01-10', applied_on: '2024-01-05', closed_on: '2025-03-31', ...o });
const run = (c, others, rules, today = '2026-06-01') => {
  const all = [c, ...others].map((x) => fromCard(x, x.bonuses || []));
  return evaluate(all[0], rules, all, today);
};

test('wait counted from the latest close across every card of the issuer', () => {
  const r = rule({});
  const other = card({ id: 2, label: 'C-002', product: 'Platinum', closed_on: '2025-09-30' });
  const e = run(card({}), [other], [r]);
  assert.equal(e.code, 'wait');
  assert.equal(e.eligibleFrom, '2027-09-30');
  assert.equal(run(card({}), [], [r]).eligibleFrom, '2027-03-31');
  assert.equal(run(card({}), [], [r], '2027-04-01').code, 'eligible');
});

test('same-card scope ignores other products of the issuer', () => {
  const r = rule({ scope: 'same_card' });
  const other = card({ id: 2, product: 'Platinum', closed_on: '2026-05-01' });
  assert.equal(run(card({}), [other], [r]).eligibleFrom, '2027-03-31');
});

test('a downgrade counts as closing the old product', () => {
  const c = card({ status: 'downgraded', closed_on: null, downgraded_on: '2025-07-03' });
  assert.equal(run(c, [], [rule({})]).eligibleFrom, '2027-07-03');
});

test('held card blocks the wait rule; once-per-lifetime wins over held; missing data is reported', () => {
  const held = card({ id: 2, status: 'open', closed_on: null });
  assert.equal(run(card({}), [held], [rule({})]).code, 'held');
  assert.equal(run(held, [], [rule({ once_per_lifetime: 1 })]).code, 'once');
  assert.equal(run(card({ closed_on: null }), [], [rule({})]).code, 'missing_date');
  assert.equal(run(card({}), [], [rule({ wait_months: null })]).code, 'unknown_wait');
  assert.equal(run(card({}), [], []).code, 'no_rule');
  assert.equal(run(card({}), [], [rule({ issuer: 'Other' })]).code, 'no_rule');
});

test('a named rule beats a blanket one, and an explicit rule name wins', () => {
  const blanket = rule({ id: 1, name: 'blanket', wait_months: 24 });
  const named = rule({ id: 2, name: 'gold only', applies_to: 'Gold', wait_months: 12 });
  assert.equal(run(card({}), [], [blanket, named]).rule, 'gold only');
  assert.equal(run(card({ rule_name: 'blanket' }), [], [blanket, named]).rule, 'blanket');
});

test('minimum days between applications gives the next application date; accounts use the institution', () => {
  const e = run(card({ applied_on: '2026-05-20' }), [], [rule({ min_days_between: 90, wait_months: 0 })]);
  assert.equal(e.nextApplication, '2026-08-18');
  const acct = { id: 1, kind: 'bank', institution: 'Bank A', account_type: 'Chequing', status: 'closed_me', opened_on: '2025-01-01', closed_on: '2025-06-30' };
  const items = [fromAccount(acct, [])];
  assert.equal(evaluate(items[0], [rule({ scope: 'any_account', wait_months: 12 })], items, '2026-06-01').eligibleFrom, '2026-06-30');
});

test('recurring: next charge, yearly and monthly cost', () => {
  const r = { frequency: 'monthly', anchor_date: '2026-01-31', status: 'active', amount_cents: 1699 };
  assert.equal(nextCharge(r, '2026-11-05'), '2026-11-30');
  assert.equal(nextCharge({ ...r, frequency: 'biweekly', anchor_date: '2026-10-30' }, '2026-11-05'), '2026-11-13');
  assert.equal(nextCharge({ ...r, frequency: 'yearly', anchor_date: '2025-12-01' }, '2026-11-05'), '2026-12-01');
  assert.equal(nextCharge({ ...r, status: 'cancelled' }, '2026-11-05'), null);
  assert.equal(nextCharge({ ...r, end_date: '2026-10-01' }, '2026-11-05'), null);
  assert.equal(yearlyCents(r), 20388);
  assert.equal(monthlyCents({ ...r, frequency: 'yearly', amount_cents: 12000 }), 1000);
});

// ---------- API ----------
async function signedIn() {
  const a = await startApp();
  const c = client(a.base);
  await signUp(c);
  return { a, c };
}

test('cards CRUD with bonuses, derived deadlines, last-4 rule and confirm', async () => {
  const { a, c } = await signedIn();
  const rr = await c.post('/api/offers/rules', { name: 'Bank A any card', issuer: 'Bank A', scope: 'any_card', counted_from: 'closed', wait_months: 12, blocked_while_held: true });
  assert.equal(rr.status, 201, rr.text);
  const bad = await c.post('/api/offers/cards', { issuer: 'Bank A', product: 'Gold', status: 'open', last4: '12345678' });
  assert.equal(bad.status, 400);
  const mk = await c.post('/api/offers/cards', { issuer: 'Bank A', product: 'Gold', status: 'open', last4: '1234', approved_on: '2026-10-01', due_day: 20, spend_progress_cents: '1200.00', cpp_cash: 1, cpp_best: 2,
    bonuses: [{ bonus_type: 'welcome', amount: 50000, spend_required_cents: '3000', months_to_qualify: 3, outcome: 'in_progress' }, { bonus_type: 'welcome', amount: 10000, outcome: 'earned', received_on: '2026-10-20' }] });
  assert.equal(mk.status, 201, mk.text);
  const list = (await c.get('/api/offers/cards')).json.items;
  assert.equal(list.length, 1);
  const card = list[0];
  assert.equal(card.label, 'C-001');
  assert.equal(card.next_deadline, '2027-01-01');
  assert.equal(card.spend_still_needed_cents, 180000);
  assert.equal(card.points_earned, 10000);
  assert.equal(card.bonus_cash_cents, 10000);
  assert.equal(card.bonus_best_cents, 20000);
  assert.equal(card.eligibility.code, 'held');
  assert.equal(card.bonuses.length, 2);
  // more than 4 bonuses refused
  const five = await c.patch(`/api/offers/cards/${card.id}`, { bonuses: [1, 2, 3, 4, 5].map(() => ({ outcome: 'in_progress' })) });
  assert.equal(five.status, 400);
  // freezing and closing update status and the rule result
  assert.equal((await c.patch(`/api/offers/cards/${card.id}`, { status: 'closed', closed_on: '2026-06-01', locked: true })).status, 200);
  const after = (await c.get('/api/offers/cards')).json.items[0];
  assert.equal(after.status, 'closed'); assert.equal(after.locked, 1);
  assert.equal(after.eligibility.eligibleFrom, '2027-06-01');
  assert.equal((await c.patch(`/api/offers/cards/${card.id}`, { status: 'weird' })).status, 400);
  assert.equal((await c.del(`/api/offers/cards/${card.id}`)).status, 200);
  assert.equal((await c.get('/api/offers/cards')).json.items.length, 0);
  await a.close();
});

test('endpoints need sign-in and a CSRF token', async () => {
  const a = await startApp();
  const anon = client(a.base);
  for (const u of ['/api/offers/cards', '/api/offers/accounts', '/api/offers/recurring', '/api/offers/rules', '/api/offers/summary', '/api/offers/schema']) assert.equal((await anon.get(u)).status, 401, u);
  const c = client(a.base); await signUp(c);
  const noCsrf = await c.raw('POST', '/api/offers/cards', { issuer: 'X', product: 'Y', status: 'open' }, { headers: { 'X-CSRF-Token': 'wrong' } });
  assert.equal(noCsrf.status, 403);
  await a.close();
});

test('accounts: bank and investment labels, bonus clawback date, recurring with next charge and summary', async () => {
  const { a, c } = await signedIn();
  const b = await c.post('/api/offers/accounts', { kind: 'bank', institution: 'Bank A', account_type: 'Chequing', status: 'open', opened_on: '2026-01-15', bonuses: [{ bonus_type: 'Sign-up', offered_cents: '300', outcome: 'earned', received_on: '2026-03-01', received_cents: '300' }] });
  const i = await c.post('/api/offers/accounts', { kind: 'invest', institution: 'Broker B', account_type: 'TFSA', status: 'open', opened_on: '2026-02-01', bonuses: [{ bonus_type: 'Transfer-in', offered_cents: '200', outcome: 'earned', received_on: '2026-05-01', received_cents: '200', months_keep_funds: 12 }] });
  assert.equal(b.status, 201, b.text); assert.equal(i.status, 201, i.text);
  const items = (await c.get('/api/offers/accounts')).json.items;
  assert.deepEqual(items.map((x) => x.label).sort(), ['B-001', 'I-001']);
  const inv = items.find((x) => x.kind === 'invest');
  assert.equal(inv.bonuses[0].keep_until, '2027-05-01');
  assert.equal(items.find((x) => x.kind === 'bank').bonus_received_cents, 30000);
  const card = (await c.post('/api/offers/cards', { issuer: 'Bank A', product: 'Gold', status: 'open' })).json.id;
  const rec = await c.post('/api/offers/recurring', { name: 'Streaming', amount_cents: '16.99', frequency: 'monthly', anchor_date: '2026-01-19', status: 'active', card_id: card, remind_days: 60 });
  assert.equal(rec.status, 201, rec.text);
  const r = (await c.get('/api/offers/recurring')).json.items[0];
  assert.equal(r.amount_cents, 1699); assert.equal(r.yearly_cents, 20388); assert.match(r.next_charge, /^\d{4}-\d{2}-19$/); assert.match(r.method, /Bank A Gold/);
  assert.equal((await c.post('/api/offers/recurring', { name: 'X', amount_cents: '1', frequency: 'monthly', anchor_date: '2026-01-19', status: 'active', card_id: 9999 })).status, 400);
  const sum = (await c.get('/api/offers/summary')).json;
  assert.equal(sum.cards.open, 1);
  assert.ok(sum.alerts.some((x) => x.kind === 'recurring'));
  assert.ok(sum.alerts.some((x) => x.kind === 'clawback'));
  await a.close();
});

// ---------- workbook import ----------
async function sampleWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = (name, headers, rows, redCells = []) => {
    const ws = wb.addWorksheet(name);
    ws.addRow([name]); ws.addRow(['hint']); ws.addRow(['hint']);
    ws.addRow(headers);
    for (const r of rows) ws.addRow(r);
    for (const [row, col] of redCells) ws.getRow(row).getCell(col).font = { color: { argb: 'FFFF0000' } };
  };
  const cardHeaders = ['ID\n(C-001...)', 'Owner *', 'Issuer *', 'Card product *', 'Card family', 'Network', 'Personal or business', 'Last 4 digits', 'Status *\n(Open / Frozen / Closed)', 'Card locked?', 'Application date', 'Approval date *', 'Date confidence',
    'Credit limit ($)', 'Annual fee ($)', 'First-year fee waived?', 'Hard credit check?', 'Referral used?', 'Rewards program', 'Point value: cash\n(cents per point)', 'Point value: best use\n(cents per point)', 'Statement closes\n(day of month)', 'Payment due\n(day of month)',
    'Downgrade / product-change date', 'Downgraded to (card)', 'Closed date', 'Final balance settled date', 'Why closed', 'Credit (negative) balance to spend ($)', 'Issuer rule\n(from Issuer rules)', 'Minimum spend progress ($)\nspent so far', 'Spend as of (date)',
    'Sign-up cashback received ($)', 'Bonus consumed?\n(points redeemed)', 'Bonus consumed on', 'Bonus clawback period (months from opening)',
    'Bonus 1\ntype', 'Bonus 1\nwhat the offer said', 'Bonus 1\npoints or cash offered', 'Bonus 1\nspend required ($)', 'Bonus 1\nmonths from approval to qualify', 'Bonus 1\nqualify-by (auto)', 'Bonus 1\noutcome', 'Bonus 1\ndate received', 'Notes'];
  const blank = (n) => Array(n).fill(null);
  const c1 = ['C-001', 'Sam', 'Bank A', 'Gold Visa', 'Gold', 'Visa', 'Personal', '1111', 'Open', 'No', new Date(Date.UTC(2026, 8, 1)), new Date(Date.UTC(2026, 8, 5)), 'Exact date', 5000, 120, 'Yes', 'Yes', 'No', 'Points', 1, 2, 12, 5,
    null, null, null, null, null, -50, 'Bank A any', 400, new Date(Date.UTC(2026, 9, 1)), null, 'No', null, 12,
    'Welcome / spend', '40,000 points', 40000, 3000, 3, null, 'In progress', null, 'note'];
  const c2 = ['EXAMPLE', ...blank(cardHeaders.length - 1)];
  sheet('Cards', cardHeaders, [c1, c2], [[5, 20], [5, 38]]);
  sheet('Bank accounts', ['ID\n(B-001...)', 'Owner *', 'Bank / institution *', 'Account type *', 'Account name', 'Last 4 digits', 'Status *', 'Opened date *', 'Date confidence', 'Closed date', 'Why closed', 'Monthly fee ($)', 'Minimum balance to avoid fee ($)', 'Notes'],
    [['B-001', 'Sam', 'Bank A', 'Chequing', null, 'oops', 'Open', new Date(Date.UTC(2026, 0, 15)), 'Exact date', null, null, 10, 2000, null]]);
  sheet('Bank account bonuses', ['Account ID *\n(from Bank accounts)', 'Account\n(auto)', 'Institution\n(auto)', 'Account type\n(auto)', 'Bonus type *', 'What the offer said', 'Bonus offered ($)', 'What you had to do', 'Months from opening to qualify', 'Qualify-by date\n(auto)', 'Outcome *', 'Date received', 'Bonus received ($)', 'Referral used?', 'Issuer rule\n(from Issuer rules)', 'Notes'],
    [['B-001', null, null, null, 'Sign-up', '$300', 300, 'Direct deposit', 3, null, 'Earned', new Date(Date.UTC(2026, 3, 1)), 300, 'No', 'Bank A any', null], ['B-404', null, null, null, 'Sign-up', 'x', 1, null, null, null, 'Missed', null, null, null, null, null]]);
  sheet('Investment accounts', ['ID\n(I-001...)', 'Owner *', 'Brokerage / institution *', 'Account type *', 'Account name', 'Last 4 digits', 'Status *', 'Opened date *', 'Date confidence', 'Closed / transferred-out date', 'Why closed', 'Currency', 'Notes'], []);
  sheet('Investment bonuses', ['Account ID *', 'Account', 'Institution', 'Account type', 'Bonus type *', 'What the offer said'], []);
  sheet('Recurring payments', ['Name *', 'Category', 'Price *', 'Currency', 'Frequency *', 'Date *\n(any date)', 'Paid by card', 'Paid from bank account', 'Other payment method', 'Auto-pay?', 'Status', 'End date', 'Remind me (days before)', 'Notes'],
    [['Streaming', 'Subscriptions', 16.99, 'CAD', 'Monthly', new Date(Date.UTC(2026, 9, 19)), 'C-001', null, null, 'Yes', 'Active', null, 3, null]]);
  sheet('Issuer rules', ['Rule name *\n(you choose)', 'Issuer / institution', 'Applies to (product or family)', 'Scope', 'Bonus only once per lifetime? *', 'Wait before a new bonus (months) *', 'Months counted from *', 'Blocked while you still hold a matching card?', 'Min days between new applications to this issuer', 'Source / how sure are you', 'Rule last checked'],
    [['Bank A any', 'Bank A', null, 'Any card from the issuer', 'No', 12, 'Closed date', 'Yes', null, 'Forum post', new Date(Date.UTC(2026, 10, 2))]], [[5, 6]]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('workbook import: preview, add-only, red text becomes unconfirmed, overwrite, bad rows reported', async () => {
  const { a, c } = await signedIn();
  const file_base64 = (await sampleWorkbook()).toString('base64');
  assert.equal((await c.post('/api/workbook/preview', { file_base64: 'AAAA' })).status, 400);
  const pv = (await c.post('/api/workbook/preview', { file_base64 })).json;
  assert.deepEqual(pv.counts, { cards: 1, bonuses: 1, accounts: 1, account_bonuses: 1, recurring: 1, rules: 1 });
  assert.ok(pv.warnings.some((w) => /last4/.test(w)));
  assert.ok(pv.warnings.some((w) => /B-404/.test(w)));
  const imp = (await c.post('/api/workbook/import', { file_base64 })).json;
  assert.deepEqual(imp.added, { cards: 1, accounts: 1, recurring: 1, rules: 1 });
  const card = (await c.get('/api/offers/cards')).json.items[0];
  assert.equal(card.label, 'C-001'); assert.equal(card.status, 'open'); assert.equal(card.credit_balance_cents, -5000);
  assert.deepEqual(card.unconfirmed.sort(), ['cpp_cash']); assert.deepEqual(card.bonuses[0].unconfirmed, ['offer_text']);
  assert.equal(card.bonuses[0].spend_required_cents, 300000); assert.equal(card.bonuses[0].outcome, 'in_progress');
  assert.equal(card.spend_progress_cents, 40000);
  assert.equal(card.eligibility.code, 'held');
  const rules = (await c.get('/api/offers/rules')).json.items;
  assert.equal(rules[0].verified, 0); assert.deepEqual(rules[0].unconfirmed, ['wait_months']);
  const rec = (await c.get('/api/offers/recurring')).json.items[0];
  assert.equal(rec.card_id, card.id); assert.equal(rec.amount_cents, 1699);
  const acct = (await c.get('/api/offers/accounts')).json.items[0];
  assert.equal(acct.last4, null); assert.equal(acct.rule_name, 'Bank A any'); assert.equal(acct.bonuses.length, 1);
  // add-only leaves in-app edits alone; overwrite restores the workbook value
  await c.patch(`/api/offers/cards/${card.id}`, { product: 'Gold Visa EDITED' });
  const again = (await c.post('/api/workbook/import', { file_base64 })).json;
  assert.equal(again.skipped.cards, 1); assert.equal(again.added.cards, 0);
  assert.equal((await c.get('/api/offers/cards')).json.items[0].product, 'Gold Visa EDITED');
  await c.post('/api/workbook/import', { file_base64, mode: 'overwrite' });
  assert.equal((await c.get('/api/offers/cards')).json.items[0].product, 'Gold Visa');
  // editing a red field clears its flag; confirm clears the rest
  await c.patch(`/api/offers/cards/${card.id}`, { cpp_cash: 1.5 });
  assert.deepEqual((await c.get('/api/offers/cards')).json.items[0].unconfirmed, []);
  await a.close();
});
