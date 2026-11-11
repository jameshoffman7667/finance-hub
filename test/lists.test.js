import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client, signUp } from './helpers.js';

async function setup() {
  const app = await startApp(); const c = client(app.base); const u = await signUp(c);
  return { app, c, u };
}
const csv = (rows, head = 'Date,Description,Memo,Ref,Amount,Balance') => [head, ...rows].join('\n');

test('accounts: label, edit, usage and delete with and without data', async () => {
  const { app, c } = await setup();
  const a = (await c.post('/api/accounts', { name: 'Everyday', institution: 'TD', owner: 'James', type: 'chequing' })).json;
  const list = (await c.get('/api/accounts')).json;
  assert.equal(list.accounts[0].label, 'Everyday, TD, Chequing, James');
  assert.deepEqual(list.institutions, ['TD']); assert.deepEqual(list.owners, ['James']);
  const p = await c.patch(`/api/accounts/${a.id}`, { name: 'Daily', institution: 'RBC', owner: '', type: 'savings' });
  assert.equal(p.status, 200);
  assert.equal((await c.get('/api/accounts')).json.accounts[0].label, 'Daily, RBC, Savings');
  assert.equal((await c.get(`/api/accounts/${a.id}/usage`)).json.has_data, false);
  assert.equal((await c.del(`/api/accounts/${a.id}`)).status, 200);
  const b = (await c.post('/api/accounts', { name: 'Card', type: 'credit_card' })).json;
  await c.post(`/api/accounts/${b.id}/valuations`, { as_of: '2026-01-01', value: '10' });
  assert.equal((await c.del(`/api/accounts/${b.id}`)).status, 409);
  assert.equal((await c.del(`/api/accounts/${b.id}`, { delete_data: true })).status, 200);
  assert.equal((await c.get('/api/accounts')).json.accounts.length, 0);
  await app.close();
});

test('import: comment, reference, search, file balance, manual balance protection, saved mapping', async () => {
  const { app, c, u } = await setup();
  const a = (await c.post('/api/accounts', { name: 'Chq', type: 'chequing' })).json;
  await c.post('/api/rules', { pattern: 'refund-me', category_id: (await c.get('/api/categories')).json.categories.find((x) => x.name === 'Groceries').id, field: 'comment' });
  const text = csv(['2026-03-01,Store A,refund-me please,R100,-10.00,990.00', '2026-03-02,Store B,,R101,-5.00,985.00']);
  await c.post(`/api/accounts/${a.id}/valuations`, { as_of: '2026-03-02', value: '1' });
  const pv = (await c.post('/api/imports/preview', { account_id: a.id, text })).json;
  assert.equal(pv.sample[0].comment, 'refund-me please'); assert.equal(pv.sample[0].reference, 'R100');
  assert.equal(pv.balance.source, 'file'); assert.equal(pv.balance.value_cents, 98500); assert.equal(pv.balance.existing_manual_cents, 100);
  assert.equal(pv.categorised, 1);
  const r1 = (await c.post('/api/imports', { account_id: a.id, text, filename: 'x.csv', balance: { as_of: pv.balance.as_of, value_cents: 98500 } })).json;
  assert.equal(r1.balance_kept_manual, true); assert.equal(r1.balance_saved, false);
  const tx = (await c.get('/api/transactions?q=R100')).json;
  assert.equal(tx.transactions.length, 1); assert.equal(tx.transactions[0].comment, 'refund-me please');
  assert.ok(tx.transactions[0].category);
  const text2 = csv(['2026-03-03,Store C,,R102,-1.00,984.00']);
  const pv2 = (await c.post('/api/imports/preview', { account_id: a.id, text: text2, mapping: undefined })).json;
  assert.equal(pv2.mapping.comment, pv.mapping.comment);
  const r2 = (await c.post('/api/imports', { account_id: a.id, text: text2, filename: 'y.csv', balance: { as_of: '2026-03-03', value_cents: 98400 } })).json;
  assert.equal(r2.balance_saved, true);
  await c.post('/api/stepup', { password: u.password });
  const csvOut = (await c.raw('GET', '/api/export/transactions.csv')).text;
  assert.match(csvOut, /comment/i); assert.match(csvOut, /refund-me please/);
  await app.close();
});

test('categories: no creation, sub-categories, rename, remove with move, lists', async () => {
  const { app, c } = await setup();
  assert.notEqual((await c.post('/api/categories', { name: 'Mine', kind: 'expense' })).status, 200);
  const cats = (await c.get('/api/categories')).json.categories;
  const names = cats.map((x) => x.name);
  for (const n of ['Credit card payment', 'Loan payment', 'Cash withdrawal', 'Cash deposit', 'Cash returned to account', 'Children and Pets']) assert.ok(names.includes(n), n);
  const hous = cats.find((x) => x.name === 'Housing');
  const sub = (await c.post('/api/subcategories', { category_id: hous.id, name: 'Improvement' })).json;
  assert.ok(sub.id);
  assert.equal((await c.post('/api/subcategories', { category_id: hous.id, name: 'Improvement' })).status, 409);
  const l = (await c.get('/api/lists')).json;
  assert.ok(l.categories.find((x) => x.name === 'Housing').subs.length === 1);
  assert.ok(l.categories.find((x) => x.name === 'Children and Pets').suggested.includes('Child care'));
  const acc = (await c.post('/api/accounts', { name: 'A', institution: 'TD', owner: 'J', type: 'chequing' })).json;
  const ren = await c.post('/api/lists/institution/rename', { from: 'TD', to: 'Toronto Dominion' });
  assert.equal(ren.status, 200);
  assert.equal((await c.get('/api/accounts')).json.accounts[0].institution, 'Toronto Dominion');
  const rm = await c.post('/api/lists/owner/remove', { value: 'J' });
  assert.equal(rm.status, 200);
  assert.equal((await c.get('/api/accounts')).json.accounts[0].owner, '');
  const food = cats.find((x) => x.name === 'Groceries');
  const del = await c.del(`/api/categories/${food.id}`, { move_to: hous.id });
  assert.equal(del.status, 200);
  assert.ok(!(await c.get('/api/categories')).json.categories.some((x) => x.name === 'Groceries'));
  await app.close();
});

test('cash returned nets into cash withdrawal in the spending report', async () => {
  const { app, c } = await setup();
  const a = (await c.post('/api/accounts', { name: 'Chq', type: 'chequing' })).json;
  const cats = (await c.get('/api/categories')).json.categories;
  const w = cats.find((x) => x.name === 'Cash withdrawal'), r = cats.find((x) => x.name === 'Cash returned to account');
  const text = csv(['2026-03-01,ATM,,,-100.00,', '2026-03-05,Deposit back,,,30.00,'], 'Date,Description,Memo,Ref,Amount,Balance');
  await c.post('/api/imports', { account_id: a.id, text, filename: 'c.csv' });
  const tx = (await c.get('/api/transactions')).json.transactions;
  for (const t of tx) await c.patch(`/api/transactions/${t.id}`, { category_id: t.amount_cents < 0 ? w.id : r.id });
  const rep = (await c.get('/api/reports/spending?from=2026-03-01&to=2026-03-31')).json;
  const row = rep.categories.find((x) => x.name === 'Cash withdrawal');
  assert.equal(row.spent_cents, 7000);
  assert.ok(!rep.categories.some((x) => x.name === 'Cash returned to account'));
  await app.close();
});
